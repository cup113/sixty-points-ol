/**
 * 桌边消息（ADR-0028）的两层判据：
 *
 * 1. **纯函数**：表情目录、短句归一化与长度、暂离档位、剩余时间文案；
 * 2. **真 SQLite**：在座才能发、2 秒限速、过期不返回、牌局动作只清暂离、离座带走消息。
 *
 * 第二条不能只靠源码守卫：`REPLACE`、`LEFT JOIN` 与「到点不返回」都是运行时行为，
 * 源码里看不出来。
 *
 * 沙箱里按包跑：`pnpm run test:web`。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { auctionTurn } from '@sixty/engine';

import {
  AWAY_MINUTES,
  EMOTES,
  EMOTE_TTL_MS,
  MAX_MESSAGE_LENGTH,
  TEXT_TTL_MS,
  awayRemainingText,
  emoteGlyph,
  isAwayMinutes,
  isEmoteKey,
  messageProblem,
  normalizeMessage,
  parseSocialPost
} from '$lib/social';

// 库与延迟的准备必须在服务端模块被求值之前完成（见 server-db.ts 的注释）
await import('./server-db.ts');

const { db } = await import('../src/lib/server/db.ts');
const { createIdentity } = await import('../src/lib/server/auth.ts');
const {
  applyTableAction,
  createTable,
  enterTable,
  getGameState,
  getTableByCode,
  leaveSeat,
  postAnnouncement,
  takeSeat,
  tableView
} = await import('../src/lib/server/tables.ts');
const { deleteTableById, deleteUser } = await import('../src/lib/server/admin.ts');

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test('表情目录：键唯一、字形与读屏名都不为空', () => {
  const keys = EMOTES.map((emote) => emote.key);
  assert.equal(new Set(keys).size, keys.length, '表情键有重复');
  for (const emote of EMOTES) {
    assert.ok(emote.glyph.length > 0, `${emote.key} 没有字形`);
    assert.ok(emote.label.length > 0, `${emote.key} 没有读屏名`);
  }
});

test('isEmoteKey 只认目录里的键，emoteGlyph 对脏键给中性占位', () => {
  assert.equal(isEmoteKey('nice'), true);
  assert.equal(isEmoteKey('NICE'), false);
  assert.equal(isEmoteKey(null), false);
  assert.equal(isEmoteKey(3), false);
  assert.equal(emoteGlyph('nice'), EMOTES.find((emote) => emote.key === 'nice')?.glyph);
  assert.equal(emoteGlyph('not-a-key'), '·');
});

test('短句归一化：控制字符、零宽字符与连续空白都不许带进气泡', () => {
  assert.equal(normalizeMessage('  你好  '), '你好');
  assert.equal(normalizeMessage('你\n\n好'), '你 好');
  assert.equal(normalizeMessage('你\u0007好\u200b'), '你 好');
  assert.equal(normalizeMessage('   '), '');
});

test('短句长度：按码点算，恰好在边界上的放行、超一个拒绝', () => {
  assert.equal(MAX_MESSAGE_LENGTH, 24);
  assert.equal(messageProblem('字'.repeat(MAX_MESSAGE_LENGTH)), null);
  assert.match(messageProblem('字'.repeat(MAX_MESSAGE_LENGTH + 1)) ?? '', /最多 24 个字/);
  assert.equal(messageProblem('   '), '写一句再发');
  // emoji 是一个码点：24 个 emoji 不该被 UTF-16 长度卡住
  assert.equal(messageProblem('😀'.repeat(MAX_MESSAGE_LENGTH)), null);
});

test('暂离档位：六档、全是整数分钟；不在档位里的一律拒绝', () => {
  assert.deepEqual([...AWAY_MINUTES], [5, 10, 15, 30, 45, 60]);
  for (const minutes of AWAY_MINUTES) assert.equal(isAwayMinutes(minutes), true);
  for (const bad of [4, 20, 61, 15.5, '15', null]) assert.equal(isAwayMinutes(bad), false);
});

test('剩余时间文案：向上取整到分钟，到点返回 null', () => {
  assert.equal(awayRemainingText(15 * 60_000), '还剩 15 分');
  assert.equal(awayRemainingText(14 * 60_000 + 1), '还剩 15 分');
  assert.equal(awayRemainingText(59_000), '还剩 1 分');
  assert.equal(awayRemainingText(0), null);
  assert.equal(awayRemainingText(-1), null);
});

test('parseSocialPost：三种消息各自的形状与拒绝理由', () => {
  assert.deepEqual(parseSocialPost({ kind: 'emote', key: 'nice' }), {
    ok: true,
    post: { kind: 'emote', key: 'nice' }
  });
  assert.deepEqual(parseSocialPost({ kind: 'text', text: '  好牌  ' }), {
    ok: true,
    post: { kind: 'text', text: '好牌' }
  });
  assert.deepEqual(parseSocialPost({ kind: 'away', minutes: 15 }), {
    ok: true,
    post: { kind: 'away', minutes: 15 }
  });

  assert.equal(parseSocialPost(null).ok, false);
  assert.equal(parseSocialPost({ kind: 'emote', key: 'nope' }).ok, false);
  assert.equal(parseSocialPost({ kind: 'text', text: '' }).ok, false);
  assert.equal(parseSocialPost({ kind: 'text', text: 42 }).ok, false);
  assert.equal(parseSocialPost({ kind: 'away', minutes: 20 }).ok, false);
  assert.equal(parseSocialPost({ kind: 'shout', text: '嗨' }).ok, false);
});

// ---------------------------------------------------------------------------
// 真库：一桌三人
// ---------------------------------------------------------------------------

let seq = 0;

function human(name: string): { id: number } {
  const identity = createIdentity(name);
  assert.ok(identity !== null, '注册人类身份失败');
  return { id: identity.id };
}

interface Fixture {
  readonly code: string;
  readonly tableId: number;
  readonly ids: readonly number[];
}

/** 三个真人坐满一张桌（不复用身份：每个用例一个干净的牌桌） */
function fixture(): Fixture {
  seq += 1;
  const people = [0, 1, 2].map((i) => human(`桌边${seq}-${i}`));
  const table = createTable(people[0]!.id);
  for (const person of people.slice(1)) {
    const entered = enterTable(table.code, person.id);
    assert.equal('role' in entered && entered.role, 'player');
  }
  return { code: table.code, tableId: table.id, ids: people.map((person) => person.id) };
}

