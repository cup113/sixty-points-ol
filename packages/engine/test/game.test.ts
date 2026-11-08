import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cardsPoints, type Seat } from '../src/cards.ts';
import {
  CARDS_PER_SEAT,
  FINISH_ONE_AT,
  KITTY_SIZE,
  createGame,
  dealWith,
  dispatch,
  levelProgress,
  newDeal,
  type GameState
} from '../src/state.ts';
import { keys, mulberry32, randomLegalAction } from './helpers.ts';

const SEEDS = Number(process.env['GAME_SEEDS'] ?? 60);
const STEP_CAP = 40000;

function playOut(seed: number): { state: GameState; steps: number; deals: number; seed: number } {
  const rng = mulberry32(seed);
  let state = createGame((seed % 3) as Seat);
  let steps = 0;
  let deals = 0;

  while (state.status === 'playing' && steps < STEP_CAP) {
    const action = randomLegalAction(state, rng);
    const res = dispatch(state, action, rng);
    assert.ok(
      res.ok,
      `seed=${seed} 第 ${steps} 步动作被拒（${JSON.stringify(action)}）：${res.ok ? '' : `${res.code} ${res.message}`}`
    );
    if (!res.ok) break;
    state = res.state;
    steps += 1;

    const deal = state.deal;
    if (deal === null) continue;

    if (deal.phase === 'play' && (deal.trick === null || deal.trick.plays.length === 0)) {
      const sizes = deal.hands.map((h) => h.length);
      assert.equal(sizes[0], sizes[1], `seed=${seed} 轮次之间手牌数应相等`);
      assert.equal(sizes[1], sizes[2], `seed=${seed} 轮次之间手牌数应相等`);
    }

    if (deal.phase === 'scored') {
      const captured = deal.captured.flat();
      assert.equal(captured.length + deal.kitty.length, 54, `seed=${seed} 牌数守恒`);
      assert.equal(cardsPoints(captured) + cardsPoints(deal.kitty), 100, `seed=${seed} 分数守恒`);
      const s = deal.summary!;
      const expected =
        s.declarerTrickPoints +
        (s.protectedBottom ? s.multiplier * s.kittyPoints : -s.multiplier * s.kittyPoints);
      assert.equal(s.finalScore, expected, `seed=${seed} 结算公式`);
      assert.equal(s.made, s.finalScore >= s.contract.points, `seed=${seed} 打成判定`);
      assert.equal(s.multiplier, s.lastTrickSize, `seed=${seed} 底牌倍数 = 末轮张数`);
      deals += 1;
    }
  }

  return { state, steps, deals, seed };
}

describe('随机整局不变量', () => {
  it(`${SEEDS} 个种子全部跑到结束，每一步动作都被引擎接受`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { state, deals } = playOut(seed);
      assert.equal(state.status, 'finished', `seed=${seed} 应在有限步内结束（已完成 ${deals} 副）`);
      assert.ok(deals >= 1, `seed=${seed} 至少打完一副`);

      const progress = state.levels.map(levelProgress);
      assert.deepEqual(state.result!.progress, progress, `seed=${seed} 结果进度与级别一致`);
      assert.ok(
        progress.some((p) => p >= FINISH_ONE_AT),
        `seed=${seed} 结束条件成立（有人到 2(+3)）`
      );

      const ranking = state.result!.ranking;
      assert.equal(ranking.length, 3);
      for (let i = 1; i < ranking.length; i++) {
        assert.ok(
          progress[ranking[i - 1]!]! >= progress[ranking[i]!]!,
          `seed=${seed} 排名按总进度降序`
        );
      }

      // 名次：并列共享、「比我高的有几个 + 1」。ranking 只是排序，不许拿它的下标当名次
      const places = state.result!.places;
      for (const seat of [0, 1, 2] as const) {
        const expected = 1 + progress.filter((p) => p > progress[seat]!).length;
        assert.equal(places[seat], expected, `seed=${seed} 座位 ${seat} 的名次与进度一致`);
      }
      assert.ok(
        places.filter((place) => place === 1).length >= 1,
        `seed=${seed} 至少有一个冠军`
      );
    }
  });

  it('同一种子完全可复现（含每副结算）', () => {
    for (const seed of [1, 7, 42]) {
      const a = playOut(seed);
      const b = playOut(seed);
      assert.equal(JSON.stringify(a.state.history), JSON.stringify(b.state.history), `seed=${seed} 复现`);
      assert.deepEqual(a.state.levels, b.state.levels, `seed=${seed} 级别复现`);
      assert.equal(a.steps, b.steps, `seed=${seed} 步数复现`);
    }
  });

  it('对局必然产生升级：结束后至少一方进度前移', () => {
    const { state } = playOut(3);
    assert.ok(state.history.length >= 1);
    const moved = state.history.flatMap((h) => h.levelChanges).length;
    assert.ok(moved >= 1, '每副结算都应有升级记录');
  });
});

