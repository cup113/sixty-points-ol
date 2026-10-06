/**
 * 浏览器侧的 API 客户端：**只跟自己的 `/api/music/*` 说话**，永远不直连网易云。
 *
 * 三条设计约束：
 * - **不抛异常**：所有失败都归一成 `{ ok: false, error }`（连「返回的不是 JSON」也算），
 *   界面因此不必写 try/catch，也不会因为上游吐了一段 HTML 就白屏。
 * - **只对读重试一次**：`op` 本身是幂等的（GET）才重试；喜欢/取消喜欢这类写操作
 *   一次都不重发 —— 与 MCP 工具面「写路径不重试」同一条纪律（ADR-0012）。
 * - **`fetch` 与 `now` 可注入**：测试塞桩进来就能把 503 / 超时 / 非 JSON 三种坏情况
 *   在 `node:test` 里跑一遍，不需要真服务。
 *
 * 上游载荷 → 界面形状（`Track` / `PlaylistBrief`）的改名只在这个文件里发生。
 */
import { artistsText } from './format.ts';
import type {
  LyricLine,
  MusicError,
  MusicResult,
  PlaybackTicket,
  PlaylistBrief,
  QrStatus,
  SearchKind,
  SearchPage,
  SessionInfo,
  Track
} from './types.ts';
import { ANONYMOUS_SESSION } from './types.ts';
import { searchTypeOf } from '../music-adapters.ts';
import { lyricsFrom } from './lyric.ts';

/** `fetch` 的最小形状（注入桩用），`Response` 只用到这几个成员 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MusicClientOptions {
  readonly fetch: FetchLike;
  readonly basePath?: string;
  /** 单次请求超时（毫秒）：上游卡住时界面不能一直转圈 */
  readonly timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 12_000;

export interface MusicClient {
  session(): Promise<MusicResult<SessionInfo>>;
  logout(): Promise<MusicResult<SessionInfo>>;
  search(keywords: string, kind: SearchKind, offset: number): Promise<MusicResult<SearchPage>>;
  /** 拿播放地址：拿不到时不是错误，而是 `{ kind: 'unplayable' }`（界面据此跳过并标注） */
  songUrl(id: number, level: string): Promise<MusicResult<PlaybackTicket>>;
  /** 搜索接口给的信息不够时补齐时长/封面/权限（`song/detail`） */
  songDetail(ids: readonly number[]): Promise<MusicResult<Track[]>>;
  lyric(id: number): Promise<MusicResult<LyricLine[]>>;
  qrStart(): Promise<MusicResult<{ key: string; image: string; url: string }>>;
  qrPoll(key: string): Promise<MusicResult<{ status: QrStatus; session: SessionInfo | null }>>;
  recommendSongs(): Promise<MusicResult<Track[]>>;
  personalizedPlaylists(): Promise<MusicResult<PlaylistBrief[]>>;
  toplists(): Promise<MusicResult<PlaylistBrief[]>>;
  playlistTracks(id: number): Promise<MusicResult<Track[]>>;
  userPlaylists(uid: number): Promise<MusicResult<PlaylistBrief[]>>;
  likedIds(uid: number): Promise<MusicResult<number[]>>;
  setLiked(id: number, uid: number, liked: boolean): Promise<MusicResult<{ liked: boolean }>>;
  recentSongs(): Promise<MusicResult<Track[]>>;
}

/* ---------- 归一化：上游 JSON → 界面形状 ---------- */

