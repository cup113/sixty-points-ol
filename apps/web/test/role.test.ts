/**
 * 角色 → 投影的单测：**观战者拿到公共视图**（见 ADR-0007）。
 *
 * 引擎侧对同一条不变量有跨随机整局的属性测试（`packages/engine/test/view.test.ts`）；
 * 这一份守的是 web 端这次调用没把个人视图发给观战者、以及到达规则本身。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { cardKey, createGame, dispatch, type Card, type GameState } from '@sixty/engine';

import { whoLabel } from '../src/lib/labels.ts';
import {
  anchorSeatOf,
  labelSeatOf,
  projectionFor,
  resolveArrivalRole,
  SPECTATOR_ANCHOR_SEAT,
  SPECTATOR_LABEL_SEAT
} from '../src/lib/role.ts';

/** 确定性 RNG（与引擎测试同一套路，便于复现） */
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

function dealtState(seed: number): GameState {
  const result = dispatch(createGame(0), { type: 'deal' }, mulberry32(seed));
  assert.ok(result.ok, '发牌应当成功');
  if (!result.ok) throw new Error('发牌失败');
  return result.state;
}

/** 结构 walker：payload 里所有「像一张牌」的对象（与引擎测试同一口径，不做子串匹配） */
function cardsIn(value: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(value)) {
    for (const item of value) cardsIn(item, out);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  const obj = value as Record<string, unknown>;
  if (obj['joker'] === 'small' || obj['joker'] === 'big') {
    out.push({ joker: obj['joker'] });
    return out;
  }
  if (typeof obj['suit'] === 'string' && typeof obj['rank'] === 'number') {
    out.push(obj as unknown as Card);
    return out;
  }
  for (const item of Object.values(obj)) cardsIn(item, out);
  return out;
}

const PUBLIC_DEAL_FIELDS = [
  'phase',
  'dealNo',
  'dealerSeat',
  'auction',
  'highestBid',
  'auctionTurn',
  'contract',
  'trump',
  'trick',
  'playTurn',
  'trickHistory',
  'captured',
  'handCounts',
  'declarerSeat',
  'summary',
  'claim'
].sort();

test('到达规则：在座→玩家；有观战记录→观战；有空座→自动入座；满座→观战', () => {
  assert.equal(resolveArrivalRole({ seated: true, watching: false, freeSeats: 2 }), 'player');
  assert.equal(resolveArrivalRole({ seated: true, watching: true, freeSeats: 0 }), 'player');
  // 主动离座过（有观战记录）的人再进来不该被自动塞回座位
  assert.equal(resolveArrivalRole({ seated: false, watching: true, freeSeats: 3 }), 'spectator');
  assert.equal(resolveArrivalRole({ seated: false, watching: false, freeSeats: 2 }), 'player');
  assert.equal(resolveArrivalRole({ seated: false, watching: false, freeSeats: 0 }), 'spectator');
});

test('观战者拿到公共视图：没有手牌与底牌，you 为 null', () => {
  const state = dealtState(3);
  const { role, view, you } = projectionFor(state, null);
  assert.equal(role, 'spectator');
  assert.equal(you, null, '观战者不该有一份手牌');
  assert.ok(view !== null);
  assert.deepEqual(
    Object.keys(view.deal!).sort(),
    PUBLIC_DEAL_FIELDS,
    '公共视图的 deal 字段变了：多出来的字段可能是新的泄漏面'
  );

  const deal = state.deal!;
  const hidden = new Set(
    [...deal.hands.flat(), ...deal.kitty].map((card) => cardKey(card))
  );
  const leaked = [...new Set(cardsIn(view).map((card) => cardKey(card)))].filter((key) => hidden.has(key));
  assert.deepEqual(leaked, [], `观战负载里出现了隐藏牌：${leaked.join(',')}`);
  assert.equal(deal.hands.flat().length + deal.kitty.length, 54, '前提：一副共 54 张');
});

test('玩家拿到个人视图：手牌只在 you 里发一份，其余两家仍在隐藏集合里', () => {
  const state = dealtState(5);
  const { role, view, you } = projectionFor(state, 2);
  assert.equal(role, 'player');
  assert.equal(you?.seat, 2);
  assert.equal(you?.hand.length, 17);
  assert.equal(
    (view as unknown as Record<string, unknown>)['you'],
    undefined,
    '个人视图里的 you 应当被摘掉：手牌只发一份'
  );

  const deal = state.deal!;
  const hidden = new Set(
    [...deal.hands[0]!, ...deal.hands[1]!, ...deal.kitty].map((card) => cardKey(card))
  );
  const leaked = [...new Set(cardsIn({ view, you }).map((card) => cardKey(card)))].filter((key) =>
    hidden.has(key)
  );
  assert.deepEqual(leaked, [], `玩家负载里出现了别人的牌或底牌：${leaked.join(',')}`);
});

test('未开局：视图为空，但在不在座位上仍然看得出来（you 的存在就是座位）', () => {
  assert.deepEqual(projectionFor(null, null), { role: 'spectator', view: null, you: null });

  const player = projectionFor(null, 1);
  assert.equal(player.role, 'player');
  assert.equal(player.view, null);
  assert.deepEqual(player.you, {
    seat: 1,
    hand: [],
    isDeclarer: false,
    originalKitty: null,
    buriedKitty: null
  });

  const fresh = createGame(0);
  const spectator = projectionFor(fresh, null);
  assert.equal(spectator.role, 'spectator');
  assert.equal(spectator.view?.deal, null, '还没发牌时 deal 为空');
  assert.equal(spectator.you, null);

  const seated = projectionFor(fresh, 1);
  assert.equal(seated.role, 'player');
  assert.equal(seated.you?.seat, 1, '未开局时在座的人也必须拿到 you，否则界面会以为自己在观战');
  assert.equal(seated.you?.hand.length, 0);
  assert.equal(seated.you?.originalKitty, null, '还没发牌时谈不上「拿上来的底牌」');
  assert.equal(seated.you?.buriedKitty, null, '还没发牌时也谈不上「埋下的底牌」');
  assert.equal(seated.view?.deal, null);
});

test('布局锚点与文案：观战者没有「你」，三个座位都显示玩家名', () => {
  assert.equal(anchorSeatOf(null), SPECTATOR_ANCHOR_SEAT);
  assert.equal(anchorSeatOf(1), 1);
  assert.equal(labelSeatOf(null), SPECTATOR_LABEL_SEAT);
  assert.equal(labelSeatOf(0), 0);

  const names = ['甲', '乙', '丙'];
  const mySeat = labelSeatOf(null);
  for (const seat of [0, 1, 2]) {
    assert.equal(whoLabel(names, mySeat, seat), names[seat], `观战时座位 ${seat} 应显示玩家名`);
  }
  assert.equal(whoLabel(names, 1, 1), '你', '玩家本人仍然是「你」');
});
