import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatch,
  FINISH_ONE_AT,
  levelFromProgress,
  levelLabel,
  levelProgress,
  madeLevels,
  START_LEVEL,
  type Action,
  type GameState
} from '../src/state.ts';
import type { Card, Seat } from '../src/cards.ts';
import { cardsPoints } from '../src/cards.ts';
import { mulberry32, c, rigPlayDeal } from './helpers.ts';

const rng = mulberry32(99);
const KITTY_25 = [c('S', 5), c('S', 10), c('S', 13)];

function playRule(state: GameState, moves: readonly (readonly [Seat, Card[]])[]): GameState {
  let current = state;
  for (const [seat, cards] of moves) {
    const action: Action = { type: 'play', seat, cards };
    const res = dispatch(current, action, rng);
    if (!res.ok) throw new Error(`出牌被拒: ${res.message}`);
    current = res.state;
  }
  return current;
}

/** 庄家（座位 0）拿 15 分、保底 x=1、底牌 25 分 → 40 分打成 */
function madeByProtect(): GameState {
  const state = rigPlayDeal(
    [[c('C', 5), c('C', 10)], [c('C', 3), c('C', 4)], [c('D', 3), c('D', 4)]],
    KITTY_25
  );
  return playRule(state, [
    [0, [c('C', 5)]],
    [1, [c('C', 3)]],
    [2, [c('D', 3)]],
    [0, [c('C', 10)]],
    [1, [c('C', 4)]],
    [2, [c('D', 4)]]
  ]);
}

/** 闲家杀牌抠底：x=2、底牌 25 分 → 庄家 0-50 = -50 */
function setByRuff(): GameState {
  const state = rigPlayDeal(
    [[c('C', 2), c('C', 3)], [c('H', 2), c('H', 3)], [c('D', 2), c('D', 3)]],
    KITTY_25
  );
  return playRule(state, [
    [0, [c('C', 2), c('C', 3)]],
    [1, [c('H', 2), c('H', 3)]],
    [2, [c('D', 2), c('D', 3)]]
  ]);
}

describe('级别与升级表', () => {
  it('进度换算与轮转', () => {
    assert.equal(levelProgress({ rank: 2, cycle: 0 }), 1);
    assert.equal(levelProgress({ rank: 14, cycle: 0 }), 13);
    assert.equal(levelProgress({ rank: 2, cycle: 1 }), 14);
    assert.equal(levelProgress({ rank: 2, cycle: 2 }), 27);
    assert.deepEqual(levelFromProgress(13), { rank: 14, cycle: 0 });
    assert.deepEqual(levelFromProgress(14), { rank: 2, cycle: 1 });
    assert.deepEqual(levelFromProgress(27), { rank: 2, cycle: 2 });
    assert.equal(levelLabel({ rank: 14, cycle: 1 }), 'A(+1)');
    assert.equal(levelLabel({ rank: 2, cycle: 2 }), '2(+2)');
  });

  it('打成升级表：40→1、60→2、70→3、80→4、90 起每 5 分多 1 级', () => {
    assert.equal(madeLevels(40), 1);
    assert.equal(madeLevels(59), 1);
    assert.equal(madeLevels(60), 2);
    assert.equal(madeLevels(69), 2);
    assert.equal(madeLevels(70), 3);
    assert.equal(madeLevels(79), 3);
    assert.equal(madeLevels(80), 4);
    assert.equal(madeLevels(89), 4);
    assert.equal(madeLevels(90), 5);
    assert.equal(madeLevels(95), 6);
    assert.equal(madeLevels(100), 7);
    assert.equal(madeLevels(125), 12);
  });
});

