/**
 * 认赢的服务端半场（ADR-0028）：真 SQLite、真引擎。
 *
 * 认领**当场判、当场结算**（引擎手里有另外两家的牌），所以服务端这一层只剩三件事要守：
 * 座位由身份推导（客户端说 0 不算数）、引擎的拒绝原话原样转给玩家、以及老库里的
 * `claim` 字段缺失时别在首帧抛。
 *
 * 「认领成立 → 剩余全收」的牌面规则在 `packages/engine/test/claim.test.ts`；
 * 随机发出的真牌几乎不可能成立，所以这里测的是**被拒**的那条路。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameState } from '@sixty/engine';
import { auctionTurn, playTurn, type Seat } from '@sixty/engine';

// 库的准备必须在服务端模块被求值之前完成（见 server-db.ts 的注释）
await import('./server-db.ts');

const { db } = await import('../src/lib/server/db.ts');
const { applyTableAction, createTable, enterTable, getGameState, getTableByCode, viewFor } =
  await import('../src/lib/server/tables.ts');
const { createIdentity } = await import('../src/lib/server/auth.ts');

let userSeq = 0;

function human(): { id: number; name: string } {
  userSeq += 1;
  const identity = createIdentity(`认赢${userSeq}`);
  assert.ok(identity !== null, '注册身份失败');
  return { id: identity.id, name: identity.name };
}

interface Fixture {
  readonly code: string;
  readonly ids: readonly number[];
  readonly tableId: number;
}

/** 三个真人座、已经发过牌的一桌（座位 0/1/2 对应的 user id 在 `ids` 里） */
function threeSeats(): Fixture {
  const first = human();
  const table = createTable(first.id);
  for (let i = 0; i < 2; i++) {
    const other = human();
    const arrived = enterTable(table.code, other.id);
    assert.ok(!('error' in arrived), '入座失败');
  }
  const info = getTableByCode(table.code)!;
  const ids = info.seats.map((id) => id ?? 0);
  const dealt = applyTableAction(table.code, first.id, { type: 'deal' });
  assert.ok(dealt.ok, dealt.ok ? '' : dealt.message);
  const row = db.prepare('SELECT id FROM tables WHERE code = ?').get(table.code) as { id: number };
  return { code: table.code, ids, tableId: row.id };
}

function stateOf(fixture: Fixture): GameState {
  const state = getGameState(fixture.tableId);
  assert.ok(state !== null, '牌局状态不见了');
  return state;
}

/** 叫牌到成交，再让庄家埋三张：落到「出牌阶段、庄家领出」 */
function toPlay(fixture: Fixture): { declarer: Seat; userId: number } {
  for (let step = 0; step < 6; step++) {
    const state = stateOf(fixture);
    const deal = state.deal!;
    if (deal.phase !== 'auction') break;
    const turn = auctionTurn(deal);
    const call = deal.auction.length === 0 ? { points: 40, strain: 'C' as const } : ('pass' as const);
    const result = applyTableAction(fixture.code, fixture.ids[turn]!, { type: 'bid', seat: 0, call });
    assert.ok(result.ok, result.ok ? '' : result.message);
  }
  const auctioned = stateOf(fixture);
  const declarer = auctioned.deal!.contract!.declarerSeat;
  const hand = auctioned.deal!.hands[declarer]!;
  const buried = applyTableAction(fixture.code, fixture.ids[declarer]!, {
    type: 'bury',
    seat: 0,
    cards: hand.slice(0, 3)
  });
  assert.ok(buried.ok, buried.ok ? '' : buried.message);
  return { declarer, userId: fixture.ids[declarer]! };
}

test('认赢：座位由身份推导；随机发出来的牌几乎不可能成立，引擎当场拒并把原话说出来', () => {
  const fixture = threeSeats();
  const { declarer } = toPlay(fixture);
  const before = JSON.stringify(stateOf(fixture));

  // 不是轮到你出牌的人发认赢：座位是按身份推的（客户端说 0 不算数）
  const defender = ([0, 1, 2] as Seat[]).find((seat) => seat !== declarer)!;
  const wrongTurn = applyTableAction(fixture.code, fixture.ids[defender]!, { type: 'claim', seat: 0 });
  assert.equal(wrongTurn.ok, false);
  assert.match(wrongTurn.ok ? '' : wrongTurn.message, /还没轮到你出牌/);

  // 轮到庄家（首攻）：真牌 17 张，谁都压得住他某一门 —— 当场拒，且一个字都不改状态
  const refused = applyTableAction(fixture.code, fixture.ids[declarer]!, { type: 'claim', seat: 0 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.message, /剩下的牌你还赢不完全/);
  assert.equal(JSON.stringify(stateOf(fixture)), before, '被拒的认领不该改动牌局');
  assert.equal(stateOf(fixture).deal!.claim, null);
  assert.notEqual(playTurn(stateOf(fixture).deal!), null, '被拒之后仍轮到同一个人出牌');
});

test('老库补字段：认赢上线前落库的牌局读到 claim 为 null，不会在第一帧炸掉', () => {
  const fixture = threeSeats();
  const state = stateOf(fixture);
  const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  const deal = legacy['deal'] as Record<string, unknown>;
  delete deal['claim'];
  db.prepare('UPDATE games SET state = ? WHERE table_id = ?').run(JSON.stringify(legacy), fixture.tableId);

  const loaded = stateOf(fixture);
  assert.equal(loaded.deal!.claim, null);
  // 能正常出下一步（而不是在 `deal.claim.xxx` 上抛 TypeError）
  assert.equal(viewFor(getTableByCode(fixture.code)!, fixture.ids[0]!).view!.deal!.claim, null);
});
