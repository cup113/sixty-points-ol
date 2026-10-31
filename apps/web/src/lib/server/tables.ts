import { randomInt } from 'node:crypto';
import {
  createGame,
  dispatch,
  type Action,
  type BidCall,
  type Card,
  type DealSummary,
  type GameState,
  type Seat
} from '@sixty/engine';
import type { Role, SeatAnnouncement, SeatInfo, StreamPayload, TableView } from '../shared';
import {
  ANNOUNCEMENT_RATE_LIMIT_MS,
  EMOTE_TTL_MS,
  TEXT_TTL_MS,
  isAwayMinutes,
  isEmoteKey,
  messageProblem,
  normalizeMessage,
  type AnnouncementKind,
  type SocialPost
} from '../social';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '../invite';
import { projectionFor, resolveArrivalRole } from '../role';
import { db, now, transaction } from './db';
import { broadcast, connectionUserIds, forget, hasAnyConnection, isRecentlyActive, isUserOnline, touch } from './hub';
import { scheduleBots } from './bots';
import { clearReplays, computeReplay, saveReplay } from './replays';

export interface TableInfo {
  readonly id: number;
  readonly code: string;
  readonly hostUserId: number;
  /** 按座位号排列的 user_id，空座为 null */
  readonly seats: readonly (number | null)[];
}

interface TableRow {
  id: number;
  code: string;
  host_user_id: number;
}

interface SeatRow {
  seat: number;
  user_id: number;
  name: string;
}

const cryptoRng = (): number => randomInt(0, 2 ** 32) / 2 ** 32;
const SEAT_COUNT = 3;

/** 认赢的表决窗口（ADR-0028）：两名对手在这段时间内不表态就算失败 */
export const CLAIM_WINDOW_MS = 30_000;

/**
 * 牌桌动作：引擎动作 + 一种**还没有截止时刻**的认赢。
 *
 * `expiresAt` 只能由服务端给（`Date.now() + CLAIM_WINDOW_MS`）：客户端提交的时间戳
 * 等于让对手自己决定窗口多长。引擎侧的动作仍然要求它（纯函数只存不读）。
 */
export type TableAction =
  | Exclude<Action, { type: 'claim' }>
  | { readonly type: 'claim'; readonly seat: Seat; readonly lastTrick: number };

function makeCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)];
    const exists = db.prepare('SELECT 1 FROM tables WHERE code = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('无法生成邀请码');
}

function readSeats(tableId: number): (number | null)[] {
  const rows = db
    .prepare('SELECT seat, user_id FROM seats WHERE table_id = ? ORDER BY seat')
    .all(tableId) as unknown as { seat: number; user_id: number }[];
  const seats: (number | null)[] = [null, null, null];
  for (const row of rows) seats[row.seat] = row.user_id;
  return seats;
}

function tableFrom(row: TableRow): TableInfo {
  return { id: row.id, code: row.code, hostUserId: row.host_user_id, seats: readSeats(row.id) };
}

function freeSeatOf(table: TableInfo): number {
  return table.seats.findIndex((id) => id === null);
}

export function createTable(userId: number): TableInfo {
  const code = makeCode();
  const info = db
    .prepare('INSERT INTO tables (code, host_user_id, created_at) VALUES (?, ?, ?)')
    .run(code, userId, now());
  const tableId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO seats (table_id, seat, user_id, joined_at) VALUES (?, 0, ?, ?)').run(
    tableId,
    userId,
    now()
  );
  return { id: tableId, code, hostUserId: userId, seats: [userId, null, null] };
}

export function getTableByCode(code: string): TableInfo | null {
  const row = db
    .prepare('SELECT id, code, host_user_id FROM tables WHERE code = ?')
    .get(code.toUpperCase()) as TableRow | undefined;
  return row ? tableFrom(row) : null;
}

/** 按内部 id 取桌（机器人调度器手里只有 tableId，见 bots.ts） */
export function getTableById(id: number): TableInfo | null {
  const row = db
    .prepare('SELECT id, code, host_user_id FROM tables WHERE id = ?')
    .get(id) as TableRow | undefined;
  return row ? tableFrom(row) : null;
}