function seatOf(code: string, userId: number) {
  return tableView(getTableByCode(code)!).seats.find((seat) => seat.userId === userId) ?? null;
}

test('表情：在座就能发，别人在同一张桌的负载里立刻能看到；寿命是 6 秒', () => {
  const { code, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'emote', key: 'nice' }), { ok: true });

  const seat = seatOf(code, ids[0]!);
  assert.equal(seat?.announcement?.kind, 'emote');
  assert.equal(seat?.announcement?.body, 'nice');
  assert.ok((seat?.announcement?.remainingMs ?? 0) > 0);
  assert.ok((seat?.announcement?.remainingMs ?? 0) <= EMOTE_TTL_MS);

  // 另一个座位读到的是同一份，且自己的座位没有消息
  assert.equal(seatOf(code, ids[1]!)?.announcement, null);
});

test('短句：入库前归一化；超过 24 字当场拒绝', () => {
  const { code, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'text', text: '  好  牌  ' }), { ok: true });
  assert.equal(seatOf(code, ids[0]!)?.announcement?.body, '好 牌');
  assert.ok((seatOf(code, ids[0]!)?.announcement?.remainingMs ?? 0) <= TEXT_TTL_MS);

  const rejected = postAnnouncement(code, ids[1]!, { kind: 'text', text: '字'.repeat(25) });
  assert.equal(rejected.ok, false);
  assert.match(rejected.ok ? '' : rejected.message, /最多 24 个字/);
  assert.equal(seatOf(code, ids[1]!)?.announcement, null);
});

