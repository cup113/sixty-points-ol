import {
  bidCandidates,
  bidOptions,
  cardClass,
  cardKey,
  checkPlay as engineCheckPlay,
  isJoker,
  levelLabel,
  RANK_LABEL,
  rankLabel,
  SEATS,
  START_LEVEL,
  STRAINS,
  SUIT_LABEL,
  type Bid,
  type BidCall,
  type BidOption,
  type Card,
  type CompletedTrick,
  type DealSummary,
  type Level,
  type PublicView,
  type Seat,
  type Strain,
  type TrumpModel
} from '@sixty/engine';

/**
 * 文本里指代某个座位：本人用「你」，其余用玩家名。
 *
 * 界面上不再出现「东/南/西」：四角座位卡上显示的就是名字，方位在屏幕上没有锚点，
 * 玩家也不会去记自己是哪一方位。座位名由 `TableView.seats[].name` 提供。
 */
export function whoLabel(names: readonly (string | null)[], mySeat: number, seat: number): string {
  if (seat === mySeat) return '你';
  return names[seat] ?? '空座';
}

/**
 * 花色字形：用于紧凑的状态条、定约与叫品显示。
 *
 * 无主写成 `NT`（不再写「无主」）：与 MCP 工具面的合法叫品串（`55NT`）同一套写法，
 * 也是**叫牌面板固定五槽**能等宽的前提 —— 两个汉字比一个花色字形宽 60% 以上，
 * 第五槽要么加宽（行与行对不齐）要么压字。行文（`/rules`、`/learn` 的叙述句）仍写「无主」。
 */
export function strainGlyph(strain: Strain): string {
  return strain === 'NT' ? 'NT' : SUIT_LABEL[strain];
}

/** 叫品按钮上的字形，与 `strainGlyph` 同源；牌桌与编排台共用一份，不许各写各的 */
export const BID_GLYPH: Record<Strain, string> = {
  C: strainGlyph('C'),
  D: strainGlyph('D'),
  H: strainGlyph('H'),
  S: strainGlyph('S'),
  NT: strainGlyph('NT')
};

/** ♦ ♥ 用红字：牌面与按钮保持同一套色彩语言 */
export function isRedStrain(strain: Strain): boolean {
  return strain === 'H' || strain === 'D';
}

/**
 * 将牌环境的一句话说明：`级牌 5 · 主打 ♥` / `级牌 5 · NT`。
 *
 * 教程里凡是「3-4-6 是顺子」「副级三张相等」这类例子，都只有在级牌点数已知时才成立，
 * 所以每个示例块都要带上这句，读者不必往上翻去找级牌是几。
 */
export function trumpText(trump: TrumpModel): string {
  return `级牌 ${rankLabel(trump.rank)} · ${trump.strain === 'NT' ? 'NT' : `主打 ${SUIT_LABEL[trump.strain]}`}`;
}

/**
 * 一副牌的「定约 + 级牌」：`45♣ · 级 5` / `40NT · 级 A`。
 *
 * 定约给出打的分数与花色，级牌给出这一副的主级点数 —— 两者缺一不可：战报里的旧副
 * 级牌各不相同，只写定约的话「为什么这张 5 是主牌」在读旧战报时无从判断。
 * 花色走 `strainGlyph`（与叫品同一套字形），点数走 `rankLabel`（A 不写成 14）。
 */
export function contractText(s: DealSummary): string {
  return `${s.contract.points}${strainGlyph(s.contract.strain)} · 级 ${rankLabel(s.trump.rank)}`;
}

/** 级别拆分：底数（2..A）与右上角「+过次」，如 5(+2) → { rank: '5', cycle: 2 } */
export function levelParts(level: Level): { rank: string; cycle: number } {
  return { rank: rankLabel(level.rank), cycle: level.cycle };
}

