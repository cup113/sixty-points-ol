/**
 * 网易云 API 的**白名单适配层** —— 我们的 op 名与上游端点的映射只在这里一处。
 *
 * 为什么要有这一层（而不是把浏览器／代理直接怼到上游）：
 * - **不是开放代理**：只放行下面这张表里的 op，参数逐条校验，未知 op 一律 404。
 *   上游有 400+ 个端点，其中改名、上传、删除、投币、云盘之类都能毁掉用户的账号数据 ——
 *   播放器一个都用不着，所以一个都不放行。
 * - **上游换端点只改这一行**（例如 `/api/v6/playlist/detail` 以后变成 v7）：界面与路由都不动。
 * - **纯函数**：`buildUpstreamRequest` 不碰网络、不碰 cookie 存储（凭据由服务端在 `server/music.ts` 拼），
 *   所以能在 `node:test` 里逐条断言「什么参数会被拒」。
 *
 * 它同时被服务端路由与测试使用，所以放在 `lib` 根下（不在 `lib/server/` 里，那个目录下的东西
 * 只有服务端能用）。
 */
import type { SearchKind } from './music/types.ts';

/** 一次 `song/detail` 最多带多少 id（上游上限是 1000，界面一次用不到那么多） */
export const MAX_SONG_IDS = 200;
export const MAX_LIMIT = 1000;

/** 参数类型：每种自带校验与上限，非法值当场拒掉 */
export type ParamKind =
  | 'id'
  | 'uid'
  | 'keyword'
  | 'limit'
  | 'offset'
  | 'idList'
  | 'like'
  | 'searchType';

interface ParamSpec {
  readonly kind: ParamKind;
  readonly required?: boolean;
  readonly fallback?: string | number;
}

export interface OpSpec {
  /** 上游（ncm-api 边车）的路径，不带 `/api/` 前缀：边车自己就是 `/cloudsearch` 这种直通路由 */
  readonly path: string;
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** 会改变账号数据（喜欢/取消喜欢）—— 只有这些走 POST，其余一律 GET */
  readonly write?: boolean;
}

/**
 * 全部放行的操作。命名与界面一一对应，不出现上游的端点名。
 *
 * `level`（音质）不在这个表里：它由服务端按登录态推出，见 `format.ts` 的 `qualityTierOf`。
 */
export const MUSIC_OPS = {
  search: {
    path: 'cloudsearch',
    params: {
      keywords: { kind: 'keyword', required: true },
      type: { kind: 'searchType', fallback: 1 },
      limit: { kind: 'limit', fallback: 30 },
      offset: { kind: 'offset', fallback: 0 }
    }
  },
  songUrl: { path: 'song/url/v1', params: { id: { kind: 'id', required: true } } },
  songDetail: { path: 'song/detail', params: { ids: { kind: 'idList', required: true } } },
  lyric: { path: 'lyric', params: { id: { kind: 'id', required: true } } },
  loginQrKey: { path: 'login/qr/key', params: {} },
  loginQrCreate: {
    path: 'login/qr/create',
    params: { key: { kind: 'keyword', required: true }, qrimg: { kind: 'keyword', fallback: 'true' } }
  },
  loginQrCheck: { path: 'login/qr/check', params: { key: { kind: 'keyword', required: true } } },
  logout: { path: 'logout', params: {} },
  loginStatus: { path: 'login/status', params: {} },
  recommendSongs: { path: 'recommend/songs', params: {} },
  personalizedPlaylist: { path: 'personalized', params: { limit: { kind: 'limit', fallback: 30 } } },
  toplist: { path: 'toplist', params: {} },
  playlistDetail: { path: 'playlist/detail', params: { id: { kind: 'id', required: true } } },
  playlistTrackAll: {
    path: 'playlist/track/all',
    params: {
      id: { kind: 'id', required: true },
      limit: { kind: 'limit', fallback: 200 },
      offset: { kind: 'offset', fallback: 0 }
    }
  },
  userPlaylist: {
    path: 'user/playlist',
    params: { uid: { kind: 'uid', required: true }, limit: { kind: 'limit', fallback: 100 } }
  },
  likelist: { path: 'likelist', params: { uid: { kind: 'uid', required: true } } },
  songLike: {
    path: 'song/like',
    write: true,
    params: {
      id: { kind: 'id', required: true },
      uid: { kind: 'uid', required: true },
      like: { kind: 'like', fallback: 'true' }
    }
  },
  recordRecent: { path: 'record/recent/song', params: { limit: { kind: 'limit', fallback: 100 } } }
} as const satisfies Record<string, OpSpec>;

