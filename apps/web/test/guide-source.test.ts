/**
 * 取数路径（`guide:extract` 的内核）单测：**这是一份真 db 副本会走的那条路**。
 *
 * 用内存 SQLite 建出与 `src/lib/server/db.ts` 相同的**最小**表结构，把一个合成好的
 * 已结算局面塞进 `games.state`，再问 `readCandidates`：
 * 三人非 bot 的应当出草稿，有机器人 / 座位不满 / 没结算的必须如实说理由。
 *
 * 为什么值得单测：真实数据进来时，这条路上的错都是「跑到用户机器上才发现」的那种 ——
 * 表名写错、`is_bot` 判反、`state` 解析路径不对，任何一条都会让整件事静默失败。
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { readCandidates } from '../src/lib/server/guide-source.ts';
import { playDeal } from './guide-fixture.ts';

const SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, token TEXT NOT NULL, created_at TEXT NOT NULL, is_bot INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tables (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, host_user_id INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE seats (table_id INTEGER NOT NULL, seat INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (table_id, seat), UNIQUE (table_id, user_id));
CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL UNIQUE, state TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

interface TableSetup {
  readonly code: string;
  readonly state: string;
  /** 每个座位的 `is_bot`；长度 < 3 就是「座位不满」 */
  readonly bots: readonly number[];
}

function makeDb(tables: readonly TableSetup[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const insertUser = db.prepare('INSERT INTO users (name, token, created_at, is_bot) VALUES (?, ?, ?, ?)');
  const insertTable = db.prepare('INSERT INTO tables (code, host_user_id, created_at) VALUES (?, ?, ?)');
  const insertSeat = db.prepare('INSERT INTO seats (table_id, seat, user_id, joined_at) VALUES (?, ?, ?, ?)');
  const insertGame = db.prepare('INSERT INTO games (table_id, state, updated_at) VALUES (?, ?, ?)');

  tables.forEach((table, index) => {
    const tableId = index + 1;
    insertTable.run(table.code, 1, '2025-01-01T00:00:00.000Z');
    table.bots.forEach((isBot, seat) => {
      // 用户 id 必须用插入真正拿到的那个（AUTOINCREMENT 从 1 起，拍脑袋编号会让座位 JOIN 不上）
      const userId = Number(
        insertUser.run(`${table.code}-p${seat}`, `t-${table.code}-${seat}`, '2025-01-01T00:00:00.000Z', isBot)
          .lastInsertRowid
      );
      insertSeat.run(tableId, seat, userId, '2025-01-01T00:00:00.000Z');
    });
    insertGame.run(tableId, table.state, '2025-02-03T04:05:06.000Z');
  });
  return db;
}

const PLAYED = playDeal(7);

/** 一份三人非 bot 的已结算局面 */
function humanTable(code: string): TableSetup {
  return { code, state: JSON.stringify(PLAYED.finalState), bots: [0, 0, 0] };
}

test('三人非 bot 的已结算副 → 出一份候选草稿（事实与动作齐备）', () => {
  const db = makeDb([humanTable('ABC123')]);
  const candidates = readCandidates(db, '2025-01-01');
  assert.equal(candidates.length, 1);
  const first = candidates[0]!;
  assert.equal(first.ok, true, first.ok ? '' : first.reason);
  if (!first.ok) return;

  assert.equal(first.slug, 'abc123-1', 'slug = 桌码小写 + 副号');
  assert.equal(first.table, 'ABC123');
  assert.equal(first.dealNo, PLAYED.finalState.deal!.dealNo);
  assert.equal(first.draft.facts.hands.length, 3);
  assert.ok(first.draft.actions.length > 0, '草稿必须带着动作序列');
  assert.deepEqual(first.draft.guides, {}, '引导词要由人来写，草稿里是空的');
  assert.equal(first.features.trickCount, PLAYED.finalState.deal!.trickHistory.length);
  assert.match(first.levelNote, /副前级别/);
  // 来源只记桌码与日期，**不含真实用户名**
  assert.deepEqual(Object.keys(first.draft.source).sort(), ['date', 'dealNo', 'table']);
  assert.equal(first.draft.source.date, '2025-02-03');
});

test('有机器人座位 → 不符合「三人均非 bot」，如实说理由', () => {
  const db = makeDb([{ code: 'BOT001', state: JSON.stringify(PLAYED.finalState), bots: [0, 1, 0] }]);
  const candidates = readCandidates(db, '2025-01-01');
  assert.equal(candidates.length, 1);
  const first = candidates[0]!;
  assert.equal(first.ok, false);
  if (!first.ok) assert.match(first.reason, /机器人/);
});

test('座位不满 → 跳过；没发过牌 / 没结算 → 跳过', () => {
  const db = makeDb([
    { code: 'SOLO01', state: JSON.stringify(PLAYED.finalState), bots: [0, 0] },
    { code: 'EMPTY1', state: JSON.stringify({ ...PLAYED.finalState, deal: null }), bots: [0, 0, 0] },
    {
      code: 'OPEN01',
      state: JSON.stringify({
        ...PLAYED.finalState,
        deal: { ...PLAYED.finalState.deal!, phase: 'play', summary: null }
      }),
      bots: [0, 0, 0]
    }
  ]);
  const candidates = readCandidates(db, '2025-01-01');
  assert.deepEqual(
    candidates.map((item) => [item.table, item.ok]),
    [
      ['EMPTY1', false],
      ['OPEN01', false],
      ['SOLO01', false]
    ],
    '三张桌都该被跳过（按桌码排序）'
  );
  const reasons = candidates.map((item) => (item.ok ? '' : item.reason)).join(' | ');
  assert.match(reasons, /只有 2 个座位/);
  assert.match(reasons, /还没发过牌/);
  assert.match(reasons, /还没结算/);
});

test('多张桌：好的出草稿、坏的出理由，一张也不许静默丢', () => {
  const db = makeDb([
    humanTable('GOOD01'),
    { code: 'MIXED1', state: JSON.stringify(PLAYED.finalState), bots: [1, 1, 0] },
    humanTable('GOOD02')
  ]);
  const candidates = readCandidates(db, '2025-01-01');
  assert.equal(candidates.length, 3, '每张有游戏的桌都要有一行结果');
  assert.deepEqual(
    candidates.filter((item) => item.ok).map((item) => item.table),
    ['GOOD01', 'GOOD02']
  );
  assert.equal(candidates.filter((item) => !item.ok).length, 1);
});

test('状态 JSON 坏掉 → 记一句理由，不抛错（一份坏行不该让整次提取失败）', () => {
  const db = makeDb([{ code: 'BROKEN', state: '{不是 JSON', bots: [0, 0, 0] }]);
  const candidates = readCandidates(db, '2025-01-01');
  assert.equal(candidates.length, 1);
  const first = candidates[0]!;
  assert.equal(first.ok, false);
  if (!first.ok) assert.match(first.reason, /JSON 解析失败/);
});

test('只读：一次提取不写库（表里行数不变）', () => {
  const db = makeDb([humanTable('READ01')]);
  const count = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM games').get() as unknown as { n: number }).n;
  const before = count();
  readCandidates(db, '2025-01-01');
  assert.equal(count(), before);
});
