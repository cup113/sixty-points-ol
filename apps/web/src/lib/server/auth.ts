import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { db, now } from './db';

export const CREDENTIAL_COOKIE = 'sixty_cred';
/** Gitee 身份的会话 cookie（ADR-0023）：值是 sessions 表里的随机 token，不是凭据串 */
export const SESSION_COOKIE = 'sixty_session';
const NAME_MAX = 12;
/** Gitee 会话有效期：30 天滚动（重登一键完成，比凭据串的 365 天窗口小） */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Identity {
  readonly id: number;
  readonly name: string;
  readonly token: string;
  /** 非空 = Gitee 身份：令牌永不外发，也没有凭据串这回事（ADR-0023） */
  readonly giteeId: string | null;
}

interface UserRow {
  id: number;
  name: string;
  token: string;
  gitee_id: string | null;
}

function rowToIdentity(row: UserRow): Identity {
  return { id: row.id, name: row.name, token: row.token, giteeId: row.gitee_id };
}

const SELECT_USER = 'SELECT id, name, token, gitee_id FROM users';

/** 凭据串 = base64url(名字:令牌)，可复制粘贴跨浏览器（见 ADR-0003）。
 *  **只许对本地身份调用**：对 Gitee 身份它也能编出一串有效的 `名字:令牌`——
 *  那正是「令牌永不外发」要堵的口子，Gitee 身份的任何响应都不该出现它的输出。 */
export function credentialOf(user: Identity): string {
  return Buffer.from(`${user.name}:${user.token}`, 'utf8').toString('base64url');
}

export function parseCredential(credential: string): { name: string; token: string } | null {
  try {
    const raw = Buffer.from(credential.trim(), 'base64url').toString('utf8');
    const sep = raw.indexOf(':');
    if (sep <= 0 || sep === raw.length - 1) return null;
    return { name: raw.slice(0, sep), token: raw.slice(sep + 1) };
  } catch {
    return null;
  }
}

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length === 0 || name.length > NAME_MAX) return null;
  if (name.includes(':')) return null;
  return name;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 按名字查身份：**含机器人**（名字全局唯一，注册/改名的撞名检查必须把它们算进去）。
 */
export function findByName(name: string): Identity | null {
  const row = db.prepare(`${SELECT_USER} WHERE name = ?`).get(name) as UserRow | undefined;
  return row ? rowToIdentity(row) : null;
}

/** 按名字查**可登录**的身份：机器人行被排除（ADR-0015 —— 机器人没有凭据串，也不许有） */
function findAuthByName(name: string): Identity | null {
  const row = db.prepare(`${SELECT_USER} WHERE name = ? AND is_bot = 0`).get(name) as
    | UserRow
    | undefined;
  return row ? rowToIdentity(row) : null;
}

/**
 * 注册新身份；**名字已被占用时返回 null**（不返回那条身份）。
 *
 * 曾经这里对已存在的名字直接返回既有身份，于是「输入别人的名字」就等于登入别人，
 * 拿到的正是对方座位上的手牌。名字唯一 + 令牌才是凭证（ADR-0003 / ADR-0009）。
 */
export function createIdentity(name: string): Identity | null {
  if (findByName(name) !== null) return null;
  const token = randomBytes(24).toString('base64url');
  const info = db
    .prepare('INSERT INTO users (name, token, created_at) VALUES (?, ?, ?)')
    .run(name, token, now());
  return { id: Number(info.lastInsertRowid), name, token, giteeId: null };
}

export function findByCredential(credential: string): Identity | null {
  const parsed = parseCredential(credential);
  if (parsed === null) return null;
  // 机器人行在此被排除：就算拿到了它的令牌也登不进来（防御纵深，令牌本就不外发）
  const row = findAuthByName(parsed.name);
  if (!row) return null;
  return safeEqual(row.token, parsed.token) ? row : null;
}

export function findByToken(token: string): Identity | null {
  const row = db.prepare(`${SELECT_USER} WHERE token = ? AND is_bot = 0`).get(token) as
    | UserRow
    | undefined;
  return row ? rowToIdentity(row) : null;
}

// ---------------------------------------------------------------------------
// Gitee 身份（ADR-0023）：键是 gitee id（唯一），站内名从 login 派生；
// 令牌照旧随机生成存库，但**任何响应都不外发** —— 不签发凭据串。
// ---------------------------------------------------------------------------

export function findByGiteeId(giteeId: string): Identity | null {
  const row = db.prepare(`${SELECT_USER} WHERE gitee_id = ?`).get(giteeId) as
    | UserRow
    | undefined;
  return row ? rowToIdentity(row) : null;
}

/**
 * 站内名派生：login 截到 `NAME_MAX`；撞名（本地身份、机器人、别的 Gitee 身份都算）
 * 加 `-2`/`-3`… 后缀，整体仍塞进 `NAME_MAX`；`-99` 仍撞就放弃（调用方回错误）。
 */
function deriveGiteeName(login: string): string | null {
  const base = login.slice(0, NAME_MAX);
  if (normalizeName(base) !== null && findByName(base) === null) return base;
  for (let n = 2; n < 100; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, NAME_MAX - suffix.length) + suffix;
    if (normalizeName(candidate) !== null && findByName(candidate) === null) return candidate;
  }
  return null;
}

/**
 * 首次 Gitee 登录建身份（已存在则直接返回那条）：绝不合并进同名本地身份 ——
 * 那会重新打开「输入别人的名字等于接管他」的口子（ADR-0009 的教训）。
 * 并发首登撞 `gitee_id` 唯一索引时，退回按 gitee id 重查。
 */
