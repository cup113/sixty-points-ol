/**
 * MCP 侧消费的 **wire 形状**：服务器负载里与「角色 / 视图 / 同桌」有关的那部分。
 *
 * 它必须与浏览器拿到的东西**逐字段一致**（`apps/web/src/lib/shared.ts` 的 `StreamPayload`）：
 * 一条负载同时喂浏览器与 MCP，才谈得上「同一条服务器权威路径」。因此：
 *
 * - 视图类型直接取自引擎（`PublicView` / `PlayerSeat`），不复刻第二套；
 * - `apps/web/src/lib/shared.ts` 属于 SvelteKit 的 `$lib` 作用域，packages/mcp 引不到，
 *   所以平台层的那几个 interface 在这里声明一份，由 `scripts/mcp-check.ts` 拿真实响应逐字段核对
 *   （形状守卫）—— 服务器改了形状而这里没跟上，脚本立刻失败，而不是运行时报 undefined。
 */
import type { PlayerSeat, PublicView } from '@sixty/engine';

/** 座位上的玩家 = `player`；不在座位上的人（观战者）= `spectator` */
export type Role = 'player' | 'spectator';

/** 桌边消息的种类（ADR-0028）：表情 / 短句 / 暂离，三者共用一个座位气泡 */
export type AnnouncementKind = 'emote' | 'text' | 'away';

/** 某座位最近一条桌边消息；`body` 对暂离为 null，`remainingMs` 是剩余时间而不是时间戳 */
export interface SeatAnnouncement {
  readonly id: number;
  readonly kind: AnnouncementKind;
  readonly body: string | null;
  readonly remainingMs: number;
}

export interface SeatInfo {
  readonly seat: number;
  readonly userId: number | null;
  readonly name: string | null;
  readonly online: boolean;
  /** 机器人座位（服务器代打的无凭据身份，见 ADR-0015）；`mcp-check` 的形状守卫会逐字段核对 */
  readonly bot: boolean;
  /** 这一座位此刻的桌边消息（表情 / 短句 / 暂离）；没有时为 null */
  readonly announcement: SeatAnnouncement | null;
}

export interface TableView {
  readonly code: string;
  readonly seats: readonly SeatInfo[];
  readonly seatedCount: number;
  readonly ready: boolean;
  /** **实时**观战连接数（不是观战记录数） */
  readonly spectatorCount: number;
  /**
   * 距上一次牌局动作的毫秒数（这一桌还没发过牌为 `null`）。
   * 它是浏览器侧的「距上一步」计时用的，工具面不消费（`project.ts` 的白名单不取它）。
   */
  readonly actionAgeMs: number | null;
  /**
   * 认赢待表决的剩余毫秒（没有进行中的认赢为 `null`）。
   * 与 `actionAgeMs` 同一条口径：传时长不传时刻；工具面不消费它（`turn` 自己给「该不该表态」）。
   */
  readonly claimMsLeft: number | null;
}

/**
 * 一次读取的完整负载，与浏览器同形。
 *
 * - `view` 一律是**公共视图**：观战者能看到的全部内容，没有手牌与底牌；
 * - `you` 是玩家私有那一份（手牌、是否庄家、拿上来的底牌），观战者为 `null`；
 * - 角色由服务端按数据库现算，工具面无法自称玩家。
 */
export interface StreamPayload {
  readonly role: Role;
  readonly view: PublicView | null;
  readonly you: PlayerSeat | null;
  readonly table: TableView;
}

/** GET /api/tables 的一项（与大厅「我的同桌」同形，含我在那张桌的角色） */
export interface TableSummary {
  readonly code: string;
  readonly seated: number;
  readonly role: Role;
}

/**
 * 形状守卫的字段清单：声明与服务器漂移时，mcp-check 按这几张表逐个核对。
 *
 * 同一规矩也适用于 `TableView`：服务器负载**长了字段这里就要显式跟**，
 * 忘了形状守卫立刻红 —— `actionAgeMs`（浏览器的「距上一步」计时）就是这么进来的；
 * `bot`（机器人座位）同理。
 */
export const SEAT_FIELDS: readonly (keyof SeatInfo)[] = [
  'seat',
  'userId',
  'name',
  'online',
  'bot',
  'announcement'
];
export const TABLE_FIELDS: readonly (keyof TableView)[] = [
  'code',
  'seats',
  'seatedCount',
  'ready',
  'spectatorCount',
  'actionAgeMs',
  'claimMsLeft'
];
export const VIEW_FIELDS: readonly (keyof PublicView)[] = [
  'version',
  'status',
  'dealerSeat',
  'dealNo',
  'levels',
  'progress',
  'result',
  'history',
  'deal'
];
/**
 * `PlayerSeat` 是**服务器发过来的原始个人视图**（`/view` 与 SSE 同源），所以引擎给它长字段时，
 * 这张表必须显式跟着长 —— 忘了就会让 `mcp-check` 的形状守卫红，那正是它存在的意义。
 * `buriedKitty`（庄家埋下去的那 3 张，埋底完成后才有值）就是这么来的。
 *
 * 它不是工具面的出参清单：工具面走 `project.ts` 的 `COMPACT_*`（更瘦、另外声明），
 * 两张表不同是有意的，别合并。
 */
export const YOU_FIELDS: readonly (keyof PlayerSeat)[] = [
  'seat',
  'hand',
  'isDeclarer',
  'originalKitty',
  'buriedKitty'
];
