import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 单文件 SQLite（better-sqlite3 的替代：Node 内置 node:sqlite，无原生编译步骤）。
 * 持久化引擎完整状态 JSON + 追加事件表，重启后可无缝续局（见 ADR-0002）。
 */
const dbPath = process.env['SIXTY_DB'] ?? resolve(process.cwd(), 'data/sixty.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0,
  gitee_id TEXT
);
-- Gitee 会话（ADR-0023）：Gitee 身份的令牌永不离开服务器，浏览器持有的是
-- 这张表里的不透明随机 token —— 复制它不等于复制身份（与凭据串是两种东西），
-- 且服务端可撤销（登出即删行）。
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  host_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seats (
  table_id INTEGER NOT NULL REFERENCES tables(id),
  seat INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (table_id, seat),
  UNIQUE (table_id, user_id)
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL UNIQUE REFERENCES tables(id),
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- 观战记录：不是「正在看」，而是「这个人对这张桌表达过不坐座位」（满座到达或主动离座）。
-- 它的唯一作用是让同桌页不再把这位用户自动塞回座位（见 ADR-0007 / role.ts）。
CREATE TABLE IF NOT EXISTS spectators (
  table_id INTEGER NOT NULL REFERENCES tables(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (table_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_spectators_user ON spectators (user_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES tables(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_table ON events (table_id, seq);
-- 机器重演（ADR-0016）：每副结算时同步算好、只读不回写、不再重算。
-- 键是 (table_id, deal_no)；开新对局时 dealNo 从 1 重新计数，所以那张事务里整表清空。
CREATE TABLE IF NOT EXISTS replays (
  table_id INTEGER NOT NULL REFERENCES tables(id),
  deal_no INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (table_id, deal_no)
);
-- 桌边消息（ADR-0028）：一个座位同一时刻至多一条（表情 / 短句 / 暂离），新消息覆盖旧的。
-- 没有历史表：气泡消失之后就不该再找得回来，所以这里只有**最近一条**。
-- expires_at 是绝对时刻，但浏览器永远只收到剩余毫秒（见 shared.ts 的 SeatAnnouncement）；
-- id 每次写入都会换（REPLACE 会删旧行、插新行），客户端据此判断哪条被点掉过。
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES tables(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('emote', 'text', 'away')),
  body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (table_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcements_table ON announcements (table_id);
`);

// 机器人座位（ADR-0015）：老库补列。上面的 CREATE TABLE 只对新建库生效，
// 已有的 users 表要靠探测 + ALTER，否则一升级就崩。
{
  const columns = db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[];
  if (!columns.some((col) => col.name === 'is_bot')) {
    db.exec('ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0');
  }
}

// Gitee 身份（ADR-0023）：老库同样补列。唯一索引放在补列**之后**再建，
// 否则老库（还没有这一列）在启动时就撞「no such column」。
// 部分索引排除 NULL：本地身份与机器人不参与唯一性。
{
  const columns = db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[];
  if (!columns.some((col) => col.name === 'gitee_id')) {
    db.exec('ALTER TABLE users ADD COLUMN gitee_id TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gitee_id ON users (gitee_id) WHERE gitee_id IS NOT NULL');
  // 顺手清扫过期会话：滚动续期只在「有人来」时发生，没人再来的行在这里回收
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

export function now(): string {
  return new Date().toISOString();
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const DB_FILE = dbPath;