describe('dealWith：用已知牌构造一副', () => {
  const rng = mulberry32(9);
  const reference = newDeal(5, 1, rng);

  it('构造出叫牌阶段的空局：底牌占位、无定约、无人出过牌', () => {
    const deal = dealWith(reference.hands, reference.originalKitty, 1, 5);
    assert.equal(deal.phase, 'auction');
    assert.equal(deal.dealNo, 5);
    assert.equal(deal.dealerSeat, 1);
    assert.deepEqual(deal.auction, []);
    assert.equal(deal.contract, null);
    assert.equal(deal.trump, null);
    assert.equal(deal.trick, null);
    assert.deepEqual(deal.trickHistory, []);
    // kitty 此时是「发牌留下的」占位 —— 与 originalKitty 同内容（埋底才会被替换）
    assert.deepEqual(keys(deal.kitty), keys(reference.originalKitty));
    assert.equal(deal.summary, null);
  });

  it('newDeal 与 dealWith 同源：同参数构造的牌局与 newDeal 完全一致', () => {
    const deal = dealWith(reference.hands, reference.originalKitty, 1, 5);
    for (const seat of [0, 1, 2] as const) {
      assert.deepEqual(keys(deal.hands[seat]!), keys(reference.hands[seat]!));
    }
    assert.deepEqual(keys(deal.originalKitty), keys(reference.originalKitty));
  });

  it('入参被拷贝：构造后改动源数组不影响牌局（重演要拿结算后的手牌重建）', () => {
    const hands = reference.hands.map((h) => [...h]);
    const kitty = [...reference.originalKitty];
    const deal = dealWith(hands, kitty, 0, 1);
    hands[0]!.length = 0;
    kitty.length = 0;
    assert.equal(deal.hands[0]!.length, CARDS_PER_SEAT);
    assert.equal(deal.originalKitty.length, KITTY_SIZE);
  });

  it('从 dealWith 起步照样能整副打完：与 newDeal 同一来源不是空话', () => {
    const seed = 21;
    const dealRng = mulberry32(seed);
    const game = createGame(0);
    game.dealNo = 1;
    game.deal = dealWith(reference.hands, reference.originalKitty, 0, 1);
    let state: GameState = game;
    let steps = 0;
    while (state.deal!.phase !== 'scored' && steps < 2000) {
      const res = dispatch(state, randomLegalAction(state, dealRng), dealRng);
      assert.ok(res.ok, `第 ${steps} 步动作被拒：${res.ok ? '' : res.message}`);
      if (!res.ok) break;
      state = res.state;
      steps += 1;
    }
    assert.equal(state.deal!.phase, 'scored', '应在有限步内结算');
    const s = state.deal!.summary!;
    assert.equal(s.declarerTrickPoints + s.defenderTrickPoints, 100, '墩分守恒');
    assert.equal(s.kittyPoints, cardsPoints(state.deal!.kitty), '底分与埋下的底牌一致');
  });
});
