/**
 * 基线启发式策略：纯函数，输入只有引擎的**个人视图**（公共信息 + 自己的手牌与底牌）。
 *
 * 三条铁律（ADR-0015）：
 * 1. **确定性** —— 同一视图永远给出同一动作，表驱动测试与整局回放因此可行；不注入 RNG。
 * 2. **合法即构造** —— 输出永远来自引擎给出的合法集/结构（`bidOptions`、`bestProfile`、
 *   `checkPlay`），并逐次用 `checkPlay` 自检；服务端仍是唯一裁判。
 * 3. **只见个人视图** —— 记牌（`sight.ts`）只从公共墩史与自己手牌数出来，别人的手牌与
 *   底牌结构上拿不到。
 *
 * 档位是「基线规则式」：遵守领域结论「叫分只当及格线」（CONTEXT.md 升级表）——
 * 正常不跳叫，竞叫只在最小合法步长上抬；埋底**默认不埋分**，只有主牌控制到「几乎必然保住末轮」
 * 时才把不超过 10 分埋进去（判据与实测见 `buryFor`）；打牌不犯低级错（有分必收、
 * 末轮按**赌注**决定值不值得争、缺门才杀且取最低能压的、全押只押主牌门）。
 *
 * **参数面（ADR-0017）**：上面那些常量不再直接写死在决策里，而是收进 `BotParams` 这一份显式输入；
 * `BASELINE_PARAMS` 逐一取历史常量 ⇒ **不传参数 = 历史行为逐字节不变**（`test/arena.test.ts` 钉死）。
 * 参数只是纯函数的入参：无 IO、无 RNG、无隐藏状态，同一视图 + 同一参数永远同一动作。
 * 由此多出来的两个非标量开关是**同伴概念**（闲家才有，庄家恒 no-op，见 `partnerSeatOf`）
 * 与**领出次序**；它们值不值得换，靠 `src/arena.ts` 的同副牌配对竞技场量，不靠观感。
 * 搜索 / 学习牌谱仍然不做。
 */
import {
  bestProfile,
  cardClass,
  cardLevel,
  cardPoints,
  cardsPoints,
  checkPlay,
  classOfSet,
  followMode,
  isJoker,
  leadInfo,
  MIN_BID,
  sortHand,
  STRAIN_RANK,
  STRAINS,
  SUITS,
  trickWinner,
  validateCall,
  type Bid,
  type BidCall,
  type Card,
  type Contract,
  type PlayerSeat,
  type PublicView,
  type Seat,
  type Strain,
  type TrumpModel
} from '@sixty/engine';
import { extractChains, classCards, Sight } from './sight.ts';

/** 驱动器要发的动作（座位号由服务端按身份推导，见 ADR-0002） */
export type BotMove =
  | { readonly type: 'bid'; readonly call: BidCall }
  | { readonly type: 'bury'; readonly cards: readonly Card[] }
  | { readonly type: 'play'; readonly cards: readonly Card[] };

/**
 * 机器人参数（ADR-0017）：策略的**唯一**外部输入。
 *
 * 每个字段都对应一处曾经写死的常量，注释里保留它的来处与依据，免得调参时把理由丢掉。
 * 缺省一律是历史值 —— 「不传参数」与「传 `BASELINE_PARAMS`」走同一条路径。
 */
export interface BotParams {
  // ---- 叫牌 ----
  /** 开叫门槛：牌力到这个数就愿意叫 40（历史值 12；越小越积极） */
  readonly bidBar: number;
  /**
   * 「牌力 → 愿意分数」阶梯的**原点**（历史值 12）。
   *
   * 与 `bidBar` 分开，是因为竞技场实测「多开叫」与「多竞叫」是两件事，而一个门槛会把它们
   * 绑在一起动：门槛一降，阶梯整体上移，同一手牌的竞叫上限也跟着涨。
   * `bidLadderBase` 只动竞叫上限，`bidBar` 只动「够不够格开叫」。
   */
  readonly bidLadderBase: number;
  /** 牌力每涨这么多点，愿意分数上一档 */
  readonly bidStepStrength: number;
  /** 愿意分数每档涨这么多分 */
  readonly bidStepPoints: number;
  /** 愿意分数的封顶 */
  readonly maxWilling: number;
  /** 跳叫：开叫/竞叫直接叫到愿意分数，而不是最小合法步长（历史 false；ADR-0015 认为跳叫买不到级数） */
  readonly bidJump: boolean;

  // ---- 埋底 ----
  /** 主牌绝对控制时故意埋分（历史 true，判据与实测见 `buryFor`） */
  readonly buryGamble: boolean;
  readonly buryGambleMaxPoints: number;
  readonly buryGambleMinTrumps: number;
  readonly buryGambleStrongTrumps: number;

  // ---- 打牌：争墩与杀牌 ----
  /** `wantWin` 的分门槛：**跟牌**时这一墩的已有分到它才值得争（历史 5 = 任何有分墩 + 末轮 + 庄家差分的局面） */
  readonly winPointThreshold: number;
  /**
   * **缺门杀牌**的分数门槛（历史 5）。
   * 与 `winPointThreshold` 分成两个字段，是因为竞技场实测这两件事的方向**相反**：
   * 跟牌多争有利（`winPointThreshold: 0` ≈ +0.04 级/座位/副），
   * 而 0 分墩也去杀略亏（`ruffPolicy: 'always'` ≈ −0.02）——
   * 合成一个门槛就只能两件一起调，等于把好的那半让坏的这半吃掉。
   */
  readonly ruffPointThreshold: number;
  /**
   * **争墩时把「我要出的这张牌自己带的分」算进去**（历史 false = 只数桌上已有的分）。
   *
   * 真实对局（表 8 d4#2）里抓到的活例：庄家领 ♥Q（0 分），我在第二家用 ♥5 垫过去 ——
   * `trickPoints` 只数到庄家那张 0 分的 Q，于是 `wantWin` 为假，我把**带 5 分**的 ♥5 送进了
   * 庄家的赢墩。桌上有没有分和我这张牌带不带分，对「该不该赢」是同一件事：
   * 只要**这一墩最终会归对手、而我又往里塞了分**，那几分的代价就得算进来。
   */
  readonly countOwnCardPoints: boolean;
  /** 缺门杀牌：`points-only` = 历史行为（过门槛才杀）；`always` = 能杀就杀；`never` = 不杀 */
  readonly ruffPolicy: 'points-only' | 'always' | 'never';
  /** `noRuffRisk` 的「这门未见牌还够多」余量：庄家 / 闲家各一个（历史 2 / 5） */
  readonly leadCaution: { readonly declarer: number; readonly defender: number };

