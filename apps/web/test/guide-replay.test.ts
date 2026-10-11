/**
 * 引导局回放核对（ADR-0025）：合成一副 → 逐步合法 → 终局结算与存证一致。
 *
 * 这里盯的是「客户端从显式手牌重放」这件事本身：不用种子、不用随机数，
 * 三家 17 张 + 底牌就是那副牌的全部真相。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fullDeck, cardKey } from '@sixty/engine';
import { actorOf, dealSpans, dealtGuideState, handFromKeys, replayGuide, sameCards, segmentRange } from '../src/lib/guide/replay.ts';
import { fastForward, startSession, stepOnce } from '../src/lib/guide/session.ts';
import { fixtureDeal } from './guide-fixture.ts';

test('发牌态：三家各 17 张 + 3 张底牌，54 张不重不漏', () => {
  const { deal } = fixtureDeal(7, 1);
  const state = dealtGuideState(deal);
  const dealState = state.deal!;
  assert.equal(dealState.phase, 'auction', '构造出来就在叫牌阶段');
  assert.deepEqual(
    dealState.hands.map((hand) => hand.length),
    [17, 17, 17]
  );
  assert.equal(dealState.originalKitty.length, 3);
  const all = [...dealState.hands.flat(), ...dealState.originalKitty].map(cardKey);
  assert.equal(all.length, 54);
  assert.equal(new Set(all).size, 54, '有牌重复');
  assert.equal(new Set(all).size, new Set(fullDeck().map(cardKey)).size, '牌数与整副不符');
});

test('回放：每一步都合法，终局结算与 expect 存证逐项一致', () => {
  const { deal } = fixtureDeal(7, 1);
  const replay = replayGuide(deal);
  assert.equal(replay.error, null, `回放报错：${replay.error?.message ?? ''}`);
  assert.equal(replay.states.length, deal.actions.length, '状态条数与动作条数不符');
  const scored = replay.state.deal!;
  assert.equal(scored.phase, 'scored');
  assert.deepEqual(scored.summary, deal.expect, '现场重放的结算与存证不一致（引擎漂移或数据被改）');
  assert.equal(replay.tricks.length, scored.trickHistory.length);
});

test('actionOf：叫牌 → 埋底 → 出牌 → 结算，一路都有唯一的下一个行动者', () => {
  const { deal } = fixtureDeal(7, 1);
  const replay = replayGuide(deal);
  assert.equal(actorOf(replay.state), null, '结算之后没人该动');
  const phases = new Set(replay.states.map((state) => state.deal!.phase));
  assert.ok(phases.has('auction') && phases.has('play'), '这副牌应当经历过叫牌与出牌');
  assert.ok(replay.states.every((state) => actorOf(state) !== null || state.deal!.phase === 'scored'));
});

test('快进与逐步推进等价：同一批动作，结果必须一模一样', () => {
  const { deal } = fixtureDeal(11, 0);
  for (const target of [0, 1, 5, 12, deal.actions.length]) {
    const jumped = fastForward(deal, target);
    let walked = startSession(deal);
    for (let i = 0; i < target && walked.phase === 'playing'; i += 1) {
      walked = stepOnce(walked, deal).snapshot;
    }
    assert.equal(jumped.index, walked.index, `快进到 ${target} 的下标不一致`);
    assert.equal(jumped.phase, walked.phase);
    assert.deepEqual(jumped.state.deal!.summary, walked.state.deal!.summary);
  }
});

test('sameCards：多重集合语义（顺序无关、张数有关）', () => {
  const { deal } = fixtureDeal(7, 2);
  const hand = dealtGuideState(deal).deal!.hands[2]!;
  const a = hand.slice(0, 3);
  assert.equal(sameCards(a, [...a].reverse()), true);
  assert.equal(sameCards(a, hand.slice(0, 2)), false);
  assert.equal(sameCards(a, hand.slice(1, 4)), false);
});

test('分段：叫牌段结束于定约成立那一步，两段拼起来正好是整副', () => {
  for (const seed of [3, 7, 11]) {
    const { deal } = fixtureDeal(seed, 1);
    const spans = dealSpans(deal);
    assert.ok(spans.auctionEnd > 0, `种子 ${seed}：叫牌段是空的`);
    assert.ok(spans.auctionEnd < spans.total, `种子 ${seed}：整副都在叫牌段里`);
    assert.ok(
      deal.actions.slice(0, spans.auctionEnd).every((action) => action.type === 'bid'),
      `种子 ${seed}：叫牌段里混进了非叫牌动作`
    );
    assert.equal(deal.actions[spans.auctionEnd - 1]!.type, 'bid', '叫牌段的最后一步就是定约成立那一步');
    assert.notEqual(deal.actions[spans.auctionEnd]!.type, 'bid', '叫牌段之后不该再有叫牌');
    assert.deepEqual(segmentRange(deal, 'auction'), { from: 0, to: spans.auctionEnd });
    assert.deepEqual(segmentRange(deal, 'play'), { from: spans.auctionEnd, to: spans.total });
    assert.deepEqual(segmentRange(deal, 'all'), { from: 0, to: spans.total });
  }
});

/**
 * 牌位不变式（原 `position.test.ts` 的口径，改钉在引导局上）：
 * 手牌只减不增、每一墩之后 54 张不重复不漏，最后一墩打完三家都空手。
 *
 * 为什么值得留着：引导局**只见自己的手牌**，界面能画的牌面全靠「重放出来的手牌」，
 * 而复盘屏要把三家摊开 —— 只要牌位算错，复盘就会画出不存在的一手牌，或者少掉几张。
 */
