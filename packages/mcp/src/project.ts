/**
 * **工具负载投影**：把浏览器同款负载压成「此刻行动所需」的紧凑形状（ADR-0019）。
 *
 * 出发点：宿主每个请求都重发整段会话与工具面 schema，所以**模型已经看过**早先那些帧 ——
 * 再投喂一遍是纯税，而且是乘在回合数上的二次税（ADR-0011 实测：整局的账约等于回合数²）。
 * 于是默认负载只留「要走出这一手所必需的」+「自你上次看到以来**新发生**的」；
 * 更早的墩、跨副战报这类信息属于**记忆考题**，不再重复给。被中断（对话被截断、换了个会话）
 * 时用 `verbose: true` 拿回引擎类型逐字的那一份 —— 它是**恢复通道**，不是兼容逃生门。
 *
 * 三条纪律（`test/project.test.ts` 与静态守卫一起钉住）：
 *   1. **只减不增**：每个字段都能追到服务器负载里的一个字段，投影不许发明事实；
 *   2. **不许有第二个来源**：本文件只 import 引擎的**类型**与本包的编解码 —— 它读不到
 *      服务器状态，所以「观战者看不到手牌」在投影层依旧成立（观战者 `you === null`）；
 *   3. **浏览器那份不动**：`/view`、SSE 与 `wire.ts` 的 `PublicView` 保持逐字，
 *      投影只发生在 MCP 出参这一侧；要逐字时 `get_state`/`wait_for_turn` 传 `verbose: true`。
 *
 * 两条**可推导性**规则解释了形状为什么长这样：
 *   - 每条消息都是负载的**纯函数**（不依赖「这是第几条消息」）—— `/api/mcp` 是无状态的
 *     （每个请求新建服务器，ADR-0010），任何「只发一次」的字段都得靠服务端记住客户端看到了哪，
 *     那条路被明确拒绝。所以省的办法只有两种：**删掉**（模型看过就不必再给）与
 *     **阶段门控**（成交后 `auction` 冻结、结算时 `levels` 才变 —— 都由负载自身判定）。
 *   - 名字挂在**座位下标**上（`names[seat]`），不再给整块座位卡：动作只认座位号（ADR-0010），
 *     在线状态是界面的事（`在线` 的定义见 CONTEXT.md），两者都不参与规则判定。
 */
import type {
  Contract,
  DealPhase,
  DealSummary,
  GameResult,
  Level,
  PlayerSeat,
  PublicDealView,
  PublicView,
  Seat,
  TrickPlay,
  TrumpModel
} from '@sixty/engine';
import { encodeCall, encodeCard } from './codec.ts';
import type { Role, StreamPayload, TableView } from './wire.ts';

/** 一张桌的座位数（`Seat` 是 0|1|2；这里只用来给 `names` 定长） */
const SEAT_COUNT = 3;

/** 座位顺序的名字（下标 = 座位号，`null` = 空座）。在线与机器人标记都不进这里 */
export type SeatNames = readonly (string | null)[];

/**
 * 名字是「座位 N 是谁」的唯一锚点：`turn.hint`、`auction`、`trickHistory` 里全是座位号，
 * 没有名字模型就只能对着数字推人。
 */
export function seatNames(table: TableView): SeatNames {
  const names = Array.from({ length: SEAT_COUNT }, () => null as string | null);
  for (const seat of table.seats) {
    if (seat.seat >= 0 && seat.seat < SEAT_COUNT) names[seat.seat] = seat.name;
  }
  return names;
}

/**
 * 一手牌写成 `"座位:牌码 牌码"`：`"0:C5"`、`"1:H3 H4"`（多张时用空格分隔）。
 *
 * 一手从 `{"seat":0,"cards":["C5"]}`（26 字符）压到 `"0:C5"`（6 字符）——
 * 这是投影里最贵的一处（一副牌 51 手），而座位与「哪几张是一手出的」都不能丢。
 * 出参用这个写法，入参仍是 `cards: ["C5"]` 数组（见 tools.ts）。
 */
export type CompactPlay = string;

export function encodePlay(play: TrickPlay): string {
  return `${play.seat}:${play.cards.map(encodeCard).join(' ')}`;
}

/** `"0:C5 H3"` → `{ seat: 0, cards: ["C5", "H3"] }`：消费方（与测试）需要拆开时用它 */
export function decodePlay(play: string): { readonly seat: Seat; readonly cards: readonly string[] } {
  const separator = play.indexOf(':');
  return {
    seat: Number.parseInt(play.slice(0, separator), 10) as Seat,
    cards: play.slice(separator + 1).split(' ')
  };
}

