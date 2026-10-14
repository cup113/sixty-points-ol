/**
 * 强制判定：用户点了牌 / 叫了品之后，**该不该放行**。
 *
 * 两类拒绝（CONTEXT.md 的 **教练栏**）：
 * - `illegal` —— 引擎说这手不合法（结构优先、必须跟门、叫品不够高…）。**引擎的理由原样透出**，
 *   因为那条理由本身就是教材。
 * - `off-guide` —— 这手**合法**，但不是引导词点的那一手。指回教练栏。
 *
 * 顺序是有意的：**先问合法性**。用户选了一张，既不合引导、也不合法时，该看到的是规则原因
 * （「必须出 3 张牌」），而不是「不是这张」。
 */
import {
  highestBid,
  isPass,
  removeCards,
  validateCall,
  type BidCall,
  type Card,
  type GameState,
  type Seat
} from '@sixty/engine';
import { callText, cardText, checkPlay, type LegalityContext } from '../labels.ts';
import { handFromKeys, sameCards } from './replay.ts';
import type { GuideAction } from './types.ts';

export type RejectionKind = 'illegal' | 'off-guide';

export interface Rejection {
  readonly kind: RejectionKind;
  /** 直接给玩家看的一句中文 */
  readonly reason: string;
}

/** `null` = 放行 */
export type Verdict = Rejection | null;

/** 这一步引导词指定的牌（埋底 3 张 / 出牌 n 张）；叫牌步与「不叫」为 null */
export function guidedCards(action: GuideAction): Card[] | null {
  if (action.type === 'play' || action.type === 'bury') return handFromKeys(action.cards);
  return null;
}

/** 这一步引导词指定的叫品；只有叫牌步有，可能是 `'pass'` */
export function guidedCall(action: GuideAction): BidCall | null {
  return action.type === 'bid' ? action.call : null;
}

/**
 * 把引导目标写成一行提示文字（教练栏右上角那枚小标）：`♣3-4-6` / `45♥` / `不叫`。
 * 叫品走 `callText`、牌面走 `cardText`，与界面其它地方同一套字形。
 */
export function describeTarget(action: GuideAction): string {
  if (action.type === 'bid') return callText(action.call);
  return handFromKeys(action.cards).map(cardText).join(' ');
}

/** 两个叫品是不是同一个（「不叫」只与「不叫」相等） */
export function sameCall(a: BidCall, b: BidCall): boolean {
  if (isPass(a) || isPass(b)) return isPass(a) && isPass(b);
  return a.points === b.points && a.strain === b.strain;
}

/** 出牌：先引擎合法性，再对引导目标 */
export function judgePlay(
  state: GameState,
  seat: Seat,
  target: readonly Card[],
  attempt: readonly Card[]
): Verdict {
  const deal = state.deal;
  if (deal === null || deal.phase !== 'play' || deal.trump === null) {
    return { kind: 'illegal', reason: '当前不是出牌阶段' };
  }
  const trick = deal.trick;
  const lead = trick === null || trick.plays.length === 0 ? null : (trick.plays[0]!.cards as readonly Card[]);
  const ctx: LegalityContext = { hand: deal.hands[seat]!, trump: deal.trump, lead };
  const bad = checkPlay(ctx, attempt);
  if (bad !== null) return { kind: 'illegal', reason: bad };
  if (!sameCards(attempt, target)) {
    return {
      kind: 'off-guide',
      reason: `这手本身能出，但教程带你打另一手：${target.map(cardText).join(' ')}`
    };
  }
  return null;
}

/** 叫牌：先引擎合法性（`validateCall` 是唯一那份阈值），再对引导目标 */
export function judgeBid(
  state: GameState,
  seat: Seat,
  target: BidCall,
  attempt: BidCall
): Verdict {
  const deal = state.deal;
  if (deal === null || deal.phase !== 'auction') {
    return { kind: 'illegal', reason: '当前不是叫牌阶段' };
  }
  const bad = validateCall(attempt, highestBid(deal.auction));
  if (bad !== null) return { kind: 'illegal', reason: bad };
  if (!sameCall(attempt, target)) {
    return { kind: 'off-guide', reason: `这个叫品合法，但教程带你叫：${callText(target)}` };
  }
  return null;
}

/** 埋底：引擎只认「正好 3 张且都在手里」，其余归引导目标 */
export function judgeBury(
  state: GameState,
  seat: Seat,
  target: readonly Card[],
  attempt: readonly Card[]
): Verdict {
  const deal = state.deal;
  if (deal === null || deal.phase !== 'bury') {
    return { kind: 'illegal', reason: '当前不是埋底阶段' };
  }
  if (attempt.length !== 3) return { kind: 'illegal', reason: '必须埋 3 张底牌' };
  if (removeCards(deal.hands[seat]!, attempt) === null) {
    return { kind: 'illegal', reason: '手牌中没有这些牌' };
  }
  if (!sameCards(attempt, target)) {
    return {
      kind: 'off-guide',
      reason: `这三张也能埋，但教程带你埋：${target.map(cardText).join(' ')}`
    };
  }
  return null;
}
