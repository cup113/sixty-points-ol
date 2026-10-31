import type { PersonalView, PublicView } from '@sixty/engine';
import type { AnnouncementKind } from './social';

/** 观众角色：座位上的人和不在座位上的人（见 CONTEXT.md「观战者」） */
export type Role = 'player' | 'spectator';

/**
 * 一桌至多 2 个机器人（ADR-0015）：至少留一个人类座位，否则没人能按「开下一副」
 * （机器人从不发起 `deal` / `newGame`）。放在 shared 里是因为界面也要用同一份上限。
 */
export const BOT_LIMIT = 2;

/** 玩家独有的一份信息：观战者为 null。类型取自引擎的个人视图，避免两处各写一遍 */
export type PlayerHand = PersonalView['you'];

/**
 * 某座位此刻那**一条**桌边消息（表情 / 短句 / 暂离）。
 *
 * 为什么只留一条：气泡只有一处落点，它挂在座位卡上而不是一条独立的聊天栏里；
 * 新消息覆盖旧消息，刷新不会补历史（ADR-0028）。`body` 对暂离为 null ——
 * 暂离的文案由剩余的毫秒数算出来，不把「还剩 14 分」存进数据库。
 */
export interface SeatAnnouncement {
  /** 数据库行 id：新消息 = 新 id，客户端据此判断「这条我之前点掉过没有」 */
  readonly id: number;
  readonly kind: AnnouncementKind;
  /** emote = 目录键；text = 那一句话；away = null */
  readonly body: string | null;
  /** 还能看见多久（毫秒）。与 `actionAgeMs` 同一条纪律：传剩余/年龄，不传时间戳 */
  readonly remainingMs: number;
}

export interface SeatInfo {
  readonly seat: number;
  readonly userId: number | null;
  readonly name: string | null;
  readonly online: boolean;
  /** 这个座位是不是**机器人**（服务器代打的无凭据身份，见 ADR-0015）：座位卡据此显示徽标与「请离」 */
  readonly bot: boolean;
  /** 这一座位此刻的桌边消息；空座与没有消息时为 null */
  readonly announcement: SeatAnnouncement | null;
}

export interface TableView {
  readonly code: string;
  readonly seats: readonly SeatInfo[];
  readonly seatedCount: number;
  readonly ready: boolean;
  /** **实时**观战连接数（不是观战记录数）：大厅列表用的是观战记录，两者口径不同 */
  readonly spectatorCount: number;
  /**
   * 距**上一次牌局动作**（发牌/叫牌/埋底/出牌/开新对局）的毫秒数；这一桌还没发过牌则为 `null`。
   *
   * 传的是**年龄**而不是时间戳：浏览器因此永远不必拿自己的钟去对服务端的钟，
   * 帧与帧之间自己走时，每收到一帧就用这里的权威值重新锚定（见 CONTEXT.md 的「计时」）。
   * 入座与离座不写这个值（它们不是牌局动作），所以计时不会被换人重置。
   */
  readonly actionAgeMs: number | null;
}

/**
 * 每次推送/拉取的完整负载。
 *
 * `view` 一律是**公共视图**（观战者能看到的全部内容）；玩家独有信息只在 `you`。
 * 这样「谁该看到什么」只有一处判断（`projectionFor`），组件不会各自去 `view.you` 里掏。
 */
export interface StreamPayload {
  readonly role: Role;
  readonly view: PublicView | null;
  readonly you: PlayerHand | null;
  readonly table: TableView;
}