  // ---- 打牌：领出次序与大牌保留 ----
  /** `draw-first` = 历史行为（先顶主吊主）；`side-first` = 先兑现副门同门无敌的分牌 */
  readonly leadPriority: 'draw-first' | 'side-first';
  /**
   * **垫牌不送分**（历史 false）：跟牌让利时，在合法的同门候选里挑**送给对手分最少**的那一窗。
   *
   * 这是表 8 d4#2 的正解：庄家领 ♥Q，我在第二家手上是 ♥10 ♥K ♥5 ♥6 ♥9 ♥J ♥A —— `buildFollow('bottom')`
   * 按层号取最低的链，于是挑中 ♥5 把 5 分送进庄家的赢墩；而**同样能跟出、还白送 0 分**的 ♥6/♥9就在手里。
   * 与 `countOwnCardPoints` 的区别：那个是「为了不送分去争墩」（要花牌力，实战为负），
   * 这个是「反正都是让利，就挑一张不送分的」—— 不花任何代价。
   */
  readonly dumpDiscipline: boolean;
  /**
   * **领出兜底不许送牌**（历史 false）。
   *
   * 历史兜底是「最短副门的最低张」，而**单张 K 就是那门的最低张** —— 于是它会把副 K 直接
   * 送给外面还没露面的 A。表 8 抓到 3 例（d4#9 ♠K 丢 20 分、d6#4 ♣K 丢 10、d6#8 ♥K 丢 10），
   * 三例都是「某门只剩一张 K」。
   * 打开后兜底改成：① 赢不了的**带分**牌不领；② 有 0 分的牌就不领带分的牌。
   */
  readonly noGiftExit: boolean;
  /**
   * **吊主时把同门无敌的主牌顺子整段领出去**（默认 **true**，ADR-0018 按实测提升）。
   *
   * 单张吊一轮只抽掉每家 1 张主；同长度的主牌顺子一次抽掉 n 张（对手要么拿出更高的同长度顺子、
   * 要么交出 n 张主牌）。表 8 d6#0/#1 手里有大小王却分两轮单出，白白多花一墩 ——
   * 用户对真实对局的四条指控里，只有这一条既**确实发生**、改完之后又**确实更强**。
   *
   * 实测（单副台 2000 种子 × 两个配比）：+0.0368 / +0.0381；换一批没参与调参的种子
   * （seed0=30000、6000 种子）：+0.0194 / +0.0221 —— 复现后仍显著。
   * 整局台（150 种子 × 两个配比）：+1.11 / +1.02 进度/座位，均过 Holm；
   * 庄家打成率 66.1% → 68.6%，吊主次数 4702 → 2554（每 100 座位-副，因为它一次领一段）。
   */
  readonly trumpRunLead: boolean;
  /**
   * **主牌够长时，顶主不是「可证必胜」也照样吊主**（历史 false）。
   *
   * 吊主分支原本要求顶张 `sureWinner` —— 而**外面还有大王/小王时这条永远不成立**，
   * 于是「该清主」的局面整个退化到兜底去送副牌。表 8 d3 就是这么打崩的：庄家 8 张主
   * （含 DA/DK/DQ/DJ）全程没吊过一轮主，最后被闲家的顺子把 DJ DQ DK / DA C4 D5 全部吃掉，
   * 一副牌只抓 0 分。打开后：手牌主牌数 ≥ 阈值且不少于未见主牌数时，用顶主吊。
   */
  readonly drawWhenLong: boolean;
  /** `drawWhenLong` 的「够长」阈值 */
  readonly drawWhenLongMinTrumps: number;
  /**
   * **只被王压着的顶主也拿来吊主**（历史 false）。
   *
   * 与 `drawWhenLong` 分开：那个只看主牌够不够长（实测为负），这个看「压在我头上的只剩王」——
   * 领出去确实会被王吃掉，但**吃掉的正是那张永远压着我的王**，之后我剩下的主牌就是最大的。
   */
  readonly drawIntoJoker: boolean;
  /** 同门无敌的顶主恰是大王时不拿它吊主（留给末轮；闲家看不到底牌，所以这只是钝规则） */
  readonly keepBigJoker: boolean;
  /** 庄家专用：自己埋进底里的牌有分时，不拿同门无敌的顶主吊主（留到末轮护底） */
  readonly protectPointedKitty: boolean;
  /** `unseen` = 历史行为（外面还有未见主牌就吊主）；`never` = 从不吊主 */
  readonly drawTrumps: 'unseen' | 'never';

  // ---- 打牌：垫牌 ----
  /** `discardValue` 里分牌的权重（历史 30；越大越舍不得垫分） */
  readonly discardPointWeight: number;

  // ---- 同伴（闲家才有；庄家恒 no-op）----
  /** 认识同伴：不抢同伴已定的赢墩、不杀同伴已定的赢墩 */
  readonly partnerAware: boolean;
  /** 同伴已定的赢墩上把分垫给同伴（分进同伴的账 = 从庄家的账上拿掉，见引擎的结算公式） */
  readonly feedPartner: boolean;
}

/**
 * 出厂默认（ADR-0017）。四项已按竞技场实测与历史基线不同 —— 每一处都写明依据，
 * 因为「为什么是这个值」比「值是多少」更容易在下一轮调参时丢掉：
 *
 * 1. `bidLadderBase: 6`（原 12）—— **收益最大的一项**。竞叫阶梯的原点决定了「愿意把价抬到哪」，
 *    而升级表把主要级数给了庄家侧（拆开算：变体做庄的副 Δ=+1.59 级/座位，基线做庄的副 Δ=−1.02），
 *    所以「愿意一路用最小步长把庄家位拿过来」是巨大的正收益。单副台 2000 种子 × 两个配比：
 *    +0.282 / +0.271 级/座位/副；整局台：+14.3 进度/座位。
 *    对照项说明了它不是「叫得越高越好」：跳叫到愿意分数是 **−0.044**（白抬及格线），
 *    **只**降开叫门槛（阶梯不动）在整局台是 **−0.58 / −1.00**（拿弱牌做庄是亏的）。
 * 2. `leadCaution {1,2}`（原 {2,5}）—— 领出更激进：+0.037 / +0.035，整局台 +1.6 / +0.9。
 * 3. `partnerAware + feedPartner: true`（原都是 false）—— 同伴概念。被量的是**这一对**
 *    （+0.057 / +0.058，整局台 +1.1 / +0.9）；单独开 `partnerAware` 与 0 不可区分（+0.0038，CI 跨 0），
 *    所以收益无法单独归因到「不抢同伴」那一半，但它是喂分规则自洽的前提。
 *
 * **`discardPointWeight` 保持 30（不采纳竞技场里那个 0）**：它虽然五次测量全为正
 * （+0.0183 / +0.0153 / +0.0162 / +0.0130 单副台、+0.81 整局台），但 ① 幅度只有 +0.016，
 * 远低于事先定下的「≥ +0.1 级/座位」门槛；② 整局台的读数过不了 Holm；③ **机制没解释清楚** ——
 * 它其实只改变「5/10 与相邻低张谁先垫」的次序，而送给庄家的分几乎没变（0.98–0.99×），
 * 也就是说它并没有做到「少送分」这件它看起来该做的事。依据薄且说不清的一项不进默认。
 *
 * 被实验**否掉**的（值保持历史基线，别以为它们没试过）：跳叫、只降开叫门槛、
 * 见墩就争 / 只把跟牌门槛归零（符号翻转，不稳健）、能杀就杀 / 从不杀、只争大分墩、
 * **大王留到末轮（−0.096，推翻了上一轮复盘的判断）**、庄家顶主留末轮、先副门后吊主、
 * 从不吊主、领出更保守、埋底一分不埋、叫牌门槛 16、垫牌分权重归零。
 */
