/**
 * 跟牌属性测试：**「手里有能赢的合法组合时，它必须赢」** —— 这条是审查者用探针
 * 反向验证过的（20000 例 0 漏），这里降采样成常驻回归，免得将来改 `buildFollow`
 * 或 `verify` 的兜底逻辑时悄悄把「该赢不赢」放回来。
 *
 * 为什么值得单独一条：`verify()` 在构造被引擎拒掉时会**静默**改走 `fallbackPlay`
 * （枚举里第一个合法解，通常是手里最低的几张），于是「想赢」变成「让利」——
 * 这类退化没有任何报错，只能靠不变量钉住。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardClass,
  cardKey,
  cardPoints,
  checkPlay,
  containsCard,
  createGame,
  fullDeck,
  personalView,
  SUITS,
  trickWinner,
  type Card,
  type Contract,
  type Level,
  type PersonalView,
  type Strain,
  type Suit,
  type Trick,
  type TrumpModel
} from '@sixty/engine';
import { playFor } from '../src/policy.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const levelsOf = (rank: number): Level[] => [
  { rank, cycle: 0 },
  { rank, cycle: 0 },
  { rank, cycle: 0 }
];

function makeView(hand: readonly Card[], trump: TrumpModel, trick: Trick): PersonalView {
  const used = [...hand, ...trick.plays.flatMap((p) => p.cards)];
  const others = fullDeck().filter((card) => !containsCard(used, card)).slice(0, 37);
  const contract: Contract = { points: 40, strain: trump.strain, declarerSeat: 1 };
  const game = createGame(0);
  game.levels = levelsOf(trump.rank);
  game.dealNo = 1;
  game.deal = {
    phase: 'play',
    dealNo: 1,
    dealerSeat: 0,
    hands: [[...hand], others.slice(0, hand.length), others.slice(hand.length, hand.length * 2)],
    originalKitty: others.slice(34, 37),
    kitty: others.slice(34, 37),
    auction: [],
    contract,
    trump,
    trick,
    trickHistory: [],
    captured: [[], [], []],
    summary: null,
    claim: null
  };
  return personalView(game, 0);
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

const pointsOf = (card: Card): number => cardPoints(card);

const SAMPLES = Number(process.env['FOLLOW_SAMPLES'] ?? 3000);
const rng = mulberry32(20261004);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

let used = 0;
let winnable = 0;
let missed = 0;
const examples: string[] = [];

for (let iteration = 0; iteration < SAMPLES * 12 && used < SAMPLES; iteration += 1) {
  const strain: Strain = pick(['C', 'D', 'H', 'S', 'NT'] as const);
  const rank = 2 + Math.floor(rng() * 13);
  const trump: TrumpModel = { strain, rank };
  const leadSuit = pick(SUITS.filter((s) => s !== strain) as Suit[]);
  const n = 1 + Math.floor(rng() * 3);

  // 合法领出：同门（不含级牌）、层号严格连续、且带分（有分才逼出「该赢必赢」的动机）
  const start = 2 + Math.floor(rng() * (13 - n));
  const lead: Card[] = [];
  for (let i = 0; i < n; i += 1) lead.push({ suit: leadSuit, rank: start + i });
  if (lead.some((card) => cardClass(card, trump) !== leadSuit)) continue;
  if (lead.reduce((sum, card) => sum + pointsOf(card), 0) <= 0) continue;

  // 我的手牌：该门 holding ≥ n（够跟），再加几张别的门
  const holding: Card[] = [];
  for (const r of [14, 12, 11, 9, 8, 7, 6, 4, 3, 2, 13, 5, 10]) {
    if (holding.length >= n + Math.floor(rng() * 4)) break;
    const card: Card = { suit: leadSuit, rank: r };
    if (cardClass(card, trump) !== leadSuit) continue;
    if (containsCard(lead, card) || containsCard(holding, card)) continue;
    holding.push(card);
  }
  if (holding.length < n) continue;
  const fillers = fullDeck()
    .filter((card) => cardClass(card, trump) !== leadSuit && !containsCard(lead, card) && !containsCard(holding, card))
    .slice(0, 6);
  const hand = [...holding, ...fillers];
  const trick: Trick = { leaderSeat: 1, plays: [{ seat: 1, cards: lead }] };
  const view = makeView(hand, trump, trick);
  used += 1;

  const played = playFor(view, view.you, trump);
  const won = trickWinner([{ seat: 1, cards: lead }, { seat: 0, cards: played }], trump) === 0;
  const winning = combinations(holding, n).filter(
    (combo) =>
      checkPlay(hand, combo, trump, lead) === null &&
      trickWinner([{ seat: 1, cards: lead }, { seat: 0, cards: combo }], trump) === 0
  );
  if (winning.length === 0) continue; // 本来就没得赢的局面不算
  winnable += 1;
  if (!won && examples.length < 4) {
    const show = (cards: readonly Card[]): string => cards.map(cardKey).join(',');
    examples.push(
      `将 ${trump.strain}${trump.rank}；领出 [${show(lead)}]；手牌 [${show(hand)}]；它出 [${show(played)}]；能赢的一例 [${show(winning[0]!)}]`
    );
  }
  if (!won) missed += 1;
}

test(`${SAMPLES} 个「手里有合法且能赢的组合」的跟牌局面：一次都不该错过`, () => {
  assert.ok(winnable > 100, `有效样本只有 ${winnable} 个（总取样 ${used}）：生成器退化了`);
  assert.equal(missed, 0, `有 ${missed}/${winnable} 次该赢没赢：\n  ${examples.join('\n  ')}`);
});
