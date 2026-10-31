/**
 * 参数竞技场（ADR-0017）：把「哪套参数更强」从观感变成**可以复算的数字**。
 *
 * 与策略包同一条铁律（ADR-0015）：本模块是**纯函数** —— 只依赖 `@sixty/engine` 与包内模块，
 * 没有 IO、没有 `Math.random`、没有 `Date.now`（纯度守卫扫这一份文件）；随机源一律由调用方
 * 以 `rng` / `rngFactory` 注入，于是「同一种子 → 逐字节相同的结果」在竞技场里也成立。
 *
 * 两种台子：
 * - `runDealCell`（单副台）—— 每副一副新牌、级别钉死（默认覆盖 13 个级牌）、真叫牌、打到结算。
 *   主力台：**同一颗种子 = 同一副牌**，所以两个 cell 拿到的牌完全一样，比较是配对的。
 *   只改打牌参数时连叫牌与合同都一样（叫牌参数没动），配对的强度最高。
 * - `runGameCell`（整局台）—— 从 `createGame` 打到 `status === 'finished'`，覆盖真实的级别分化、
 *   叫牌歧义与「谁先打完」。种子是共同随机数：同一个种子下两边的发牌序列尽量同源。
 *
 * 座位轮换（`assign`）是设计的一部分：把变体依次放到 0/1/2 三个座位上再取平均，
 * 座位与角色的系统性偏差就被消掉了 —— 这正是「2 个基线 + 1 个变体」与「1 个基线 + 2 个变体」
 * 能用同一套数说清楚的原因。
 *
 * 所有「变体真的改变了下法吗」的证据都从 `(视图, 动作)` 流里**推**出来（`DealCounters`），
 * 不给策略埋钩子：计数为 0 的变体就是「这个开关没接线」，必须如实上报。
 */
import {
  cardClass,
  cardsPoints,
  classOfSet,
  createGame,
  dealWith,
  dispatch,
  isJoker,
  levelProgress,
  personalView,
  trickWinner,
  type Action,
  type Card,
  type Contract,
  type DealSummary,
  type GameState,
  type Level,
  type RNG,
  type Seat,
  type Strain,
  type TrumpModel
} from '@sixty/engine';
import {
  fallbackFor,
  moveFor,
  partnerSeatOf,
  type BotMove,
  type BotParams
} from './policy.ts';

/** 三家座位上的参数（下标 = 座位号；`undefined` = 基线） */
export type SeatParams = readonly (Partial<BotParams> | undefined)[];

/** 一个 cell 里的「配置」：只写要改的那几项，其余落基线（见 `paramsOf`） */
export type ArenaConfig = Partial<BotParams> | undefined;

const STEP_CAP = 60_000;
const DEAL_CAP = 400;

/** 引擎的 `dispatch` 要 rng，但竞技场只 dispatch bid/bury/play/deal 之外的动作用不到它 */
const deadRng: RNG = () => 0;

// ---------------------------------------------------------------------------
// 记录形状
// ---------------------------------------------------------------------------

/**
 * 从 `(视图, 动作)` 流里推出的机制计数：**变体真的换了下法**的证据。
 * 名字都对应一个开关，方便「开关拨了但计数为 0 ⇒ 没接线」当场暴露。
 */
export interface DealCounters {
  /** 叫牌：开叫机会 / 其中真开叫 / 已有最高叫品时的竞叫（`bidBar`、`bidJump`） */
  readonly openingChances: number;
  readonly openings: number;
  readonly competitions: number;
  /** 领出总数 / 单张主牌领出（吊主的代理指标）/ 大王单张领出 / 副门多张领出 */
  readonly leads: number;
  readonly trumpLeads: number;
  readonly bigJokerLeads: number;
  readonly sideMultiLeads: number;
  /** 缺门用主牌门出牌（杀牌）：次数 / 其中真赢下这一墩的次数 */
  readonly ruffAttempts: number;
  readonly ruffsWon: number;
  /** 我是第三家且此刻赢家是同伴的回合数（同伴概念的作用面） */
  readonly partnerSettledTurns: number;
  /** 其中「我把这一墩从同伴手里抢过来」的次数（`partnerAware` 应压到 0；含用主牌抢） */
  readonly partnerOvertakes: number;
  /** 其中「我把分垫给同伴」的次数与分数（`feedPartner` 应把它抬起来） */
  readonly partnerFeeds: number;
  readonly partnerFeedPoints: number;
  /** 我出的牌最后进了庄家的账：次数与分数（垫牌积极性的方向性证据） */
  readonly pointsToDeclarer: number;
  readonly pointsToDeclarerPoints: number;
  /** 我是第三家且真赢下这一墩的次数（争墩积极性） */
  readonly tricksWon: number;
}