export type MusicOp = keyof typeof MUSIC_OPS;

export const MUSIC_OP_NAMES = Object.keys(MUSIC_OPS) as MusicOp[];

export function isMusicOp(value: string): value is MusicOp {
  return Object.hasOwn(MUSIC_OPS, value);
}

/** 调用方给的参数（来自 query string 或 JSON body，值可能是 string 或 number） */
export type RawParams = Readonly<Record<string, unknown>>;

/** 校验失败：`status` 直接给路由用（400 = 参数错，404 = 没有这个 op） */
export interface RejectSpec {
  readonly ok: false;
  readonly status: 400 | 404;
  readonly message: string;
}

/** 一条已经干净的请求：只差凭据与音质档位（由服务端补） */
export interface CleanRequest {
  readonly ok: true;
  readonly op: MusicOp;
  readonly path: string;
  readonly write: boolean;
  readonly params: Readonly<Record<string, string>>;
}

export type BuiltRequest = CleanRequest | RejectSpec;

/** 参数校验：非法一律 400（而不是夹到合法值 —— 静默改参数会让上游的错误更难查） */
function coerce(kind: ParamKind, raw: unknown): string | null {
  switch (kind) {
    case 'id':
    case 'uid': {
      const value = Number(raw);
      return Number.isInteger(value) && value > 0 ? String(value) : null;
    }
    case 'limit': {
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) return null;
      return String(Math.min(value, MAX_LIMIT)); // 上游有上限，别让它自己裁
    }
    case 'offset': {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) return null;
      return String(Math.min(value, 100_000));
    }
    case 'idList': {
      const ids = String(raw)
        .split(',')
        .map((piece) => piece.trim())
        .filter((piece) => piece !== '');
      if (ids.length === 0 || ids.length > MAX_SONG_IDS) return null;
      if (!ids.every((piece) => /^\d+$/.test(piece) && Number(piece) > 0)) return null;
      return ids.join(',');
    }
    case 'like': {
      if (raw === true || raw === 'true' || raw === '1') return 'true';
      if (raw === false || raw === 'false' || raw === '0') return 'false';
      return null;
    }
    case 'searchType': {
      const value = Number(raw);
      return value === 1 || value === 100 || value === 1000 ? String(value) : null;
    }
    case 'keyword': {
      const text = String(raw).trim();
      // 关键字允许中文、空格与符号；只挡掉控制字符与超长（防止拿它当任意文本通道）
      if (text === '' || text.length > 100) return null;
      for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f) return null;
      }
      return text;
    }
  }
}

/**
 * 把调用方参数变成一条干净的请求。
 *
 * - 未知参数**直接丢掉**（不报错）：界面多传一个字段不该让播放失败，但它也到不了上游；
 * - 必填缺失 / 类型不对 → 400；
 * - 没有这个 op → 404。
 */
export function buildUpstreamRequest(op: string, raw: RawParams): BuiltRequest {
  if (!isMusicOp(op)) return { ok: false, status: 404, message: `没有这个音乐操作：${op}` };
  const spec: OpSpec = MUSIC_OPS[op];
  const params: Record<string, string> = {};
  for (const [name, param] of Object.entries(spec.params)) {
    const given = raw[name];
    if (given === undefined || given === null || given === '') {
      if (param.required === true) return { ok: false, status: 400, message: `缺少参数：${name}` };
      if (param.fallback !== undefined) params[name] = String(param.fallback);
      continue;
    }
    const value = coerce(param.kind, given);
    if (value === null) return { ok: false, status: 400, message: `参数不合法：${name}` };
    params[name] = value;
  }
  return { ok: true, op, path: spec.path, write: spec.write === true, params };
}

/**
 * 搜索类型：界面的三种视图 → 上游 `cloudsearch` 的 `type`。
 *
 * 放在这里而不是界面里：它是**协议细节**（1 = 单曲、100 = 歌手、1000 = 歌单），
 * 上游哪天换了取值，只有这一处要改。
 */
export function searchTypeOf(kind: SearchKind): number {
  switch (kind) {
    case 'song':
      return 1;
    case 'artist':
      return 100;
    case 'playlist':
      return 1000;
  }
}