test('新消息换新 id：点掉过的旧气泡不会压住下一条', () => {
  const { code, tableId, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'text', text: '第一句' }), { ok: true });
  const first = seatOf(code, ids[0]!)?.announcement?.id;
  assert.equal(typeof first, 'number');

  // 把消息与限速台账都往前挪，绕开 2 秒限速（这里测的是 id 换代，不是限速）
  const past = new Date(Date.now() - 3_000).toISOString();
  db.prepare('UPDATE announcements SET created_at = ? WHERE table_id = ? AND user_id = ?').run(
    past,
    tableId,
    ids[0]!
  );
  db.prepare(
    'UPDATE announcement_throttle SET posted_at = ? WHERE table_id = ? AND user_id = ?'
  ).run(past, tableId, ids[0]!);
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'text', text: '第二句' }), { ok: true });
  const second = seatOf(code, ids[0]!)?.announcement?.id;
  assert.equal(typeof second, 'number');
  assert.notEqual(first, second, 'REPLACE 没有换 id：客户端会把新消息当成被点掉的旧气泡');
});

test('限速：同一个人 2 秒内第二条被 429 拒绝，别人不受影响', () => {
  const { code, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'emote', key: 'nice' }), { ok: true });
  const second = postAnnouncement(code, ids[0]!, { kind: 'emote', key: 'party' });
  assert.equal(second.ok, false);
  assert.equal(second.ok ? undefined : second.status, 429);
  assert.equal(seatOf(code, ids[0]!)?.announcement?.body, 'nice', '被拒的那条不该覆盖上一条');

  // 另一个人照常能发
  assert.deepEqual(postAnnouncement(code, ids[1]!, { kind: 'emote', key: 'clap' }), { ok: true });
});

test('限速的窗口属于人：牌局动作删掉暂离之后，2 秒内仍然限速', () => {
  const { code, ids } = fixture();
  const dealt = applyTableAction(code, ids[0]!, { type: 'deal' });
  assert.equal(dealt.ok, true);
  const state = getGameState(getTableByCode(code)!.id);
  const deal = state?.deal ?? null;
  if (deal === null) throw new Error('发牌之后没有 deal');
  const actor = ids[auctionTurn(deal)]!;

  assert.deepEqual(postAnnouncement(code, actor, { kind: 'away', minutes: 5 }), { ok: true });
  assert.equal(applyTableAction(code, actor, { type: 'bid', seat: 0, call: 'pass' }).ok, true);
  assert.equal(seatOf(code, actor)?.announcement, null, '出手之后暂离该消失');

  const blocked = postAnnouncement(code, actor, { kind: 'emote', key: 'nice' });
  assert.equal(blocked.ok, false, '删掉消息不该把 2 秒限速一起清零');
  assert.equal(blocked.ok ? undefined : blocked.status, 429);
});

test('限速的窗口跨过离座再入座：座位换回来也不重置', () => {
  const { code, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'emote', key: 'nice' }), { ok: true });
  assert.equal(leaveSeat(code, ids[0]!).ok, true);
  const taken = takeSeat(code, ids[0]!);
  assert.ok('seat' in taken, '再入座失败');

  const blocked = postAnnouncement(code, ids[0]!, { kind: 'emote', key: 'party' });
  assert.equal(blocked.ok, false, '离座再入座不该把 2 秒限速一起带走');
  assert.equal(blocked.ok ? undefined : blocked.status, 429);
});

test('限速台账过期后放行：窗口之内才拒，过了窗口就照常发', () => {
  const { code, tableId, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'emote', key: 'nice' }), { ok: true });
  db.prepare('UPDATE announcement_throttle SET posted_at = ? WHERE table_id = ? AND user_id = ?').run(
    new Date(Date.now() - 3_000).toISOString(),
    tableId,
    ids[0]!
  );
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'emote', key: 'party' }), { ok: true });
});