/** `DealCounters` 的可变版（驱动器边打边累加，出记录时按座位冻结成只读形状） */
type MutableCounters = { -readonly [K in keyof DealCounters]: number };

function emptyCounters(): MutableCounters {
  return {
    openingChances: 0,
    openings: 0,
    competitions: 0,
    leads: 0,
    trumpLeads: 0,
    bigJokerLeads: 0,
    sideMultiLeads: 0,
    ruffAttempts: 0,
    ruffsWon: 0,
    partnerSettledTurns: 0,
    partnerOvertakes: 0,
    partnerFeeds: 0,
    partnerFeedPoints: 0,
    pointsToDeclarer: 0,
    pointsToDeclarerPoints: 0,
    tricksWon: 0
  };
}

/** 三家各自的计数（下标 = 座位号）：这样「变体真的换了下法吗」能归到配置上，而不是整副平均 */
export type SeatCounters = readonly [DealCounters, DealCounters, DealCounters];

function emptySeatCounters(): [MutableCounters, MutableCounters, MutableCounters] {
  return [emptyCounters(), emptyCounters(), emptyCounters()];
}

/**
 * 把某个配置名下所有座位的计数加起来 —— 「这个开关拨了之后，杀牌/喂分真的变多了吗」。
 * `null` 表示这个配置在记录里一个座位都没占到（例如单副台某一轮换里）。
 */
export function countersOfConfig(
  records: readonly { readonly configOfSeat: readonly [number, number, number]; readonly counters: SeatCounters }[],
  config: number
): DealCounters {
  const total = emptyCounters();
  for (const record of records) {
    for (const seat of [0, 1, 2] as Seat[]) {
      if (record.configOfSeat[seat] !== config) continue;
      const one = record.counters[seat];
      for (const key of Object.keys(total) as (keyof MutableCounters)[]) total[key] += one[key];
    }
  }
  return total;
}

/** 一副的结果：`unreached` = 一直全 pass 到重发上限，这副没打成 */
export interface DealRecord {
  readonly seed: number;
  readonly rotation: number;
  readonly dealNo: number;
  /** 每家座位上坐的是哪个**配置下标**（`configs` 的下标）—— 轮换就是靠它做出来的 */
  readonly configOfSeat: readonly [number, number, number];
  readonly contract: Contract | null;
  readonly trump: TrumpModel | null;
  readonly summary: DealSummary | null;
  readonly unreached: boolean;
  /** 全 pass 重发次数（叫牌积极性的直接读数；桌子级事实，所以不塞进按座位的计数） */
  readonly redeals: number;
  /** 这一副开打前三家的进度（级牌采样是否覆盖到就写在这里） */
  readonly levels: readonly Level[];
  /** 三家这一副各涨了几级（结算公式给的） */
  readonly improvements: readonly [number, number, number];
  readonly counters: SeatCounters;
}

/** 一整局的结果 */
export interface GameRecord {
  readonly seed: number;
  readonly rotation: number;
  readonly configOfSeat: readonly [number, number, number];
  readonly status: 'playing' | 'finished';
  readonly deals: number;
  readonly redeals: number;
  readonly summaries: readonly DealSummary[];
  /** 终局三家进度（`levelProgress`）；`finished` 为 false 时是步数/副数上限截断处 */
  readonly progress: readonly [number, number, number];
  readonly ranking: readonly Seat[] | null;
  readonly counters: SeatCounters;
}

// ---------------------------------------------------------------------------
// 驱动器
// ---------------------------------------------------------------------------

function withSeat(move: BotMove, seat: Seat): Action {
  switch (move.type) {
    case 'bid':
      return { type: 'bid', seat, call: move.call };
    case 'bury':
      return { type: 'bury', seat, cards: move.cards };
    case 'play':
      return { type: 'play', seat, cards: move.cards };
  }
}

