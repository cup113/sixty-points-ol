/**
 * 机器人座位的进程内集成测试（ADR-0015）：真 SQLite、真调度器、真引擎，只把
 * **拟人延迟调零**换取确定性。
 *
 * 覆盖别处测不到的五件事：
 * 1. 1 人 + 2 机器人能从发牌打到结算（调度器链式推进、机器人真的动了手）；
 * 2. 进行中加入＝补位（新机器人接过该座位现有的手牌）；
 * 3. 权限与上限：未入座者加不了、至多 2 个、非机器人座位踢不掉；
 * 4. 踢出＝离座语义：座位空出、身份删除、名字回池、再点「+机器人」复用同名；
 * 5. 身份面：机器人行**认证不出来**（没有凭据串这回事），但名字仍然占位；
 * 6. 重启自愈：排程丢了之后 `initBots()` 能把牌局接回去。
 *
 * 沙箱里按包跑：`pnpm run test:web`（`--import ./test/loader.mjs` 见 package.json）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardsPoints, type Action } from '@sixty/engine';
import { moveFor, type BotMove } from '@sixty/bot';

// 库与延迟的准备必须在服务端模块被求值之前完成（见 server-db.ts 的注释）
await import('./server-db.ts');

const { db } = await import('../src/lib/server/db.ts');
const {
  BOT_LIMIT,
  addBot,
  botDelayRange,
  botSeats,
  botsIdle,
  forgetBotTimers,
  initBots,
  removeBot
} = await import('../src/lib/server/bots.ts');
const {
  applyTableAction,
  createTable,
  enterTable,
  getGameState,
  getTableByCode,
  leaveSeat,
  seatOf,
  viewFor
} = await import('../src/lib/server/tables.ts');
const { createIdentity, credentialOf, findByCredential, findByToken, findByName } = await import(
  '../src/lib/server/auth.ts'
);

/** 每个用例结束都丢掉排程：把「延迟已调零的定时器」挡在用例之外 */
test.afterEach(() => forgetBotTimers());

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let userSeq = 0;

/** 建一个人类身份（走真实注册路径；名字唯一） */
function human(): { id: number; name: string } {
  userSeq += 1;
  const identity = createIdentity(`测试${userSeq}`);
  assert.ok(identity !== null, '注册人类身份失败');
  return { id: identity.id, name: identity.name };
}

function toAction(move: BotMove): Action {
  if (move.type === 'bid') return { type: 'bid', seat: 0, call: move.call };
  if (move.type === 'bury') return { type: 'bury', seat: 0, cards: move.cards };
  if (move.type === 'claimAnswer') return { type: 'claimAnswer', seat: 0, agree: move.agree };
  return { type: 'play', seat: 0, cards: move.cards };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 排空机器人排程：延迟已调零，循环让出宏任务直到调度器真的静下来 */
async function settleBots(): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (botsIdle()) {
      await sleep(1);
      if (botsIdle()) return;
    }
    await sleep(1);
  }
  throw new Error('机器人调度一直没停下来');
}

function tableIdOf(code: string): number {
  const row = db.prepare('SELECT id FROM tables WHERE code = ?').get(code) as { id: number } | undefined;
  assert.ok(row !== undefined, `找不到桌 ${code}`);
  return row.id;
}

interface Fixture {
  readonly code: string;
  readonly humanId: number;
}

/** 开一张「1 人 + 2 机器人」的桌（上限就是 2，正好满座） */
function tableWithBots(): Fixture {
  const me = human();
  const table = createTable(me.id);
  for (let i = 0; i < BOT_LIMIT; i++) {
    const added = addBot(table.code, me.id);
    assert.ok(added.ok, `加机器人失败：${added.ok ? '' : added.error}`);
  }
  return { code: table.code, humanId: me.id };
}

/** 替人类座位出牌（用同一份策略）：测试只验证驱动与规则，不评人类手感 */
function humanMove(fixture: Fixture): boolean {
  const table = getTableByCode(fixture.code);
  if (table === null) return false;
  const payload = viewFor(table, fixture.humanId);
  if (payload.view === null || payload.you === null) return false;
  const move = moveFor(payload.view, payload.you);
  if (move === null) return false;
  const result = applyTableAction(fixture.code, fixture.humanId, toAction(move));
  assert.ok(result.ok, `人类座位动作被拒：${result.ok ? '' : result.message}`);
  return true;
}