/** 上游的 `ar` 有时叫 `artists`，`al` 有时叫 `album`：两个都认，谁也不许漏 */
function trackFrom(raw: unknown): Track | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const song = raw as {
    id?: unknown;
    name?: unknown;
    ar?: unknown;
    artists?: unknown;
    al?: unknown;
    album?: unknown;
    dt?: unknown;
    duration?: unknown;
    fee?: unknown;
    privilege?: { st?: unknown; freeTrialInfo?: unknown; vip?: unknown } | null;
  };
  const id = Number(song.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const name = typeof song.name === 'string' ? song.name : '';
  if (name === '') return null;

  const artistList = Array.isArray(song.ar)
    ? song.ar
    : Array.isArray(song.artists)
      ? song.artists
      : [];
  const names = artistList
    .map((item) => (typeof item === 'object' && item !== null ? String((item as { name?: unknown }).name ?? '') : ''))
    .filter((text) => text !== '');

  const albumRaw = (song.al ?? song.album) as { name?: unknown; picUrl?: unknown } | undefined;
  const cover = typeof albumRaw?.picUrl === 'string' && albumRaw.picUrl !== '' ? albumRaw.picUrl : null;
  const durationMs = Number(song.dt ?? song.duration ?? 0);
  const privilege = song.privilege ?? null;
  const fee = Number(song.fee ?? 0);

  return {
    id,
    name,
    artists: artistsText(names),
    album: typeof albumRaw?.name === 'string' ? albumRaw.name : '',
    cover,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    vipOnly: fee === 1 || privilege?.vip === true,
    trialOnly: privilege?.freeTrialInfo !== null && privilege?.freeTrialInfo !== undefined,
    unplayable: privilege?.st === 0
  };
}

function tracksFrom(raw: unknown): Track[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(trackFrom).filter((track): track is Track => track !== null);
}

function playlistFrom(raw: unknown): PlaylistBrief | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as { id?: unknown; name?: unknown; coverImgUrl?: unknown; picUrl?: unknown; trackCount?: unknown; playCount?: unknown; creator?: { nickname?: unknown } | null };
  const id = Number(item.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const name = typeof item.name === 'string' ? item.name : '';
  if (name === '') return null;
  const cover = typeof item.coverImgUrl === 'string' ? item.coverImgUrl : typeof item.picUrl === 'string' ? item.picUrl : null;
  const creator = typeof item.creator?.nickname === 'string' ? item.creator.nickname : null;
  return {
    id,
    name,
    cover: cover === '' ? null : cover,
    trackCount: Number(item.trackCount ?? 0) || 0,
    creator
  };
}

function playlistsFrom(raw: unknown): PlaylistBrief[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(playlistFrom).filter((item): item is PlaylistBrief => item !== null);
}

/** 上游的登录态可能出现在 `data.account` / `account` / `profile` 三处，逐个找 */
function sessionFrom(raw: unknown): SessionInfo {
  if (typeof raw !== 'object' || raw === null) return ANONYMOUS_SESSION;
  const root = raw as { data?: unknown; account?: unknown; profile?: unknown };
  const data = (typeof root.data === 'object' && root.data !== null ? root.data : root) as {
    account?: { id?: unknown; vipType?: unknown } | null;
    profile?: { userId?: unknown; nickname?: unknown; vipType?: unknown } | null;
  };
  const profile = data.profile ?? null;
  const account = data.account ?? null;
  const userId = Number(profile?.userId ?? account?.id ?? 0);
  const nickname = typeof profile?.nickname === 'string' ? profile.nickname : null;
  const vipType = Number(profile?.vipType ?? account?.vipType ?? 0);
  const loggedIn = Number.isInteger(userId) && userId > 0 && nickname !== null;
  return {
    loggedIn,
    userId: loggedIn ? userId : null,
    nickname: loggedIn ? nickname : null,
    vipType: Number.isFinite(vipType) ? vipType : 0
  };
}

/** 扫码状态：上游用数字 800/801/802/803，这里翻成人话（未知值当过期处理，别卡住轮询） */
function qrStatusFrom(code: number): QrStatus {
  if (code === 800) return 'expired';
  if (code === 801) return 'waiting';
  if (code === 802) return 'scanned';
  return 'confirmed';
}

/* ---------- 客户端本体 ---------- */