/** 此刻该谁行动（scored / 无牌局 → null：驱动器里「发牌」是它自己的活） */
function actorOf(state: GameState): Seat | null {
  const deal = state.deal;
  if (deal === null) return null;
  if (deal.phase === 'auction') return ((deal.dealerSeat + deal.auction.length) % 3) as Seat;
  if (deal.phase === 'bury') return deal.contract!.declarerSeat;
  if (deal.phase === 'play') return ((deal.trick!.leaderSeat + deal.trick!.plays.length) % 3) as Seat;
  return null;
}

/**
 * 把这次决策记进机制计数（**只从视图与动作推**，不看策略内部）。
 * 视图是刚才 `moveFor` 用的那一份，所以这里的「我手里有没有这门」与策略看到的一致。
 */
function countMove(
  view: ReturnType<typeof personalView>,
  actor: Seat,
  move: BotMove,
  c: MutableCounters
): void {
  const deal = view.deal!;
  if (move.type === 'bid') {
    if (deal.auction.length === 0) {
      c.openingChances += 1;
      if (move.call !== 'pass') c.openings += 1;
    } else if (move.call !== 'pass') {
      c.competitions += 1;
    }
    return;
  }
  if (move.type !== 'play') return;

  const t = deal.trump!;
  const trick = deal.trick!;
  const plays = trick.plays;
  const cards = move.cards;
  const cardsCls = classOfSet(cards, t);
  const after = trickWinner([...plays, { seat: actor, cards }], t);
  const last = plays.length === 2;

  if (plays.length === 0) {
    c.leads += 1;
    const single = cards.length === 1 ? cards[0]! : null;
    if (single !== null && isJoker(single) && single.joker === 'big') c.bigJokerLeads += 1;
    if (cardsCls === 'T' && cards.length === 1) c.trumpLeads += 1;
    if (cardsCls !== null && cardsCls !== 'T' && cards.length >= 2) c.sideMultiLeads += 1;
    return;
  }

  const leadCls = classOfSet(plays[0]!.cards, t);
  const holding = view.you.hand.filter((card) => cardClass(card, t) === leadCls);
  if (holding.length === 0 && leadCls !== 'T' && cardsCls === 'T') {
    c.ruffAttempts += 1;
    if (after === actor) c.ruffsWon += 1;
  }

  const partner = partnerSeatOf(actor, deal);
  const winnerBefore = trickWinner(plays, t);
  if (last && partner !== null && winnerBefore === partner) {
    c.partnerSettledTurns += 1;
    if (after === actor) c.partnerOvertakes += 1;
    const given = cardsPoints(cards);
    if (after === partner && given > 0) {
      c.partnerFeeds += 1;
      c.partnerFeedPoints += given;
    }
  }
  if (last) {
    if (after === actor) c.tricksWon += 1;
    const declarer = deal.contract?.declarerSeat ?? null;
    const given = cardsPoints(cards);
    if (declarer !== null && after === declarer && given > 0) {
      c.pointsToDeclarer += 1;
      c.pointsToDeclarerPoints += given;
    }
  }
}

/** 走一步：策略动作 → 引擎；被拒退保底（与服务端 `actAsBot` 同款双保险），绝不卡死 */
function step(
  state: GameState,
  seatParams: SeatParams,
  counters: readonly MutableCounters[]
): GameState {
  const actor = actorOf(state);
  if (actor === null) throw new Error('竞技场：没有可行动的人（应在调用方处理发牌）');
  const view = personalView(state, actor);
  const move = moveFor(view, view.you, seatParams[actor]);
  if (move === null) throw new Error(`竞技场：座位 ${actor}（${state.deal!.phase} 阶段）给不出动作`);
  countMove(view, actor, move, counters[actor]!);

  let result = dispatch(state, withSeat(move, actor), deadRng);
  if (!result.ok) {
    const fallback = fallbackFor(view, view.you, seatParams[actor]);
    if (fallback === null) throw new Error(`竞技场：座位 ${actor} 动作被拒且无保底：${result.message}`);
    result = dispatch(state, withSeat(fallback, actor), deadRng);
  }
  if (!result.ok) throw new Error(`竞技场动作被拒：${result.message}`);
  return result.state;
}

// ---------------------------------------------------------------------------
// 单副台
// ---------------------------------------------------------------------------