/** 此刻是不是某个机器人能动（只看这一张桌，`viewFor` 是纯读、不会亮在线灯） */
function pendingBotTurn(fixture: Fixture): boolean {
  const table = getTableByCode(fixture.code);
  if (table === null) return false;
  return botSeats(table.id).some((row) => {
    const payload = viewFor(table, row.user_id);
    return moveFor(payload.view, payload.you) !== null;
  });
}

// ---------------------------------------------------------------------------
// 1. 一整副
// ---------------------------------------------------------------------------

test('1 人 + 2 机器人：从发牌打到结算，机器人真的动了手', async () => {
  const fixture = tableWithBots();
  const tableId = tableIdOf(fixture.code);
  const started = applyTableAction(fixture.code, fixture.humanId, { type: 'deal' });
  assert.ok(started.ok, `发牌失败：${started.ok ? '' : started.message}`);

  assert.equal(botSeats(tableId).length, 2, '满座桌应有两个机器人');

  let scored = false;
  let rounds = 0;
  for (; rounds < 2000; rounds++) {
    await settleBots();
    const state = getGameState(tableId);
    assert.ok(state !== null, '牌局状态不见了');
    if (state.deal !== null && state.deal.phase === 'scored') {
      scored = true;
      break;
    }
    if (!humanMove(fixture)) await sleep(1);
  }

  assert.ok(scored, `一副牌没打完（走了 ${rounds} 轮）`);
  assert.ok(botsIdle(), '结算后仍有待触发的机器人动作');

  const deal = getGameState(tableId)!.deal!;
  assert.equal(deal.phase, 'scored');
  assert.ok(deal.summary !== null, '结算缺少 summary');
  // 牌数守恒：抓到的牌 + 底牌 = 54；分数守恒 = 100
  assert.equal(deal.captured.flat().length + deal.kitty.length, 54);
  assert.equal(cardsPoints(deal.captured.flat()) + cardsPoints(deal.kitty), 100);

  // 机器人确实出过手：事件表里出现它们**座位**的叫牌/埋底/出牌
  // （注意比的是座位号，不是 user id —— 两者只是碰巧都是小整数，比错了会时红时绿）
  const botSeatNumbers = botSeats(tableId).map((row) => row.seat);
  assert.equal(botSeatNumbers.length, 2);
  const acted = db
    .prepare(
      `SELECT COUNT(*) AS n FROM events
       WHERE table_id = ? AND type IN ('bid','bury','play')
         AND json_extract(payload, '$.seat') IN (?, ?)`
    )
    .get(tableId, botSeatNumbers[0]!, botSeatNumbers[1]!) as { n: number };
  assert.ok(acted.n > 0, '事件表里没有机器人动作：调度器没把动作发出去');
});

// ---------------------------------------------------------------------------
// 2. 补位
// ---------------------------------------------------------------------------

test('进行中加入＝补位：新机器人接过该座位现有的手牌', () => {
  const me = human();
  const other = human();
  const table = createTable(me.id);
  const arrived = enterTable(table.code, other.id);
  assert.ok(!('error' in arrived) && arrived.role === 'player', '第二个人类应直接入座');

  const first = addBot(table.code, me.id);
  assert.ok(first.ok, `加第一个机器人失败：${first.ok ? '' : first.error}`);
  const dealt = applyTableAction(table.code, me.id, { type: 'deal' });
  assert.ok(dealt.ok, `发牌失败：${dealt.ok ? '' : dealt.message}`);

  // 另一个人类离座腾出座位 1，新机器人补进去（进行中加入＝补位）
  assert.ok(leaveSeat(table.code, other.id).ok);
  const replaced = addBot(table.code, me.id);
  assert.ok(replaced.ok, `补位加机器人失败：${replaced.ok ? '' : replaced.error}`);
  if (!replaced.ok) return;
  assert.equal(replaced.value.seat, 1, '新机器人应补进刚空出的座位');

  const tableId = tableIdOf(table.code);
  const newcomer = botSeats(tableId).find((row) => row.seat === 1);
  assert.ok(newcomer !== undefined, '补位的机器人不在座位上');
  const payload = viewFor(getTableByCode(table.code)!, newcomer.user_id);
  assert.ok(payload.you !== null, '补位后应拿到个人视图');
  assert.ok(
    (payload.you?.hand.length ?? 0) > 0,
    '补位的机器人必须接手这个座位现有的手牌，而不是空手'
  );
  assert.equal(botSeats(tableId).length, 2, '补位后仍应正好两个机器人');
});

// ---------------------------------------------------------------------------
// 3. 权限与上限
// ---------------------------------------------------------------------------

