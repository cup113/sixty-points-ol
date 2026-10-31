/**
 * 认赢的服务端半场（ADR-0028）：真 SQLite、真引擎、真定时器。
 *
 * 引擎自己的规则（票、结算、视图）在 `packages/engine/test/claim.test.ts`；
 * 这一份只测**服务端**独有的那几件：截止时刻由服务端盖、座位由身份推导、
 * 表决窗口的定时器、以及「重启补扫时到点就判失败」。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameState } from '@sixty/engine';
import { auctionTurn, playTurn, type Seat } from '@sixty/engine';

// 库的准备必须在服务端模块被求值之前完成（见 server-db.ts 的注释）
await import('./server-db.ts');

const { db } = await import('../src/lib/server/db.ts');
const { applyTableAction, createTable, enterTable, getGameState, getTableByCode, initClaims, viewFor, forgetClaimTimers } =
  await import('../src/lib/server/tables.ts');
const { createIdentity } = await import('../src/lib/server/auth.ts');

test.afterEach(() => forgetClaimTimers());

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

test('认赢：截止时刻由服务端盖，座位由身份推导，两名对手都认输才结算', () => {
  const fixture = threeSeats();
  const { declarer, userId } = toPlay(fixture);
  const before = Date.now();

  // 客户端只发「末轮张数」；座位填 0 也会被服务端按身份覆盖 —— 所以这里故意从庄家发
  const claimed = applyTableAction(fixture.code, userId, { type: 'claim', seat: 0, lastTrick: 1 });
  assert.ok(claimed.ok, claimed.ok ? '' : claimed.message);

  const claim = stateOf(fixture).deal!.claim!;
  assert.equal(claim.claimant, declarer);
  assert.equal(claim.status, 'pending');
  // 30 秒窗口由服务端的钟给（引擎只存不读）
  assert.ok(claim.expiresAt >= before + 29_000, '截止时刻没有被服务端盖成 30 秒窗口');

  // 负载里传的是剩余毫秒，不是时间戳
  const table = getTableByCode(fixture.code)!;
  const mine = viewFor(table, userId);
  assert.ok(mine.table.claimMsLeft !== null && mine.table.claimMsLeft <= 30_000, 'claimMsLeft 不在 30 秒以内');
  assert.ok(mine.view!.deal!.claim!.revealed.length > 0, '公共视图里没有亮牌');

  // 不是轮到你出牌的人发认赢：被拒（座位确实是按身份推导的，不是客户端填的 0）
  const defender = ([0, 1, 2] as Seat[]).find((seat) => seat !== declarer)!;
  const wrongTurn = applyTableAction(fixture.code, fixture.ids[defender]!, { type: 'claim', seat: 0, lastTrick: 1 });
  assert.equal(wrongTurn.ok, false);

  // 一票「认输」还不够
  const one = applyTableAction(fixture.code, fixture.ids[defender]!, { type: 'claimAnswer', seat: 0, agree: true });
  assert.ok(one.ok, one.ok ? '' : one.message);
  assert.equal(stateOf(fixture).deal!.claim!.status, 'pending');

  // 两票都到齐 → 立即按「剩余全收」结算
  const other = ([0, 1, 2] as Seat[]).find((seat) => seat !== declarer && seat !== defender)!;
  const two = applyTableAction(fixture.code, fixture.ids[other]!, { type: 'claimAnswer', seat: 0, agree: true });
  assert.ok(two.ok, two.ok ? '' : two.message);
  const scored = stateOf(fixture).deal!;
  assert.equal(scored.phase, 'scored');
  assert.equal(scored.summary!.claim!.seat, declarer);
  assert.equal(viewFor(table, userId).table.claimMsLeft, null);
});

test('超时：重启补扫时到点的认赢判失败（fail-closed），牌局从原处继续', async () => {
  const fixture = threeSeats();
  const { userId } = toPlay(fixture);
  const claimed = applyTableAction(fixture.code, userId, { type: 'claim', seat: 0, lastTrick: 1 });
  assert.ok(claimed.ok, claimed.ok ? '' : claimed.message);

  // 模拟「重启时这个窗口早就过期了」：把存下来的截止时刻改到过去，再走启动补扫
  const state = stateOf(fixture);
  (state.deal!.claim as { expiresAt: number }).expiresAt = Date.now() - 1;
  db.prepare('UPDATE games SET state = ? WHERE table_id = ?').run(JSON.stringify(state), fixture.tableId);
  initClaims();

  for (let i = 0; i < 100; i++) {
    const claim = stateOf(fixture).deal!.claim!;
    if (claim.status !== 'pending') {
      assert.equal(claim.status, 'rejected');
      assert.equal(claim.rejectedBy, null, '超时不指向某个人');
      assert.notEqual(playTurn(stateOf(fixture).deal!), null, '被拒之后应回到原来的出牌人');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('认赢窗口到点了还挂在 pending 上');
});

test('窗口之外到达的票不生效：哪怕定时器没赶上（进程睡过点 / 定时器丢了）', () => {
  const fixture = threeSeats();
  const { declarer, userId } = toPlay(fixture);
  const claimed = applyTableAction(fixture.code, userId, { type: 'claim', seat: 0, lastTrick: 1 });
  assert.ok(claimed.ok, claimed.ok ? '' : claimed.message);

  // 只把存下来的截止时刻拨到过去：**不**调 initClaims、也不等定时器 ——
  // 模拟「定时器没跑过」，这一票仍必须被拿下（窗口不是靠定时器才算数的）
  const state = stateOf(fixture);
  (state.deal!.claim as { expiresAt: number }).expiresAt = Date.now() - 1;
  db.prepare('UPDATE games SET state = ? WHERE table_id = ?').run(JSON.stringify(state), fixture.tableId);

  const defender = ([0, 1, 2] as Seat[]).find((seat) => seat !== declarer)!;
  const late = applyTableAction(fixture.code, fixture.ids[defender]!, { type: 'claimAnswer', seat: 0, agree: true });
  assert.equal(late.ok, false, '迟到的票被当成有效票了');
  assert.equal(stateOf(fixture).deal!.claim!.status, 'rejected', '迟到的票没有把窗口判掉');
  assert.notEqual(playTurn(stateOf(fixture).deal!), null, '被拒之后应回到原来的出牌人');
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
  // 能正常出下一步（而不是在 `deal.claim.status` 上抛 TypeError）
  assert.equal(viewFor(getTableByCode(fixture.code)!, fixture.ids[0]!).table.claimMsLeft, null);
});
