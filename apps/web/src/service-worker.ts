/**
 * 应用壳的 Service Worker（ADR-0026）。
 *
 * 只做三件事，边界都取「正确性」而不是「新鲜度」：
 *
 * 1. **`/api/` 一律直通**：SSE（`/api/tables/<code>/stream`）、动作接口与 `/api/mcp` 都不许经过缓存 ——
 *    回合制对战全靠服务器推送，缓存一份事件流既没有意义，还会让断线重连读不到新帧。
 *    这条判断排在所有缓存逻辑**之前**，所以它不需要「记得同步」。
 * 2. **应用壳进缓存**：`build`（带哈希的产物）与静态目录里跟壳有关的那几件（manifest / 图标 / favicon）。
 *    音效（`static/sounds`，约 730KB）**不预缓存** —— 出厂两条音频通道是静音的（见 CONTEXT「声音反馈」），
 *    为它占掉首装流量不值；真放过的音效走运行期缓存，下次离线也还在。
 * 3. **导航走 network-first**：联不上网时回缓存里那份壳，连壳都没有就给一页最小的离线说明。
 *
 * 刻意**不** `skipWaiting()`：牌桌页是长开标签，中途换一个 SW 会把正在打的一副换成另一份壳。
 * 新版本等用户下一次打开页面才生效，`activate` 里顺手清掉旧版本的缓存。
 *
 * 小提示：设备上换一副身份/登出后，缓存里那些**旧身份的个人视图**仍在（离线时可能被翻出来）。
 * 它与本机保存的凭据串同一个信任边界 —— 都在这台设备的浏览器里；把这个取舍写在 ADR 而不是
 * 加一层清理，是因为清理一旦漏一条路径，副作用是「看起来正常的旧画面」。
 */
import { build, files, version } from '$service-worker';

/** 静态目录里算「壳」的那几件；`files` 里剩下的（音效）不进预缓存 */
const SHELL_FILE_PATTERNS = [
  /^\/manifest\.webmanifest$/,
  /^\/icons\//,
  /^\/favicon\.(svg|ico)$/,
  /^\/apple-touch-icon\.png$/
];

const SHELL_CACHE = `sixty-shell-${version}`;
const PAGE_CACHE = `sixty-pages-${version}`;
const ASSET_CACHE = `sixty-assets-${version}`;
const CURRENT_CACHES = [SHELL_CACHE, PAGE_CACHE, ASSET_CACHE];

/** 缓存条目上限：导航按 URL 逐个存，否则一张张牌桌会把配额吃光 */
const PAGE_CACHE_LIMIT = 20;
const ASSET_CACHE_LIMIT = 40;

const SHELL_ASSETS = [
  ...build,
  ...files.filter((file) => SHELL_FILE_PATTERNS.some((pattern) => pattern.test(file)))
];
const SHELL_INDEX = new Set(SHELL_ASSETS);

/**
 * 开发模式下 kit 给的是**桩模块**：`build` 恒为空数组（见 kit 的 `create_service_worker_module`），
 * 而那时的资源都从 `@fs` / `src` 直接来。缓存它们只会让本地开发吃到上一版的代码，
 * 所以整条缓存路径关掉 —— dev 里这个 SW 只是被注册了，什么都不拦。
 */
const CACHING_ENABLED = build.length > 0;

const OFFLINE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>离线中 · 六十分</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;padding:1.5rem;text-align:center;color:#e8e2cf;background:radial-gradient(circle at 50% 30%,#17714f,#0d4432 48%,#072b1f);font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
<div>
<p style="margin:0 0 0.75rem;font-size:1.5rem;font-weight:700">离线中</p>
<p style="margin:0 0 1.25rem;max-width:20rem;line-height:1.7;color:#c9c2aa">六十分是一桌三人的线上牌局，要连上服务器才能继续这一副。网络恢复后点下面重试。</p>
<button type="button" onclick="location.reload()" style="padding:0.6rem 1.4rem;border:1px solid #d8b45a;border-radius:9999px;background:transparent;color:#d8b45a;font:inherit;font-weight:600;cursor:pointer">重试</button>
</div>
</body>
</html>`;

/*
 * 类型：应用 tsconfig 的 lib 是 DOM（没有 service worker 那套事件类型），
 * 而 `/// <reference lib="webworker" />` 会把那份 lib 加到**整个**工程、与 DOM 重复声明打架。
 * 所以这里只描述用到的那几只 —— 不改 tsconfig，也不引全局类型。
 */
interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface ServiceWorkerScope {
  readonly location: { readonly origin: string };
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
}

const sw = self as unknown as ServiceWorkerScope;

/** `/api` 与 `/api/**`：直通，不缓存、不改写 */
function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** 只留最新的 `limit` 条：`Cache.keys()` 按插入顺序返回 */
async function trimCache(cache: Cache, limit: number): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - limit;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

async function cacheFirst(request: Request, cacheName: string, limit: number): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit !== undefined) return hit;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    await trimCache(cache, limit);
  }
  return response;
}

async function navigate(request: Request): Promise<Response> {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimCache(cache, PAGE_CACHE_LIMIT);
    }
    return response;
  } catch {
    // 离线：先认这一条 URL，再放宽到「同一路径的另一份查询串」（如 /?join=CODE）
    const hit = (await cache.match(request)) ?? (await caches.match(request, { ignoreSearch: true }));
    if (hit !== undefined) return hit;
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
}

sw.addEventListener('install', (event) => {
  if (!CACHING_ENABLED) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !CURRENT_CACHES.includes(name)).map((name) => caches.delete(name))
      );
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (isApiPath(url.pathname)) return;
  if (request.headers.has('range')) return;
  if (!CACHING_ENABLED) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  if (SHELL_INDEX.has(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, SHELL_ASSETS.length));
    return;
  }

  event.respondWith(cacheFirst(request, ASSET_CACHE, ASSET_CACHE_LIMIT));
});