test('权限与上限：未入座加不了、至多 2 个、非机器人座位踢不掉', () => {
  const outsider = human();
  const me = human();
  const table = createTable(me.id);

  const refused = addBot(table.code, outsider.id);
  assert.ok(!refused.ok && refused.error.includes('入座'), '观战/未入座者不该能加机器人');

  for (let i = 0; i < BOT_LIMIT; i++) {
    assert.ok(addBot(table.code, me.id).ok, '上限之内应该能加');
  }
  const overflow = addBot(table.code, me.id);
  assert.ok(!overflow.ok, `超过 ${BOT_LIMIT} 个机器人仍被接受`);

  const wrongSeat = seatOf(getTableByCode(table.code)!, me.id)!;
  const notBot = removeBot(table.code, me.id, wrongSeat);
  assert.ok(!notBot.ok && notBot.error.includes('机器人'), '人类座位不该能被当成机器人踢掉');
  const byOutsider = removeBot(table.code, outsider.id, botSeats(tableIdOf(table.code))[0]!.seat);
  assert.ok(!byOutsider.ok, '未入座者不该能踢机器人');
});

test('指定座位加机器人：就坐点的那张空座；已占座位与越界座位被拒', () => {
  const me = human();
  const table = createTable(me.id); // 我坐 0 号位
  const tableId = tableIdOf(table.code);

  const atTwo = addBot(table.code, me.id, 2);
  assert.ok(atTwo.ok, `指定 2 号位失败：${atTwo.ok ? '' : atTwo.error}`);
  if (atTwo.ok) assert.equal(atTwo.value.seat, 2, '必须坐进指定的座位，而不是第一个空座');
  assert.deepEqual(botSeats(tableId).map((row) => row.seat), [2]);

  const taken = addBot(table.code, me.id, 0); // 0 号位是我自己
  assert.ok(!taken.ok && taken.error.includes('已经有人'), '已占座位应当被拒');

  const outOfRange = addBot(table.code, me.id, 9);
  assert.ok(!outOfRange.ok, '越界座位号应当被拒');

  // 不指定座位时仍是「第一个空座」（脚本与既有调用依赖这条默认行为）
  const byDefault = addBot(table.code, me.id);
  assert.ok(byDefault.ok);
  if (byDefault.ok) assert.equal(byDefault.value.seat, 1, '不指定时取第一个空座');
});

test('botDelayRange：坏值一律退回默认，绝不产生 NaN（初版会让服务起不来）', () => {
  assert.deepEqual(botDelayRange({}), { min: 500, max: 1500 }, '没设就用默认');
  assert.deepEqual(
    botDelayRange({ SIXTY_BOT_DELAY_MIN_MS: '', SIXTY_BOT_DELAY_MAX_MS: '' }),
    { min: 500, max: 1500 },
    '空串 = 没设（compose 里 `X=` 很常见）'
  );
  assert.deepEqual(
    botDelayRange({ SIXTY_BOT_DELAY_MIN_MS: '500ms', SIXTY_BOT_DELAY_MAX_MS: '0.5s' }),
    { min: 500, max: 1500 },
    '带单位/非数字的笔误退回默认，而不是 NaN'
  );
  assert.deepEqual(
    botDelayRange({ SIXTY_BOT_DELAY_MIN_MS: '-5', SIXTY_BOT_DELAY_MAX_MS: '10' }),
    { min: 0, max: 10 },
    '负数夹到 0'
  );
  assert.deepEqual(
    botDelayRange({ SIXTY_BOT_DELAY_MIN_MS: '0.5', SIXTY_BOT_DELAY_MAX_MS: '2.9' }),
    { min: 0, max: 2 },
    '小数取整：randomInt 只吃安全整数'
  );
  assert.deepEqual(
    botDelayRange({ SIXTY_BOT_DELAY_MIN_MS: '3000', SIXTY_BOT_DELAY_MAX_MS: '1000' }),
    { min: 3000, max: 3000 },
    '上限低于下限时抬到下限'
  );
  const bad = botDelayRange({ SIXTY_BOT_DELAY_MIN_MS: 'NaN', SIXTY_BOT_DELAY_MAX_MS: 'Infinity' });
  for (const value of [bad.min, bad.max]) {
    assert.ok(Number.isInteger(value) && Number.isFinite(value), `解析结果必须是有限整数：${value}`);
  }
  // 合法值照常生效（调零就是靠它）
  assert.deepEqual(botDelayRange({ SIXTY_BOT_DELAY_MIN_MS: '0', SIXTY_BOT_DELAY_MAX_MS: '0' }), {
    min: 0,
    max: 0
  });
});

// ---------------------------------------------------------------------------
// 4. 踢出＝离座语义
// ---------------------------------------------------------------------------