export const BASELINE_PARAMS: BotParams = {
  bidBar: 12,
  bidLadderBase: 6,
  bidStepStrength: 3,
  bidStepPoints: 5,
  maxWilling: 85,
  bidJump: false,
  buryGamble: true,
  buryGambleMaxPoints: 10,
  buryGambleMinTrumps: 9,
  buryGambleStrongTrumps: 10,
  winPointThreshold: 5,
  ruffPointThreshold: 5,
  countOwnCardPoints: false,
  ruffPolicy: 'points-only',
  leadCaution: { declarer: 1, defender: 2 },
  leadPriority: 'draw-first',
  noGiftExit: false,
  trumpRunLead: true,
  drawWhenLong: false,
  drawWhenLongMinTrumps: 5,
  drawIntoJoker: false,
  dumpDiscipline: false,
  keepBigJoker: false,
  protectPointedKitty: false,
  drawTrumps: 'unseen',
  discardPointWeight: 30,
  partnerAware: true,
  feedPartner: true
};

/**
 * 解析参数：只覆盖调用方给的那几项，其余落到 `BASELINE_PARAMS`。
 * 于是实验配置可以只写「我改了什么」，不必抄一遍 20 个字段（抄错一个就是一次假实验）。
 */
export function paramsOf(p?: Partial<BotParams>): BotParams {
  return p === undefined ? BASELINE_PARAMS : { ...BASELINE_PARAMS, ...p };
}

/**
 * 闲家的同伴座位（庄家没有同伴）：1v2 里两个闲家互为同伴，座位号从**公开信息**推出来
 * （`deal.contract.declarerSeat` 与自己的座位），不碰任何隐藏信息。
 * 参数只要「有个合同」这一件事，所以竞技场那边也能直接用它数计数。
 */
export function partnerSeatOf(seat: Seat, deal: { readonly contract: Contract | null }): Seat | null {
  const declarer = deal.contract?.declarerSeat ?? null;
  if (declarer === null || declarer === seat) return null;
  const rest = ([0, 1, 2] as Seat[]).filter((s) => s !== seat && s !== declarer);
  return rest.length === 1 ? rest[0]! : null;
}

/**
 * 当前这一步该做什么：轮不到机器人（或没牌局）返回 null。
 * 驱动器在**每次状态变更后**调它；机器人从不发起 `deal` / `newGame` ——
 * 桌面级动作留给人类，这也是「一桌至少留一个人类座位」的原因。
 */
export function moveFor(
  view: PublicView | null,
  you: PlayerSeat | null,
  params?: Partial<BotParams>
): BotMove | null {
  if (view === null || you === null || view.status === 'finished') return null;
  const deal = view.deal;
  if (deal === null) return null;
  if (deal.phase === 'auction' && deal.auctionTurn === you.seat) {
    return { type: 'bid', call: bidFor(view, you, params) };
  }
  if (deal.phase === 'bury' && you.isDeclarer && deal.trump !== null) {
    return { type: 'bury', cards: buryFor(you.hand, deal.trump, params) };
  }
  if (deal.phase === 'play' && deal.playTurn === you.seat && deal.trump !== null) {
    return { type: 'play', cards: playFor(view, you, deal.trump, params) };
  }
  return null;
}

/**
 * 保底动作：**恒合法**的最低限度选择，供驱动器在策略动作被服务端拒绝时兜底
 * （策略与引擎万一漂移，桌面也绝不卡在机器人手里）。
 *
 * 与 `moveFor` 的区别只在「不挑好的，只挑一定合法的」：叫牌 pass、埋底交出手牌前三张、
 * 出牌走 `fallbackPlay`。轮不到它时同样返回 null。
 */