export interface CompactTrick {
  readonly leaderSeat: Seat;
  readonly plays: readonly CompactPlay[];
}

/**
 * 已完成的墩：赢家 + 分数 + 三手牌。
 *
 * **不给 `leaderSeat`**：它是可推的（第一墩由庄家领出，之后每墩由上墩赢家领出），
 * 而它按墩重复出现。牌换成紧凑码（`"C5"`），墩边界与赢家都留着。
 */
export interface CompactCompletedTrick {
  readonly winner: Seat;
  readonly points: number;
  readonly plays: readonly CompactPlay[];
}

/** 结算摘要：只有牌面字段换成紧凑码（其余照原样，结算信息一次性给足） */
export type CompactSummary = Omit<DealSummary, 'kitty' | 'originalKitty'> & {
  readonly kitty: readonly string[];
  readonly originalKitty: readonly string[];
};

export interface CompactDeal {
  readonly phase: DealPhase;
  readonly dealNo: number;
  /** 仅叫牌阶段：谁先叫（此后按座位轮转）。成交之后它与轮转都无关了 */
  readonly dealerSeat?: Seat | undefined;
  readonly auctionTurn: Seat;
  readonly playTurn: Seat | null;
  readonly declarerSeat: Seat | null;
  /**
   * 仅叫牌阶段：已发生的叫牌。
   *
   * 成交那一刻起它就是**记忆**（模型亲手参与过），结论由 `contract` 与 `declarerSeat` 带走 ——
   * 唯一还需要它的时刻是「正在叫牌」：要判断下一口叫什么、对手在竞什么。
   */
  readonly auction?: readonly { readonly seat: Seat; readonly call: string }[] | undefined;
  /** 仅叫牌阶段：当前最高叫品（成交后由 `contract` 带走，不再重复） */
  readonly highestBid?: string | null | undefined;
  readonly contract: Contract | null;
  readonly trump: TrumpModel | null;
  readonly trick: CompactTrick | null;
  /**
   * 至多一项：**最近完成**的那一墩（`TRICK_TAIL`）。
   *
   * 为什么恰好一项就够：在座的玩家每副出手一次，两次出手之间**恰好**多完成一墩
   * （自己出手 → 另外两家收掉这一墩 → 赢家领出下一墩 → 下家跟一张 → 又轮到自己），
   * 所以末墩永远是「自你上次看到以来新发生的那件事」，零重复；再往前的墩都在早先的帧里
   * 出现过，属于记忆考题（`capturedPoints` 给出可核对的累计分）。
   *
   * 它不是可有可无的：你出手时第三家还没出牌，他那一张**只可能**从这里看到。
   */
  readonly trickHistory: readonly CompactCompletedTrick[];
  /** 按座位下标：`capturedPoints[seat]`。牌本身不重复给 —— 都在 `trickHistory` 里（至多一墩） */
  readonly capturedPoints: readonly number[];
  readonly handCounts: readonly number[];
  /** 只在结算后非 null：结算信息一次性给足 */
  readonly summary: CompactSummary | null;
}

/** 末墩只留一项（`trickHistory` 的长度上界；改它要同时想清楚上面那段理由） */
export const TRICK_TAIL = 1;

export interface CompactView {
  readonly status: PublicView['status'];
  readonly result: GameResult | null;
  readonly deal: CompactDeal | null;
  /**
   * 只在「级别正在变」的帧给：大厅（还没发牌）、本副结算、终局。
   *
   * 副内它是静态的（模型在开局那一帧看过了），所以不给 —— `progress` 更是可以算出来的
   * （13 × 轮数 + 档位序号），一律不进负载；冠军判定看 `result`。
   */
  readonly levels?: readonly Level[] | undefined;
}

export interface CompactYou {
  readonly seat: Seat;
  readonly hand: readonly string[];
  readonly isDeclarer: boolean;
  readonly originalKitty: readonly string[] | null;
}

/** 投影后的取数结果：与浏览器负载同源、同形到字段级，只是表示更省 */
export interface CompactPayload {
  readonly code: string;
  readonly role: Role;
  readonly names: SeatNames;
  readonly view: CompactView | null;
  readonly you: CompactYou | null;
}

/**
 * 形状守卫：投影的字段清单（`test/project.test.ts` 逐个核对，多一个少一个都红）。
 *
 * 「阶段门控」的那几个字段单独列出来：它们**多出来**的时机由负载自身决定（纯函数），
 * 所以守卫要按帧核对（叫牌帧 / 出牌帧 / 结算帧各一套）。
 */
