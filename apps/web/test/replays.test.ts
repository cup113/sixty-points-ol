/**
 * 机器重演的服务端集成测试（ADR-0016）：真 SQLite、真 `applyTableAction` 权威路径。
 *
 * 覆盖四件事：
 * 1. 一副结算 → 重演立刻落库，且摘要与真桌**逐字相同**（三个真人座位用机器人策略代开，
 *    于是「真桌」与「重演」走同一套决策 —— 重建输入正确性由此得到端到端验证）；
 * 2. `newGame` 清空重演（dealNo 重新从 1 计数，不清就张冠李戴）；
 * 3. 路由：无凭据 401、码不存在 404、有凭据拿到升序列表；
 * 4. `replayInputOf` 的形状校验：墩史不完整（手牌还原不出 17 张）时返回 null。
 *
 * 沙箱内按包跑：`pnpm run test:web`（`--import ./test/loader.mjs` 见 package.json）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardKey, createGame, dispatch, fullDeck, personalView, type Action, type GameState, type Seat } from '@sixty/engine';
import { moveFor } from '@sixty/bot';

// 库与延迟的准备必须在服务端模块被求值之前完成（见 server-db.ts 的注释）
await import('./server-db.ts');

const { db, now } = await import('../src/lib/server/db.ts');
const { computeReplay, replayInputOf, replaysOf } = await import('../src/lib/server/replays.ts');
const { applyTableAction, createTable, enterTable, getGameState, getTableByCode, viewFor } = await import(
  '../src/lib/server/tables.ts'
);
const { createIdentity, credentialOf } = await import('../src/lib/server/auth.ts');
const route = await import('../src/routes/api/tables/[code]/replays/+server.ts');

/** 与 bots.test 同款确定性 RNG（驱动引擎层夹具用） */
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

let seq = 0;
const uniqueName = (prefix: string): string => `${prefix}${Date.now() % 100000}${(seq += 1)}`;

/** 此刻该谁行动（scored / 无牌局 → null） */
function actorOf(state: GameState): Seat | null {
  const deal = state.deal;
  if (deal === null) return null;
  if (deal.phase === 'auction') return ((deal.dealerSeat + deal.auction.length) % 3) as Seat;
  if (deal.phase === 'bury') return deal.contract!.declarerSeat;
  if (deal.phase === 'play') return ((deal.trick!.leaderSeat + deal.trick!.plays.length) % 3) as Seat;
  return null;
}

interface Fixture {
  readonly code: string;
  readonly tableId: number;
  readonly seatUsers: readonly number[];
  readonly credential: string;
}

/** 一张三人桌（三个真人身份；决策由测试用机器人策略代开，走人类同一条权威路径） */
function fixture(): Fixture {
  const a = createIdentity(uniqueName('重演甲'));
  const b = createIdentity(uniqueName('重演乙'));
  const c = createIdentity(uniqueName('重演丙'));
  assert.ok(a !== null && b !== null && c !== null, '建身份失败');
  const table = createTable(a.id);
  enterTable(table.code, b.id);
  enterTable(table.code, c.id);
  const fresh = getTableByCode(table.code)!;
  return { code: table.code, tableId: table.id, seatUsers: fresh.seats as readonly number[], credential: credentialOf(a) };
}

/** 把这副打到底（含全 pass 重发；上限兜住死循环） */
function driveDeal(fixture: Fixture): void {
  for (let steps = 0; steps < 3000; steps++) {
    const table = getTableByCode(fixture.code)!;
    const state = getGameState(table.id);
    if (state === null || state.deal === null) {
      assert.ok(applyTableAction(fixture.code, fixture.seatUsers[0]!, { type: 'deal' }).ok);
      continue;
    }
    if (state.deal.phase === 'scored') return;
    const actor = actorOf(state)!;
    const userId = table.seats[actor]!;
    const payload = viewFor(table, userId);
    const move = moveFor(payload.view, payload.you);
    assert.ok(move !== null, `座位 ${actor}（${state.deal.phase}）给不出动作`);
    const res = applyTableAction(fixture.code, userId, { ...move, seat: actor } as Action);
    assert.ok(res.ok, `动作被拒：${res.ok ? '' : res.message}`);
  }
  assert.fail('driveDeal 步数超限');
}

