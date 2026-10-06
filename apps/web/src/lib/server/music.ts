/**
 * 网易云旁挂服务的**服务端代理**：浏览器唯一能看到的那扇门。
 *
 * 为什么不让浏览器直连边车：
 * - 边车默认 `Access-Control-Allow-Origin: *`，谁都能拿着它的地址当开放代理用；
 *   放在内网 + 由我们转发，地址与端口不出现在前端代码里；
 * - **凭据留在服务端**：`MUSIC_U` 这类网易云会话 cookie 存进我们自己的 httpOnly cookie，
 *   前端只拿到 `{ loggedIn, nickname, userId }`（XSS 也偷不到，它本来也不该被页面脚本看见）；
 * - 我们才能做白名单、超时、错误归一化 —— 上游吐一段 HTML 也不会把界面弄白屏。
 *
 * 与主功能的关系：这条路由**不碰**数据库、不碰牌局、不认身份。它只认一个「音乐会话 cookie」。
 */
import { musicConfig, type MusicConfig } from '$lib/music-config.ts';
import { buildUpstreamRequest } from '$lib/music-adapters.ts';

/** 我们自己那枚会话 cookie 的名字（与身份凭据 `sixty.credential` 完全无关） */
export const SESSION_COOKIE = 'sixty.music.session';

/**
 * 上游 cookie 串的长度上限。
 *
 * 网易云的会话是 `MUSIC_U=…; __csrf=…` 这一串，实测几百字节；给 4KB 是留足余量，
 * 同时保证它不会把请求头撑爆（Cookie 头整体上限通常 8KB，还有别的 cookie 要放）。
 */
export const MAX_SESSION_CHARS = 4096;

/** 会话 cookie 的生命周期：与网易云自己的一致（30 天），过期就重新扫码 */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface ForwardOk {
  readonly ok: true;
  readonly status: number;
  readonly data: unknown;
  /** 上游这次给回来的新会话（与旧的相同或没给就是 null）—— 与失败路径同一形状，
   *  路由因此不必分两种写法去更新 cookie */
  readonly session: string | null;
}

export interface ForwardFail {
  readonly ok: false;
  readonly status: 400 | 403 | 404 | 503;
  /** 前端只读 `message`；`code` 给日志与将来做区分用 */
  readonly code: 'disabled' | 'bad-request' | 'upstream' | 'timeout';
  readonly message: string;
  /** 上游给回来的新会话（有变化时才非 null）—— 路由据此更新 httpOnly cookie */
  readonly session: string | null;
}

export type ForwardResult = ForwardOk | ForwardFail;

/**
 * 我们要的那两个 cookie 方法（SvelteKit 的 `event.cookies` 有更多方法，这里只声明用到的）
 * 与**我们真正会写的选项**。
 *
 * 刻意不写成 `Cookies` 的切片：那样会把这些选项的类型绑到 SvelteKit 内部的
 * `CookieSerializeOptions` 上，测试塞一个内存对象就得去满足它的全部要求（实测报
 * `Types of property 'set' are incompatible`）。这里只要「名字、值、四个选项」这一层。
 */
export interface SessionJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options: SessionCookieOptions): void;
}

/** 写会话用的选项：`path` 必给，其余可选 */
export interface SessionCookieOptions {
  readonly path: string;
  readonly httpOnly?: boolean;
  readonly sameSite?: 'lax' | 'strict' | 'none';
  readonly maxAge?: number;
  readonly secure?: boolean;
}

/** 极端情况下上游塞回来的会话超长：宁可丢掉（下次重新登录），也不让它撑爆响应头 */
export function capSession(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_SESSION_CHARS ? null : trimmed;
}

/** 读会话：空串与超长一律当没有（后者宁可让人重新扫码，也不让它撑爆请求头） */
export function readSession(cookies: SessionJar): string | null {
  return capSession(cookies.get(SESSION_COOKIE) ?? '');
}

/** 写会话：写的是**上游给的那一串**，原样存、原样回灌 */
export function writeSession(cookies: SessionJar, value: string): boolean {
  const capped = capSession(value);
  if (capped === null) return false;
  cookies.set(SESSION_COOKIE, capped, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    // 本站可能是 http（内网部署），所以不强制 secure —— 强制了内网就登录不了。
    // 这枚会话只值「一个网易云账号的听歌数据」，不碰牌局身份，这个取舍写在这里。
    secure: false
  });
  return true;
}

