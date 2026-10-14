/**
 * 强制与会话（CONTEXT.md 的 **教练栏** / **引导局**）：
 *
 * - 两类拒绝必须分得开：不合法 → 引擎的理由；合法但非引导牌 → 指回引导词；
 * - 只有「与引导目标完全一致」才放行，用户自己想的另一手永远不被写进牌局；
 * - 全量强制能把一副真实牌局走完，且步数与动作条数一致。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bidOptions,
  cardClass,
  cardKey,
  highestBid,
  isPass,
  type BidCall,
  type Card,
  type Seat
} from '@sixty/engine';
import { guidedCall, guidedCards } from '../src/lib/guide/forcing.ts';
import { handFromKeys } from '../src/lib/guide/replay.ts';
import {
  fastForward,
  learnerHand,
  learnerTurn,
  nextLearnerAction,
  startSession,
  stepOnce,
  submitBid,
  submitBury,
  submitPlay,
  type SessionSnapshot
} from '../src/lib/guide/session.ts';
import type { GuideAction, GuideDealData } from '../src/lib/guide/types.ts';
import { fixtureDeal } from './guide-fixture.ts';

/** 走到「第 index 条动作之前」的那个快照 */
function before(deal: GuideDealData, index: number): SessionSnapshot {
  return fastForward(deal, index);
}

/** 收集用户座位每一步的（快照 + 该走的那条动作） */
function learnerSteps(deal: GuideDealData): { index: number; snapshot: SessionSnapshot; action: GuideAction }[] {
  const out: { index: number; snapshot: SessionSnapshot; action: GuideAction }[] = [];
  deal.actions.forEach((action, index) => {
    if (action.seat !== deal.learnerSeat) return;
    out.push({ index, snapshot: before(deal, index), action });
  });
  return out;
}

test('出牌：引导目标放行；同门另一张单张 → off-guide；两张不同门 → 引擎的 illegal', () => {
  const played = fixtureDeal(7, 1);
  const { deal } = played;
  const steps = learnerSteps(deal);
  const leader = steps.find((step) => {
    const dealState = step.snapshot.state.deal!;
    return (
      dealState.phase === 'play' &&
      dealState.trick !== null &&
      dealState.trick.plays.length === 0 &&
      step.action.type === 'play' &&
      (step.action.cards as readonly string[]).length === 1
    );
  });
  assert.ok(leader !== undefined, '这副牌里应当有「用户领出单张」的时刻');

  const turn = learnerTurn(leader.snapshot, deal);
  assert.ok(turn !== null && turn.action.type === 'play');
  const target = guidedCards(turn.action)!;

  // ① 照引导词出 → 放行
  const pass = submitPlay(leader.snapshot, deal, target);
  assert.equal(pass.ok, true, '引导目标被拒了');

  // ② 同门、合法、但另外一张单张 → off-guide
  const trump = leader.snapshot.state.deal!.trump!;
  const hand = learnerHand(leader.snapshot, deal);
  const targetKeys = new Set(target.map(cardKey));
  const sameClassOther = hand.find(
    (card) => cardClass(card, trump) === cardClass(target[0]!, trump) && !targetKeys.has(cardKey(card))
  );
  if (sameClassOther !== undefined) {
    const off = submitPlay(leader.snapshot, deal, [sameClassOther]);
    assert.equal(off.ok, false);
    if (!off.ok) {
      assert.equal(off.rejection.kind, 'off-guide');
      assert.match(off.rejection.reason, /教程带你打/);
    }
  }

  // ③ 两张不同门 → 领出规则直接拒（引擎的理由）
  const other = hand.find((card) => cardClass(card, trump) !== cardClass(target[0]!, trump));
  assert.ok(other !== undefined, '手上应当还有别的门');
  const illegal = submitPlay(leader.snapshot, deal, [target[0]!, other]);
  assert.equal(illegal.ok, false);
  if (!illegal.ok) {
    assert.equal(illegal.rejection.kind, 'illegal');
    assert.match(illegal.rejection.reason, /同门|顺子/);
  }
});

