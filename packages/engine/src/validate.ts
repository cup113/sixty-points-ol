import { containsCard, removeCards, type Card } from './cards.ts';
import {
  bestProfile,
  cardClass,
  cardLevel,
  classOfSet,
  compareProfiles,
  isRun,
  longestRun,
  segments,
  type CardClass,
  type TrumpModel
} from './order.ts';
import type { TrickPlay } from './trick.ts';

export interface LeadInfo {
  readonly cardClass: CardClass;
  readonly cards: readonly Card[];
  readonly size: number;
}

export function leadInfo(cards: readonly Card[], t: TrumpModel): LeadInfo | null {
  const cls = classOfSet(cards, t);
  return cls === null ? null : { cardClass: cls, cards, size: cards.length };
}

/** 手牌里与 `cls` 同门的那些牌 */
export function holdingOf(hand: readonly Card[], t: TrumpModel, cls: CardClass): Card[] {
  return hand.filter((c) => cardClass(c, t) === cls);
}

/**
 * 跟牌的两种模式，**只由「该门够不够」决定**：
 * 够 → 必须全出该门（还受结构优先约束）；不够 → 必须出完该门，其余任意垫。
 *
 * 这是 `validateFollow` 与 `playHint` 共用的那一个判断 —— 阈值只有一处，
 * 否则「工具面说该怎么出、服务端说非法」迟早会漂移。
 */
export type FollowMode = 'must-follow-class' | 'must-empty-class';

export function followMode(holdingCount: number, leadSize: number): FollowMode {
  return holdingCount >= leadSize ? 'must-follow-class' : 'must-empty-class';
}

/**
 * 「现在该怎么出」的结构化摘要（`check_play` 的省钱版）：
 * 只给**约束**，不复述手牌 —— 模型自己手上有 `you.hand`。
 *
 * `lead` 为 null 表示你是领出（单张，或同门顺子）；`holdingCount` 是你在领出那一门里的张数。
 */
export interface PlayHint {
  readonly lead: { readonly cardClass: CardClass; readonly size: number } | null;
  readonly holdingCount: number;
  readonly rule: FollowMode | 'lead-run-or-single';
}

export function playHint(hand: readonly Card[], t: TrumpModel, lead: readonly Card[] | null): PlayHint {
  const info = lead === null || lead.length === 0 ? null : leadInfo(lead, t);
  if (info === null) return { lead: null, holdingCount: hand.length, rule: 'lead-run-or-single' };
  const holding = holdingOf(hand, t, info.cardClass);
  return {
    lead: { cardClass: info.cardClass, size: info.size },
    holdingCount: holding.length,
    rule: followMode(holding.length, info.size)
  };
}

/** 领出校验：非空、同门、多张必须是顺子（不允许甩牌） */
export function validateLead(hand: readonly Card[], cards: readonly Card[], t: TrumpModel): string | null {
  if (cards.length === 0) return '必须至少出一张牌';
  if (cards.length > hand.length) return '出牌数超过手牌数';
  if (removeCards(hand, cards) === null) return '手牌中没有这些牌';
  const cls = classOfSet(cards, t);
  if (cls === null) return '一次出的多张牌必须同门（不允许甩牌）';
  if (cards.length > 1 && !isRun(cards, t)) return '多张牌必须构成顺子';
  return null;
}

/**
 * 跟牌校验：
 * - 张数必须与领出一致
 * - 该门张数 ≥ n：必须全出该门 n 张，且连续段分解字典序最大（结构优先）
 * - 该门张数 < n：必须出完该门所有牌，其余任意（垫牌自由；不成结构则不能赢）
 */
export function validateFollow(
  hand: readonly Card[],
  cards: readonly Card[],
  lead: LeadInfo,
  t: TrumpModel
): string | null {
  const n = lead.size;
  if (cards.length !== n) return `必须出 ${n} 张牌`;
  if (removeCards(hand, cards) === null) return '手牌中没有这些牌';

  const holding = holdingOf(hand, t, lead.cardClass);
  if (followMode(holding.length, n) === 'must-follow-class') {
    if (!cards.every((c) => cardClass(c, t) === lead.cardClass)) return '该门牌够，必须全部跟该门';
    if (compareProfiles(segments(cards, t), bestProfile(holding, t, n)) !== 0) {
      return '跟牌结构不足：应按最长顺子优先出牌';
    }
    return null;
  }

  const missing = holding.filter((h) => !containsCard(cards, h));
  if (missing.length > 0) return '该门牌不足，必须先出完该门所有牌';
  return null;
}

/**
 * 出牌的本地预判：`lead` 为 null 表示本轮还没人出牌（你是领出）。
 * 返回 null 表示合法，否则是给玩家看的中文原因。
 *
 * 界面（`$lib/labels` 的 checkPlay）与 MCP 工具面的 `check_play` 都走这一处 ——
 * 服务端始终是唯一裁判，这只是同一套规则的提前告知。
 */