/**
 * 轮数（跨过 A 的次数）的**视觉分层**。级别写作 `点数(+轮数)`，数值化是
 * `13 × 轮数 + 档位序号` —— **轮数权重 13、档位只有 1**。徽标若只放大档位、把轮数塞进
 * 9px 药丸，跨 A 时 `A(+0)`(=12) → `2(+1)`(=13) 明明是升级，大字却从 A 掉到 2，看着像掉级。
 * 所以让轮数同时落在**主数字**与药丸上：过 A 越多，金色越实、环越粗。
 *
 * 只用**不参与布局**的属性（color / box-shadow）：徽标宽高逐像素不变
 * （实测 /rules 三枚真徽标 cycle 0/1/2：25.828 / 27 / 25.828 × 31，改前改后一致）。
 * 正常轮数上限是 3（`FINISH_ONE_AT` 的 2(+3)），更高并入最高档。
 * 「不许出现布局类」由 test/level-tone.test.ts 钉住。
 */
export function levelTone(cycle: number): { rank: string; pill: string } {
  if (cycle <= 0) return { rank: '', pill: '' };
  if (cycle === 1) return { rank: 'text-gold', pill: 'ring-1 ring-gold/60' };
  if (cycle === 2) return { rank: 'text-gold', pill: 'ring-2 ring-gold/60' };
  return { rank: 'text-gold', pill: 'ring-2 ring-gold/70 shadow-[0_0_8px_rgba(216,180,90,.5)]' };
}

export function cardText(card: Card): string {
  if (isJoker(card)) return card.joker === 'small' ? '小王' : '大王';
  return `${SUIT_LABEL[card.suit]}${RANK_LABEL[card.rank] ?? card.rank}`;
}

/**
 * 叫品的显示文本：`不叫` 或 `40♣`。
 *
 * 花色一律走 `strainGlyph`（字形 / NT），界面任何位置都不许再拼 `STRAIN_LABEL` ——
 * 引擎的 `bidLabel` 是给日志和测试看的（`40 梅花`），不是给牌桌看的。
 */
export function bidText(call: BidCall): string {
  return call === 'pass' ? '不叫' : `${call.points}${strainGlyph(call.strain)}`;
}

/** `bidText` 的别名，保留旧名以免大范围改调用方 */
export function callText(call: BidCall): string {
  return bidText(call);
}

/**
 * 「距上一步」那个闹钟的**表面**：图标里直接写秒数，三档（ADR-0020 修订）。
 *
 * - `0..99` 秒：正常字号；
 * - `100..999` 秒：小一档字号（三位数要塞进 22px 的圆里）；
 * - `≥1000` 秒（约 17 分钟）：**不再写数**，改成一枚红色的「—」。
 *
 * 为什么 1000 秒之后不写数：那一刻它已经不是「谁想了多久」，而是「这张桌停住了」——
 * 三位以上的秒数在一个小圆里既读不出精确值、也没有意义（真实牌局里这个数动辄上万秒）。
 * 一枚红横杠把「停住了」说得更快，而且不占宽度。这是本项目**唯一**一处按时间升级的变色，
 * 早先 ADR-0020 写过「不做任何催促色阶」，那条判断在「计时占一整枚药丸、宽度足够」的前提下成立，
 * 改成图标之后不成立了：图标里没有第二个位置放「很久」这件事。
 *
 * 取值口径与 `formatElapsed` 一致（都是秒），差别只在呈现：药丸上写「12 分 34 秒」，
 * 图标里只写「754」。完整那句仍然由 `formatElapsed` 提供，挂在 `title` / `aria-label` 上。
 */
export interface ClockFace {
  readonly text: string;
  readonly tone: 'plain' | 'long' | 'stale';
}

/** 图标不再写数、改红色横杠的秒数门槛（1000 秒 ≈ 16 分 40 秒） */
export const CLOCK_STALE_SECONDS = 1000;

export function clockFace(ageMs: number): ClockFace {
  // 负数与非有限值一律当 0（与 `formatElapsed` 同一条纪律）：宁可显示「0」，也不许在牌面上出现 NaN
  const seconds = Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 1000)) : 0;
  if (seconds >= CLOCK_STALE_SECONDS) return { text: '—', tone: 'stale' };
  return { text: String(seconds), tone: seconds >= 100 ? 'long' : 'plain' };
}