test('出牌：跟随别人领出的多张时，张数不对给引擎理由而不是「不是这张」', () => {
  const { deal } = fixtureDeal(7, 1);
  const steps = learnerSteps(deal);
  const follower = steps.find((step) => {
    const dealState = step.snapshot.state.deal!;
    return (
      dealState.phase === 'play' &&
      dealState.trick !== null &&
      dealState.trick.plays.length > 0 &&
      dealState.trick.plays[0]!.cards.length > 1 &&
      step.action.type === 'play'
    );
  });
  if (follower === undefined) return; // 这副没有多张领出，跳过（不是失败）
  const turn = learnerTurn(follower.snapshot, deal)!;
  assert.equal(turn.action.type, 'play');
  const target = guidedCards(turn.action)!;
  const short = submitPlay(follower.snapshot, deal, [target[0]!]);
  assert.equal(short.ok, false);
  if (!short.ok) {
    assert.equal(short.rejection.kind, 'illegal');
    assert.match(short.rejection.reason, /必须出 \d+ 张牌/);
  }
});

test('叫牌：低于 40 的分数 → illegal；合法但非引导叫品 → off-guide；引导叫品放行', () => {
  const { deal } = fixtureDeal(7, 1);
  const steps = learnerSteps(deal);
  const bidStep = steps.find((step) => step.action.type === 'bid');
  assert.ok(bidStep !== undefined, '这副牌里应当有用户的叫牌');
  const turn = learnerTurn(bidStep.snapshot, deal)!;
  const target = guidedCall(turn.action) ?? 'pass';

  const tooLow: BidCall = { points: 35, strain: 'NT' };
  const illegal = submitBid(bidStep.snapshot, deal, tooLow);
  assert.equal(illegal.ok, false);
  if (!illegal.ok) assert.equal(illegal.rejection.kind, 'illegal');

  const highest = highestBid(bidStep.snapshot.state.deal!.auction);
  const alternative = bidOptions(highest)
    .flatMap((row) => row.strains.map((strain) => ({ points: row.points, strain })))
    .find((call) => isPass(target) || call.points !== target.points || call.strain !== target.strain);
  if (alternative !== undefined) {
    const off = submitBid(bidStep.snapshot, deal, alternative);
    assert.equal(off.ok, false);
    if (!off.ok) assert.equal(off.rejection.kind, 'off-guide');
  }

  const ok = submitBid(bidStep.snapshot, deal, target);
  assert.equal(ok.ok, true, '引导叫品被拒了');
});

test('埋底：2 张 → illegal；3 张但非引导 → off-guide；引导三张放行', () => {
  const played = fixtureDeal(7, 1);
  const declarer = played.played.declarerSeat;
  const { deal } = fixtureDeal(7, declarer);
  const buryStep = learnerSteps(deal).find((step) => step.action.type === 'bury');
  assert.ok(buryStep !== undefined, '当庄家时必有埋底这一手');
  const turn = learnerTurn(buryStep.snapshot, deal)!;
  const target = guidedCards(turn.action)!;

  const short = submitBury(buryStep.snapshot, deal, target.slice(0, 2));
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.rejection.kind, 'illegal');

  const hand = learnerHand(buryStep.snapshot, deal);
  const other = hand.filter((card) => !target.some((item) => cardKey(item) === cardKey(card))).slice(0, 3);
  assert.equal(other.length, 3, '埋底时手上有 20 张，取三张非引导牌不难');
  const off = submitBury(buryStep.snapshot, deal, other);
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.rejection.kind, 'off-guide');

  const ok = submitBury(buryStep.snapshot, deal, target);
  assert.equal(ok.ok, true, '引导的三张被拒了');
});