test('删桌与删人都会带走限速台账（不留孤儿行）', () => {
  const first = fixture();
  assert.deepEqual(postAnnouncement(first.code, first.ids[0]!, { kind: 'emote', key: 'nice' }), {
    ok: true
  });
  assert.equal(deleteTableById(first.tableId), true);
  assert.equal(
    (db
      .prepare('SELECT COUNT(*) AS n FROM announcement_throttle WHERE table_id = ?')
      .get(first.tableId) as { n: number }).n,
    0,
    '删桌之后还留着这一桌的限速行'
  );

  const second = fixture();
  assert.deepEqual(postAnnouncement(second.code, second.ids[1]!, { kind: 'emote', key: 'clap' }), {
    ok: true
  });
  assert.equal(deleteUser(second.ids[1]!, second.ids[0]!).ok, true);
  assert.equal(
    (db
      .prepare('SELECT COUNT(*) AS n FROM announcement_throttle WHERE user_id = ?')
      .get(second.ids[1]!) as { n: number }).n,
    0,
    '删人之后还留着这个人的限速行'
  );
});

test('观战者：坐满的桌再进来的人只能看，不能发（403）', () => {
  const { code } = fixture();
  seq += 1;
  const watcher = human(`桌边观战${seq}`);
  const entered = enterTable(code, watcher.id);
  assert.equal('role' in entered && entered.role, 'spectator');
  const result = postAnnouncement(code, watcher.id, { kind: 'emote', key: 'nice' });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.status, 403);
});

test('暂离：寿命就是所选档位；到点后负载里自然没有它（不需要服务端定时器）', () => {
  const { code, tableId, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'away', minutes: 15 }), { ok: true });
  const away = seatOf(code, ids[0]!)?.announcement;
  assert.equal(away?.kind, 'away');
  assert.equal(away?.body, null);
  assert.ok((away?.remainingMs ?? 0) > 14 * 60_000);
  assert.ok((away?.remainingMs ?? 0) <= 15 * 60_000);

  db.prepare('UPDATE announcements SET expires_at = ? WHERE table_id = ? AND user_id = ?').run(
    new Date(Date.now() - 1_000).toISOString(),
    tableId,
    ids[0]!
  );
  assert.equal(seatOf(code, ids[0]!)?.announcement, null);
});

test('牌局动作：清掉暂离', () => {
  const { code, ids } = fixture();
  // 先发牌，找到第一个该叫牌的人
  const dealt = applyTableAction(code, ids[0]!, { type: 'deal' });
  assert.equal(dealt.ok, true);
  const state = getGameState(getTableByCode(code)!.id);
  const deal = state?.deal ?? null;
  if (deal === null) throw new Error('发牌之后没有 deal');
  const actor = ids[auctionTurn(deal)]!;

  assert.deepEqual(postAnnouncement(code, actor, { kind: 'away', minutes: 5 }), { ok: true });
  const bid = applyTableAction(code, actor, { type: 'bid', seat: 0, call: 'pass' });
  assert.equal(bid.ok, true);

  assert.equal(seatOf(code, actor)?.announcement, null, '出手之后暂离该消失');
});

test('牌局动作不清短句：短句的寿命仍由 TTL 决定', () => {
  const { code, ids } = fixture();
  const dealt = applyTableAction(code, ids[0]!, { type: 'deal' });
  assert.equal(dealt.ok, true);
  const state = getGameState(getTableByCode(code)!.id);
  const deal = state?.deal ?? null;
  if (deal === null) throw new Error('发牌之后没有 deal');
  const actor = ids[auctionTurn(deal)]!;

  assert.deepEqual(postAnnouncement(code, actor, { kind: 'text', text: '好牌' }), { ok: true });
  assert.equal(applyTableAction(code, actor, { type: 'bid', seat: 0, call: 'pass' }).ok, true);
  assert.equal(seatOf(code, actor)?.announcement?.body, '好牌');
});

test('离座：座位空了，消息也一起删（再坐回来不复活）', () => {
  const { code, tableId, ids } = fixture();
  assert.deepEqual(postAnnouncement(code, ids[0]!, { kind: 'text', text: '离开一下' }), { ok: true });
  assert.equal(leaveSeat(code, ids[0]!).ok, true);

  assert.equal(seatOf(code, ids[0]!), null);
  const row: unknown = db
    .prepare('SELECT 1 FROM announcements WHERE table_id = ? AND user_id = ?')
    .get(tableId, ids[0]!);
  assert.equal(row, undefined);
});