export interface MyTable {
  readonly code: string;
  readonly seated: number;
  readonly role: Role;
}

/** 大厅列表：我占着座位的桌 + 我在观战的桌（离座后仍然回得去，不必重新找链接） */
export function myTables(userId: number): MyTable[] {
  const rows = db
    .prepare(
      `SELECT t.code AS code,
              (SELECT COUNT(*) FROM seats s2 WHERE s2.table_id = t.id) AS seated,
              (s.user_id IS NOT NULL) AS seated_me
       FROM tables t
       LEFT JOIN seats s ON s.table_id = t.id AND s.user_id = ?
       LEFT JOIN spectators w ON w.table_id = t.id AND w.user_id = ?
       WHERE s.user_id IS NOT NULL OR w.user_id IS NOT NULL
       ORDER BY t.id DESC
       LIMIT 20`
    )
    .all(userId, userId) as unknown as { code: string; seated: number; seated_me: number }[];
  return rows.map((row) => ({
    code: row.code,
    seated: row.seated,
    role: row.seated_me === 1 ? 'player' : 'spectator'
  }));
}

export interface MyTableDetailed {
  readonly code: string;
  readonly role: Role;
  /** 在座玩家名（按座位顺序；空座没有座位行，所以只含已入座的名字） */
  readonly names: string[];
}

/**
 * 大厅「我的牌桌」行的加详版：多带在座玩家名（每桌独占一行，不必点进去看谁在座）。
 * `myTables` 本体是 wire 形状（REST `/api/tables` 与 MCP `list_my_tables` 共用，ADR-0012），
 * 加字段走这个**只给大厅页 load 用**的新函数，不动那份形状。
 */
export function myTablesDetailed(userId: number): MyTableDetailed[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.code AS code,
              (s.user_id IS NOT NULL) AS seated_me
       FROM tables t
       LEFT JOIN seats s ON s.table_id = t.id AND s.user_id = ?
       LEFT JOIN spectators w ON w.table_id = t.id AND w.user_id = ?
       WHERE s.user_id IS NOT NULL OR w.user_id IS NOT NULL
       ORDER BY t.id DESC
       LIMIT 20`
    )
    .all(userId, userId) as unknown as { id: number; code: string; seated_me: number }[];
  const seatNames = db.prepare(
    `SELECT u.name AS name FROM seats s JOIN users u ON u.id = s.user_id
     WHERE s.table_id = ? ORDER BY s.seat`
  );
  return rows.map((row) => ({
    code: row.code,
    role: row.seated_me === 1 ? 'player' : 'spectator',
    names: (seatNames.all(row.id) as unknown as { name: string }[]).map((seat) => seat.name)
  }));
}

export function seatOf(table: TableInfo, userId: number): number | null {
  const index = table.seats.findIndex((id) => id === userId);
  return index === -1 ? null : index;
}

/**
 * 该身份出现在哪些桌（占着座位，或留着观战记录）。
 *
 * 「在线」是**身份级**的判定（`hub` 里按 userId 存），所以一个人刚上线这件事要在他出现的
 * **每一张**桌都推一帧 —— 在 A 桌坐着、拿 B 桌的码轮询的 agent，不该在 A 桌一直显示离线。
 * 不改 `myTables` 的返回形状来做这件事：那份形状有浏览器消费者（等于 wire 形状）。
 */
function tableIdsOf(userId: number): number[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id FROM tables t
       LEFT JOIN seats s ON s.table_id = t.id AND s.user_id = ?
       LEFT JOIN spectators w ON w.table_id = t.id AND w.user_id = ?
       WHERE s.user_id IS NOT NULL OR w.user_id IS NOT NULL`
    )
    .all(userId, userId) as unknown as { id: number }[];
  return rows.map((row) => row.id);
}

/** 这个身份的在场状态变了（刚上线 / 刚断开）：通知他出现的每一张桌 */
export function announcePresence(userId: number): void {
  for (const id of tableIdsOf(userId)) broadcast(id);
}