test('全量强制：用户每一步照引导词走，能把整副打完（步数 = 动作条数）', () => {
  for (const seed of [3, 7, 11]) {
    const played = fixtureDeal(seed, 1);
    const deal = played.deal;
    let snap = startSession(deal);
    let guard = 0;
    while (snap.phase === 'playing' && guard < 400) {
      guard += 1;
      const turn = learnerTurn(snap, deal);
      if (turn === null) {
        snap = stepOnce(snap, deal).snapshot;
        continue;
      }
      const action = turn.action;
      const out =
        action.type === 'bid'
          ? submitBid(snap, deal, action.call)
          : action.type === 'bury'
            ? submitBury(snap, deal, guidedCards(action)!)
            : submitPlay(snap, deal, guidedCards(action)!);
      assert.equal(out.ok, true, `种子 ${seed}：引导动作被拒`);
      if (out.ok) snap = out.snapshot;
    }
    assert.equal(snap.phase, 'done', `种子 ${seed}：这副没走完`);
    assert.equal(snap.index, deal.actions.length, `种子 ${seed}：步数与动作条数不符`);
    assert.deepEqual(snap.state.deal!.summary, deal.expect);
  }
});

test('教练栏：nextLearnerAction 能找到「接下来」那一手，learnerTurn 只在轮到时给', () => {
  const { deal } = fixtureDeal(5, 2);
  const next = nextLearnerAction(deal, 0);
  assert.ok(next !== null);
  assert.equal(next.action.seat, deal.learnerSeat);
  const snap = startSession(deal);
  const first = deal.actions[0]!;
  if (first.seat === deal.learnerSeat) {
    assert.ok(learnerTurn(snap, deal) !== null, '第一步就是用户的，应当立即轮到他');
  } else {
    assert.equal(learnerTurn(snap, deal), null, '还没轮到用户');
  }
});

test('不给看别人的牌：learnerHand 只给用户自己那一手', () => {
  const { deal } = fixtureDeal(5, 2);
  const snap = startSession(deal);
  const hand = learnerHand(snap, deal);
  assert.equal(hand.length, 17);
  const keys = new Set(hand.map(cardKey));
  const own = new Set(snap.state.deal!.hands[deal.learnerSeat]!.map(cardKey));
  assert.deepEqual(keys, own);
});

test('数据坏了要显式报错，不许静默卡住', () => {
  const { deal } = fixtureDeal(7, 1);
  const first = deal.actions[0]!;
  // 把第一条动作改成**引擎一定拒绝**的那一种：叫牌步报 35 分（低于 40 的下限），
  // 其余步塞三张不可能同时在手的牌。两种情况都必须让会话停在 error，而不是默默继续。
  const brokenFirst: GuideAction =
    first.type === 'bid'
      ? { type: 'bid', seat: first.seat, call: { points: 35, strain: 'NT' } }
      : { type: first.type, seat: first.seat, cards: ['j0', 'j1', 'H5'] };
  const broken: GuideDealData = { ...deal, actions: [brokenFirst, ...deal.actions.slice(1)] };
  const snap = stepOnce(startSession(broken), broken).snapshot;
  assert.equal(snap.phase, 'error');
  assert.ok((snap.error ?? '').length > 0, '错误里必须带一句人能看懂的原因');
  assert.equal(snap.index, 0, '失败的那一步不应当被算作已完成');
});

test('快进到用户那一手之后仍可继续强制推进（深链恢复不会破坏状态机）', () => {
  const { deal } = fixtureDeal(11, 0);
  const steps = learnerSteps(deal);
  const target = steps[Math.floor(steps.length / 2)]!;
  const snap = fastForward(deal, target.index);
  assert.equal(snap.index, target.index);
  const turn = learnerTurn(snap, deal);
  assert.ok(turn !== null, '快进停在用户那一手，应当正好轮到他');
  const cards = guidedCards(turn.action);
  if (turn.action.type === 'bid') {
    assert.equal(submitBid(snap, deal, turn.action.call).ok, true);
  } else if (cards !== null) {
    assert.equal((turn.action.type === 'bury' ? submitBury(snap, deal, cards) : submitPlay(snap, deal, cards)).ok, true);
  }
});

test('type-only 引用保持干净（座位类型只用于夹具）', () => {
  const seat: Seat = 2;
  const cards: readonly Card[] = handFromKeys(['H5', 'j1']);
  assert.equal(seat, 2);
  assert.equal(cards.length, 2);
});