/**
 * 单副台的级别：三家同级、`rank = 2 + (seed % 13)` —— 让 13 个级牌（以及它们的副级关系）
 * 在整批样本里**均匀采到**。真实对局的级别分化由整局台覆盖；这里要的是「同一副牌下
 * 两套打法的差异」，把级别钉死反而消掉了一个噪声源。
 */
export function levelsForSeed(seed: number): Level[] {
  const rank = 2 + (((seed % 13) + 13) % 13);
  return [
    { rank, cycle: 0 },
    { rank, cycle: 0 },
    { rank, cycle: 0 }
  ];
}

export interface DealCellInput {
  readonly seeds: readonly number[];
  /** 轮换次数：`rotation ∈ [0, rotations)`，交给 `assign` 决定谁坐哪个配置 */
  readonly rotations: number;
  /** 轮换 → 三家座位上的配置下标 */
  readonly assign: (rotation: number) => readonly [number, number, number];
  /** 配置表：`assign` 给出的下标在这里解引用 */
  readonly configs: readonly ArenaConfig[];
  /** 每（种子, 轮换）一份随机源（本模块不造 rng，保持纯） */
  readonly rngFactory: (seed: number, rotation: number) => RNG;
  readonly maxRedeals?: number;
}

/**
 * 座位轮换：把「轮换前谁坐哪个配置」整体转着放（座位 j 拿 `seatConfigs[(j − rotation) mod 3]`）。
 * 一圈三转取平均就把「座位/角色」的系统性偏差消掉了 —— 1:2 与 2:1 因此能用同一套数说话。
 */
export function rotateSeats(seatConfigs: readonly [number, number, number], rotation: number): readonly [number, number, number] {
  return [0, 1, 2].map((seat) => seatConfigs[(seat - rotation + 3) % 3]!) as unknown as readonly [
    number,
    number,
    number
  ];
}

export function runDealCell(input: DealCellInput): readonly DealRecord[] {
  const out: DealRecord[] = [];
  for (const seed of input.seeds) {
    for (let rotation = 0; rotation < input.rotations; rotation++) {
      const configOfSeat = input.assign(rotation);
      const seatParams: SeatParams = [0, 1, 2].map((s) => input.configs[configOfSeat[s]!]);
      out.push(runDeal(seed, rotation, configOfSeat, seatParams, input.rngFactory(seed, rotation), input.maxRedeals ?? 20));
    }
  }
  return out;
}

/**
 * **只有打牌阶段**的真实牌局重放：定约、将牌、庄家、埋底全部照实（从存档里读），只换参数重打。
 *
 * 与 `runRealDeal` 的区别很关键：那个会连叫牌一起重跑，于是庄家与定约都可能变，
 * 比出来的差异分不清是「打牌变好了」还是「叫牌换了个更划算的定约」。
 * 这里把叫牌的结果钉死，**唯一变量就是三家怎么打** —— 诊断 → 修 → 在那一副上验证，要的就是这个。
 */
export interface RealPlayInput {
  readonly hands: readonly (readonly Card[])[];
  readonly originalKitty: readonly Card[];
  readonly dealerSeat: Seat;
  readonly dealNo: number;
  readonly levels: readonly Level[];
  readonly contract: Contract;
  readonly buried: readonly Card[];
  readonly seatParams: SeatParams;
}

export function runRealPlay(input: RealPlayInput): DealRecord {
  const dealerSeat = input.dealerSeat;
  let state = createGame(dealerSeat);
  state.levels = input.levels.map((l) => ({ ...l }));
  state.deal = dealWith(input.hands, input.originalKitty, dealerSeat, input.dealNo);
  // 手动把这一副推到「埋底」阶段，用**存档里的**定约与将牌（引擎的 bid 分支做的就是这件事，
  // 只是定约来自真实对局而不是重新叫一遍）
  const deal = state.deal;
  deal.contract = { ...input.contract };
  deal.trump = { strain: input.contract.strain, rank: input.levels[input.contract.declarerSeat]!.rank };
  const declarer = input.contract.declarerSeat;
  deal.hands[declarer] = [...deal.hands[declarer]!, ...deal.kitty];
  deal.phase = 'bury';

  const counters = emptySeatCounters();
  // 先按真实的埋底走一步（这一步也是被检查的对象之一：埋底本身由参数决定）
  const buryRes = dispatch(state, {
    type: 'bury',
    seat: declarer,
    cards: input.buried.length === KITTY ? input.buried : deal.hands[declarer]!.slice(0, KITTY)
  }, deadRng);
  if (!buryRes.ok) throw new Error(`真实重放：埋底被拒 ${buryRes.message}`);
  state = buryRes.state;

  for (let steps = 0; steps < STEP_CAP; steps++) {
    const d = state.deal!;
    if (d.phase === 'scored') {
      return {
        seed: input.dealNo,
        rotation: 0,
        dealNo: input.dealNo,
        configOfSeat: [0, 1, 2],
        contract: d.summary!.contract,
        trump: d.summary!.trump,
        summary: d.summary,
        unreached: false,
        redeals: 0,
        levels: input.levels,
        improvements: improvementsOf(state),
        counters
      };
    }
    state = step(state, input.seatParams, counters);
  }
  throw new Error('真实重放（只打牌）步数超限');
}