/**
 * 记一次活跃，并在「离线→在线」翻转时通知各桌。
 *
 * 每个请求都推是不行的（`wait_for_turn` 每 1.5 秒读一次局面），所以这里只认翻转 ——
 * 一个窗口内每个身份至多一次。
 */
function touched(userId: number): void {
  if (touch(userId)) announcePresence(userId);
}

/**
 * 某条 SSE 连接断了之后调用（**必须在注销之后**，见 ADR-0013）。
 *
 * 断线比「最近活跃」更硬：他已经不在了，却因为 60 秒窗口还挂着「在线」——
 * 实测关标签页之后那颗点要 58 秒才变灰。所以这里把窗口作废，让他立刻离线。
 *
 * 唯一的例外是**他还有别的连接**（另一个标签页、另一台设备）：那时他没走，
 * 不该因为关掉一个标签页就在别的桌上闪成离线。
 */
export function connectionClosed(userId: number): void {
  if (hasAnyConnection(userId)) return;
  if (forget(userId)) announcePresence(userId);
}

/** 该身份是否还占着任何一张桌的座位（改名/换身份的前提，见 ADR-0009） */
export function seatedTableCode(userId: number): string | null {
  const row = db
    .prepare(
      `SELECT t.code AS code FROM seats s JOIN tables t ON t.id = s.table_id
       WHERE s.user_id = ? LIMIT 1`
    )
    .get(userId) as { code: string } | undefined;
  return row?.code ?? null;
}

export function watchingOf(tableId: number, userId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM spectators WHERE table_id = ? AND user_id = ?')
    .get(tableId, userId);
  return row !== undefined;
}

export function addWatcher(tableId: number, userId: number): void {
  db.prepare('INSERT OR IGNORE INTO spectators (table_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    tableId,
    userId,
    now()
  );
}

export type EnterResult =
  | { readonly role: 'player'; readonly table: TableInfo; readonly seat: number; readonly inherited: boolean }
  | { readonly role: 'spectator'; readonly table: TableInfo }
  | { readonly error: string };

/**
 * 此刻是否有一副正在进行（结算前）。
 *
 * 入座时它为真 ⇒ 你接下的是**别人的牌局进度**（该座位的手牌与级别），需要告知一声：
 * 否则新来的人会莫名其妙拿着一手陌生的牌、还不知道轮到自己要出什么。
 */
function dealInProgress(tableId: number): boolean {
  const state = getGameState(tableId);
  return state !== null && state.deal !== null && state.deal.phase !== 'scored';
}

/**
 * 到达一张同桌（点邀请码/邀请链接、或大厅「加入」）：
 * 已在座 → 玩家；有观战记录 → 观战（刷新不会被自动塞回座位）；有空座 → 自动入座；满座 → 观战。
 * 规则本身在 `resolveArrivalRole` 里，有单测；这里只做数据库动作。
 *
 * **变更之后要广播**（见 ADR-0012）：浏览器玩家随后必然连上 SSE，而 `stream` 在连接时会广播一次，
 * 于是「入座」过去总是顺带把别人的屏幕刷新了 —— 那个隐含前提对 MCP 座位不成立（它没有 SSE），
 * 所以人类屏幕上会一直显示「还差 1 人」、按钮一直是灰的，直到有人先出一次牌。
 */
export function enterTable(code: string, userId: number): EnterResult {
  const table = getTableByCode(code);
  if (table === null) return { error: '牌桌不存在' };
  const seat = seatOf(table, userId);
  // 已经在座：什么都没变，不广播（重复 join_table 不该产生帧）
  if (seat !== null) return { role: 'player', table, seat, inherited: false };

  const freeSeats = table.seats.filter((id) => id === null).length;
  const watching = watchingOf(table.id, userId);
  const role = resolveArrivalRole({ seated: false, watching, freeSeats });
  if (role === 'player') {
    const free = freeSeatOf(table);
    db.prepare('INSERT INTO seats (table_id, seat, user_id, joined_at) VALUES (?, ?, ?, ?)').run(
      table.id,
      free,
      userId,
      now()
    );
    broadcast(table.id);
    return { role: 'player', table: getTableByCode(code)!, seat: free, inherited: dealInProgress(table.id) };
  }

  addWatcher(table.id, userId);
  // 观战记录已经在了就连记录都没变，没必要推
  if (!watching) broadcast(table.id);
  return { role: 'spectator', table };
}