export function clearSession(cookies: { delete(name: string, options: { path: string }): void }): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export interface ForwardOptions {
  readonly op: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** 当前会话（没有就是匿名） */
  readonly session: string | null;
  /** 登录用户的音质偏好；匿名一律 standard —— 见 `qualityTierOf` */
  readonly loggedIn: boolean;
  readonly config?: MusicConfig;
  readonly fetch?: typeof globalThis.fetch;
}

/** 请求体（POST）也要读：写操作与搜索走 POST，避免关键字进 URL 日志 */
function initOf(spec: { write: boolean }, body: URLSearchParams, session: string | null): RequestInit {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (session !== null) headers['cookie'] = session;
  if (!spec.write) return { method: 'GET', headers };
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    body
  };
}

/**
 * 转发一次调用。四个阶段的失败各有各的出口：
 * 白名单/参数（400、404，绝不发出去）→ 超时（503 + `timeout`）→ 连不上（503）→
 * 上游非 2xx / 非 JSON（503 + `upstream`）。
 *
 * 上游的各种坏法**一律收敛到 503**：前端因此只有一条判断（「5xx 就重试」），
 * 而不是去认 502/504 这些它改变不了行为的状态码；具体原因在 `code` 与 `message` 里。
 *
 * 只有**读**会带 `?noCookie=true`：写操作的 Set-Cookie 要留下来（那正是登录本身）。
 */
export async function forwardMusic(options: ForwardOptions): Promise<ForwardResult> {
  const config = options.config ?? musicConfig();
  if (!config.enabled) {
    return { ok: false, status: 404, code: 'disabled', message: '这台服务器没有开音乐功能', session: null };
  }

  const built = buildUpstreamRequest(options.op, options.params);
  if (!built.ok) return { ok: false, status: built.status, code: 'bad-request', message: built.message, session: null };

  const params = new URLSearchParams(built.params);
  if (built.op === 'songUrl') {
    // 音质不在白名单参数里：它由登录态推出（匿名配 lossless 只会每次都拿到空 URL）
    params.set('level', options.loggedIn ? config.level : 'standard');
  }
  if (!built.write) params.set('noCookie', 'true');

  const url = `${config.apiBase}/${built.path}?${params.toString()}`;
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      ...initOf(built, params, options.session),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    return timedOut
      ? { ok: false, status: 503, code: 'timeout', message: '音乐服务响应超时', session: null }
      : { ok: false, status: 503, code: 'upstream', message: '连不上音乐服务（边车没起来？）', session: null };
  }

  // 会话更新要在读 body 之前拿：`Response.headers` 不受 body 消费影响，但这条顺序更好读
  const nextSession = nextSessionOf(response.headers, options.session);
  if (!response.ok) {
    return {
      ok: false,
      status: 503,
      code: 'upstream',
      message: `音乐服务出错（上游 ${response.status}）`,
      session: nextSession
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    // 上游给了 HTML（反代错误页之类）：如实说「看不懂」，别把 HTML 塞进界面
    return { ok: false, status: 503, code: 'upstream', message: '音乐服务返回了看不懂的内容', session: nextSession };
  }
  return { ok: true, status: 200, data, session: nextSession };
}

/**
 * 上游这次回了哪些 cookie？
 *
 * 只认 Set-Cookie，不认请求里已经有的那一份；**一样就不重复写**（每个响应都重写一遍
 * 会让 Set-Cookie 出现在每一次调用上，缓存与日志都变脏）。Node 的 fetch 提供 `getSetCookie()`，
 * 拿不到时退回单值 `get('set-cookie')`（合并成一串也能用，`k=v; k=v` 正是我们要的形状）。
 */
export function nextSessionOf(headers: Headers, current: string | null): string | null {
  const list =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie') ?? ''].filter((value) => value !== '');
  if (list.length === 0) return null;
  const pairs: string[] = [];
  for (const cookie of list) {
    // 每个 Set-Cookie 只取到第一个 `;` 之前：后面是 Path / HttpOnly / SameSite 那些属性
    const pair = cookie.split(';', 1)[0]?.trim() ?? '';
    if (/^[^=;\s]+=[^;]*$/.test(pair)) pairs.push(pair);
  }
  if (pairs.length === 0) return null;
  const joined = capSession(pairs.join('; '));
  if (joined === null || joined === current) return null;
  return joined;
}