const KITTY = 3;

/**
 * **真实牌局重放（含叫牌）**：把一副已经结算的牌（三家手牌 + 拿上来的底牌）原样喂给两套参数重打。
 *
 * 用途是「诊断 → 修复 → 在**那副牌上**验证」这条回路：竞技场量的是平均效应，
 * 而用户报的是具体几副牌的毛病（例如表 8 d6#4 把 ♣K 送给外面的 ♣A）。
 * 只有回到那副牌上重放，才能回答「改完之后它还会不会这么打」。
 *
 * `hands` 是**埋底之前**的三家 17 张（庄家在叫牌阶段就是 17 张，合同确定后引擎把底牌并进去），
 * 所以喂进来的牌必须按这个口径拆分 —— 结算摘要里的 `originalKitty` 正好给出了这个拆分。
 *
 * 注意它**连叫牌一起重跑**（庄家与定约都可能变）；要隔离打牌的好差用 `runRealPlay`。
 */
export interface RealDealInput {
  readonly hands: readonly (readonly Card[])[];
  readonly originalKitty: readonly Card[];
  readonly dealerSeat: Seat;
  readonly dealNo: number;
  readonly levels: readonly Level[];
  readonly seatParams: SeatParams;
}

export function runRealDeal(input: RealDealInput): DealRecord {
  const dealerSeat = input.dealerSeat;
  let state = createGame(dealerSeat);
  state.levels = input.levels.map((l) => ({ ...l }));
  state.deal = dealWith(input.hands, input.originalKitty, dealerSeat, input.dealNo);
  const counters = emptySeatCounters();
  let redeals = 0;
  const configOfSeat: [number, number, number] = [0, 1, 2];

  for (let steps = 0; steps < STEP_CAP; steps++) {
    const deal = state.deal!;
    if (deal.phase === 'scored') {
      return {
        seed: input.dealNo,
        rotation: 0,
        dealNo: input.dealNo,
        configOfSeat,
        contract: deal.summary!.contract,
        trump: deal.summary!.trump,
        summary: deal.summary,
        unreached: false,
        redeals,
        levels: input.levels,
        improvements: improvementsOf(state),
        counters
      };
    }
    const before = deal.dealNo;
    state = step(state, input.seatParams, counters);
    if (state.deal!.dealNo !== before) {
      redeals += 1;
      throw new Error('真实牌局重放：这副牌全 pass 重发了（重放固定牌，不该发生）');
    }
  }
  throw new Error('真实牌局重放步数超限');
}

function runDeal(
  seed: number,
  rotation: number,
  configOfSeat: readonly [number, number, number],
  seatParams: SeatParams,
  rng: RNG,
  maxRedeals: number
): DealRecord {
  const levels = levelsForSeed(seed);
  const dealerSeat = (((seed % 3) + 3) % 3) as Seat;
  let state = createGame(dealerSeat);
  state.levels = levels.map((l) => ({ ...l }));
  const counters = emptySeatCounters();
  let redeals = 0;

  const dealt = dispatch(state, { type: 'deal' }, rng);
  if (!dealt.ok) throw new Error(`竞技场发牌被拒：${dealt.message}`);
  state = dealt.state;
  let dealNo = state.dealNo;

  for (let steps = 0; steps < STEP_CAP; steps++) {
    const deal = state.deal!;
    if (deal.phase === 'scored') {
      return {
        seed,
        rotation,
        dealNo,
        configOfSeat,
        contract: deal.summary!.contract,
        trump: deal.summary!.trump,
        summary: deal.summary,
        unreached: false,
        redeals,
        levels,
        improvements: improvementsOf(state),
        counters
      };
    }
    const before = deal.dealNo;
    state = step(state, seatParams, counters);
    if (state.deal!.dealNo !== before) {
      redeals += 1;
      if (redeals > maxRedeals) {
        return {
          seed,
          rotation,
          dealNo,
          configOfSeat,
          contract: null,
          trump: null,
          summary: null,
          unreached: true,
          redeals,
          levels,
          improvements: [0, 0, 0],
          counters
        };
      }
      dealNo = state.dealNo;
    }
  }
  throw new Error('竞技场单副步数超限：策略与引擎大概率漂移了');
}