export type ActionResult = { ok: true } | { ok: false; message: string };

/** 离座：座位空出，本人转为观战者（写完观战记录后刷新也不会被自动塞回座位） */
export function leaveSeat(code: string, userId: number): ActionResult {
  const table = getTableByCode(code);
  if (table === null) return { ok: false, message: '牌桌不存在' };
  if (seatOf(table, userId) === null) {
    // 幂等：本来就没在座，只确保观战意愿记下（按钮双击/重试不该报错）
    const watching = watchingOf(table.id, userId);
    addWatcher(table.id, userId);
    if (!watching) broadcast(table.id);
    return { ok: true };
  }
  transaction(() => {
    db.prepare('DELETE FROM seats WHERE table_id = ? AND user_id = ?').run(table.id, userId);
    // 离座就带走自己的桌边消息：座位空了，气泡没有可挂的地方；再坐回来也不该复活
    db.prepare('DELETE FROM announcements WHERE table_id = ? AND user_id = ?').run(table.id, userId);
    db.prepare('INSERT OR IGNORE INTO spectators (table_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      table.id,
      userId,
      now()
    );
  });
  broadcast(table.id);
  return { ok: true };
}

/** 入座（观战者的「入座」按钮，也是大厅进入满座桌后的补位入口） */
export function takeSeat(
  code: string,
  userId: number
): { seat: number; inherited: boolean } | { error: string } {
  const table = getTableByCode(code);
  if (table === null) return { error: '牌桌不存在' };
  const existing = seatOf(table, userId);
  // 已经在座：幂等，没有变化
  if (existing !== null) return { seat: existing, inherited: false };
  const free = freeSeatOf(table);
  if (free === -1) return { error: `座位已满（${SEAT_COUNT} 人），等有人离座` };
  const result = transaction(() => {
    db.prepare('DELETE FROM spectators WHERE table_id = ? AND user_id = ?').run(table.id, userId);
    db.prepare('INSERT INTO seats (table_id, seat, user_id, joined_at) VALUES (?, ?, ?, ?)').run(
      table.id,
      free,
      userId,
      now()
    );
    return { seat: free, inherited: dealInProgress(table.id) };
  });
  broadcast(table.id);
  return result;
}

/**
 * 距**上一次牌局动作**的毫秒数；这一桌还没发过牌时为 `null`。
 *
 * 来源是 `games.updated_at`：它由 `saveGame` 在每次动作的**同一个事务**里写入（唯一调用点），
 * 所以它就是「上个动作」的时刻。入座/离座不写这张表 ⇒ 换人不重置计时。
 * 传年龄而不是时间戳：浏览器不必相信自己的钟（见 CONTEXT.md 的「计时」）。
 */
function actionAgeMs(tableId: number): number | null {
  const row = db.prepare('SELECT updated_at FROM games WHERE table_id = ?').get(tableId) as
    | { updated_at: string }
    | undefined;
  if (row === undefined) return null;
  const at = Date.parse(row.updated_at);
  return Number.isFinite(at) ? Math.max(0, Date.now() - at) : null;
}

/**
 * 座位行 + 该座位最近一条桌边消息（没有就是四个 NULL）。
 *
 * 消息在**同一条查询**里 LEFT JOIN 出来：每一帧 SSE 都要重算 `tableView`，
 * 再为三个座位各查一次消息表是纯多出来的往返。
 */
type SeatRowWithAnnouncement = SeatRow & {
  is_bot: number;
  ann_id: number | null;
  ann_kind: string | null;
  ann_body: string | null;
  ann_expires: string | null;
};