export function createGiteeIdentity(giteeId: string, login: string): Identity | null {
  const existing = findByGiteeId(giteeId);
  if (existing !== null) return existing;
  const name = deriveGiteeName(login);
  if (name === null) return null;
  const token = randomBytes(24).toString('base64url');
  try {
    const info = db
      .prepare('INSERT INTO users (name, token, created_at, gitee_id) VALUES (?, ?, ?, ?)')
      .run(name, token, now(), giteeId);
    return { id: Number(info.lastInsertRowid), name, token, giteeId };
  } catch {
    return findByGiteeId(giteeId);
  }
}

// ---------------------------------------------------------------------------
// 会话：Gitee 身份唯一的浏览器持有物（ADR-0023）。
// cookie 里是这张表的随机 token；复制它 ≠ 复制身份（无凭据串可签发），
// 服务端可撤销（登出/管理员删用户 = 删行）。
// ---------------------------------------------------------------------------

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, now(), new Date(Date.now() + SESSION_TTL_MS).toISOString());
  return token;
}

/** 会话查身份：过期行顺手删；命中滚动续期（每次使用都把窗口往后推）。机器人不可有会话。 */
export function findBySessionToken(token: string): Identity | null {
  const row = db
    .prepare(
      `SELECT s.expires_at AS expires_at, u.id AS id, u.name AS name, u.token AS token, u.gitee_id AS gitee_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.is_bot = 0`
    )
    .get(token) as (UserRow & { expires_at: string }) | undefined;
  if (row === undefined) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(
    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    token
  );
  return rowToIdentity(row);
}

/** 撤销一个会话（登出用）：删行即失效，返回是否真的删掉了 */
export function revokeSession(token: string): boolean {
  return db.prepare('DELETE FROM sessions WHERE token = ?').run(token).changes > 0;
}

export function rename(identity: Identity, name: string): Identity {
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, identity.id);
  return { ...identity, name };
}

export function setCredentialCookie(cookies: Cookies, credential: string): void {
  cookies.set(CREDENTIAL_COOKIE, credential, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  });
}

export function setSessionCookie(cookies: Cookies, sessionToken: string): void {
  cookies.set(SESSION_COOKIE, sessionToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
}

export function clearCredentialCookie(cookies: Cookies): void {
  cookies.delete(CREDENTIAL_COOKIE, { path: '/' });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** 身份来源：凭据 cookie 优先，其次会话 cookie，最后 `Authorization: Bearer <凭据串>`。
 *  凭据与会话在写入点互斥（Gitee 回调清凭据 cookie、claim 导入清会话 cookie），
 *  但历史浏览器可能两样都留着，这里固定凭据优先，保证本地身份行为不变。 */
export function identityFrom(event: Pick<RequestEvent, 'cookies' | 'request'>): Identity | null {
  const cookie = event.cookies.get(CREDENTIAL_COOKIE);
  if (cookie) {
    const found = findByCredential(cookie);
    if (found) return found;
  }
  const session = event.cookies.get(SESSION_COOKIE);
  if (session) {
    const found = findBySessionToken(session);
    if (found) return found;
  }
  const header = event.request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const found = findByCredential(header.slice(7).trim());
    if (found) return found;
  }
  return null;
}

/**
 * **只认凭据串**的身份解析（凭据 cookie + Bearer，不看会话 cookie）。
 *
 * 唯一消费者是 `/api/mcp`：Gitee 身份拿不到凭据串，也就进不了 MCP（ADR-0023 的
 * 有意边界）—— 浏览器里带着会话 cookie 撞 `/api/mcp` 不算「配了凭据」，
 * 按无身份会话处理，而不是让会话 cookie 变成第二根 MCP 凭据。
 */
export function identityFromCredentialOnly(
  event: Pick<RequestEvent, 'cookies' | 'request'>
): Identity | null {
  const cookie = event.cookies.get(CREDENTIAL_COOKIE);
  if (cookie) {
    const found = findByCredential(cookie);
    if (found) return found;
  }
  const header = event.request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const found = findByCredential(header.slice(7).trim());
    if (found) return found;
  }
  return null;
}

export function requireIdentity(event: Pick<RequestEvent, 'cookies' | 'request'>): Identity {
  const identity = identityFrom(event);
  if (identity === null) error(401, '需要身份：请先创建或导入凭据');
  return identity;
}

/**
 * 这个请求有没有**尝试带凭据**（凭据 cookie 或 `Authorization: Bearer`，非空）。
 * 会话 cookie **不算**：MCP 的鉴权面只有凭据串（见 `identityFromCredentialOnly`），
 * 带着会话 cookie 的浏览器请求按「没带凭据」处理。
 *
 * 用途只有一个：把「**没带**凭据」与「带了但**无效**」分开。
 * `/api/mcp` 允许前者（无身份会话：只有 read_rules 与 claim，见 ADR-0014），
 * 但后者必须 401 —— 静默降级成匿名会让「凭据串粘错/已失效」看起来像「权限突然全没了」。
 * 有效性判定仍然只在 `identityFromCredentialOnly` 里（此处只看有没有带）。
 */
export function credentialPresent(event: Pick<RequestEvent, 'cookies' | 'request'>): boolean {
  const cookie = event.cookies.get(CREDENTIAL_COOKIE);
  if (cookie !== undefined && cookie.trim().length > 0) return true;
  const header = event.request.headers.get('authorization');
  if (header === null || !header.toLowerCase().startsWith('bearer ')) return false;
  return header.slice(7).trim().length > 0;
}