test('踢出＝离座语义：座位空出、身份删除、名字回池可复用', () => {
  const fixture = tableWithBots();
  const tableId = tableIdOf(fixture.code);
  const target = botSeats(tableId)[0]!;
  const row = db.prepare('SELECT name FROM users WHERE id = ?').get(target.user_id) as { name: string };
  assert.notEqual(findByName(row.name), null, '机器人名字应占位');

  const removed = removeBot(fixture.code, fixture.humanId, target.seat);
  assert.ok(removed.ok, `踢机器人失败：${removed.ok ? '' : removed.error}`);
  assert.equal(botSeats(tableId).length, 1, '踢出后应只剩 1 个机器人');
  assert.equal(seatOf(getTableByCode(fixture.code)!, target.user_id), null, '座位应已空出');
  assert.equal(
    db.prepare('SELECT 1 FROM users WHERE id = ?').get(target.user_id),
    undefined,
    '机器人身份应随离座删除（名字回收）'
  );
  assert.equal(findByName(row.name), null, '名字应已回到可用池');

  const again = addBot(fixture.code, fixture.humanId);
  assert.ok(again.ok, `再点一次「+机器人」失败：${again.ok ? '' : again.error}`);
  if (again.ok) assert.equal(again.value.name, row.name, '机器人名字应从池子里复用');
});

// ---------------------------------------------------------------------------
// 5. 身份面：机器人认证不出来
// ---------------------------------------------------------------------------

test('机器人身份没有凭据串：令牌与凭据都认证不出，但名字仍然占位', () => {
  const fixture = tableWithBots();
  const target = botSeats(tableIdOf(fixture.code))[0]!;
  const row = db.prepare('SELECT id, name, token FROM users WHERE id = ?').get(target.user_id) as {
    id: number;
    name: string;
    token: string;
  };

  assert.ok(row.token.length > 0, 'token 列非空（列约束），只是永不外发');
  assert.equal(findByToken(row.token), null, '机器人不该能靠令牌认证');
  assert.equal(
    findByCredential(credentialOf({ id: row.id, name: row.name, token: row.token, giteeId: null })),
    null,
    '机器人不该能靠凭据串认证'
  );
  assert.notEqual(findByName(row.name), null, '名字仍占位');
  assert.equal(createIdentity(row.name), null, '机器人占着的名字不该能被人类注册');
});

// ---------------------------------------------------------------------------
// 6. 重启自愈
// ---------------------------------------------------------------------------

test('排程丢失后 initBots 把牌局接回去（重启自愈）', async () => {
  const fixture = tableWithBots();
  const tableId = tableIdOf(fixture.code);
  assert.ok(applyTableAction(fixture.code, fixture.humanId, { type: 'deal' }).ok);

  /**
   * 先推进到「**确实轮到某个机器人**」的状态：这正是重启前会挂住的那种局面。
   * 注意发牌座位是随机的（`applyTableAction` 用 `randomInt` 选庄），所以第一个人可能是人类；
   * 而只要排程还活着，`settleBots` 就会替机器人把牌出掉 —— 想观察「轮到机器人」，
   * 必须先把排程丢掉再看（`forgetBotTimers` 在这里同时充当观察手段）。
   */
  let waitingOnBot = false;
  for (let i = 0; i < 60; i++) {
    forgetBotTimers();
    if (pendingBotTurn(fixture)) {
      waitingOnBot = true;
      break;
    }
    initBots();
    await settleBots();
    if (getGameState(tableId)!.deal?.phase === 'scored') break;
    humanMove(fixture);
  }
  assert.ok(waitingOnBot, '没能推进到「轮到一个机器人」的局面');

  // 丢掉内存里的排程 = 服务重启后的状态
  forgetBotTimers();
  assert.ok(botsIdle(), 'forgetBotTimers 之后不该还有排程');
  const before = getGameState(tableId)!;

  initBots();
  assert.ok(!botsIdle(), 'initBots 必须为「有机器人且轮到它」的桌重新排程');

  await settleBots();
  // 真正的证据落在这张桌上：补扫之后机器人接着出手，版本号前移
  assert.ok(
    getGameState(tableId)!.version > before.version,
    '补扫之后这张桌的牌局应继续推进（机器人接着出手）'
  );

  // 收尾：把这一副打完，别把后台定时器留给下一个用例（afterEach 也会丢排程）
  for (let i = 0; i < 2000 && getGameState(tableId)!.deal?.phase !== 'scored'; i++) {
    await settleBots();
    if (!humanMove(fixture)) await sleep(1);
  }
  assert.ok(botsIdle());
});
