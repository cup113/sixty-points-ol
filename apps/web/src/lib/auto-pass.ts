/**
 * 委托不叫（ADR-0029）：叫牌阶段的一句话 —— 「这一副剩下的都不叫」。
 *
 * 形状上的三条决定，每条都对应一个会真实出问题的地方：
 *
 * ① **它是本机偏好，不是服务器状态**。委托存在 `localStorage` 里（键里带副号），
 *    与音量 / 震动同一类：不进负载、不进数据库、不跨设备。代价写在 ADR 里 ——
 *    页面关掉就不作数，它承诺的是「顺手」而不是「兜底」。
 * ② **由浏览器出手，而且慢半拍**。轮到我时页面等 `500~1500ms` 随机（与机器人
 *    `SIXTY_BOT_DELAY_MIN_MS` / `_MAX` 的出厂值同一档）再发出一次 `bid 'pass'`：
 *    桌面读不出这是代按，也不必读 —— 它就是我的一次 pass。
 * ③ **一拍一副一次**。记账键是 `副号:叫牌史长度`：同一拍重复到达、重连补帧都不会发第二次；
 *    副号变了（换副、全 pass 重发）记账自然对不上，于是**不会自我循环**。
 *
 * 这个文件是纯的（没有 Svelte runes、没有定时器、除了 `localStorage` 没有别的 IO），
 * 所以 `test/auto-pass.test.ts` 能在 node 里逐帧验证它 —— 调度那一半（定时器）住在
 * `client/table.svelte.ts`，它只负责「按这里说的做」。
 */
import type { PublicView } from '@sixty/engine';
import type { PlayerHand } from './shared';

/**
 * 代按的延迟区间（毫秒）。
 *
 * 与机器人同一档不是巧合：机器人的出厂延迟就是 500~1500（ADR-0015），
 * 于是「人在看牌、慢了一下才按不叫」与「服务器代按」在桌面上是同一种节奏。
 * 更短会显得像脚本抢答，更长会让整桌真的变慢。
 */
export const MIN_DELAY_MS = 500;
export const MAX_DELAY_MS = 1500;

/**
 * 这一拍该等多久。`rng` 一次调用只读一个数（`Math.random` 直接传进来）。
 * 脏值（NaN / 负数 / ≥1）一律夹到区间内 —— 调度器会在页面生命周期里一直跑，
 * `NaN` 传进 `setTimeout` 会变成「立刻触发」，那正好是最不该发生的形状。
 */
export function autoPassDelay(rng: () => number): number {
  const raw = rng();
  const unit = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
  const span = MAX_DELAY_MS - MIN_DELAY_MS + 1;
  return MIN_DELAY_MS + Math.floor(unit * span);
}

/**
 * 代按的**重试预算**：发失败这么多次就停下，等下一帧再说。
 *
 * 为什么必须有一个上限：代按失败之后**不会再来下一帧**（SSE 已断，或服务端不可达），
 * 而这一拍之后可能再也没有别人出手 —— 于是「发失败就立刻再排一拍」就是一条**每秒重发一次**的
 * 循环：每轮都把 `busy` 翻一次（手动「不叫」跟着每秒灰一下），页头刚写上的横幅也每秒被抹一次。
 */
export const AUTO_PASS_TRIES = 5;

/** 退避的上限（毫秒）：预算烧完之前最久等这么久 */
export const AUTO_PASS_BACKOFF_MAX_MS = 4_000;

/**
 * 第 `tries` 次重试要多等多久（`tries` 从 0 起）：500 / 1000 / 2000 / 4000，之后封顶。
 *
 * 退避把「网络抖一下」与「网真断了」分成两件事：前者一两拍就成，后者很快把预算烧完并停下来，
 * 期间发出的请求是五次而不是「一直每秒一次」。
 * 脏值按 0 处理（与 `autoPassDelay` 同一条纪律：宁可早一拍，也不许 `NaN` 变成「立刻触发」）。
 */
export function autoPassRetryDelay(tries: number): number {
  const step = Number.isFinite(tries) ? Math.max(0, Math.floor(tries)) : 0;
  return Math.min(AUTO_PASS_BACKOFF_MAX_MS, MIN_DELAY_MS * 2 ** Math.min(step, 3));
}