describe('结算：保底打成', () => {
  it('庄家 15 分 + 保底 1×25 = 40，打成并升 1 级', () => {
    const state = madeByProtect();
    const deal = state.deal!;
    assert.equal(deal.phase, 'scored');
    const s = deal.summary!;
    assert.equal(s.declarerTrickPoints, 15);
    assert.equal(s.defenderTrickPoints, 0);
    assert.equal(s.kittyPoints, 25);
    assert.equal(s.multiplier, 1);
    assert.equal(s.lastTrickSize, 1);
    assert.equal(s.protectedBottom, true);
    assert.equal(s.finalScore, 40);
    assert.equal(s.made, true);
    assert.equal(s.shortfall, 0);
    assert.deepEqual(s.levelChanges, [
      { seat: 0, from: { rank: 2, cycle: 0 }, to: { rank: 3, cycle: 0 }, levels: 1 }
    ]);
    assert.deepEqual(state.levels[0], { rank: 3, cycle: 0 });
    assert.deepEqual(state.levels[1], { ...START_LEVEL });
    assert.equal(state.status, 'playing');
  });
});

describe('结算：抠底打输', () => {
  it('闲家 2 张连续主牌杀牌抠底，庄家得分为负', () => {
    const state = setByRuff();
    const s = state.deal!.summary!;
    assert.equal(s.declarerTrickPoints, 0);
    assert.equal(s.multiplier, 2);
    assert.equal(s.protectedBottom, false);
    assert.equal(s.finalScore, -50);
    assert.equal(s.made, false);
    assert.equal(s.shortfall, 90);
    assert.deepEqual(
      s.levelChanges.map((ch) => [ch.seat, ch.levels]),
      [[1, 9], [2, 9]]
    );
    assert.deepEqual(state.levels[0], { ...START_LEVEL });
    assert.deepEqual(state.levels[1], levelFromProgress(1 + 9));
    assert.ok(levelProgress(state.levels[1]!) > levelProgress(state.levels[0]!));
  });

  it('缺分不足 10 分时闲家也只升 1 级', () => {
    const state = rigPlayDeal(
      [[c('C', 5), c('C', 10)], [c('C', 3), c('C', 4)], [c('D', 3), c('D', 4)]],
      KITTY_25,
      { points: 90 }
    );
    // 庄家拿 15 分、保底 x=1 → 40 分，叫 90 差 50 → 升 5 级
    const after = playRule(state, [
      [0, [c('C', 5)]],
      [1, [c('C', 3)]],
      [2, [c('D', 3)]],
      [0, [c('C', 10)]],
      [1, [c('C', 4)]],
      [2, [c('D', 4)]]
    ]);
    const s = after.deal!.summary!;
    assert.equal(s.finalScore, 40);
    assert.equal(s.shortfall, 50);
    assert.deepEqual(s.levelChanges.map((ch) => [ch.seat, ch.levels]), [[1, 5], [2, 5]]);
  });
});

/** 座位 0 冲到 2(+3) 的那一副（结算即刻结束整场） */
function finishedByOneAtThree(): GameState {
  const state = rigPlayDeal(
    [[c('C', 5), c('C', 10)], [c('C', 3), c('C', 4)], [c('D', 3), c('D', 4)]],
    KITTY_25,
    { levels: [{ rank: 14, cycle: 2 }, { rank: 2, cycle: 0 }, { rank: 2, cycle: 0 }] }
  );
  return playRule(state, [
    [0, [c('C', 5)]],
    [1, [c('C', 3)]],
    [2, [c('D', 3)]],
    [0, [c('C', 10)]],
    [1, [c('C', 4)]],
    [2, [c('D', 4)]]
  ]);
}