/**
 * 数据库里的那一行 → 负载里的那一条；过期、脏数据、未知种类一律当作没有消息。
 *
 * `remainingMs` 由服务端算，浏览器只负责本地倒数 —— 与「距上一步」计时同一条纪律：
 * 时钟不跨端比较，且过期不需要服务端定时器（下一次读负载时自然就没了）。
 */
function announcementOf(row: SeatRowWithAnnouncement, nowMs: number): SeatAnnouncement | null {
  const { ann_id: id, ann_kind: kind, ann_body: body, ann_expires: expires } = row;
  if (id === null || kind === null || expires === null) return null;
  if (kind !== 'emote' && kind !== 'text' && kind !== 'away') return null;
  if (kind === 'emote' && !isEmoteKey(body)) return null;
  if (kind === 'text' && (body === null || body.length === 0)) return null;
  const remainingMs = Date.parse(expires) - nowMs;
  if (!(remainingMs > 0)) return null;
  return { id, kind, body, remainingMs };
}

/**
 * 桌面信息；`claimMsLeft` 由 `viewFor` 现算（它要读牌局状态，这里只读桌子），
 * 桌边消息则在这里按座拼进来（同一条查询带出来，每帧都要重算）。
 */
export function tableView(table: TableInfo): Omit<TableView, 'claimMsLeft'> {
  const rows = db
    .prepare(
      `SELECT s.seat AS seat, s.user_id AS user_id, u.name AS name, u.is_bot AS is_bot,
              a.id AS ann_id, a.kind AS ann_kind, a.body AS ann_body, a.expires_at AS ann_expires
       FROM seats s JOIN users u ON u.id = s.user_id
       LEFT JOIN announcements a ON a.table_id = s.table_id AND a.user_id = s.user_id
       WHERE s.table_id = ? ORDER BY s.seat`
    )
    .all(table.id) as unknown as SeatRowWithAnnouncement[];
  const bySeat = new Map<number, SeatRowWithAnnouncement>();
  for (const row of rows) bySeat.set(row.seat, row);
  const nowMs = Date.now();
  const seats: SeatInfo[] = [0, 1, 2].map((seat) => {
    const row = bySeat.get(seat);
    return {
      seat,
      userId: row?.user_id ?? null,
      name: row?.name ?? null,
      // 「在线」= 有 SSE 订阅，或最近有请求（MCP 侧没有 SSE，只能靠请求说话，见 hub.ts）；
      // 机器人的请求就是它出的每一手牌 —— 打牌时亮、停手一个窗口后转灰，如实
      online: row ? isUserOnline(table.id, row.user_id) || isRecentlyActive(row.user_id) : false,
      bot: row ? row.is_bot === 1 : false,
      announcement: row ? announcementOf(row, nowMs) : null
    };
  });
  const seatedCount = seats.filter((s) => s.userId !== null).length;
  // 「N 人观战」= 连着的 SSE 里不属于任何座位的**不同身份**数（实时口径，不是 spectators 记录数）
  const seatedIds = new Set(table.seats.filter((id): id is number => id !== null));
  const spectators = new Set(connectionUserIds(table.id).filter((id) => !seatedIds.has(id)));
  return {
    code: table.code,
    seats,
    seatedCount,
    ready: seatedCount === SEAT_COUNT,
    spectatorCount: spectators.size,
    actionAgeMs: actionAgeMs(table.id)
  };
}

export function getGameState(tableId: number): GameState | null {
  const row = db.prepare('SELECT state FROM games WHERE table_id = ?').get(tableId) as
    | { state: string }
    | undefined;
  if (row === undefined) return null;
  const state = JSON.parse(row.state) as GameState;
  // 老库补字段（ADR-0028）：认赢上线的牌局里没有 `claim` / `summary.claim`，
  // 缺了它 `deal.claim.status` 会在第一帧就抛 —— 升级不该把正在打的桌打停。
  if (state.deal !== null && state.deal.claim === undefined) state.deal.claim = null;
  for (const summary of state.history) {
    if (summary.claim === undefined) (summary as { claim: DealSummary['claim'] }).claim = null;
  }
  if (state.deal?.summary != null && state.deal.summary.claim === undefined) {
    (state.deal.summary as { claim: DealSummary['claim'] }).claim = null;
  }
  return state;
}

