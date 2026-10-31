import type { Card, Seat } from './cards.ts';
import { bestRunTop, cardClass, classOfSet, segments, topLevel, type TrumpModel } from './order.ts';

export interface TrickPlay {
  readonly seat: Seat;
  readonly cards: readonly Card[];
}

/**
 * 一轮赢家：只有“与领出同长度的单段顺子”能竞争。
 * 主牌顺子压过副牌；同门比顶张；层号相等（副级/无主级牌）时先出为大。
 * 旁门垫牌、结构性跟牌（如 3+1）均不能赢。
 */
export function trickWinner(plays: readonly TrickPlay[], t: TrumpModel): Seat {
  const lead = plays[0]!;
  const n = lead.cards.length;
  const leadCls = classOfSet(lead.cards, t)!;
  let bestSeat = lead.seat;
  let bestCards = lead.cards;
  let bestCls: ReturnType<typeof classOfSet> = leadCls;

  for (let i = 1; i < plays.length; i++) {
    const p = plays[i]!;
    if (p.cards.length !== n) continue;
    const cls = classOfSet(p.cards, t);
    if (cls === null) continue;
    if (segments(p.cards, t).length !== 1) continue;

    if (cls === 'T' && bestCls !== 'T') {
      bestSeat = p.seat;
      bestCards = p.cards;
      bestCls = cls;
      continue;
    }
    if (cls !== 'T' && bestCls === 'T') continue;
    if (cls !== 'T' && cls !== leadCls) continue;

    if (topLevel(p.cards, t) > topLevel(bestCards, t)) {
      bestSeat = p.seat;
      bestCards = p.cards;
    }
  }
  return bestSeat;
}

/**
 * 「这手牌现在打出去，压不压得住桌上最好的那手」。
 *
 * 认赢（ADR-0028）的必要条件之一：发起人**一定是还没出牌的那一位**（`playTurn`），
 * 而结算把当前这一墩也整墩收走，所以「剩下的每一墩都归我」在这一墩上也必须成立。
 * 牌局输掉的那一刻就赢不回来 —— 这种认领在引擎里直接拒，不交给两张票。
 *
 * 与 `validateFollow` 同一套判据，但只回答「最好也只能到哪」（不复制结构优先的枚举）：
 * - 本门够 n 张：必须跟本门，只有**单段 n 顺**能赢（结构性跟牌、垫牌都不行）；
 * - 本门不够：只有缺门（0 张）才谈得上杀牌，且要一条 n 连主；已被别人杀着时还要比它大。
 */
export function canWinTrickNow(
  hand: readonly Card[],
  plays: readonly TrickPlay[],
  t: TrumpModel
): boolean {
  if (plays.length === 0) return true; // 轮你领出：还没有人压你

  const lead = plays[0]!;
  const size = lead.cards.length;
  const leadCls = classOfSet(lead.cards, t);
  if (leadCls === null) return false;

  const best = plays.find((play) => play.seat === trickWinner(plays, t))!;
  const bestCls = classOfSet(best.cards, t)!;
  const bestTop = topLevel(best.cards, t);
  const bestIsRuff = bestCls === 'T' && leadCls !== 'T';

  const holding = hand.filter((card) => cardClass(card, t) === leadCls);
  if (holding.length >= size) {
    // 本门够：只能跟本门，且要一条压得过当前最好的 n 连
    return !bestIsRuff && bestRunTop(holding, size, t) > bestTop;
  }
  // 本门不够：跟牌一定是结构性的（本门若干 + 垫牌），赢不了；主牌门本身不够时也没有杀牌
  if (holding.length > 0 || leadCls === 'T') return false;

  const trumps = hand.filter((card) => cardClass(card, t) === 'T');
  const top = bestRunTop(trumps, size, t);
  // 缺门：任意 n 连主都压得过副牌领出；已被杀着时要比那手更大
  return top >= 0 && (!bestIsRuff || top > bestTop);
}