/** 这副结算里三家各涨了几级（`levelChanges` 是引擎给的事实，不自己算） */
function improvementsOf(state: GameState): [number, number, number] {
  const summary = state.deal?.summary;
  const out: [number, number, number] = [0, 0, 0];
  if (summary === null || summary === undefined) return out;
  for (const change of summary.levelChanges) out[change.seat] = change.levels;
  return out;
}

// ---------------------------------------------------------------------------
// 整局台
// ---------------------------------------------------------------------------

export interface GameCellInput {
  readonly seeds: readonly number[];
  readonly rotations: number;
  readonly assign: (rotation: number) => readonly [number, number, number];
  readonly configs: readonly ArenaConfig[];
  readonly rngFactory: (seed: number, rotation: number) => RNG;
  readonly maxDeals?: number;
}

export function runGameCell(input: GameCellInput): readonly GameRecord[] {
  const out: GameRecord[] = [];
  for (const seed of input.seeds) {
    for (let rotation = 0; rotation < input.rotations; rotation++) {
      const configOfSeat = input.assign(rotation);
      const seatParams: SeatParams = [0, 1, 2].map((s) => input.configs[configOfSeat[s]!]);
      out.push(runGame(seed, rotation, configOfSeat, seatParams, input.rngFactory(seed, rotation), input.maxDeals ?? DEAL_CAP));
    }
  }
  return out;
}

function runGame(
  seed: number,
  rotation: number,
  configOfSeat: readonly [number, number, number],
  seatParams: SeatParams,
  rng: RNG,
  maxDeals: number
): GameRecord {
  let state = createGame((((seed % 3) + 3) % 3) as Seat);
  const counters = emptySeatCounters();
  const summaries: DealSummary[] = [];
  let redeals = 0;

  for (let steps = 0; steps < STEP_CAP; steps++) {
    if (state.status === 'finished') break;
    if (state.deal === null || state.deal.phase === 'scored') {
      if (state.deal !== null && state.deal.phase === 'scored') summaries.push(state.deal.summary!);
      if (summaries.length >= maxDeals) break;
      const res = dispatch(state, { type: 'deal' }, rng);
      if (!res.ok) throw new Error(`竞技场发牌被拒：${res.message}`);
      state = res.state;
      continue;
    }
    const before = state.deal.dealNo;
    state = step(state, seatParams, counters);
    if (state.deal!.dealNo !== before) redeals += 1;
  }

  const progress = state.levels.map(levelProgress) as unknown as [number, number, number];
  return {
    seed,
    rotation,
    configOfSeat,
    status: state.status,
    deals: summaries.length,
    redeals,
    summaries,
    progress,
    ranking: state.result === null ? null : state.result.ranking,
    counters
  };
}

// ---------------------------------------------------------------------------
// 估计量（配对、聚类、多重比较）
// ---------------------------------------------------------------------------

export interface ClusterEffect {
  /** 独立单位数（**种子**，不是逐副观测：同一颗种子的轮换是聚类的） */
  readonly units: number;
  readonly samples: number;
  readonly mean: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  /** 双侧符号翻转置换检验的 p 值（配对，假设很轻） */
  readonly pValue: number;
}

/** 这个配置在这一副里「每个座位平均涨了几级」（配置占多个座位时取均值，1:2 与 2:1 才可比） */
export function improvementPerSeat(record: DealRecord, config: number): number | null {
  const seats = [0, 1, 2].filter((s) => record.configOfSeat[s] === config);
  if (seats.length === 0) return null;
  return seats.reduce((sum, s) => sum + record.improvements[s]!, 0) / seats.length;
}

