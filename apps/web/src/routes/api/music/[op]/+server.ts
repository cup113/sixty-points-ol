/**
 * 音乐代理的唯一入口：`/api/music/<op>`。
 *
 * 与牌桌那几条路由的关系：**没有任何关系**。它不读数据库、不认身份凭据、不发 SSE、不改牌局。
 * 名字里带 `music` 的只有它自己与 `$lib/server/music.ts`，所以整块功能可以单独摘掉
 * （或者用 `SIXTY_MUSIC=off` 直接下线，见 `$lib/music-config.ts`）。
 *
 * 四道门：
 * 1. `SIXTY_MUSIC=off` → 404（连「有没有这个功能」都不暴露）；
 * 2. `Origin` 与本站不一致 → 403（挡跨站脚本拿这个代理去打网易云）；
 * 3. 非白名单 op / 参数不合法 → 404 / 400（见 `$lib/music-adapters.ts`）；
 * 4. 上游失败 → 503（前端因此显示「连不上音乐服务」而不是白屏）。
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { musicConfig } from '$lib/music-config.ts';
import { clearSession, forwardMusic, readSession, writeSession } from '$lib/server/music';
import type { RequestHandler } from './$types';

/** 只收标量（string / number / boolean）：数组与嵌套对象一律拒掉，别给上游传奇怪的东西 */
function scalarsOf(source: Record<string, unknown> | URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = source instanceof URLSearchParams ? [...source.entries()] : Object.entries(source);
  for (const [key, value] of entries) {
    if (typeof value === 'string' && value !== '') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value);
    else if (typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

async function readParams(event: RequestEvent): Promise<Record<string, string> | 'bad-body'> {
  if (event.request.method !== 'POST') return scalarsOf(event.url.searchParams);
  const body = (await event.request.json().catch(() => null)) as unknown;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'bad-body';
  return scalarsOf(body as Record<string, unknown>);
}

/**
 * 同站判定：比较**主机（含端口）**，不比协议。
 *
 * 为什么不能直接比 `origin !== event.url.origin`：adapter-node 默认按「在反代后面」推导协议，
 * 直接跑 `node build/index.js` 时 `event.url` 会是 `https://127.0.0.1:5302`，而浏览器发来的
 * Origin 是 `http://127.0.0.1:5302` —— 实测同站请求会被自己挡成 403。
 * 主机（含端口，也就是 `URL#host`）才是「哪个站」，`http`/`https` 在这里是部署细节
 * （内网 http、公网 https 都常见）。跨站攻击者的 host 一定不同，所以这条判据仍然有效。
 */
function isSameSite(origin: string, event: RequestEvent): boolean {
  try {
    return new URL(origin).host === event.url.host;
  } catch {
    // 不合法的 Origin（"null"、半截 URL）一律当跨站
    return false;
  }
}

const handle: RequestHandler = async (event) => {
  const config = musicConfig();
  if (!config.enabled) return json({ ok: false, error: { message: '这台服务器没有开音乐功能' } }, { status: 404 });

  // 同站来源才放行。没带 Origin 的不是浏览器表单请求（脚本、CI），放行是安全的：
  // 伪造的跨站请求一定会带上真 Origin，而这里正是要挡住它。
  const origin = event.request.headers.get('origin');
  if (origin !== null && !isSameSite(origin, event)) {
    return json({ ok: false, error: { message: '来源不允许' } }, { status: 403 });
  }

  const params = await readParams(event);
  if (params === 'bad-body') {
    return json({ ok: false, error: { message: '请求体必须是 JSON 对象' } }, { status: 400 });
  }

  const op = event.params.op ?? '';
  // 登出是个例外：即使上游连不上，也要把本地的会话 cookie 清掉（否则「退出登录」会卡住）
  if (op === 'logout' && config.enabled) clearSession(event.cookies);

  const session = readSession(event.cookies);
  const result = await forwardMusic({
    op,
    params,
    session,
    loggedIn: session !== null,
    config
  });

  if (result.session !== null) writeSession(event.cookies, result.session);
  if (!result.ok) {
    return json(
      { ok: false, error: { code: result.code, message: result.message } },
      { status: result.status }
    );
  }
  return json({ ok: true, data: result.data });
};

export const GET: RequestHandler = handle;
export const POST: RequestHandler = handle;