function saveGame(tableId: number, state: GameState): void {
  db.prepare(
    `INSERT INTO games (table_id, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(table_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
  ).run(tableId, JSON.stringify(state), now());
}

function appendEvents(tableId: number, events: readonly { type: string }[]): void {
  if (events.length === 0) return;
  const maxRow = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE table_id = ?').get(
    tableId
  ) as { seq: number };
  let seq = maxRow.seq;
  const stmt = db.prepare(
    'INSERT INTO events (table_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const event of events) {
    seq += 1;
    stmt.run(tableId, seq, event.type, JSON.stringify(event), now());
  }
}

/**
 * 该用户此刻该收到的完整负载：角色、公共/个人视图、自己那份手牌、桌面信息。
 * 角色每次按数据库现算，绝不接受客户端传入（观战者无法自称玩家）。
 *
 * **纯读**：不记「最近活跃」、不广播 —— 机器人调度器用它判断轮次（它没发请求，
 * 不该因为被调度看了一眼就亮在线灯），人来的请求才走 `payloadFor` 记一笔。
 */
export function viewFor(table: TableInfo, userId: number): StreamPayload {
  const seat = seatOf(table, userId);
  const state = getGameState(table.id);
  return {
    ...projectionFor(state, seat === null ? null : (seat as Seat)),
    table: { ...tableView(table), claimMsLeft: claimMsLeftOf(state) }
  };
}

/** 认赢还剩多少毫秒（没有进行中的认赢为 null）；传时长而不是截止时刻，见 `TableView` */
function claimMsLeftOf(state: GameState | null): number | null {
  const claim = state?.deal?.claim ?? null;
  if (claim === null || claim.status !== 'pending') return null;
  return Math.max(0, claim.expiresAt - Date.now());
}

/** 人来的读取（view 路由 / SSE 首帧）：记一笔「最近活跃」再给负载（见 ADR-0010） */
export function payloadFor(table: TableInfo, userId: number): StreamPayload {
  // 读到自己的负载就算「最近活跃」：MCP 侧没有 SSE，靠这个让座位卡不显示假离线（见 ADR-0010）。
  // 翻转时顺手广播：别人的屏幕上那颗点该变绿了 —— 不然它要等到下一次动作才更新（见 ADR-0012）。
  touched(userId);
  return viewFor(table, userId);
}

export type SocialResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly status?: number };

/**
 * 发一条桌边消息（表情 / 短句 / 暂离）：一个座位只留**最近一条**，新消息覆盖旧消息。
 *
 * 三条边界都在服务端：
 * - **在座才能发**：观战者没有座位卡可挂，也不该往别人的桌上灌消息；
 * - **2 秒一条**：消息会广播给全桌，刷屏的成本不该由别人承担；
 * - **暂离只是一条带寿命的消息**：到点自然过期，牌局动作会提前把它删掉（见 `applyTableAction`）。
 *
 * 不做幂等键：重发在语义上就是「再说一条」，与 `claim` 那类不可核对的动作不同。
 */
export function postAnnouncement(code: string, userId: number, post: SocialPost): SocialResult {
  const table = getTableByCode(code);
  if (table === null) return { ok: false, message: '牌桌不存在' };
  if (seatOf(table, userId) === null) {
    return { ok: false, status: 403, message: '你在观战，入座后才能发消息' };
  }

  const at = Date.now();
  // 限速读的是**独立的台账**，不是消息行：暂离被一次牌局动作删掉、或离座后再入座，
  // 都不该把「2 秒一条」一起清零 —— 窗口属于人，不属于那条消息（ADR-0028 §7）。
  const last = db
    .prepare('SELECT posted_at FROM announcement_throttle WHERE table_id = ? AND user_id = ?')
    .get(table.id, userId) as { posted_at: string } | undefined;
  if (last !== undefined && at - Date.parse(last.posted_at) < ANNOUNCEMENT_RATE_LIMIT_MS) {
    return { ok: false, status: 429, message: '发得太快了，歇一下' };
  }

  let kind: AnnouncementKind;
  let body: string | null = null;
  let ttlMs: number;
  if (post.kind === 'emote') {
    if (!isEmoteKey(post.key)) return { ok: false, message: '不认识这个表情' };
    kind = 'emote';
    body = post.key;
    ttlMs = EMOTE_TTL_MS;
  } else if (post.kind === 'text') {
    const problem = messageProblem(post.text);
    if (problem !== null) return { ok: false, message: problem };
    kind = 'text';
    body = normalizeMessage(post.text);
    ttlMs = TEXT_TTL_MS;
  } else {
    if (!isAwayMinutes(post.minutes)) return { ok: false, message: '暂离时长不在档位里' };
    kind = 'away';
    ttlMs = post.minutes * 60_000;
  }

  // REPLACE 撞 (table_id, user_id) 的唯一键：旧行删掉、新行拿到一个新 id ——
  // 客户端靠这个 id 区分「同一条」与「新的一条」（点掉过的旧气泡不该压住新消息）。
  // 限速台账与消息同事务写：消息落库成功才算「发过一次」，失败不该吃掉下一条的窗口。
  transaction(() => {
    db.prepare(
      `REPLACE INTO announcements (table_id, user_id, kind, body, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      table.id,
      userId,
      kind,
      body,
      new Date(at).toISOString(),
      new Date(at + ttlMs).toISOString()
    );
    db.prepare(
      'REPLACE INTO announcement_throttle (table_id, user_id, posted_at) VALUES (?, ?, ?)'
    ).run(table.id, userId, new Date(at).toISOString());
  });
  broadcast(table.id);
  return { ok: true };
}

