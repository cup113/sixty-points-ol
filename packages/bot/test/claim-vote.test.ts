/**
 * 认赢投票（ADR-0028）：机器人只会投「认输 / 不认」这一票，判据是
 * **我还能不能从他亮出来的这手牌里拿下一墩**。固定局面 → 固定结论，所以直接钉死到牌。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGame,
  dealWith,
  personalView,
  type Card,
  type DealState,
  type PersonalView,
  type Rank,
  type Seat,
  type Suit,
  type TrumpModel
} from '@sixty/engine';
import { claimVote, moveFor } from '../src/policy.ts';

const c = (suit: Suit, rank: Rank): Card => ({ suit, rank });
const TRUMP: TrumpModel = { strain: 'H', rank: 7 };

/** 一副只有出牌阶段的局面：我的座位、我手里的牌、认赢者亮出来的牌 */
function claimView(options: {
  hand: readonly Card[];
  revealed: readonly Card[];
  trump?: TrumpModel;
  seat?: Seat;
  claimant?: Seat;
}): PersonalView {
  const seat = options.seat ?? 0;
  const claimant = options.claimant ?? 1;
  const trump = options.trump ?? TRUMP;
  const game = createGame(0);
  const deal: DealState = dealWith([options.hand, [], []], [], 0, 1);
  deal.phase = 'play';
  deal.contract = { points: 40, strain: trump.strain, declarerSeat: 2 };
  deal.trump = trump;
  deal.trick = { leaderSeat: claimant, plays: [] };
  deal.claim = {
    claimant,
    lastTrick: 1,
    revealed: [...options.revealed],
    answers: [null, null, null],
    status: 'pending',
    rejectedBy: null,
    expiresAt: 1,
    swept: 0
  };
  game.deal = deal;
  return personalView(game, seat);
}

test('同门压顶：我这一门顶张比他大、且凑得出他那一门的长度 → 不认', () => {
  const view = claimView({ hand: [c('S', 14)], revealed: [c('S', 13)] });
  assert.equal(claimVote(view, view.you), false);
});

test('同门压顶要凑得出长度：他领两张顺子，我只有一张更大的单张 → 认输', () => {
  const view = claimView({ hand: [c('S', 14), c('D', 2)], revealed: [c('S', 13), c('S', 12)] });
  // 他领 ♠K-Q 两张时我只有一张 ♠A：跟牌是结构性的，赢不了 —— 光有一张大牌不够
  assert.equal(claimVote(view, view.you), true);
});

test('他这一门比我大 → 认输', () => {
  const view = claimView({ hand: [c('C', 2)], revealed: [c('C', 14), c('C', 13)] });
  assert.equal(claimVote(view, view.you), true);
});

test('缺门杀牌：我的主牌顺子不短于他那一门 → 不认', () => {
  const view = claimView({ hand: [c('H', 2), c('H', 3), c('D', 2)], revealed: [c('C', 14), c('C', 13)] });
  // 他迟早得领 ♣，我缺门 → 两张连主杀下去
  assert.equal(claimVote(view, view.you), false);
});

test('缺门但主牌不够长 → 认输', () => {
  const view = claimView({ hand: [c('H', 2), c('D', 2)], revealed: [c('C', 14), c('C', 13)] });
  // 只有一张主牌，杀不了两顺
  assert.equal(claimVote(view, view.you), true);
});

test('认赢待表决时：对手投一票，认赢者与已投票的人都不动', () => {
  const view = claimView({ hand: [c('S', 14)], revealed: [c('S', 13)], claimant: 1 });

  const mine = moveFor(view, view.you);
  assert.deepEqual(mine, { type: 'claimAnswer', agree: false });

  // 认赢者自己：没有动作可做
  assert.equal(moveFor(view, { ...view.you, seat: 1 }), null);

  // 已经投过票的对手：也不再来一次
  const voted: PersonalView = {
    ...view,
    deal: { ...view.deal!, claim: { ...view.deal!.claim!, answers: [true, null, null] } }
  };
  assert.equal(moveFor(voted, voted.you), null);
});