export function fallbackFor(
  view: PublicView | null,
  you: PlayerSeat | null,
  params?: Partial<BotParams>
): BotMove | null {
  if (view === null || you === null || view.status === 'finished') return null;
  const deal = view.deal;
  if (deal === null) return null;
  if (deal.phase === 'auction' && deal.auctionTurn === you.seat) return { type: 'bid', call: 'pass' };
  if (deal.phase === 'bury' && you.isDeclarer && you.hand.length >= 3) {
    return { type: 'bury', cards: you.hand.slice(0, 3) };
  }
  if (deal.phase === 'play' && deal.playTurn === you.seat && deal.trump !== null) {
    const trick = deal.trick;
    const lead = trick !== null && trick.plays.length > 0 ? trick.plays[0]!.cards : null;
    return {
      type: 'play',
      cards: fallbackPlay(you.hand, deal.trump, lead, lead?.length ?? 1, paramsOf(params))
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 叫牌
// ---------------------------------------------------------------------------

/** 手牌对某花色的牌力评估（整数，越大越强）；trumps 是该花色下的主牌张数 */
export interface StrainStrength {
  readonly strain: Strain;
  readonly value: number;
  readonly trumps: number;
}

/**
 * 开叫门槛（`BotParams.bidBar`，历史值 12）与「牌力 → 愿意分数」的阶梯。
 *
 * 12 是从初版 15 调下来的：15 太保守 —— 开叫率只有 32%，全 pass 重发率高达 **36%**（每三副白扔一副），
 * 面对别人的叫品也只在 4% 的局面里竞叫，陪练时人类几乎总能以 40 拿下庄家位。
 * 调到 12 后**用真策略复测**（120 局 bot 对 bot）：开叫 **52%**（其中无主 4%，初版 0%）、
 * 竞叫 **31%**、全 pass 重发 **5%**、庄家打成率 **80%**、每副升级 庄 2.0 / 闲 0.6。
 * 这是**陪练观感 + 有据可依**的取向，不是 EV 最优声明；
 * 改门槛要连测试一起改（`willingPoints` 单测与 `fullgame.test.ts` 的开叫率 / 重发率断言都钉着它）。
 */

/**
 * 牌力：主牌的长度与质量 + 副牌大牌 +（有主时的）缺门。级牌点数取**自己的级别**
 * （我若成为庄家，级牌就是我的点数 —— 叫牌时唯一合理的近似）。
 *
 * **无主的算法不一样，别照抄有主那一套**：无主没有杀牌，缺门毫无价值（初版给每门缺门 +1，
 * 白送分让「无主」在五门里永远选不上 —— 实测无主开叫占比恒为 0%）；无主的赢墩来自
 * 四门的大牌与长套，所以改成「长套（≥4 张）另有 +1」。
 */
export function strengthOf(hand: readonly Card[], rank: number, strain: Strain): StrainStrength {
  const t: TrumpModel = { strain, rank };
  const trumps = hand.filter((c) => cardClass(c, t) === 'T');
  let value = 0;
  for (const c of trumps) {
    if (isJoker(c)) value += c.joker === 'big' ? 4 : 3;
    else if (strain === 'NT' && c.rank === rank) value += 2; // 无主里级牌就是仅次双王的主牌
    else {
      const lv = cardLevel(c, t);
      if (lv >= 14) value += 3; // 主级
      else if (lv === 13) value += 2; // 副级
      else if (lv >= 11) value += 2; // 主花色 A
      else if (lv === 10) value += 1; // 主花色 K
    }
  }
  if (trumps.length >= 7) value += 2;
  if (trumps.length >= 9) value += 3;
  for (const suit of SUITS) {
    // 主花色整门都是主牌，不该再算一次副门（否则会白拿一个「缺门」加分）
    if (strain !== 'NT' && suit === strain) continue;
    const side = hand.filter((c) => !isJoker(c) && c.suit === suit && cardClass(c, t) !== 'T');
    if (side.length === 0) {
      value += strain === 'NT' ? 0 : 1; // 缺门只有「有主」时才值钱（垫牌与杀牌的空间）
      continue;
    }
    if (side.some((c) => !isJoker(c) && c.rank === 14)) value += 2;
    else if (side.some((c) => !isJoker(c) && c.rank === 13)) value += 1;
    if (strain === 'NT' && side.length >= 4) value += 1; // 无主的长套是实打实的赢墩来源
  }
  return { strain, value, trumps: trumps.length };
}

/**
 * 牌力换算成「愿意叫到的分数」；不足门槛时返回 0（只 pass）。
 *
 * 门槛用 `bidBar`、阶梯原点用 `bidLadderBase`：两者分开之后，
 * 「只要够格就开 40、但不把竞叫上限抬上去」才写得出来（下限钳在 `MIN_BID`）。
 * 历史基线里两者都是 12，所以这条式子与改写前逐字等价。
 */
export function willingPoints(value: number, params?: Partial<BotParams>): number {
  const p = paramsOf(params);
  if (value < p.bidBar) return 0;
  const ladder =
    MIN_BID + Math.floor((value - p.bidLadderBase) / p.bidStepStrength) * p.bidStepPoints;
  return Math.min(p.maxWilling, Math.max(MIN_BID, ladder));
}

/**
 * 叫牌决策：
 * - 没人叫过 → 够 40 就开叫 40（最佳花色），否则 pass；
 * - 已有最高叫品 → 若是我自己的，pass（不抬自己）；否则只在**最小合法加叫**
 *   不超过愿意分数时竞叫（同分换更高花色，或 +5）—— 跳叫买不到任何级数
 *   （CONTEXT.md 升级表），唯一理由是把庄家位从对手手里拿走，那也只需最小步长。
 *
 * `bidJump` 一开就把上面两条的「最小步长」换成「愿意分数」：它是**对照项**，
 * 用来在竞技场里检验 ADR-0015 那条「跳叫买不到级数」（合同分越高越难打成）。
 */
export function bidFor(view: PublicView, you: PlayerSeat, params?: Partial<BotParams>): BidCall {
  const p = paramsOf(params);
  const rank = view.levels[you.seat]!.rank;
  const entries = view.deal?.auction ?? [];
  const highest = view.deal?.highestBid ?? null;

  let best: StrainStrength | null = null;
  for (const strain of STRAINS) {
    const s = strengthOf(you.hand, rank, strain);
    if (best === null || s.value > best.value || (s.value === best.value && s.trumps > best.trumps)) {
      best = s;
    }
  }
  const willing = willingPoints(best!.value, p);

  if (highest === null) {
    if (willing < MIN_BID) return 'pass';
    return { points: p.bidJump ? willing : MIN_BID, strain: best!.strain };
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.call !== 'pass') {
      if (entry.seat === you.seat) return 'pass'; // 最高叫品已是我的
      break;
    }
  }
  const nextPoints =
    STRAIN_RANK[best!.strain] > STRAIN_RANK[highest.strain] ? highest.points : highest.points + 5;
  const wanted = p.bidJump ? Math.max(nextPoints, willing) : nextPoints;
  const call: Bid = { points: wanted, strain: best!.strain };
  if (willing >= wanted && validateCall(call, highest) === null) return call;
  return 'pass';
}

// ---------------------------------------------------------------------------
// 埋底
// ---------------------------------------------------------------------------

/**
 * 埋底：默认埋掉 keep 值最小的 3 张 —— 先副牌后主牌、先低张后高张、先无分后有分。
 * 主牌既是赢墩手段也是护底资本，所以只有副牌不足 3 张时才被迫埋主。
 *
 * **例外：主牌绝对控制时故意埋分（博弈点）**。埋一张 10 进去，保底就白拿 `10 × x`（x = 末轮张数），
 * 被抠底则倒扣同样多，所以它是个下注。设「留住那一张分并自己抓回来」为基线（最保守，q=1），
 * 埋分的净变化是 `(2p−1)·s·x − s`，于是需要 `p > (x+1)/(2x)`：x=1 时**永不为正**、
 * x=2 要 >75%、x=3 要 >67% —— 门槛很高，所以只有能证明「末轮大概率我赢」时才下注。
 *
 * 判据只用确定性的可读信息（无 RNG，可复现）：门主牌 **≥10 张**，或 **≥9 张且三张顶级主牌
 * （双王 + 主级）全在**，且主牌总数 ≥9。
 *
 * 实测（真策略 120 局）：这组条件在庄家手牌里命中 **27%** 的副数（平均埋 7.7 分），
 * 命中时**保住末轮 99.1%** ⇒ 埋分净变化 **+5.9 分/副**（>0 才是 +EV）。
 * 对照（同一批局面、旧打牌策略下量）：「≥9 张且有大王」这种弱条件保底率只有 81.3%、
 * x=1 占 82% ⇒ **−1.9 分/副（负 EV，故不采纳弱条件）**。
 *
 * 上限 10 分（一张 10 / 两张 5 / 一张 K），且埋完仍要留 ≥3 张非分副牌保垫牌能力；
 * 任一条件不满足就退回「不埋分」的基线 —— 于是底牌分布不再恒为 0 分，
 * 「机器人做庄必然 0 分底」这条可被对手推知的信息也随之消失。
 *
 * 三个判据与 10 分上限现在是 `BotParams.buryGamble*`（历史值就是上面这几个数）；
 * `buryGamble: false` 直接退回「一分不埋」的基线，作为竞技场里的对照项。
 */
export function buryFor(hand: readonly Card[], t: TrumpModel, params?: Partial<BotParams>): Card[] {
  const p = paramsOf(params);
  const keep = (c: Card): number =>
    (cardClass(c, t) === 'T' ? 1000 : 0) + cardLevel(c, t) * 2 + cardPoints(c) * 50;
  const byKeep = hand.map((c, i) => ({ c, i })).sort((a, b) => keep(a.c) - keep(b.c) || a.i - b.i);
  const baseline = byKeep.slice(0, 3).map(({ c }) => c);
  if (!p.buryGamble) return baseline;

  const trumps = hand.filter((c) => cardClass(c, t) === 'T');
  const hasBigJoker = trumps.some((c) => isJoker(c) && c.joker === 'big');
  const hasSmallJoker = trumps.some((c) => isJoker(c) && c.joker === 'small');
  const hasMainRank = trumps.some(
    (c) => !isJoker(c) && c.suit === t.strain && c.rank === t.rank
  );
  const topTrumps = [hasBigJoker, hasSmallJoker, hasMainRank].filter(Boolean).length;
  // 「控制」= 手握大王，或小王+主级（都是同门无敌的顶级主牌）；光有一堆低主不算控制
  const topControl = hasBigJoker || (hasSmallJoker && hasMainRank);
  const controlled =
    trumps.length >= p.buryGambleMinTrumps &&
    topControl &&
    (trumps.length >= p.buryGambleStrongTrumps || topTrumps >= 3);
  if (!controlled) return baseline;

  const isSide = (c: Card): boolean => cardClass(c, t) !== 'T';
  const nonPointSide = (cards: readonly Card[]): number =>
    cards.filter((c) => isSide(c) && cardPoints(c) === 0).length;

  // 先挑要埋的分牌（副门里 keep 最小的，总和不超上限），再用最低的无分牌凑满 3 张
  const gamble: Card[] = [];
  let buriedPoints = 0;
  for (const { c } of byKeep) {
    if (gamble.length >= 3) break;
    if (!isSide(c) || cardPoints(c) === 0) continue;
    if (buriedPoints + cardPoints(c) > p.buryGambleMaxPoints) continue;
    gamble.push(c);
    buriedPoints += cardPoints(c);
  }
  if (gamble.length === 0) return baseline;
  for (const { c } of byKeep) {
    if (gamble.length >= 3) break;
    if (gamble.some((chosen) => chosen === c)) continue;
    if (cardPoints(c) > 0) continue; // 分数上限已用尽或没必要再埋分
    gamble.push(c);
  }
  if (gamble.length < 3) return baseline;
  // 埋完必须还留得下垫牌：非分副牌（含没被埋的那些）
  if (nonPointSide(hand.filter((c) => !gamble.includes(c))) < 3) return baseline;
  return gamble;
}

// ---------------------------------------------------------------------------
// 打牌
// ---------------------------------------------------------------------------

/** 一张牌「垫出去最不心疼」的程度：越小越先垫 —— 无分 > 有分，副牌 > 主牌，低张 > 高张 */
function discardValue(c: Card, t: TrumpModel, pointWeight: number): number {
  return (cardClass(c, t) === 'T' ? 100 : 0) + cardLevel(c, t) * 2 + cardPoints(c) * pointWeight;
}

/**
 * 「把分送给同伴」时的给牌次序：**越大越先给** —— 分值越高越先给，其次非主牌先给，最后低张先给。
 *
 * 依据是引擎的结算公式（`scoreDeal`）：`finalScore` 只算**庄家**抓到的分与底牌，
 * 闲家抓到的分永远不进这个式子，只起「不让庄家拿到」的作用。所以在本墩归属已定（我是第三家，
 * 赢家是同伴）时，把分垫给同伴 = 把分从庄家的账上拿掉，同时省下自己的高牌。
 */
function feedValue(c: Card, t: TrumpModel): number {
  return cardPoints(c) * 100 - (cardClass(c, t) === 'T' ? 40 : 0) - cardLevel(c, t);
}

export function playFor(
  view: PublicView,
  you: PlayerSeat,
  t: TrumpModel,
  params?: Partial<BotParams>
): Card[] {
  const p = paramsOf(params);
  const deal = view.deal!;
  const trick = deal.trick;
  const lead = trick !== null && trick.plays.length > 0 ? trick.plays[0]!.cards : null;
  // 已完成的墩 + 当前这一墩：缺门推断要用「谁在哪一墩里一张该门都没出」，所以按墩传
  const tricks = [...deal.trickHistory, ...(trick !== null && trick.plays.length > 0 ? [trick] : [])];
  const sight = new Sight({
    hand: you.hand,
    tricks,
    // 庄家自己埋的 3 张：它们已出局，既不是威胁也不该被当成「外面还有大牌」（闲家传空）
    outOfPlay: you.buriedKitty ?? [],
    trump: t
  });
  return lead === null ? leadPlay(you, t, sight, p) : followPlay(view, you, t, lead, p);
}

/** 我若此刻出这些牌，是否赢下当前这一墩（引擎的 trickWinner 是唯一裁判） */
function wouldWin(
  plays: readonly { seat: Seat; cards: readonly Card[] }[],
  seat: Seat,
  mine: readonly Card[],
  t: TrumpModel
): boolean {
  return trickWinner([...plays.map((p) => ({ ...p })), { seat, cards: mine }], t) === seat;
}

// --- 领出 -------------------------------------------------------------------

function leadPlay(you: PlayerSeat, t: TrumpModel, sight: Sight, p: BotParams): Card[] {
  const hand = you.hand;
  if (hand.length === 1) return [hand[0]!];

  const byClass = new Map<string, Card[]>();
  for (const c of sortHand(hand, t)) {
    const cls = cardClass(c, t);
    const bucket = byClass.get(cls);
    if (bucket) bucket.push(c);
    else byClass.set(cls, [c]);
  }
  const trumps = byClass.get('T') ?? [];
  const sideSuits = SUITS.map((s) => byClass.get(s) ?? []).filter((cards) => cards.length > 0);

  // 末轮：整手恰是一门单段顺子时这就是最后一墩（领出张数 = 手牌数），全押能把
  // 保底/抠底的 x 倍放大到最大 —— 但**只有主牌门才押得**：
  // 主牌门里唯一能压过我的是「更高的同长度主牌顺子」，而已被 sureRun（同门无敌）排除；
  // 副牌门不同 —— 缺门对手可以用同长度主牌顺子杀牌，「同门无敌」证明不了那一层
  // （踩过：副牌整手全押被杀，x 倍乘在输的那一侧）。押注只下在能证明的地方。
  const wholeHandLead = hand.length >= 2 && checkPlay(hand, hand, t, null) === null;
  if (wholeHandLead && classOfSet(hand, t) === 'T' && sight.sureRun(hand, t)) return [...hand];

  // 顶主吊主：持同门无敌的顶级主牌、且主牌还有没现身的（对手或底牌里），出顶主单张
  // 抽主 —— 庄家抽掉闲家的杀牌资本，闲家抽掉庄家的护底资本。
  //
  // 三条「清主」开关（历史行为都是关，默认保持旧口径）：
  // - `drawWhenLong`：原来的判据是顶张**可证必胜**（`sureWinner`），而**外面还有大王/小王时这条
  //   永远不成立** —— 于是最该清主的局面反而整个失效、退化到兜底去送副牌（表 8 d3 打崩就是这个）。
  //   打开后：主牌数 ≥ `drawWhenLongMinTrumps` 且不少于未见主牌数时，顶主不是必胜也照样吊。
  // - `trumpRunLead`：原来永远只领**单张**顶主；打开后若手里有同门无敌的主牌顺子（≥2），
  //   整段领出去 —— 一次抽掉每家 n 张主，而不是分 n 轮各抽 1 张。
  // - `keepBigJoker`：大王是全场唯一不可被压的牌，把它花在 0 分墩上等于把「铁定一墩」换掉。
  const drawLead = (): Card[] | null => {
    if (p.drawTrumps === 'never' || trumps.length === 0) return null;
    const unseenTrumps = sight.unseen('T', t);
    if (unseenTrumps <= 0) return null;
    const top = trumps.reduce((a, b) => (cardLevel(b, t) > cardLevel(a, t) ? b : a));
    const sureTop = sight.sureWinner(top, t);
    const longEnough =
      p.drawWhenLong && trumps.length >= p.drawWhenLongMinTrumps && trumps.length >= unseenTrumps;
    // 只被王压着：把那张王钓出来，之后我剩下的主牌就是这门最大的。
    const intoJoker =
      p.drawIntoJoker &&
      !isJoker(top) &&
      trumps.length >= 3 &&
      classCards('T', t).every(
        (other) =>
          cardLevel(other, t) <= cardLevel(top, t) || isJoker(other) || sight.gone(other)
      );
    if (!sureTop && !longEnough && !intoJoker) return null;

    const blocked = (card: Card): boolean => {
      if (p.keepBigJoker && isJoker(card) && card.joker === 'big') return true;
      if (p.protectPointedKitty && you.isDeclarer && cardsPoints(you.buriedKitty ?? []) > 0) return true;
      return false;
    };

    if (p.trumpRunLead) {
      // 从长到短找「同门无敌」的主牌顺子；找不到就退回单张顶主。
      const chains = extractChains(trumps, t).filter((chain) => chain.length >= 2);
      chains.sort((a, b) => b.length - a.length);
      for (const chain of chains) {
        if (chain.length >= hand.length) continue;      // 整手押上的事归上面的 wholeHandLead 管
        if (!sight.sureRun(chain, t)) continue;
        if (chain.some(blocked)) continue;
        return [...chain];
      }
    }
    if (blocked(top)) return null;
    return [top];
  };

  // 副门「同门无敌」的顶段：先找最长的（≥2 收大分），退而求其次单张。
  // 但必须先过 noRuffRisk：已知有人缺门（或这门未见牌太少、很可能有人缺门）就不算安全领出，
  // 否则等于把一段好牌送给对手杀（实测这类领出有 35% 能被合法压过）。
  const sureLead = (): Card[] | null => {
    let sure: Card[] | null = null;
    for (const cards of sideSuits) {
      const cls = cardClass(cards[0]!, t);
      const margin = you.isDeclarer ? p.leadCaution.declarer : p.leadCaution.defender;
      if (!sight.noRuffRisk(cls, t, margin)) continue;
      for (const chain of extractChains(cards, t)) {
        for (let len = Math.min(chain.length, 3); len >= 2; len--) {
          const window = chain.slice(chain.length - len);
          // 残局里窗口可能正好等于整手牌 —— 那就等于把整手押在副门上（x 倍的另一面），
          // 与全押同一条原则：只有**可证无人能压**的主牌门才押整手。副门一律拆成单张领出。
          if (window.length === hand.length) continue;
          if (sight.sureRun(window, t) && (sure === null || window.length > sure.length)) sure = window;
        }
        const single = [chain[chain.length - 1]!];
        if (sight.sureWinner(single[0]!, t) && sure === null) sure = single;
      }
    }
    return sure;
  };

  // 领出次序（`leadPriority`）：历史是「先吊主、后副门」，`side-first` 反过来 ——
  // 先把副门能证明必得的分兑现掉，再去动主牌（回应「大王早花、副门分没收到」那条诊断）。
  const order: readonly ('draw' | 'side')[] =
    p.leadPriority === 'side-first' ? ['side', 'draw'] : ['draw', 'side'];
  for (const which of order) {
    const cards = which === 'draw' ? drawLead() : sureLead();
    if (cards !== null) return cards;
  }

  // 兜底：最短副门的最低张（省主牌、保大牌）。
  if (sideSuits.length > 0) {
    if (p.noGiftExit) {
      // 兜底不许送牌：这两条都来自表 8 的真实亏分（d4#9 ♠K 丢 20、d6#4 ♣K 丢 10、d6#8 ♥K 丢 10）。
      // ① 「最短副门的最低张」在只剩一张 K 时**就是那张 K** —— 外面 A 还没露面就别领它；
      // ② 有 0 分的牌可领时，不领带分的牌。
      const all = sideSuits.flat();
      // 「送牌」= **赢不了又带分**（副 K 是最典型的：外面 A 还没露面，它必被吃掉，还值 10 分）。
      const gift = (c: Card): boolean => {
        const cls = cardClass(c, t);
        const higherAlive = classCards(cls, t).some(
          (other) => cardLevel(other, t) > cardLevel(c, t) && !sight.gone(other)
        );
        return higherAlive && cardPoints(c) > 0;
      };
      const clean = all.filter((c) => !gift(c));
      if (clean.length > 0) {
        const zero = clean.filter((c) => cardPoints(c) === 0);
        const pool = zero.length > 0 ? zero : clean;
        const shortest = sideSuits
          .map((cards) => cards.filter((c) => pool.some((x) => x === c)))
          .filter((cards) => cards.length > 0);
        if (shortest.length > 0) {
          const pick = shortest.reduce((a, b) => (b.length < a.length ? b : a));
          return [pick.reduce((a, b) => (cardLevel(b, t) < cardLevel(a, t) ? b : a))];
        }
      }
    }
    const shortest = sideSuits.reduce((a, b) => (b.length < a.length ? b : a));
    return [shortest.reduce((a, b) => (cardLevel(b, t) < cardLevel(a, t) ? b : a))];
  }
  // 只剩主牌：最低主牌。
  return [trumps.reduce((a, b) => (cardLevel(b, t) < cardLevel(a, t) ? b : a))];
}

// --- 跟牌 -------------------------------------------------------------------

function followPlay(
  view: PublicView,
  you: PlayerSeat,
  t: TrumpModel,
  lead: readonly Card[],
  p: BotParams
): Card[] {
  const deal = view.deal!;
  const hand = you.hand;
  const trick = deal.trick!;
  const info = leadInfo(lead, t)!;
  const n = info.size;
  const holding = hand.filter((c) => cardClass(c, t) === info.cardClass);
  const mode = followMode(holding.length, n);
  const trickPoints = cardsPoints(trick.plays.flatMap((p) => p.cards));
  const finalTrick = hand.length === n; // 这一墩打完手牌就空了（引擎保证三家同步）
  const contract = deal.contract;
  const declarerPoints = contract === null ? 0 : deal.captured[contract.declarerSeat]!.points;
  // 注意：`finalTrick` 时**没有选牌自由度** —— 手牌数 = 领出张数意味着这三张都得打出去，
  // 所以这里不必（也不能）为「末轮赌注」做取舍。x 倍的决定权只在领出者手里，
  // 那条决策在 `leadPlay` 里（全押只押主牌门），见那里的注释。
  const declarerNeeds =
    you.isDeclarer && contract !== null && declarerPoints + trickPoints < contract.points;
  // 跟牌与杀牌用**两个**门槛：实测这两件事的方向相反（见 `BotParams.ruffPointThreshold`）
  const followWant = trickPoints >= p.winPointThreshold || finalTrick || declarerNeeds;
  const ruffWant = trickPoints >= p.ruffPointThreshold || finalTrick || declarerNeeds;
  // 同伴概念（`BotParams.partnerAware`）：只有闲家有同伴，庄家恒 null。
  // `last` = 我是第三家 ⇒ 此刻的赢家**就是本墩终局**，后面没人能翻案。
  // 只在这一种局面上做同伴决策：第二家时同伴的赢墩还没定，让利/喂分都可能送给庄家。
  const partner = partnerSeatOf(you.seat, deal);
  const last = trick.plays.length === 2;
  const currentWinner = trick.plays.length > 0 ? trickWinner(trick.plays, t) : null;
  const partnerWins = partner !== null && last && currentWinner === partner;
  // 「不抢 / 不杀同伴已定的赢墩」是 `partnerAware` 这一半
  const partnerSettled = p.partnerAware && partnerWins;
  // 「把分垫给同伴」是另一半，单独一个开关（它自己就要求认出同伴，所以不依赖 partnerAware）
  const feed = p.feedPartner && partnerWins;
  // 能垫得出非主牌才谈得上「不杀」：手里全是主牌时只能杀（本墩归属不变，不是浪费）。
  const keepTrumpsBack = partnerSettled || p.ruffPolicy === 'never';

  const verify = (cards: Card[]): Card[] => {
    if (checkPlay(hand, cards, t, lead) === null) return cards;
    return fallbackPlay(hand, t, lead, n, p);
  };

  if (mode === 'must-follow-class') {
    const profile = bestProfile(holding, t, n);
    const win = buildFollow(holding, t, profile, 'top');
    // `dumpDiscipline` 只在**这一墩正被对手拿着**时才换选窗的方式。
    // 前两版无条件生效，实测都更差 —— 因为同伴赢墩时"别把分送给对手"这条根本不适用：
    // 那时把分垫给同伴正是我们要的（`feedPartner` 就是干这个的），无条件省分反而把喂分抵消掉。
    const mySide = you.isDeclarer ? [you.seat] : [you.seat, partner].filter((s): s is Seat => s !== null);
    const opponentWinning = currentWinner !== null && !mySide.includes(currentWinner);
    const low =
      p.dumpDiscipline && opponentWinning
        ? buildFollowCheap(holding, t, profile)
        : buildFollow(holding, t, profile, 'bottom');
    // `countOwnCardPoints`：让利要垫的那几张牌**自己带的分**也得算进「这一墩值不值得争」——
    // 桌上 0 分、但我要垫的牌带分时，「不争」等于把那张牌的分送给对手（表 8 d4#2 的 ♥5）。
    const wantWin =
      followWant || (p.countOwnCardPoints && trickPoints + cardsPoints(low) >= p.winPointThreshold);
    // 同伴已定的赢墩不抢：本墩已经是本侧的，牌的高低只影响手里留下什么 ⇒ 出最低的。
    // （普通局面下这里可能仍会被迫压过同伴 —— 整门都比同伴那张大时无牌可让，那不是浪费。）
    if (partnerSettled) return verify(low);
    if (wantWin && wouldWin(trick.plays, you.seat, win, t)) return verify(win);
    return verify(low);
  }

  // 缺门（该门一张都没有）且领出不是主牌：找**顶张最低**且压得过当前赢家的主牌顺子杀牌。
  if (holding.length === 0 && info.cardClass !== 'T') {
    const trumps = hand.filter((c) => cardClass(c, t) === 'T');
    const candidates: Card[][] = [];
    for (const chain of extractChains(trumps, t)) {
      for (let start = 0; start + n <= chain.length; start++) candidates.push(chain.slice(start, start + n));
    }
    candidates.sort(
      (a, b) => cardLevel(a[a.length - 1]!, t) - cardLevel(b[b.length - 1]!, t) || a.length - b.length
    );
    // `ruffPolicy`：`always` = 能杀就杀；`points-only` = 历史行为（过 `ruffPointThreshold` 才杀）；`never` = 不杀。
    // 同伴已定的赢墩优先于它 —— 杀那一墩只是白花一张主牌，本墩归属不会变。
    // `countOwnCardPoints` 在这里同源：不杀就要垫牌，垫的那张若带分，同样该算进代价。
    const cheapestDiscard = [...hand]
      .filter((c) => cardClass(c, t) !== info.cardClass)
      .sort((a, b) => discardValue(a, t, p.discardPointWeight) - discardValue(b, t, p.discardPointWeight))[0];
    const wantWin =
      ruffWant ||
      (p.countOwnCardPoints &&
        cheapestDiscard !== undefined &&
        trickPoints + cardPoints(cheapestDiscard) >= p.ruffPointThreshold);
    const ruffWanted = p.ruffPolicy === 'always' || wantWin;
    if (!partnerSettled && p.ruffPolicy !== 'never' && ruffWanted) {
      for (const run of candidates) {
        if (wouldWin(trick.plays, you.seat, run, t)) return verify(run);
      }
    }
  }

  // 垫牌/贴牌：出完该门剩下的牌 + 最不心疼的 k 张。
  // 决定不杀时（同伴已定赢墩 / `ruffPolicy: never`）先把非主牌垫出去 —— 缺门时用主牌
  // 「垫牌」其实就是杀牌，会把这一墩从同伴手里抢回来，白花一张主牌。
  const need = n - holding.length;
  const offClass = [...hand].filter((c) => cardClass(c, t) !== info.cardClass);
  let pool = offClass;
  if (keepTrumpsBack && info.cardClass !== 'T') {
    const nonTrump = offClass.filter((c) => cardClass(c, t) !== 'T');
    if (nonTrump.length >= need) pool = nonTrump;
  }
  const sorted = [...pool].sort((a, b) =>
    feed ? feedValue(b, t) - feedValue(a, t) : discardValue(a, t, p.discardPointWeight) - discardValue(b, t, p.discardPointWeight)
  );
  return verify([...holding, ...sorted.slice(0, need)]);
}

/**
 * 在「结构优先」的段长约束内挑具体牌。
 *
 * 段长来自引擎的 `bestProfile`（唯一实现），**链的挑选**才是我方的策略：
 * 想赢就从层号最高的链上取顶窗（手里最强的那一顺），想让利就从最低的链上取底窗。
 * 只按链长排序是不够的 —— 单张跟牌时「找第一条够长的链」会永远挑到最低那张，
 * 于是「该赢的墩不赢」（这正是单测抓到过的错）。
 */
function buildFollow(
  holding: readonly Card[],
  t: TrumpModel,
  pieces: readonly number[],
  window: 'top' | 'bottom'
): Card[] {
  const topOf = (chain: readonly Card[]): number => cardLevel(chain[chain.length - 1]!, t);
  const chains = extractChains(holding, t).map((chain) => [...chain]);
  chains.sort((a, b) =>
    window === 'top' ? topOf(b) - topOf(a) || b.length - a.length : topOf(a) - topOf(b) || b.length - a.length
  );
  const out: Card[] = [];
  let budget = pieces.reduce((sum, p) => sum + p, 0);
  for (const piece of pieces) {
    if (budget <= 0) break;
    const take = Math.min(piece, budget);
    let target = chains.find((chain) => chain.length >= take);
    if (target === undefined) target = chains.find((chain) => chain.length > 0);
    if (target === undefined) break;
    const count = Math.min(take, target.length);
    out.push(...(window === 'top' ? target.slice(target.length - count) : target.slice(0, count)));
    chains.splice(chains.indexOf(target), 1, target.slice(count));
    budget -= count;
  }
  return out;
}

/**
 * 让利时挑「送分最少」的那条链（`dumpDiscipline`）。
 *
 * 与 `buildFollow(…, 'bottom')` 的唯一差别是**选链的键**：那边永远从层号最低的链上取底窗，
 * 这边先把「这条链的底窗要送多少分」算出来，按「送分少 → 层号低」排序再取。
 *
 * **窗仍然只从链的底部取**（`slice(0, count)`），这一点是刻意的：第一版实现在整条链上滑窗、
 * 取了送分最少的窗口，结果会把 ♥5♥6♥7 里的 ♥6 拿走（从链中间挖洞），把结构优先这条基本原则
 * 破坏掉了 —— 那一版实测 −0.024/−0.038，不能算作「这条思路不行」的证据。
 */
function buildFollowCheap(holding: readonly Card[], t: TrumpModel, pieces: readonly number[]): Card[] {
  const chains = extractChains(holding, t).map((chain) => [...chain]);
  const out: Card[] = [];
  let budget = pieces.reduce((sum, p) => sum + p, 0);
  for (const piece of pieces) {
    if (budget <= 0) break;
    const take = Math.min(piece, budget);
    let best: { chain: Card[]; window: Card[]; cost: number } | null = null;
    for (const chain of chains) {
      if (chain.length === 0) continue;
      const count = Math.min(take, chain.length);
      const window = chain.slice(0, count);          // 只取底窗：链的高端是资产的所在，不能挖
      const cost = cardsPoints(window) * 100 + cardLevel(window[window.length - 1]!, t);
      if (best === null || cost < best.cost) best = { chain, window, cost };
    }
    if (best === null) break;
    out.push(...best.window);
    chains.splice(chains.indexOf(best.chain), 1, best.chain.filter((c) => !best!.window.includes(c)));
    budget -= best.window.length;
  }
  return out;
}

/** 兜底出牌：策略构造失败（理论不该发生）时的合法保底，绝不让桌面卡在机器人手里 */
function fallbackPlay(
  hand: readonly Card[],
  t: TrumpModel,
  lead: readonly Card[] | null,
  n: number,
  p: BotParams
): Card[] {
  const ok = (cards: readonly Card[]): boolean => checkPlay(hand, cards, t, lead) === null;
  if (lead === null) return [sortHand(hand, t)[0]!];
  const info = leadInfo(lead, t)!;
  const holding = hand.filter((c) => cardClass(c, t) === info.cardClass);
  if (holding.length >= n) {
    for (const combo of combinations(holding, n)) {
      if (ok(combo)) return combo;
    }
  }
  const rest = hand
    .filter((c) => cardClass(c, t) !== info.cardClass)
    .sort((a, b) => discardValue(a, t, p.discardPointWeight) - discardValue(b, t, p.discardPointWeight));
  return [...holding, ...rest.slice(0, n - holding.length)];
}

function combinations(cards: readonly Card[], n: number): Card[][] {
  const out: Card[][] = [];
  const walk = (start: number, acc: Card[]): void => {
    if (acc.length === n) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      acc.push(cards[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}
