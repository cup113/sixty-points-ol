/**
 * 音乐悬浮窗的公共类型。
 *
 * 这一整个目录（`src/lib/music/`）与主功能**没有 import 关系**：它不认识引擎、牌桌客户端、
 * SSE、服务端存储，主功能也不认识它 —— 唯一入口是 `components/MusicDock.svelte`，
 * 由牌桌页挂一行标签。判据在 `apps/web/test/music-guard.test.ts`。
 *
 * 所有形状都是**从上游载荷里减出来的**（只留界面真要用的字段），不新增任何事实：
 * 来源是 `@neteasecloudmusicapienhanced/api` 的 JSON，字段改名一律在 `client.ts` 一处完成。
 */

/** 一首歌：界面上的最小可用形状 */
export interface Track {
  readonly id: number;
  readonly name: string;
  readonly artists: string;
  readonly album: string;
  /** 封面图地址；上游没给就是 null，界面用一块占位 */
  readonly cover: string | null;
  /** 时长（毫秒）；0 表示上游没给 */
  readonly durationMs: number;
  /** 只对会员开放（上游 `fee` = 1 或 `privilege.vip`） */
  readonly vipOnly: boolean;
  /** 只能试听片段（上游 `privilege.freeTrialInfo` 非空） */
  readonly trialOnly: boolean;
  /** 没有播放权限（上游 `privilege.st === 0` 或取 URL 时拿到 null） */
  readonly unplayable: boolean;
}

/** 一行歌词：`translated` 是同一时间戳的翻译行（没有就是 null） */
export interface LyricLine {
  readonly timeMs: number;
  readonly text: string;
  readonly translated: string | null;
}

/** 播放模式：顺序 / 单曲循环 / 随机 */
export type PlayMode = 'list' | 'one' | 'shuffle';

/** 队列的**纯数据**部分（不含下标：下标由 `queue.ts` 的函数按需算） */
export interface QueueSnapshot {
  readonly tracks: readonly Track[];
  readonly index: number;
}

/** 登录态（前端只看到这些，`MUSIC_U` 之类的凭据留在服务端的 httpOnly cookie 里） */
export interface SessionInfo {
  readonly loggedIn: boolean;
  readonly userId: number | null;
  readonly nickname: string | null;
  readonly vipType: number;
}

export const ANONYMOUS_SESSION: SessionInfo = {
  loggedIn: false,
  userId: null,
  nickname: null,
  vipType: 0
};

/** 悬浮窗的视野设置：拖动位置 + 收起态 + 音量 + 播放模式（本机持久化，与身份无关） */
export interface MusicView {
  readonly x: number;
  readonly y: number;
  readonly collapsed: boolean;
  /** 0~100 */
  readonly volume: number;
  readonly mode: PlayMode;
}

/** 播放一次的结果：拿到 URL 就播，拿不到时 `reason` 说明为什么 */
export type PlaybackTicket =
  | { readonly kind: 'url'; readonly url: string; readonly trial: boolean }
  | { readonly kind: 'unplayable'; readonly reason: 'rights' | 'vip' | 'empty' };

/** 音乐相关的一切失败都收敛成这一种；界面只读 `message` */
export interface MusicError {
  readonly code: 'upstream' | 'timeout' | 'disabled' | 'bad-request' | 'unknown';
  readonly message: string;
  /** 可以原样重试（上游坏了 / 超时）；`disabled`、`bad-request` 不给重试按钮 */
  readonly retryable: boolean;
}

/** 统一的调用结果：**不抛异常**，失败也是一条数据（界面不必写 try/catch） */
export type MusicResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: MusicError };

/** 搜索的一个分页块：`hasMore` 由「已拿到 < total」推出，不信上游那一堆字段 */
export interface SearchPage {
  readonly tracks: readonly Track[];
  /** 搜歌单时才有值（`kind === 'playlist'`）；搜单曲时是空数组 */
  readonly playlists: readonly PlaylistBrief[];
  readonly total: number;
  readonly hasMore: boolean;
}

/** 搜索类型（上游 cloudsearch 的 `type`）：单曲 / 歌手 / 歌单 */
export type SearchKind = 'song' | 'artist' | 'playlist';

/** 一个歌单条目（推荐歌单、我的歌单、搜索结果里的歌单共用这一种） */
export interface PlaylistBrief {
  readonly id: number;
  readonly name: string;
  readonly cover: string | null;
  readonly trackCount: number;
  readonly creator: string | null;
}

/** 扫码登录的状态机：等待扫码 → 已扫待确认 → 成功 / 过期 */
export type QrStatus = 'waiting' | 'scanned' | 'confirmed' | 'expired';
