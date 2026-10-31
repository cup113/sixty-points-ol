import type { Card, Rank, RNG, Seat, Suit } from '../src/cards.ts';
import { cardKey, STRAINS } from '../src/cards.ts';
import { bestProfile, cardClass, cardLevel, classOfSet, segments, type CardClass, type TrumpModel } from '../src/order.ts';
import { createGame, START_LEVEL, type Action, type DealState, type GameState } from '../src/state.ts';
import { MIN_BID, validateCall, type Bid, type BidCall } from '../src/auction.ts';

/** 确定性 RNG，便于复现牌局 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}
export const SJ: Card = { joker: 'small' };
export const BJ: Card = { joker: 'big' };

export function pick<T>(items: readonly T[], rng: RNG): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function sample<T>(items: readonly T[], n: number, rng: RNG): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return out;
}

/** 枚举所有 n 元子集（仅用于小规模暴力校验） */
export function combinations<T>(items: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]): void => {
    if (acc.length === n) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

export function groupByClass(cards: readonly Card[], t: TrumpModel): Map<CardClass, Card[]> {
  const map = new Map<CardClass, Card[]>();
  for (const card of cards) {
    const cls = cardClass(card, t);
    const bucket = map.get(cls);
    if (bucket) bucket.push(card);
    else map.set(cls, [card]);
  }
  return map;
}

/**
 * 与引擎一致的「最长连续链优先」分解，但返回具体牌。
 * 层号相等的牌（副级 / 无主级牌）不能同链，但可被不同链分别使用。
 */
export function extractChains(cards: readonly Card[], t: TrumpModel): Card[][] {
  const byLevel = new Map<number, Card[]>();
  for (const card of cards) {
    const lv = cardLevel(card, t);
    const bucket = byLevel.get(lv);
    if (bucket) bucket.push(card);
    else byLevel.set(lv, [card]);
  }
  const chains: Card[][] = [];
  let remaining = cards.length;
  while (remaining > 0) {
    const levels = [...byLevel.entries()]
      .filter(([, bucket]) => bucket.length > 0)
      .map(([lv]) => lv)
      .sort((a, b) => a - b);
    let bestStart = 0;
    let bestLen = 0;
    let i = 0;
    while (i < levels.length) {
      let j = i;
      while (j + 1 < levels.length && levels[j + 1] === levels[j]! + 1) j += 1;
      const len = j - i + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = i;
      }
      i = j + 1;
    }
    const chain: Card[] = [];
    for (let k = bestStart; k < bestStart + bestLen; k++) {
      chain.push(byLevel.get(levels[k]!)!.shift()!);
    }
    chains.push(chain);
    remaining -= bestLen;
  }
  return chains.sort((a, b) => b.length - a.length);
}

/** 随机合法领出：单张或某门连续链中的一段 */
export function randomLead(hand: readonly Card[], t: TrumpModel, rng: RNG): Card[] {
  const chains: Card[][] = [];
  for (const cards of groupByClass(hand, t).values()) chains.push(...extractChains(cards, t));
  const usable = chains.filter((chain) => chain.length >= 2);
  if (usable.length === 0 || rng() < 0.4) return [pick(hand, rng)];
  const chain = pick(usable, rng);
  const len = 2 + Math.floor(rng() * (chain.length - 1));
  const start = Math.floor(rng() * (chain.length - len + 1));
  return chain.slice(start, start + len);
}

/** 按 bestProfile 的段长要求在 holding 中取具体牌（每段取连续窗口），并自校验结果 */
export function chooseStructure(
  holding: readonly Card[],
  t: TrumpModel,
  pieces: readonly number[],
  rng: RNG
): Card[] {
  const chains = extractChains(holding, t);
  const out: Card[] = [];
  let budget = pieces.reduce((sum, n) => sum + n, 0);
  for (const chain of chains) {
    if (budget <= 0) break;
    const take = Math.min(budget, chain.length);
    const start = take === chain.length ? 0 : rng() < 0.5 ? 0 : chain.length - take;
    out.push(...chain.slice(start, start + take));
    budget -= take;
  }
  if (budget !== 0) throw new Error(`结构分解无法满足：还差 ${budget} 张`);
  const got = segments(out, t);
  const want = bestProfile(holding, t, out.length);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`构造出的结构 ${JSON.stringify(got)} 与最优 ${JSON.stringify(want)} 不一致`);
  }
  return out;
}