test('每一墩的记录：三家各一手、不重不漏（收墩那一步不应该把第三家记两遍）', () => {
  for (const seed of [3, 7, 11]) {
    const { deal } = fixtureDeal(seed, 1);
    const replay = replayGuide(deal);
    assert.equal(replay.error, null);
    for (const trick of replay.tricks) {
      assert.equal(trick.plays.length, 3, `种子 ${seed} 第 ${trick.ordinal + 1} 墩记了 ${trick.plays.length} 手`);
      assert.deepEqual(
        [...new Set(trick.plays.map((play) => play.seat))].sort(),
        [0, 1, 2],
        `种子 ${seed} 第 ${trick.ordinal + 1} 墩的座位不是三家各一次`
      );
      const sizes = new Set(trick.plays.map((play) => play.cards.length));
      assert.equal(sizes.size, 1, `种子 ${seed} 第 ${trick.ordinal + 1} 墩三家出的张数不一致`);
    }
  }
});

test('牌位不变式：手牌只减不增，每墩之后 54 张不重不漏，最后一墩三家空手', () => {
  const { deal } = fixtureDeal(7, 1);
  const replay = replayGuide(deal);
  assert.equal(replay.error, null);

  const trump = replay.state.deal!.trump!;
  const contract = replay.state.deal!.contract!;
  const declarer = contract.declarerSeat;
  const kitty = deal.expect.kitty.map(cardKey);

  // 开打时：闲家就是发牌那 17 张；庄家 = 发牌 17 ∪ 拿上来的 3 − 埋下的 3
  const dealt = deal.facts.hands.map((hand) => handFromKeys(hand));
  const merged = [...dealt[declarer]!, ...handFromKeys(deal.facts.originalKitty)];
  const opened = merged.filter((card) => !kitty.includes(cardKey(card)));
  assert.equal(opened.length, 17, '庄家开打时应当是 17 张');
  for (const key of kitty) {
    assert.equal(opened.some((card) => cardKey(card) === key), false, `埋下的 ${key} 还在庄家手里`);
  }

  // 逐墩检查：余牌 = 开打前 − 这一墩出的牌；场上总数恒为 54
  const hands = new Map<number, string[]>();
  for (const seat of [0, 1, 2]) {
    hands.set(seat, (seat === declarer ? opened : dealt[seat]!).map(cardKey));
  }
  const playedBefore: string[] = [];
  replay.tricks.forEach((trick) => {
    for (const play of trick.plays) {
      const before = hands.get(play.seat)!;
      const keys = play.cards.map(cardKey);
      for (const key of keys) {
        const at = before.indexOf(key);
        assert.ok(at >= 0, `第 ${trick.ordinal + 1} 墩：${key} 不在该家手里`);
        before.splice(at, 1);
      }
    }
    for (const play of trick.plays) playedBefore.push(...play.cards.map(cardKey));
    const onTable = [...hands.get(0)!, ...hands.get(1)!, ...hands.get(2)!, ...playedBefore, ...kitty];
    assert.equal(onTable.length, 54, `第 ${trick.ordinal + 1} 墩之后牌总数不是 54`);
    assert.equal(new Set(onTable).size, 54, `第 ${trick.ordinal + 1} 墩之后有牌重复`);
  });

  // 最后一墩打完：三家都空手
  for (const seat of [0, 1, 2]) assert.deepEqual(hands.get(seat), [], `打完了第 ${seat} 家还有牌`);

  // 主牌张数：整副 54 张按引擎的将牌口径分类，总数必须是 18（有主）或 6（无主）
  const trumpCount = trump.strain === 'NT' ? 4 + 2 : 12 + 4 + 2;
  const whole = [...dealt.flat(), ...handFromKeys(deal.facts.originalKitty)];
  assert.equal(whole.length, 54);
  const isTrump = (card: (typeof whole)[number]): boolean =>
    'joker' in card ||
    card.rank === trump.rank ||
    (trump.strain !== 'NT' && card.suit === trump.strain);
  assert.equal(whole.filter(isTrump).length, trumpCount, '主牌总数与引擎口径不符');
});