export function checkPlay(
  hand: readonly Card[],
  cards: readonly Card[],
  t: TrumpModel,
  lead: readonly Card[] | null
): string | null {
  if (cards.length === 0) return null;
  if (lead === null) return validateLead(hand, cards, t);
  const info = leadInfo(lead, t);
  if (info === null) return '牌局状态异常';
  return validateFollow(hand, cards, info, t);
}

// ---------------------------------------------------------------------------
// 认赢（ADR-0028）：这一墩他这么快能不能赢、末轮能报多大
// ---------------------------------------------------------------------------

/**
 * 认赢报的**末轮张数**（底牌倍数 x）：能拿来收尾的最大张数；领不出为 null。
 *
 * x 是「收尾那一墩我领出几张」，所以它同时被三件事钳住：
 * - 手上真有一条 x 张的顺子（领出多张必须是顺子）；
 * - 这一墩我还得先打掉 `size` 张 —— 之后的墩才是我的「剩下」；
 * - 三家等长（`hand.length === size`）时这一墩**就是末墩**，x 只能等于这一墩的张数。
 *
 * 不让人挑：认领一旦成立，把最长那条顺子留到末轮总是摆得出来，而 x 越大底牌倍数越大 ——
 * 取上界恒不劣，于是这个数只有一个正确答案，由引擎算。
 */
export function claimLastTrickSize(
  hand: readonly Card[],
  plays: readonly TrickPlay[],
  t: TrumpModel
): number | null {
  const run = longestRun(hand, t);
  if (run < 1) return null; // 空手：一张也领不出
  if (plays.length === 0) return run; // 领出：这一墩的大小由我自己挑

  const size = plays[0]!.cards.length;
  if (hand.length < size) return null; // 出牌数超过手牌数：不是合法局面
  if (hand.length === size) return size; // 三家等长：这一墩就是末墩

  const max = Math.min(hand.length - size, run);
  return max < 1 ? null : max;
}

/**
 * 认赢**成不成立**（ADR-0028）：**他领出的每一墩都赢**，两条判据。
 *
 * 一、**主牌抽得干**：把他和对手的主牌各自从大到小排好，第 i 大的他要比第 i 大的对手大
 * （所以他也必须不比对手少）。于是他一张张领主牌，对手必须跟，每轮抽掉一张、并且每轮都是他赢；
 * 抽完之后对手一张主牌也没有了。
 *
 * 二、**副牌都是这一门剩下的最大几张**：每一门他最低的那张，也要比对手这门里最高的那张大。
 * 否则那张迟早要被他领出去（他会赢下每一墩，所以每一张牌最后都是他领），而对手一张更大的同门牌
 * 就把它压掉了。
 *
 * 为什么抽干主牌要放在副牌之前：对手只要还剩一张主牌，他领副牌时就能杀 —— 主牌不抽干，副牌
 * 再大也不安全。反过来两条都成立时，他从主牌往下领，谁也压不过、也没人杀得了（当前这一墩
 * 另由 `canWinTrickNow` 把守）。
 *
 * 偏严是刻意的：它也会误拒一些真认赢（比如某一门正好是一条对手跟不出的顺子）——
 * 误拒只丢一次快赢（牌局照常打完），误判会把不该给的墩判给他、算错分。
 */
export function claimUnbeatable(
  hand: readonly Card[],
  opponents: readonly Card[],
  t: TrumpModel
): boolean {
  const trumpsOf = (cards: readonly Card[]): number[] =>
    cards
      .filter((card) => cardClass(card, t) === 'T')
      .map((card) => cardLevel(card, t))
      .sort((a, b) => b - a);

  // 一、主牌逐张压过：第 i 大的都要比对手第 i 大的大（顺带也要求他不比对手少）
  const mine = trumpsOf(hand);
  const theirs = trumpsOf(opponents);
  if (theirs.length > mine.length) return false;
  for (let i = 0; i < theirs.length; i += 1) {
    if (mine[i]! <= theirs[i]!) return false;
  }

  // 二、副牌：我这一门最低的那张也要比对手这门最高的那张大
  const floor = new Map<CardClass, number>();
  for (const card of hand) {
    const cls = cardClass(card, t);
    if (cls === 'T') continue; // 主牌由上面那条管
    const level = cardLevel(card, t);
    const current = floor.get(cls);
    if (current === undefined || level < current) floor.set(cls, level);
  }
  for (const card of opponents) {
    const cls = cardClass(card, t);
    if (cls === 'T') continue; // 同上
    const mineLevel = floor.get(cls);
    if (mineLevel === undefined) continue; // 我这一门没有牌：他压不着我
    if (cardLevel(card, t) > mineLevel) return false;
  }
  return true;
}