/** 服务器权威地执行一个动作：座位号一律由服务端根据身份推导（见 ADR-0002） */
export function applyTableAction(code: string, userId: number, action: TableAction): ActionResult {
  const table = getTableByCode(code);
  if (table === null) return { ok: false, message: '牌桌不存在' };
  const seat = seatOf(table, userId);
  // 一次动作也是「最近活跃」：失败的动作同样说明这个人此刻在场（见 ADR-0010）
  touched(userId);
  if (seat === null) return { ok: false, message: '你在观战，入座后才能操作' };

  const seated = table.seats.filter((id) => id !== null).length;
  let state = getGameState(table.id);

  // 发牌与开新对局都要求三人到齐：座位可能被离座腾空，不能只在首副校验
  if (action.type === 'deal' || action.type === 'newGame') {
    if (seated < SEAT_COUNT) return { ok: false, message: `还差 ${SEAT_COUNT - seated} 人才能开始` };
  }

  if (state === null) {
    if (action.type !== 'deal') return { ok: false, message: '三人到齐后由任意一人发牌' };
    state = createGame(randomInt(0, SEAT_COUNT) as Seat);
  }

  const serverAction: Action =
    action.type === 'claim'
      ? { ...action, seat: seat as Seat, expiresAt: Date.now() + CLAIM_WINDOW_MS }
      : action.type === 'bid' || action.type === 'bury' || action.type === 'play' || action.type === 'claimAnswer'
        ? { ...action, seat: seat as Seat }
        : action;

  const result = dispatch(state, serverAction, cryptoRng);
  if (!result.ok) return { ok: false, message: result.message };

  // 结算那一刻同步算机器重演（ADR-0016）：此刻 `deal` 里还留着这副的全部隐藏信息，
  // 下一副发牌就没了。纯 CPU、毫秒级；失败只缺一条重演记录，结算本身不受影响。
  const replay = result.events.some((event) => event.type === 'dealScored')
    ? computeReplay(result.state)
    : null;

  transaction(() => {
    saveGame(table.id, result.state);
    appendEvents(table.id, result.events);
    if (replay !== null) saveReplay(table.id, replay);
    // 开新对局：dealNo 从 1 重新计数，旧重演必须整表清掉（见 db.ts 的表注释）
    if (action.type === 'newGame') clearReplays(table.id);
    // 牌局动作是「我回来了」最硬的证据：暂离消息在出手那一刻消失。
    // 只删 away —— 短句与表情照旧活到自己的 TTL，别让下一次出手把刚说的话吞掉。
    db.prepare("DELETE FROM announcements WHERE table_id = ? AND user_id = ? AND kind = 'away'").run(
      table.id,
      userId
    );
  });
  broadcast(table.id);
  // 状态变了，轮到机器人的话让它想（见 bots.ts / ADR-0015）。
  // 放在 broadcast 之后：机器人动作会再次广播，链式推进到人类回合为止。
  scheduleBots(table.id);
  // 认赢的窗口同理：这一步若开了/结了认赢，定时器要跟着重排（见下方）
  scheduleClaimTimeout(table.id, result.state);
  return { ok: true };
}