/** 整局台的同款读数：终局进度（级数），同样按「每座位平均」 */
export function progressPerSeat(record: GameRecord, config: number): number | null {
  const seats = [0, 1, 2].filter((s) => record.configOfSeat[s] === config);
  if (seats.length === 0) return null;
  return seats.reduce((sum, s) => sum + record.progress[s]!, 0) / seats.length;
}

/**
 * 配对差（按种子聚类）：每个（种子, 轮换）给一个 `变体 − 基线`，
 * 再把同一颗种子的多个轮换取平均 —— 轮换之间不独立，种子才是独立单位。
 */
export function pairedBySeed<T>(
  records: readonly T[],
  perSeat: (record: T) => {
    readonly seed: number;
    readonly rotation: number;
  },
  value: (record: T, config: number) => number | null,
  variant: number,
  baseline: number
): number[][] {
  const bySeed = new Map<number, number[]>();
  for (const record of records) {
    const meta = perSeat(record);
    const v = value(record, variant);
    const b = value(record, baseline);
    if (v === null || b === null) continue;
    const list = bySeed.get(meta.seed) ?? [];
    list.push(v - b);
    bySeed.set(meta.seed, list);
  }
  return [...bySeed.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 最小可检测效应（双侧 α=0.05、power 0.8 的近似：2.8σ/√n；σ 取**种子均值**的离散度） */
export function minimumDetectable(sd: number, units: number): number {
  if (units <= 0) return Number.POSITIVE_INFINITY;
  return (2.8 * sd) / Math.sqrt(units);
}

/**
 * 一个 cell 的「种子均值离散度」σ(D_s)：配对功效估算的分母。
 *
 * 注意它**不能**拿 A/A cell 来标定：两侧同配置时 D_s 恒为 0、σ 也恒为 0，
 * 那是个退化值（A/A 的用处是证明估计量无偏 + 轮换没偷换牌，不是给噪声定量）。
 * 所以 σ 取**本 cell 自己**的种子均值离散度 —— 与配对 t 检验的功效公式同一个口径。
 */
export function clusterSd(diffsBySeed: readonly (readonly number[])[]): number {
  return stdev(diffsBySeed.filter((list) => list.length > 0).map((list) => average(list)));
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index]!;
}

/**
 * 聚类 bootstrap 置信区间 + 符号翻转置换检验。
 * 两个随机过程都用注入的 `rng`，所以同一个 `rng` 序列给出同一份报告（可复现）。
 */
export function clusterEffect(
  diffsBySeed: readonly (readonly number[])[],
  rng: RNG,
  bootstrapRounds = 10_000,
  permutationRounds = 100_000
): ClusterEffect {
  const perSeed = diffsBySeed.filter((list) => list.length > 0).map((list) => average(list));
  const units = perSeed.length;
  const mean = average(perSeed);
  const samples = diffsBySeed.reduce((sum, list) => sum + list.length, 0);

  const boot: number[] = [];
  for (let round = 0; round < bootstrapRounds; round++) {
    let sum = 0;
    for (let i = 0; i < units; i++) sum += perSeed[Math.floor(rng() * units)] ?? 0;
    boot.push(sum / Math.max(1, units));
  }
  boot.sort((a, b) => a - b);

  let hits = 0;
  const target = Math.abs(mean);
  for (let round = 0; round < permutationRounds; round++) {
    let sum = 0;
    for (const d of perSeed) sum += rng() < 0.5 ? d : -d;
    if (Math.abs(sum / Math.max(1, units)) >= target) hits += 1;
  }

  return {
    units,
    samples,
    mean,
    ciLow: quantile(boot, 0.025),
    ciHigh: quantile(boot, 0.975),
    pValue: (hits + 1) / (permutationRounds + 1)
  };
}

/** Holm–Bonferroni 逐步下降：返回每个假设在 `alpha` 下是否被拒 */
export function holmBonferroni(pValues: readonly number[], alpha = 0.05): boolean[] {
  const m = pValues.length;
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p || a.index - b.index);
  const rejected = new Array<boolean>(m).fill(false);
  for (let k = 0; k < m; k++) {
    if (order[k]!.p <= alpha / (m - k)) rejected[order[k]!.index] = true;
    else break;
  }
  return rejected;
}