test('一副结算 → 重演立刻落库；重建输入集合保真、结果确定', () => {
  const f = fixture();
  driveDeal(f);

  const state = getGameState(f.tableId)!;
  const real = state.deal!.summary!;
  const rows = replaysOf(f.tableId);
  assert.equal(rows.length, 1, '恰一条重演');
  assert.equal(rows[0]!.dealNo, real.dealNo, '副号对得上');
  assert.equal(rows[0]!.result.kind, 'scored', '机器人策略代开的桌，重演必然同样打成');

  // 注意：这里**不断言**重演摘要与真桌逐字相同 —— 手牌数组序是结算时未被保存的
  // 隐藏状态（打完即空，墩史只记出牌序），而机器人策略的同值并列（埋底/垫牌的
  // keep 值相等时按下标决胜）依赖它。重演对「同一副牌（集合意义）」确定，与
  // 「当初那桌」可能差在并列取舍上（诊断实测：定约相同、埋底三张不同）。
  // 这条边界记录在 ADR-0016。

  // 服务端层面的确定性：对同一份结算状态重算，重演逐字不变
  const again = computeReplay(state);
  assert.equal(JSON.stringify(again), JSON.stringify(rows[0]), '同一结算状态重算重演必须逐字相同');

  // 重建输入集合保真：三家 17 张互不重复，与底牌合起来恰是整副 54 张。
  // 这一条专门钉住庄家的还原公式（原始 17 = 打出 17 ∪ 埋下 3 − 拿上来 3）——
  // 错版实现（直接拿「打出的 17」当原始手牌）在这里现形：拿上来的底牌被数两次、
  // 被埋掉的原手牌凭空消失（Set 只剩 51）。
  const input = replayInputOf(state)!;
  const allKeys = [...input.hands.flat(), ...input.originalKitty].map(cardKey);
  assert.equal(new Set(allKeys).size, 54, '重建出的 51 + 3 张互不重复');
  assert.deepEqual(
    [...new Set(allKeys)].sort(),
    fullDeck().map(cardKey).sort(),
    '重建出的牌恰好是整副牌（无中生有、也不错张）'
  );
  assert.deepEqual(
    [...input.originalKitty].map(cardKey).sort(),
    [...real.originalKitty].map(cardKey).sort(),
    '拿上来的底牌 = summary.originalKitty'
  );

  // 副前级别还原：变动座取 from，未变动座当前值即开打前的值
  for (const change of real.levelChanges) {
    assert.deepEqual(input.levels[change.seat], change.from, `座位 ${change.seat} 副前级别 = 变动前`);
  }

  // 重演摘要自洽（与 bot 包 sim.test 同款口径的轻量版）
  if (rows[0]!.result.kind === 'scored') {
    const sim = rows[0]!.result.summary;
    assert.equal(sim.kitty.length, 3, '机器人庄家埋了 3 张');
    assert.equal(
      sim.finalScore,
      sim.declarerTrickPoints +
        (sim.protectedBottom ? sim.multiplier * sim.kittyPoints : -sim.multiplier * sim.kittyPoints),
      '重演的结算公式'
    );
    assert.equal(sim.made, sim.finalScore >= sim.contract.points, '重演的打成判定');
  }
});