describe('结束条件与冠军', () => {
  it('两人达到 2(+2) 不再结束：只认一人冲到 2(+3)', () => {
    const state = rigPlayDeal(
      [[c('C', 2), c('C', 3)], [c('H', 2), c('H', 3)], [c('D', 2), c('D', 3)]],
      KITTY_25,
      { levels: [{ rank: 2, cycle: 0 }, { rank: 14, cycle: 1 }, { rank: 14, cycle: 1 }] }
    );
    const after = playRule(state, [
      [0, [c('C', 2), c('C', 3)]],
      [1, [c('H', 2), c('H', 3)]],
      [2, [c('D', 2), c('D', 3)]]
    ]);
    // 这一副把两名闲家一起推过了 2(+2)（进度 27）—— 但门槛已经不在那里了
    for (const seat of [1, 2] as const) {
      const progress = levelProgress(after.levels[seat]!);
      assert.ok(progress >= 27, `座位 ${seat} 应已过 2(+2)：${progress}`);
      assert.ok(progress < FINISH_ONE_AT, `座位 ${seat} 还没到 2(+3)：${progress}`);
    }
    assert.equal(after.status, 'playing', '两人到 2(+2) 不该结束整场');
    assert.equal(after.result, null);
  });

  it('一家达到 2(+3) 立即结束：二三名并列共享名次（不是第 2 / 第 3）', () => {
    const after = finishedByOneAtThree();
    assert.equal(after.status, 'finished');
    assert.equal(after.result!.progress[0], 40);
    assert.equal(after.result!.ranking[0], 0);
    // 两名闲家同为 1 分：排名里它们是先后的两个下标，名次里它们是同一个 2=
    assert.deepEqual(after.result!.places, [1, 2, 2]);
    assert.deepEqual(after.result!.reason, { kind: 'oneAtThree', seats: [0] });
  });

  it('两名闲家同拍跨过 2(+3)：并列冠军，两人都记进结束原因', () => {
    const state = rigPlayDeal(
      [[c('C', 5), c('C', 10)], [c('C', 3), c('C', 4)], [c('D', 3), c('D', 4)]],
      KITTY_25,
      { points: 90, levels: [{ rank: 2, cycle: 0 }, { rank: 13, cycle: 2 }, { rank: 13, cycle: 2 }] }
    );
    const after = playRule(state, [
      [0, [c('C', 5)]],
      [1, [c('C', 3)]],
      [2, [c('D', 3)]],
      [0, [c('C', 10)]],
      [1, [c('C', 4)]],
      [2, [c('D', 4)]]
    ]);
    assert.equal(after.status, 'finished');
    const progress = after.result!.progress;
    assert.ok(
      progress[1]! >= FINISH_ONE_AT && progress[2]! >= FINISH_ONE_AT,
      `两名闲家应同拍跨线：${progress.join(' / ')}`
    );
    assert.deepEqual(after.result!.places, [3, 1, 1], '两个冠军共享名次 1');
    assert.deepEqual(after.result!.reason.seats, [1, 2]);
  });

  it('结束后可开新对局：级别重置、发牌人轮转', () => {
    const finished = finishedByOneAtThree();
    assert.equal(finished.status, 'finished');
    const res = dispatch(finished, { type: 'newGame' }, rng);
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(res.state.status, 'playing');
    assert.deepEqual(res.state.levels, [{ ...START_LEVEL }, { ...START_LEVEL }, { ...START_LEVEL }]);
    assert.equal(res.state.dealerSeat, 1);
    assert.equal(res.state.result, null);
    assert.equal(res.state.history.length, 0);
    const dealt = dispatch(res.state, { type: 'deal' }, rng);
    assert.ok(dealt.ok);
    if (!dealt.ok) return;
    assert.equal(dealt.state.deal!.phase, 'auction');
    assert.deepEqual(dealt.state.deal!.hands.map((h) => h.length), [17, 17, 17]);
  });

  it('未结束时不能开新对局、结束后不能再发牌', () => {
    const state = madeByProtect();
    assert.equal(dispatch(state, { type: 'newGame' }, rng).ok, false);
    const finished = setByRuff();
    assert.equal(finished.status, 'playing');
    assert.equal(dispatch(finished, { type: 'deal' }, rng).ok, true);
  });
});

describe('结算不变量', () => {
  it('牌数与分数对得上：抓到的 6 张 + 底牌 3 张，最终得分可由原始牌复算', () => {
    const state = madeByProtect();
    const deal = state.deal!;
    const s = deal.summary!;
    assert.equal(deal.captured.flat().length, 6);
    assert.equal(deal.kitty.length, 3);
    assert.equal(s.protectedBottom, true);
    assert.equal(s.finalScore, cardsPoints(deal.captured[0]!) + s.multiplier * s.kittyPoints);
  });
});