export function isCardShape(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as { suit?: unknown; rank?: unknown; joker?: unknown };
  if (card.joker === 'small' || card.joker === 'big') return true;
  return (
    (card.suit === 'C' || card.suit === 'D' || card.suit === 'H' || card.suit === 'S') &&
    typeof card.rank === 'number' &&
    Number.isInteger(card.rank) &&
    card.rank >= 2 &&
    card.rank <= 14
  );
}

export function isCallShape(value: unknown): value is BidCall {
  if (value === 'pass') return true;
  if (typeof value !== 'object' || value === null) return false;
  const call = value as { points?: unknown; strain?: unknown };
  return (
    typeof call.points === 'number' &&
    Number.isInteger(call.points) &&
    (call.strain === 'C' || call.strain === 'D' || call.strain === 'H' || call.strain === 'S' || call.strain === 'NT')
  );
}

// ---------------------------------------------------------------------------
// 认赢的 30 秒窗口（ADR-0028）：定时器只在进程内（单实例，同 ADR-0001），启动时补扫
// ---------------------------------------------------------------------------

const claimTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** 测试用：丢掉进程内的认赢定时器（等价于「重启后什么都没排」） */
export function forgetClaimTimers(): void {
  for (const timer of claimTimers.values()) clearTimeout(timer);
  claimTimers.clear();
}

/** 是否有在途的认赢定时器（测试用） */
export function claimTimersIdle(): boolean {
  return claimTimers.size === 0;
}

/**
 * 每次状态变更后调用：**待表决**的认赢排一个到点定时器，其余情况清掉。
 *
 * 与 `scheduleBots` 同一条形状：幂等、不依赖内存队列存活；重启由 `initClaims` 补扫。
 * 到点不等人 —— 谁都没投的认赢按失败处理（fail-closed）。
 */
export function scheduleClaimTimeout(tableId: number, state: GameState | null): void {
  const existing = claimTimers.get(tableId);
  if (existing !== undefined) {
    clearTimeout(existing);
    claimTimers.delete(tableId);
  }
  const claim = state?.deal?.claim ?? null;
  if (claim === null || claim.status !== 'pending') return;
  const delay = claim.expiresAt - Date.now();
  const safe = Number.isFinite(delay) ? Math.max(0, delay) : 0;
  claimTimers.set(
    tableId,
    setTimeout(() => expireClaim(tableId), safe)
  );
}

/** 到点：认赢没有集齐两张「认输」票，按失败结算；这一步不需要任何人的身份 */
function expireClaim(tableId: number): void {
  claimTimers.delete(tableId);
  const table = getTableById(tableId);
  if (table === null) return;
  const state = getGameState(table.id);
  if (state?.deal?.claim?.status !== 'pending') return;
  const result = dispatch(state, { type: 'claimTimeout' }, cryptoRng);
  if (!result.ok) return;
  transaction(() => {
    saveGame(table.id, result.state);
    appendEvents(table.id, result.events);
  });
  broadcast(table.id);
  scheduleBots(table.id);
}

/** 服务启动时补扫：重启前挂着的认赢窗口自动续上（已经超时的立刻判失败） */
export function initClaims(): void {
  const rows = db.prepare('SELECT table_id FROM games').all() as unknown as { table_id: number }[];
  for (const row of rows) scheduleClaimTimeout(row.table_id, getGameState(row.table_id));
}
