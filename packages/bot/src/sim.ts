/**
 * 机器重演（ADR-0016）：把一副**已经结算**的牌原样重发给三个机器人，从叫牌起完整重打一遍。
 *
 * 与策略包同一条铁律：
 * - **确定性** —— 机器人只做纯函数决策，重演没有 RNG 也不需要（发牌/重发不在重演之列，
 *   引擎要求的 rng 形参喂一个永不被调用的死函数）；同一副牌永远演出同一结果。
 * - **只见个人视图** —— 驱动器与 `fullgame.test.ts` 同构：`personalView → moveFor → dispatch`，
 *   机器人拿到的信息与真实桌面完全相同，不多看一张牌。
 * - **合法即构造** —— 动作被拒时退 `fallbackFor`（与服务端 `actAsBot` 同款双保险），再拒即抛错。
 *
 * 全 pass 分支：三家开叫均 pass 时引擎会自动**重发新牌**（dealNo 递增），而重演的语义是
 * 「重演这一副」，追新牌没有意义 —— 用 dealNo 漂移检测到重发就停下，返回 `{ kind: 'all-pass' }`，
 * 如实告诉调用方「机器人把这张牌作废了」。
 */
import {
  createGame,
  dealWith,
  dispatch,
  personalView,
  type Action,
  type Card,
  type DealSummary,
  type GameState,
  type Level,
  type Seat
} from '@sixty/engine';
import { fallbackFor, moveFor, type BotMove } from './policy.ts';

/** 重演的输入：一副牌的全部隐藏信息 + 副前级别（级牌点数取自庄家级别，得还原到开打前） */
export interface ReplayInput {
  /** 三家原始手牌（各 17 张，发牌那一刻的形状） */
  readonly hands: readonly (readonly Card[])[];
  /** 发牌留下的 3 张暗牌（拿上来的底牌；重演里机器人庄家自己重新埋） */
  readonly originalKitty: readonly Card[];
  readonly dealerSeat: Seat;
  readonly dealNo: number;
  /** 这一副**开打前**的三家级别 */
  readonly levels: readonly Level[];
}

/** 重演结果：打完出结算摘要；全 pass 出作废标记（约 5% 的副，策略确定性 ⇒ 无重试语义） */
export type ReplayResult = { readonly kind: 'scored'; readonly summary: DealSummary } | { readonly kind: 'all-pass' };

const STEP_CAP = 20_000;

/** 引擎的 dispatch 形参要 rng，但重演只 dispatch bid/bury/play，永远不会用到它 */
const deadRng = (): number => 0;

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

/** 此刻该谁行动（scored 已在循环开头返回，deal 在重演里恒非空） */
function actorOf(state: GameState): Seat {
  const deal = state.deal!;
  if (deal.phase === 'auction') return ((deal.dealerSeat + deal.auction.length) % 3) as Seat;
  if (deal.phase === 'bury') return deal.contract!.declarerSeat;
  return ((deal.trick!.leaderSeat + deal.trick!.plays.length) % 3) as Seat;
}

export function simulateDeal(input: ReplayInput): ReplayResult {
  let state = createGame(input.dealerSeat);
  state.levels = input.levels.map((level) => ({ ...level }));
  state.dealNo = input.dealNo;
  state.deal = dealWith(input.hands, input.originalKitty, input.dealerSeat, input.dealNo);

  for (let steps = 0; steps < STEP_CAP; steps++) {
    const deal = state.deal!;
    if (deal.phase === 'scored') return { kind: 'scored', summary: deal.summary! };

    const actor = actorOf(state);
    const view = personalView(state, actor);
    const move = moveFor(view, view.you);
    if (move === null) {
      throw new Error(`机器重演：座位 ${actor}（${deal.phase} 阶段）给不出动作`);
    }

    let result = dispatch(state, withSeat(move, actor), deadRng);
    if (!result.ok) {
      // 策略与引擎漂移（理论不该发生）：退保底合法动作，重演绝不卡死
      const fallback = fallbackFor(view, view.you);
      if (fallback === null) throw new Error(`机器重演：座位 ${actor}（${deal.phase}）动作被拒且无保底：${result.message}`);
      result = dispatch(state, withSeat(fallback, actor), deadRng);
    }
    if (!result.ok) throw new Error(`机器重演动作被拒：${result.message}`);

    // 全 pass ⇒ 引擎已自动重发（dealNo 递增、换了新牌）：重演到此为止
    if (result.state.deal!.dealNo !== input.dealNo) return { kind: 'all-pass' };
    state = result.state;
  }
  throw new Error('机器重演步数超限（20_000）——策略与引擎大概率漂移了');
}
