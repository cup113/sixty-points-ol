/**
 * 管理员面（ADR-0024）：环境变量 `SIXTY_ADMIN_GITEE_IDS`（逗号分隔的 gitee id 名单）
 * 里的 Gitee 身份；只读面板 + 三个写操作（强制离座、级联删牌桌、删用户）。
 *
 * 门禁语义：未设置名单 = 功能整体不存在；非管理员（未登录 / 本地身份 / 不在名单）
 * 一律 404 —— 由路由层执行（`isAdminIdentity` 只做判定，不抛）。
 * 本地身份**永远**进不了名单：管理员权限随 Gitee 账号走，而 Gitee 身份的令牌
 * 永不外发（ADR-0023），权限不会随可复制的字符串流出。
 */
import { db, transaction } from './db';
import { broadcast } from './hub';
import { clearTimer } from './bots';
import { leaveSeat } from './tables';
import type { Identity } from './auth';

export function adminGiteeIds(env: Record<string, string | undefined> = process.env): Set<string> {
  const raw = env['SIXTY_ADMIN_GITEE_IDS'] ?? '';
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

/** 管理员判定：必须是绑定了名单内 gitee id 的身份（env 每次现读，改名单即生效） */
export function isAdminIdentity(
  identity: Identity | null,
  env: Record<string, string | undefined> = process.env
): boolean {
  return identity !== null && identity.giteeId !== null && adminGiteeIds(env).has(identity.giteeId);
}

// ---------------------------------------------------------------------------
// 只读装载
// ---------------------------------------------------------------------------

export interface AdminSeatInfo {
  readonly seat: number;
  readonly userId: number;
  readonly name: string;
  readonly bot: boolean;
}

export interface AdminTableInfo {
  readonly id: number;
  readonly code: string;
  readonly createdAt: string;
  readonly hostUserId: number;
  /** 引擎阶段（叫牌/埋底/打牌/结算），没发过牌为 null */
  readonly phase: string | null;
  readonly updatedAt: string | null;
  readonly seats: readonly (AdminSeatInfo | null)[];
}

/** 全部牌桌（新→旧）：座位带名字与机器人标记，阶段来自 games.state JSON */
export function adminTables(): AdminTableInfo[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.code AS code, t.created_at AS created_at, t.host_user_id AS host_user_id,
              g.state AS state, g.updated_at AS updated_at
       FROM tables t LEFT JOIN games g ON g.table_id = t.id
       ORDER BY t.id DESC
       LIMIT 500`
    )
    .all() as unknown as {
    id: number;
    code: string;
    created_at: string;
    host_user_id: number;
    state: string | null;
    updated_at: string | null;
  }[];
  const seatStmt = db.prepare(
    `SELECT s.seat AS seat, s.user_id AS user_id, u.name AS name, u.is_bot AS is_bot
     FROM seats s JOIN users u ON u.id = s.user_id
     WHERE s.table_id = ? ORDER BY s.seat`
  );
  return rows.map((row) => {
    const seats: (AdminSeatInfo | null)[] = [null, null, null];
    for (const seat of seatStmt.all(row.id) as unknown as {
      seat: number;
      user_id: number;
      name: string;
      is_bot: number;
    }[]) {
      seats[seat.seat] = {
        seat: seat.seat,
        userId: seat.user_id,
        name: seat.name,
        bot: seat.is_bot === 1
      };
    }
    let phase: string | null = null;
    if (row.state !== null) {
      try {
        const state = JSON.parse(row.state) as { deal?: { phase?: unknown } | null };
        phase = typeof state.deal?.phase === 'string' ? state.deal.phase : null;
      } catch {
        phase = null;
      }
    }
    return {
      id: row.id,
      code: row.code,
      createdAt: row.created_at,
      hostUserId: row.host_user_id,
      phase,
      updatedAt: row.updated_at,
      seats
    };
  });
}

export interface AdminUserInfo {
  readonly id: number;
  readonly name: string;
  readonly bot: boolean;
  readonly gitee: boolean;
  readonly createdAt: string;
  readonly seatedCount: number;
}

/** 用户列表（新→旧，最近 200 个）：带在座桌数，供删除前判断影响面 */
export function adminUsers(): AdminUserInfo[] {
  const rows = db
    .prepare(
      `SELECT u.id AS id, u.name AS name, u.is_bot AS is_bot, u.gitee_id AS gitee_id, u.created_at AS created_at,
              (SELECT COUNT(*) FROM seats s WHERE s.user_id = u.id) AS seated_count
       FROM users u ORDER BY u.id DESC LIMIT 200`
    )
    .all() as unknown as {
    id: number;
    name: string;
    is_bot: number;
    gitee_id: string | null;
    created_at: string;
    seated_count: number;
  }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    bot: row.is_bot === 1,
    gitee: row.gitee_id !== null,
    createdAt: row.created_at,
    seatedCount: row.seated_count
  }));
}

// ---------------------------------------------------------------------------
// 写操作
// ---------------------------------------------------------------------------

/** 强制离座 = 离座语义（座位空出等补位、本人转观战者）：与在座者自己点「离座」同一条路 */
export function forceLeaveSeat(code: string, userId: number): { ok: boolean; message?: string } {
  const result = leaveSeat(code, userId);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

function deleteTableRows(tableId: number): void {
  db.prepare('DELETE FROM replays WHERE table_id = ?').run(tableId);
  db.prepare('DELETE FROM events WHERE table_id = ?').run(tableId);
  db.prepare('DELETE FROM games WHERE table_id = ?').run(tableId);
  db.prepare('DELETE FROM spectators WHERE table_id = ?').run(tableId);
  db.prepare('DELETE FROM seats WHERE table_id = ?').run(tableId);
  db.prepare('DELETE FROM tables WHERE id = ?').run(tableId);
}

/** 级联删牌桌：五张从表 + 主表一起删。删后广播一次，让活着的 SSE 连接立刻取不到桌而断流。 */
export function deleteTableById(tableId: number): boolean {
  const exists = db.prepare('SELECT 1 FROM tables WHERE id = ?').get(tableId);
  if (exists === undefined) return false;
  const botRows = db
    .prepare(
      `SELECT s.user_id AS user_id FROM seats s JOIN users u ON u.id = s.user_id
       WHERE s.table_id = ? AND u.is_bot = 1`
    )
    .all(tableId) as unknown as { user_id: number }[];
  transaction(() => deleteTableRows(tableId));
  for (const bot of botRows) clearTimer(tableId, bot.user_id);
  broadcast(tableId);
  return true;
}

export interface DeleteUserResult {
  readonly ok: boolean;
  readonly message?: string;
  /** 随用户一起删掉的桌（一座不剩且由他主持） */
  readonly removedTableCodes: readonly string[];
}

/**
 * 删用户（级联删座）：
 * - 他在每张桌的座位行删除 = 强制离座语义（进行中的那副停在空座等补位），逐桌广播；
 *   不写观战记录（人都要删了，观战意愿无意义）；
 * - 他主持的桌**还有人坐** → host 改成最小编号在座者（host 是装饰字段，全库无消费者，
 *   这一步只为满足外键）；**一座不剩** → 整桌级联删（那种桌再也无法开局，留着是死数据）；
 * - 会话（Gitee 登录态）、观战记录、机器人定时器一并清；
 * - 不能删管理员自己当前的身份：会话随删即失效，误触代价太大。
 *
 * 他已连着的 SSE 不会主动掐断：连接在下一帧发现自己不在任何座位上（观战负载），
 * 下一次请求则因会话/凭据消失而 401 —— 与「离座后关页面」的既有口径一致。
 */
export function deleteUser(userId: number, actorId: number): DeleteUserResult {
  if (userId === actorId) return { ok: false, message: '不能删除你自己当前登录的身份', removedTableCodes: [] };
  const user = db.prepare('SELECT id, is_bot FROM users WHERE id = ?').get(userId) as
    | { id: number; is_bot: number }
    | undefined;
  if (user === undefined) return { ok: false, message: '用户不存在', removedTableCodes: [] };

  const seatRows = db
    .prepare('SELECT table_id, seat FROM seats WHERE user_id = ? ORDER BY table_id')
    .all(userId) as unknown as { table_id: number; seat: number }[];
  const hostedRows = db
    .prepare('SELECT id, code FROM tables WHERE host_user_id = ? ORDER BY id')
    .all(userId) as unknown as { id: number; code: string }[];

  const affectedTables = new Set<number>([...seatRows.map((row) => row.table_id), ...hostedRows.map((row) => row.id)]);
  const removedTableCodes: string[] = [];

  transaction(() => {
    for (const row of seatRows) {
      db.prepare('DELETE FROM seats WHERE table_id = ? AND user_id = ?').run(row.table_id, userId);
    }
    // 主持的桌：有人接手 host，或一座不剩则整桌删
    for (const table of hostedRows) {
      const heir = db
        .prepare('SELECT user_id FROM seats WHERE table_id = ? ORDER BY seat LIMIT 1')
        .get(table.id) as { user_id: number } | undefined;
      if (heir !== undefined) {
        db.prepare('UPDATE tables SET host_user_id = ? WHERE id = ?').run(heir.user_id, table.id);
      } else {
        deleteTableRows(table.id);
        removedTableCodes.push(table.code);
      }
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM spectators WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  if (user.is_bot === 1) {
    for (const tableId of affectedTables) clearTimer(tableId, userId);
  }
  for (const tableId of affectedTables) broadcast(tableId);
  return { ok: true, removedTableCodes };
}