export function createMusicClient(options: MusicClientOptions): MusicClient {
  const base = (options.basePath ?? '/api/music').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch;

  function failure(error: MusicError): MusicResult<never> {
    return { ok: false, error };
  }

  function errorOf(status: number, message: string | null): MusicError {
    if (status === 0) return { code: 'timeout', message: '音乐服务响应太慢，稍后再试', retryable: true };
    if (status === 404) return { code: 'disabled', message: message ?? '这台服务器没有开音乐功能', retryable: false };
    if (status === 400) return { code: 'bad-request', message: message ?? '请求不合法', retryable: false };
    if (status === 503) return { code: 'upstream', message: message ?? '音乐服务连不上（可能是边车没起来）', retryable: true };
    return { code: 'unknown', message: message ?? `音乐服务出错（${status}）`, retryable: status >= 500 };
  }

  /**
   * 发一次请求。`read` 为 true 时：用 **GET**（边车对 GET 有 2 分钟缓存，直链与歌词因此
   * 不会每次翻页都重新打网易云），并且失败**重试一次**。
   *
   * 重试的判据是「这个 op 幂等」，不是「这个错误看起来能重试」—— 写操作重发会多喜欢一次，
   * 而服务端没有幂等键（与 ADR-0012 的「写路径不重试」同一条纪律）。
   */
  async function call<T>(
    op: string,
    params: Readonly<Record<string, unknown>>,
    read: boolean
  ): Promise<MusicResult<T>> {
    const attempts = read ? 2 : 1;
    let last: MusicResult<T> = failure({ code: 'unknown', message: '没有发出请求', retryable: true });
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
        }
        const response = await doFetch(read ? `${base}/${op}?${query.toString()}` : `${base}/${op}`, {
          method: read ? 'GET' : 'POST',
          ...(read ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) }),
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: unknown; data?: unknown; error?: { message?: unknown } }
          | null;
        if (!response.ok) {
          const message = typeof payload?.error?.message === 'string' ? payload.error.message : null;
          last = failure(errorOf(response.status, message));
          // 4xx 重试没有意义（参数错、功能关着），只有 5xx 值得再来一次
          if (response.status < 500) return last;
          continue;
        }
        if (payload === null || payload.ok !== true) {
          last = failure({ code: 'upstream', message: '音乐服务返回了看不懂的内容', retryable: true });
          continue;
        }
        return { ok: true, data: payload.data as T };
      } catch {
        // AbortError 与网络错误在这里同一条路：都当「没拿到响应」
        last = failure(errorOf(0, null));
      } finally {
        clearTimeout(timer);
      }
    }
    return last;
  }

  // 先把对象存成常量再返回：`qrPoll` 里要回头再问一次登录态（`client.session()`），
  // 用 `this` 的话一旦被解构（Svelte 里很常见）就丢了。
  const client: MusicClient = {
    async session() {
      const result = await call<unknown>('loginStatus', {}, true);
      return result.ok ? { ok: true, data: sessionFrom(result.data) } : result;
    },

    async logout() {
      const result = await call<unknown>('logout', {}, false);
      return result.ok ? { ok: true, data: ANONYMOUS_SESSION } : result;
    },

    async search(keywords, kind, offset) {
      // 上游 `cloudsearch` 的三种 type 各回各的字段：单曲在 `result.songs`、歌单在
      // `result.playlists`、歌手在 `result.artists`（本版不带歌手）。
      const result = await call<{ result?: { songs?: unknown; playlists?: unknown; songCount?: unknown; playlistCount?: unknown } }>(
        'search',
        { keywords, type: searchTypeOf(kind), limit: 30, offset },
        true
      );
      if (!result.ok) return result;
      const tracks = tracksFrom(result.data?.result?.songs);
      const playlists = playlistsFrom(result.data?.result?.playlists);
      const total = Number(result.data?.result?.songCount ?? result.data?.result?.playlistCount ?? tracks.length) || 0;
      return {
        ok: true,
        data: { tracks, playlists, total, hasMore: offset + 30 < total }
      };
    },

    async songUrl(id, level) {
      const result = await call<{ data?: unknown }>('songUrl', { id, level }, true);
      if (!result.ok) return result;
      const first = Array.isArray(result.data?.data) ? (result.data.data[0] as { url?: unknown; freeTrialInfo?: unknown } | undefined) : undefined;
      const url = typeof first?.url === 'string' && first.url !== '' ? first.url : null;
      if (url === null) return { ok: true, data: { kind: 'unplayable', reason: 'rights' } };
      return { ok: true, data: { kind: 'url', url, trial: first?.freeTrialInfo !== null && first?.freeTrialInfo !== undefined } };
    },

    async songDetail(ids) {
      const result = await call<{ songs?: unknown }>('songDetail', { ids: ids.join(',') }, true);
      return result.ok ? { ok: true, data: tracksFrom(result.data?.songs) } : result;
    },

    async lyric(id) {
      const result = await call<{ lrc?: { lyric?: unknown }; tlyric?: { lyric?: unknown } }>('lyric', { id }, true);
      if (!result.ok) return result;
      const raw = typeof result.data?.lrc?.lyric === 'string' ? result.data.lrc.lyric : '';
      const translated = typeof result.data?.tlyric?.lyric === 'string' ? result.data.tlyric.lyric : '';
      // 纯音乐 / 还没上架歌词时上游给空串：空数组是正常结果，不是错误
      return { ok: true, data: lyricsFrom(raw, translated) };
    },

    async qrStart() {
      const key = await call<{ data?: { unikey?: unknown } }>('loginQrKey', {}, true);
      if (!key.ok) return key;
      const unikey = typeof key.data?.data?.unikey === 'string' ? key.data.data.unikey : '';
      if (unikey === '') return failure({ code: 'upstream', message: '拿不到登录二维码', retryable: true });
      const image = await call<{ data?: { qrimg?: unknown; qrurl?: unknown } }>(
        'loginQrCreate',
        { key: unikey, qrimg: 'true' },
        true
      );
      if (!image.ok) return image;
      return {
        ok: true,
        data: {
          key: unikey,
          image: typeof image.data?.data?.qrimg === 'string' ? image.data.data.qrimg : '',
          url: typeof image.data?.data?.qrurl === 'string' ? image.data.data.qrurl : ''
        }
      };
    },

    async qrPoll(key) {
      const result = await call<{ code?: unknown; cookie?: unknown }>('loginQrCheck', { key }, true);
      if (!result.ok) return result;
      const code = Number(result.data?.code ?? 801);
      const status = qrStatusFrom(code);
      if (status !== 'confirmed') return { ok: true, data: { status, session: null } };
      // 确认之后要再问一次登录态：`login/qr/check` 只说明「扫了」，
      // 昵称与 uid 得从 `login/status` 拿，而且会话 cookie 已经落在服务端了
      const session = await client.session();
      return { ok: true, data: { status, session: session.ok ? session.data : null } };
    },

    async recommendSongs() {
      const result = await call<{ data?: { dailySongs?: unknown } }>('recommendSongs', {}, true);
      return result.ok ? { ok: true, data: tracksFrom(result.data?.data?.dailySongs) } : result;
    },

    async personalizedPlaylists() {
      const result = await call<{ result?: unknown }>('personalizedPlaylist', { limit: 30 }, true);
      return result.ok ? { ok: true, data: playlistsFrom(result.data?.result) } : result;
    },

    async toplists() {
      const result = await call<{ list?: unknown }>('toplist', {}, true);
      return result.ok ? { ok: true, data: playlistsFrom(result.data?.list) } : result;
    },

    async playlistTracks(id) {
      const result = await call<{ songs?: unknown }>('playlistTrackAll', { id, limit: 200, offset: 0 }, true);
      return result.ok ? { ok: true, data: tracksFrom(result.data?.songs) } : result;
    },

    async userPlaylists(uid) {
      const result = await call<{ playlist?: unknown }>('userPlaylist', { uid, limit: 100 }, true);
      return result.ok ? { ok: true, data: playlistsFrom(result.data?.playlist) } : result;
    },

    async likedIds(uid) {
      const result = await call<{ ids?: unknown }>('likelist', { uid }, true);
      if (!result.ok) return result;
      const ids = Array.isArray(result.data?.ids) ? result.data.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
      return { ok: true, data: ids };
    },

    async setLiked(id, uid, liked) {
      // 写操作：客户端一次都不重试（重发会让「喜欢」变两次 —— 服务端没有幂等键）
      const result = await call<unknown>('songLike', { id, uid, like: liked }, false);
      return result.ok ? { ok: true, data: { liked } } : result;
    },

    async recentSongs() {
      const result = await call<{ data?: { list?: unknown } }>('recordRecent', { limit: 100 }, true);
      return result.ok ? { ok: true, data: tracksFrom(result.data?.data?.list) } : result;
    }
  };

  return client;
}