/**
 * 时间上最后一次出手 —— 可能就是「不叫」。
 *
 * 与 `highestCall` 是两个概念：面板顶部的大字要的是**最高叫品**（将要成为定约的那个），
 * 「不叫」只进历史。别把这两个混用。
 */
export function lastCall(view: PublicView): BidCall | null {
  const auction = view.deal?.auction ?? [];
  return auction.length === 0 ? null : auction[auction.length - 1]!.call;
}

/** 当前最高叫品（末尾的非 pass 项）；还没人叫过则为 `null` */
export function highestCall(view: PublicView): Bid | null {
  const auction = view.deal?.auction ?? [];
  for (let i = auction.length - 1; i >= 0; i--) {
    const call = auction[i]!.call;
    if (call !== 'pass') return call;
  }
  return null;
}

export function levelText(view: PublicView, seat: number): string {
  const level = view.levels[seat];
  return level ? levelLabel(level) : '—';
}

export function isTurn(view: PublicView, seat: Seat, phase: 'auction' | 'play'): boolean {
  const deal = view.deal;
  if (!deal) return false;
  return phase === 'auction' ? deal.auctionTurn === seat : deal.playTurn === seat;
}

export interface LegalityContext {
  readonly hand: readonly Card[];
  readonly trump: TrumpModel;
  readonly lead: readonly Card[] | null;
}

/** 与服务端同一套纯函数做本地预判（最终以服务端判定为准） */
/** 与服务端、MCP 的 `check_play` 同一套纯函数做本地预判（最终以服务端判定为准） */
export function checkPlay(ctx: LegalityContext, cards: readonly Card[]): string | null {
  return engineCheckPlay(ctx.hand, cards, ctx.trump, ctx.lead);
}

export function handPoints(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => (isJoker(card) ? sum : card.rank === 5 ? sum + 5 : card.rank === 10 || card.rank === 13 ? sum + 10 : sum), 0);
}

export function selectKey(card: Card): string {
  return cardKey(card);
}