/**
 * 记账键：哪一副、叫牌的第几次出手。
 *
 * 为什么带 `auctionLength`：叫牌严格按座位轮转，同一个人在**同一副**里会不止一次出手
 * （两家继续抬价时）。只按副号记账会让第二拍不再代按；只按长度记账则换副之后可能撞上。
 */
export function beatKey(dealNo: number, auctionLength: number): string {
  return `${dealNo}:${auctionLength}`;
}

/**
 * 现在这一拍该不该代按：该，返回**这一拍的记账键**；不该，返回 `null`。
 *
 * 判据全部来自视图里已有的字段，一条都不另算：
 * - `armed`：这一副是否已委托（来自本机存储）；
 * - `deal.phase === 'auction'`：只覆盖叫牌，埋底与出牌永远是人的事；
 * - `deal.auctionTurn === you.seat`：轮次真相只取引擎这一个字段（不另写一份「现在轮到谁」）；
 * - `beat !== firedBeat`：这一拍还没代按过。
 *
 * 观战者没有 `you`，于是恒为 `null` —— 与「拟选」同一条分支形状。
 */
export function autoPassBeat(
  view: PublicView | null,
  you: PlayerHand | null,
  armed: boolean,
  firedBeat: string | null
): string | null {
  if (!armed) return null;
  const deal = view?.deal ?? null;
  if (deal === null || deal.phase !== 'auction') return null;
  if (you === null) return null;
  if (deal.auctionTurn !== you.seat) return null;
  const beat = beatKey(deal.dealNo, deal.auction.length);
  return beat === firedBeat ? null : beat;
}

/** 存储键：一张桌一个键（换桌互不影响，同名不同桌也不会串） */
export const AUTO_PASS_KEY_PREFIX = 'sixty.auto-pass.';

export function autoPassKey(code: string): string {
  return `${AUTO_PASS_KEY_PREFIX}${code.toUpperCase()}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 读「这一张桌的委托挂在第几副上」。
 *
 * 存的是**副号**而不是一个布尔：委托只对这一副有效，于是「换副自动作废」不需要任何清理代码，
 * `全 pass` 重发（副号 +1）也自然不会把委托带进新一副 —— 三个都委托过不会变成死循环。
 * 脏值 / 缺失 / storage 不可用一律当作「没委托」。
 */
export function readArmedDealNo(code: string): number | null {
  const raw = storage()?.getItem(autoPassKey(code)) ?? null;
  if (raw === null || raw.trim() === '') return null;
  // 严格：写进去的永远是整数的副号，`'2.5'` / `'abc'` 这类只可能来自外部改动 ——
  // 若用 `parseInt`，`'2.5'` 会被悄悄读成第 2 副，于是「脏值」变成了一个看着像真的委托。
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 写委托（`null` = 撤回）。storage 不可用（无痕模式、禁用 cookie）时静默放弃，不抛错 */
export function writeArmedDealNo(code: string, dealNo: number | null): void {
  try {
    const store = storage();
    if (store === null) return;
    if (dealNo === null) store.removeItem(autoPassKey(code));
    else store.setItem(autoPassKey(code), String(dealNo));
  } catch {
    // 写不进去就算了：委托只在本次会话内有效，不该因此打断打牌
  }
}

/** 这一副是否已委托 */
export function isArmedFor(code: string, dealNo: number): boolean {
  return readArmedDealNo(code) === dealNo;
}

/**
 * 存储里那份委托**该变成什么**（`null` = 清掉）。每帧调一次。
 *
 * 一条规则：**只有「正在叫牌的那一副」值得留着**。叫牌一结束（成交 / 全 pass 重发 / 结算）、
 * 或者手上根本没有牌局，就清掉。于是有一条结构性保证：
 *
 * > 台账里永远只可能躺着一个**当下正在叫牌**的副号。
 *
 * 它顺手治掉了一个只有这种存法才会有的窟窿：`开新对局` 会把副号从 1 重新数起，
 * 若第 1 副勾过委托就再没动过，那条 `1` 会在新对局的第 1 副重新生效 —— 等于「我明明没委托，
 * 却被自动 pass 了一副」。按「叫牌结束就清」的规则，这一副的叫牌早已结束，账早就空了。
 */
export function armedAfter(view: PublicView | null, armedDealNo: number | null): number | null {
  const deal = view?.deal ?? null;
  if (deal === null || deal.phase !== 'auction') return null;
  return armedDealNo === deal.dealNo ? deal.dealNo : null;
}