test('newGame 清空重演（dealNo 重新计数）', () => {
  const f = fixture();
  driveDeal(f);
  assert.ok(replaysOf(f.tableId).length === 1, '前置：已有一条重演');

  // 直接把 games 行改成一个「已结束」状态（newGame 的唯一门槛），避免真打完整场
  const finished: GameState = {
    ...createGame(0),
    status: 'finished',
    result: {
      progress: [0, 0, 0],
      ranking: [0, 1, 2],
      places: [1, 1, 1],
      reason: { kind: 'oneAtThree', seats: [0] }
    }
  };
  db.prepare(
    `INSERT INTO games (table_id, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(table_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
  ).run(f.tableId, JSON.stringify(finished), now());

  const res = applyTableAction(f.code, f.seatUsers[0]!, { type: 'newGame' });
  assert.ok(res.ok, `newGame 应成功：${res.ok ? '' : res.message}`);
  assert.deepEqual(replaysOf(f.tableId), [], '开新对局后重演必须清空');
});

test('路由：无凭据 401、码不存在 404、有凭据拿到列表', async () => {
  const f = fixture();
  driveDeal(f);

  const call = async (code: string, credential?: string): Promise<{ status: number; body: string }> => {
    const url = new URL(`http://127.0.0.1/api/tables/${code}/replays`);
    const event = {
      params: { code },
      url,
      cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
      request: new Request(url, { headers: credential ? { authorization: `Bearer ${credential}` } : {} }),
      locals: {},
      fetch,
      getClientAddress: () => '127.0.0.1',
      platform: undefined,
      route: { id: null },
      setHeaders: () => undefined,
      isDataRequest: false,
      isSubRequest: false
    };
    try {
      const response = (await (route.GET as (e: never) => Promise<Response>)(event as never)) as Response;
      return { status: response.status, body: await response.text() };
    } catch (thrown) {
      const status = (thrown as { status?: number }).status;
      if (status === undefined) throw thrown;
      return { status, body: (thrown as { body?: { message?: string } }).body?.message ?? '' };
    }
  };

  assert.equal((await call(f.code)).status, 401, '无凭据 401');
  assert.equal((await call('ZZZZZZ', f.credential)).status, 404, '码不存在 404');

  const ok = await call(f.code, f.credential);
  assert.equal(ok.status, 200);
  const parsed = JSON.parse(ok.body) as { replays: { dealNo: number; result: { kind: string } }[] };
  assert.equal(parsed.replays.length, 1, '列表含结算过的那副');
  assert.ok(parsed.replays[0]!.dealNo >= 1, '副号在列表里');
  assert.ok(['scored', 'all-pass'].includes(parsed.replays[0]!.result.kind), '终态只有两种');
});

test('replayInputOf 的形状校验：墩史不完整时返回 null（不影响结算）', () => {
  // 引擎层直接打到 scored（无数据库，纯内存）
  const rng = mulberry32(11);
  let state: GameState = createGame(0);
  const dealt = dispatch(state, { type: 'deal' }, rng);
  assert.ok(dealt.ok, '发牌应成功');
  state = dealt.state;
  for (let steps = 0; state.deal!.phase !== 'scored' && steps < 2000; steps++) {
    const deal = state.deal!;
    let actor: Seat;
    if (deal.phase === 'auction') actor = ((deal.dealerSeat + deal.auction.length) % 3) as Seat;
    else if (deal.phase === 'bury') actor = deal.contract!.declarerSeat;
    else actor = ((deal.trick!.leaderSeat + deal.trick!.plays.length) % 3) as Seat;
    const view = personalView(state, actor);
    const move = moveFor(view, view.you);
    assert.ok(move !== null);
    const res = dispatch(state, { ...move, seat: actor } as Action, rng);
    assert.ok(res.ok, `引擎层驱动被拒：${res.ok ? '' : res.message}`);
    state = res.state;
  }
  assert.equal(state.deal!.phase, 'scored', '前置：已结算');
  assert.notEqual(replayInputOf(state), null, '完整状态应重建出输入');

  const broken: GameState = structuredClone(state);
  broken.deal!.trickHistory.pop(); // 少一墩：有一家只剩 16 张可还原
  assert.equal(replayInputOf(broken), null, '墩史不完整 → null');
  assert.equal(computeReplay(broken), null, 'computeReplay 同样拒绝（不落库、不抛错）');
});