export const COMPACT_VIEW_FIELDS: readonly (keyof CompactView)[] = ['status', 'result', 'deal'];
export const COMPACT_VIEW_LEVEL_FIELD = 'levels' as const;
export const COMPACT_DEAL_FIELDS: readonly (keyof CompactDeal)[] = [
  'phase',
  'dealNo',
  'auctionTurn',
  'playTurn',
  'declarerSeat',
  'contract',
  'trump',
  'trick',
  'trickHistory',
  'capturedPoints',
  'handCounts',
  'summary'
];
/** 叫牌阶段多出来的三个（成交后由 `contract` / `declarerSeat` 带走） */
export const COMPACT_DEAL_AUCTION_FIELDS: readonly (keyof CompactDeal)[] = [
  'dealerSeat',
  'auction',
  'highestBid'
];
export const COMPACT_YOU_FIELDS: readonly (keyof CompactYou)[] = ['seat', 'hand', 'isDeclarer', 'originalKitty'];
export const COMPACT_SUMMARY_FIELDS: readonly (keyof CompactSummary)[] = [
  'dealNo',
  'contract',
  'trump',
  'declarerTrickPoints',
  'defenderTrickPoints',
  'originalKitty',
  'kitty',
  'lastTrickSize',
  'protectedBottom',
  'multiplier',
  'kittyPoints',
  'finalScore',
  'made',
  'shortfall',
  'levelChanges'
];
export const COMPACT_TRICK_FIELDS: readonly (keyof CompactCompletedTrick)[] = ['winner', 'points', 'plays'];

export function projectSummary(summary: DealSummary): CompactSummary {
  return {
    ...summary,
    kitty: summary.kitty.map(encodeCard),
    originalKitty: summary.originalKitty.map(encodeCard)
  };
}

function projectCompletedTrick(trick: PublicDealView['trickHistory'][number]): CompactCompletedTrick {
  return {
    winner: trick.winnerSeat,
    points: trick.points,
    plays: trick.plays.map(encodePlay)
  };
}

export function projectTrick(trick: NonNullable<PublicDealView['trick']>): CompactTrick {
  return { leaderSeat: trick.leaderSeat, plays: trick.plays.map(encodePlay) };
}

export function projectDeal(deal: PublicDealView): CompactDeal {
  const base: CompactDeal = {
    phase: deal.phase,
    dealNo: deal.dealNo,
    auctionTurn: deal.auctionTurn,
    playTurn: deal.playTurn,
    declarerSeat: deal.declarerSeat,
    contract: deal.contract,
    trump: deal.trump,
    trick: deal.trick === null ? null : projectTrick(deal.trick),
    trickHistory: deal.trickHistory.slice(-TRICK_TAIL).map(projectCompletedTrick),
    capturedPoints: deal.captured.map((entry) => entry.points),
    handCounts: [...deal.handCounts],
    summary: deal.summary === null ? null : projectSummary(deal.summary)
  };
  // 叫牌阶段才给「正在叫的那点事」：轮转起点、已发生的叫牌、当前最高叫品
  return deal.phase === 'auction'
    ? {
        ...base,
        dealerSeat: deal.dealerSeat,
        auction: deal.auction.map((entry) => ({ seat: entry.seat, call: encodeCall(entry.call) })),
        highestBid: deal.highestBid === null ? null : encodeCall(deal.highestBid)
      }
    : base;
}

function projectYou(you: PlayerSeat): CompactYou {
  return {
    seat: you.seat,
    hand: you.hand.map(encodeCard),
    isDeclarer: you.isDeclarer,
    originalKitty: you.originalKitty === null ? null : you.originalKitty.map(encodeCard)
  };
}

export function projectView(view: PublicView): CompactView {
  const deal = view.deal === null ? null : projectDeal(view.deal);
  const showLevels = deal === null || deal.phase === 'scored' || view.status === 'finished';
  const base: CompactView = {
    status: view.status,
    result: view.result,
    deal
  };
  return showLevels ? { ...base, levels: [...view.levels] } : base;
}

/**
 * 服务器负载 → 工具出参。**唯一的投影入口**，两条传输都走它 —— 所以 stdio 与 `/api/mcp`
 * 不可能给出不同的形状（`verbose` 那条逐字路径也一样，见 tools.ts 的 `stateOf`）。
 */
export function project(payload: StreamPayload, code: string): CompactPayload {
  return {
    code,
    role: payload.role,
    names: seatNames(payload.table),
    view: payload.view === null ? null : projectView(payload.view),
    you: payload.you === null ? null : projectYou(payload.you)
  };
}
