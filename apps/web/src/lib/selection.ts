import { cardKey, type Card } from '@sixty/engine';
import type { PlayerHand, Role } from './shared';

/**
 * 判断「选择是否还有意义」只需要这几项；完整负载结构上也满足它
 * （`StreamPayload` 多出来的字段不影响结构匹配）。
 */
export interface SelectionContext {
  readonly role: Role;
  readonly you: PlayerHand | null;
}

/** 一副手牌的指纹：张数 + 每张的短码（顺序也进指纹 —— 手牌是服务端排序后给的） */
function handFingerprint(hand: readonly Card[] | null | undefined): string {
  if (hand === null || hand === undefined) return '';
  return hand.map(cardKey).join(',');
}

/**
 * 收到一帧负载后，是否要丢弃玩家**正在选的牌**。
 *
 * 只有「让选择失去意义」的变化才清空：
 * - 角色或座位变了（我入座/离座/换了身份）—— 选择属于上一个座位；
 * - **我的手牌变了**（换副、全 pass 重发、补位接下了别人的牌、我刚出手）——
 *   那些牌已经不是手上这些了。
 *
 * 名单与在线点的变化**不清空**：任何人连上或断开这条流都会让服务端广播一帧
 * （`stream/+server.ts` 注册后即 broadcast，断开时也 broadcast），
 * 若无条件清空，观战者反复连断就能把在座玩家的选牌刷掉 —— 观战开放后这条路径人人为之。
 *
 * **牌局推进本身也不再清空**（早先的判据是 `view.version` 变了就清）—— 那是「拟选」的前提：
 * 别人出牌、收墩、换轮次都不该把你正在拟的那几张牌丢掉，能丢掉它们的只有「牌已经不在我手上」。
 * 于是拟选可以跨墩保留；轮到你时托盘用引擎的 `checkPlay` 判这组合不合法（`playError`），
 * 跟牌蓝框也会跟着新的领出重新标出该跟哪一门（见 CONTEXT.md 的 **拟选**）。
 */
export function shouldResetSelection(prev: SelectionContext | null, next: SelectionContext): boolean {
  if (prev === null) return true;
  if (prev.role !== next.role) return true;
  if ((prev.you?.seat ?? null) !== (next.you?.seat ?? null)) return true;
  return handFingerprint(prev.you?.hand) !== handFingerprint(next.you?.hand);
}