/** 随机合法跟牌 */
export function randomFollow(hand: readonly Card[], leadCards: readonly Card[], t: TrumpModel, rng: RNG): Card[] {
  const n = leadCards.length;
  const leadCls = classOfSet(leadCards, t)!;
  const holding = hand.filter((card) => cardClass(card, t) === leadCls);
  if (holding.length >= n) return chooseStructure(holding, t, bestProfile(holding, t, n), rng);
  const others = hand.filter((card) => cardClass(card, t) !== leadCls);
  return [...holding, ...sample(others, n - holding.length, rng)];
}

function highestOf(deal: DealState): Bid | null {
  for (let i = deal.auction.length - 1; i >= 0; i--) {
    const call = deal.auction[i]!.call;
    if (call !== 'pass') return call;
  }
  return null;
}

export function randomLegalAction(state: GameState, rng: RNG): Action {
  const deal = state.deal;
  if (deal === null || deal.phase === 'scored') return { type: 'deal' };
  if (deal.phase === 'auction') {
    const turn = ((deal.dealerSeat + deal.auction.length) % 3) as Seat;
    if (rng() < 0.3) return { type: 'bid', seat: turn, call: 'pass' };
    return { type: 'bid', seat: turn, call: randomBid(deal, rng) };
  }
  if (deal.phase === 'bury') {
    const seat = deal.contract!.declarerSeat;
    return { type: 'bury', seat, cards: sample(deal.hands[seat]!, 3, rng) };
  }
  const t = deal.trump!;
  const trick = deal.trick!;
  const turn = ((trick.leaderSeat + trick.plays.length) % 3) as Seat;
  const hand = deal.hands[turn]!;
  const cards =
    trick.plays.length === 0
      ? randomLead(hand, t, rng)
      : randomFollow(hand, trick.plays[0]!.cards, t, rng);
  return { type: 'play', seat: turn, cards };
}

function randomBid(deal: DealState, rng: RNG): BidCall {
  const highest = highestOf(deal);
  const base = highest === null ? MIN_BID : highest.points;
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate: Bid = { points: base + 5 * Math.floor(rng() * 4), strain: pick(STRAINS, rng) };
    if (validateCall(candidate, highest) === null) return candidate;
  }
  return { points: base + 5, strain: 'C' };
}

export interface RigOptions {
  readonly trump?: TrumpModel;
  readonly declarerSeat?: Seat;
  readonly dealerSeat?: Seat;
  readonly points?: number;
  readonly levels?: GameState['levels'];
}

/** 直接构造已进入出牌阶段的牌局，用于打牌/结算规则的精确测试 */
export function rigPlayDeal(
  hands: readonly (readonly Card[])[],
  kitty: readonly Card[],
  opts: RigOptions = {}
): GameState {
  const declarerSeat = opts.declarerSeat ?? 0;
  const trump = opts.trump ?? { strain: 'H', rank: 7 };
  const deal: DealState = {
    phase: 'play',
    dealNo: 1,
    dealerSeat: opts.dealerSeat ?? 0,
    hands: hands.map((h) => [...h]),
    originalKitty: [...kitty],
    kitty: [...kitty],
    auction: [],
    contract: { points: opts.points ?? 40, strain: trump.strain, declarerSeat },
    trump,
    trick: { leaderSeat: declarerSeat, plays: [] },
    trickHistory: [],
    captured: [[], [], []],
    summary: null,
    claim: null
  };
  const game = createGame(opts.dealerSeat ?? 0);
  game.levels = opts.levels
    ? opts.levels.map((l) => ({ ...l }))
    : [{ ...START_LEVEL }, { ...START_LEVEL }, { ...START_LEVEL }];
  game.dealNo = 1;
  game.deal = deal;
  return game;
}

export function keys(cards: readonly Card[]): string[] {
  return cards.map(cardKey).sort();
}