/**
 * 把「距上一步」的毫秒数写成给人看的时长：`12 秒` / `1 分 05 秒` / `2 小时 03 分`。
 *
 * 三档而不是一串冒号：牌桌上读到的是「等了多久」，`1 分 05 秒` 比 `01:05` 不需要翻译。
 * 秒与分都补零（`05` 而不是 `5`），这样同一个数字在走字时宽度不跳。
 * 负数与非有限值一律当 0：宁可显示「0 秒」，也不许在牌面上出现 `NaN` 或负数。
 */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分`;
  if (total >= 60) return `${Math.floor(total / 60)} 分 ${String(seconds).padStart(2, '0')} 秒`;
  return `${total} 秒`;
}

/**
 * 手牌中「来自底牌」的那些牌（多重集合语义）。
 *
 * 用于埋底阶段给庄家标注手牌：`you.originalKitty` 是权威来源，这里只做交集，
 * 不猜、不补、不排序 —— 返回顺序与 `hand` 一致，方便 UI 直接当标记集合用。
 *
 * 同点同花的两张牌在物理上不可区分，对玩家而言标哪一张都一样，所以按 `cardKey` 计数即可。
 */
export function kittyHandDelta(hand: readonly Card[], kitty: readonly Card[] | null): Card[] {
  if (kitty === null || kitty.length === 0) return [];
  const quota = new Map<string, number>();
  for (const card of kitty) {
    const key = cardKey(card);
    quota.set(key, (quota.get(key) ?? 0) + 1);
  }
  const out: Card[] = [];
  for (const card of hand) {
    const key = cardKey(card);
    const left = quota.get(key) ?? 0;
    if (left > 0) {
      quota.set(key, left - 1);
      out.push(card);
    }
  }
  return out;
}

/**
 * 赢墩徽标：只说「这 N 分进了谁家的账」。
 *
 * 三家分两方 —— 庄家一方（**庄**）与两名闲家一方（**闲**），所以赢家座位就决定了写哪个字。
 * 早先写「上一轮 · 赢墩 +N 分」：既报了时机（上一轮）又报了动作（赢墩），
 * 而玩家真正要一眼看懂的是「分归哪一方」——「庄 / 闲 +N 分」才是这条信息本身。
 */
export function trickSideBadge(
  declarerSeat: number | null,
  winnerSeat: number,
  points: number
): string {
  return `${winnerSeat === declarerSeat ? '庄' : '闲'} +${points} 分`;
}

/**
 * 「上一轮」的**唯一定义**：最近收掉的那一墩（`trickHistory` 的末项），还没收过墩时为 `null`。
 *
 * 两处都在读它：毡面出牌区（当前墩还没有出牌时回显上一墩，`TrickArea`）与回看浮层
 * （`TrickReview`，bot 出手太快时靠它把那一墩找回来）。定义只此一处 —— 两边各写一次
 * `trickHistory[trickHistory.length - 1]` 就是两处会各自过期。
 *
 * 入参取结构类型而不是 `PublicView`：调用方手上多半只有 `deal`，少一层解构。
 */
export function lastCompletedTrick(
  deal: { readonly trickHistory: readonly CompletedTrick[] } | null
): CompletedTrick | null {
  const history = deal?.trickHistory ?? [];
  return history.length === 0 ? null : history[history.length - 1]!;
}

/**
 * 跟牌时要蓝框高亮的手牌：**领出那一门的全部手牌**。
 *
 * 领出（`trick.plays` 为空）没有「同一门」可跟，缺门时这一门在手上一张也没有 ——
 * 两种情况都自然返回空集，所以调用方只按「轮到自己 + 跟牌」判断，不必再分情形。
 * 门用引擎的 `cardClass`（主牌是一门：主花色、副级、主级、双王都算），
 * 于是「领主牌」时高亮的正是整手主牌。
 */
export function followSuitCards(
  hand: readonly Card[],
  trump: TrumpModel | null,
  trick: { readonly plays: readonly { readonly cards: readonly Card[] }[] } | null
): Card[] {
  if (trump === null || trick === null || trick.plays.length === 0) return [];
  const led = trick.plays[0]!.cards;
  if (led.length === 0) return [];
  const cls = cardClass(led[0]!, trump);
  return hand.filter((card) => cardClass(card, trump) === cls);
}

/**
 * 结算算式里墩分与底牌之间的符号：保底 `+`、抠底 `−`。
 *
 * 用 U+2212 而不是键盘上的 ASCII `-`：它与 `/rules` 教程、编排台里的那个 `−` 是同一个字形，
 * 同一条算式里不许出现两种破折号。这个符号是整条式子里唯一决定「加还是扣」的东西，
 * 所以弹窗把它按保底/抠底着色并放大（见 ActionTray 旁边那条 CONTEXT.md 决定）。
 */
export function kittySign(protectedBottom: boolean): '+' | '−' {
  return protectedBottom ? '+' : '−';
}

/**
 * 结算结论一行：打输 `50/55（差 5 分）· 闲家升 1 级`，打成 `打成 65/60 · 庄家升 2 级`。
 *
 * 打输时「差 N 分」自己就把输赢说了，所以不再写「打输」二字；打成没有对应的余量说法
 * （恰好打平时写「超 0 分」反而是句怪话），所以保留「打成」。
 * 负分是合法的（抠底可以把庄家扣成负数），负数用同一个 U+2212 —— 不让面板里出现 ASCII 连字符。
 */
export function scoreLineText(s: DealSummary): string {
  const levels = s.levelChanges[0]?.levels ?? 0;
  const score = String(s.finalScore).replace(/^-/, '−');
  return s.made
    ? `打成 ${score}/${s.contract.points} · 庄家升 ${levels} 级`
    : `${score}/${s.contract.points}（差 ${s.shortfall} 分）· 闲家升 ${levels} 级`;
}

/** 结算弹窗级别表的一行 */
export interface LevelRow {
  readonly seat: Seat;
  readonly from: Level;
  readonly to: Level;
  readonly changed: boolean;
}

/**
 * 结算弹窗的级别表：**三家都要出现**。
 *
 * 没升级的那家也看得见，于是不必再单写一行「庄家级别不变。」；升级的行排前面（`sort` 是稳定的，
 * 所以两组内部仍按座位序）。没升级的那家没有 `LevelChange`，用它当前的级别同时当 from 与 to ——
 * `view.levels` 在结算后已经是终值。
 */
export function levelRows(summary: DealSummary, levels: readonly Level[]): LevelRow[] {
  const changed = new Map(summary.levelChanges.map((change) => [change.seat, change]));
  return SEATS.map((seat): LevelRow => {
    const change = changed.get(seat);
    const now = levels[seat] ?? START_LEVEL;
    return change === undefined
      ? { seat, from: now, to: now, changed: false }
      : { seat, from: change.from, to: change.to, changed: true };
  }).sort((a, b) => Number(b.changed) - Number(a.changed));
}

/**
 * 战报每副卡的升级行：**只列升级了的座位**。
 *
 * 与弹窗的 `levelRows`（三家全列）有意不同：`DealSummary` 只记**变动**，没升级的座位当时是什么
 * 级别不在负载里（`view.levels` 是当前值，往回套旧副会算错），所以历史这一层能给的就是
 * 「谁升了、从几到几」。全部行 `changed: true`，`LevelTable` 于是按升级行的样式渲染。
 */
export function changedLevelRows(summary: DealSummary): LevelRow[] {
  return summary.levelChanges.map((change) => ({
    seat: change.seat,
    from: change.from,
    to: change.to,
    changed: true
  }));
}

/** 升级表（「升级表」模式）的一行 */
export interface ProgressionRow {
  /** `0` = **开局**那一行（副数从 1 起，所以 0 不可能是真的副）；其余是各副的 `dealNo` */
  readonly dealNo: number;
  /** 这一行之后三家的级别（按座位序） */
  readonly levels: readonly Level[];
  /** 这一行里动了的是哪几家（开局全 false） */
  readonly changed: readonly boolean[];
}

/**
 * 升级表：把战报从**开局**一路演算到最后一副，给出每副打完时三家的级别。
 *
 * 为什么能算出来：`history` 覆盖本局从第 1 副起的每一副（`resume-check` 钉着「条数 = 副数」），
 * 每副只记**变动**（`levelChanges`）—— 从 `START_LEVEL` 出发逐副套用，就还原出全程。
 * 历史负载里没有「每副打完时的一整份级别快照」，这是它唯一能走的路（也是不能拿
 * `view.levels` 往回套的原因：那是**当前**值）。
 *
 * 返回的第一行是**开局**（`dealNo: 0`、三家都在 `START_LEVEL`），所以调用方直接把结果铺成表即可，
 * 不必自己再造一行；空战报时返回的正是这一行。
 */
export function levelProgression(history: readonly DealSummary[]): ProgressionRow[] {
  const levels: Level[] = SEATS.map(() => START_LEVEL);
  const rows: ProgressionRow[] = [
    { dealNo: 0, levels: [...levels], changed: SEATS.map(() => false) }
  ];
  for (const deal of history) {
    const changed = SEATS.map(() => false);
    for (const change of deal.levelChanges) {
      levels[change.seat] = change.to;
      changed[change.seat] = true;
    }
    rows.push({ dealNo: deal.dealNo, levels: [...levels], changed });
  }
  return rows;
}

/**
 * 叫牌面板的**固定槽位**与**跳叫触发形态** —— 面板摆哪些档、每档五个槽谁可点，全在这里算，
 * `BidPanel` 不自己判断（四场景表与反证在 `test/labels.test.ts`）。
 *
 * 两条 UI 不变式：
 *
 * 1. **花色恒定位**：每档永远给出 `STRAINS` 全序（♣ ♦ ♥ ♠ NT）的五个槽，不可叫的花色 `legal: false`。
 *    面板把它渲染成**隐形占位**，绝不让后面的槽往前补位 —— 一旦补位，「上一档第 3 个按钮」
 *    与「下一档第 3 个按钮」就不再是同一个花色，手快就是误触（这正是这次要修的形状）。
 *
 * 2. **跳叫显式化**：默认只给非跳叫档 —— 最便宜合法档，外加（该档不满五格时）再一档 +5；
 *    最便宜档已满五格（最高叫品是 NT，或还没人叫）时**只给这一档**，第二行整行让给触发钮。
 *    判定基准是**当前最高叫品**，不是字面上「前一个人」：他可能只是 pass，而 pass 不改变叫牌空间。
 *    点开后共 `BID_TIER_LIMIT` 档，触发钮消失（没有收回按钮）。更大的跳叫仍可由 API / MCP 叫出 ——
 *    引擎的合法集没变，这里少的只是「面板上一次摆几档」。
 */
export const BID_TIER_LIMIT = 5;

/** 一档里的一个花色槽：`legal: false` = 面板渲染隐形占位（占位，但不补位） */
export interface BidSlot {
  readonly strain: Strain;
  readonly legal: boolean;
}

/** 一档 = 一个分数 + 五个固定槽（严格按 ♣ ♦ ♥ ♠ NT 序） */
export interface BidTier {
  readonly points: number;
  readonly slots: readonly BidSlot[];
}

/**
 * 跳叫触发钮的形态：
 * - `line`：档位区**下面**右对齐的一枚细钮（跳叫独立成行）；
 * - `none`：已经展开，不再有触发钮。
 *
 * 为什么把早先的 `row-end`（第二档行末）退休掉：触发器一旦挤进档位行，那一行就比其它行宽，
 * 而槽位（`w-9`）没有 `shrink-0`，flex 于是**只把这一行的五个槽一起压窄**。实测 360px 视口上
 * 第 5 格的宽 36.0 vs 32.3、右缘相差 18.3px —— 两行的 NT 明显不在同一条竖线上（368px 的
 * 真实机型上是 3.5px，肉眼也看得出来）。跳叫独立成行之后，**档位行恒为「数字 + 五格」**，
 * 对齐就是结构保证，而不是「这次刚好放得下」。判据在 `scripts/shot-auction.ts` 的实测断言
 * （源码守卫看不见几何）。
 */
export type BidTrigger = 'line' | 'none';

export interface BidLayout {
  readonly tiers: readonly BidTier[];
  readonly trigger: BidTrigger;
}

export function bidTiers(view: PublicView, expanded: boolean): BidLayout {
  const rows = bidCandidates(view, expanded ? BID_TIER_LIMIT - 1 : 1);
  const tiers = rows.map((row): BidTier => ({
    points: row.points,
    slots: STRAINS.map((strain): BidSlot => ({ strain, legal: row.strains.includes(strain) }))
  }));
  if (expanded) return { tiers, trigger: 'none' };
  const first = tiers[0];
  // 最便宜档满五格 = 同分没有可压的花色，再上一档就已经是跳叫 —— 于是只摆这一档，
  // 剩下的位置让给下面那行触发钮（这是既有判据，与「扳手放哪儿」无关，所以照旧）。
  if (first !== undefined && first.slots.every((slot) => slot.legal)) {
    return { tiers: [first], trigger: 'line' };
  }
  return { tiers, trigger: 'line' };
}

/**
 * 叫牌合法集只有一处实现：引擎包（`bidOptions` 是纯规则，`bidCandidates` 只是从视图里取最高叫品）。
 *
 * 牌桌的叫牌面板、牌局编排台与 MCP 工具面的 `legal_bids` 都走这一份 ——
 * 合法集不允许有第二个来源，否则改规则时会出现「工具面说合法、服务端说非法」。
 * 这里保留同名转出，调用方不必改 import。
 */
export { bidCandidates, bidOptions, type BidOption };
