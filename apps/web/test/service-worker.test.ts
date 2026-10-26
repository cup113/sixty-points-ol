/**
 * Service Worker 的**源码**守卫（ADR-0026）。
 *
 * SW 一旦写歪，症状是「页面看着正常、但状态不再刷新」或者「离线打开是别人的牌」——
 * 前者是 SSE 被缓存了，后者是个人视图被写进了缓存。这类错浏览器不报、`svelte-check` 也不报
 * （它对 `self` 上的事件是弱类型的），所以照 `page-source.test.ts` 的套路对源码断言**顺序**：
 * 「`/api/` 直通」这件事必须在**任何**缓存逻辑之前 —— 顺序是这里唯一的保证。
 *
 * 判据都自带「抓到没有」的自检：命名一改，守卫当场红，而不是安静地空转。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/service-worker.ts', import.meta.url), 'utf8');

/** 剥掉注释：注释里写着「不许缓存 /api」不构成实现 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const sw = code(source);

/** 取一段源码；抓不到直接失败（改名 = 判据失效，不许静默通过） */
function slice(from: string, to?: string): string {
  const start = sw.indexOf(from);
  assert.ok(start >= 0, `源码里找不到「${from}」——判据要跟着改`);
  if (to === undefined) return sw.slice(start);
  const end = sw.indexOf(to, start + from.length);
  assert.ok(end > start, `找到「${from}」之后找不到「${to}」`);
  return sw.slice(start, end);
}

test('预缓存只取壳：build 产物 + 静态目录里挑出来的那几件，音效不预缓存', () => {
  assert.match(sw, /import\s*\{\s*build,\s*files,\s*version\s*\}\s*from\s*'\$service-worker'/, '没有从 $service-worker 取 build/files/version');

  const patterns = slice('const SHELL_FILE_PATTERNS = [', '];');
  assert.ok(patterns.includes('manifest\\.webmanifest'), '壳里没有 manifest');
  assert.ok(patterns.includes('icons'), '壳里没有图标');
  // 音效约 730KB：为它占首装流量不值（出厂两条音频通道本来就是 0）
  assert.equal(/sounds/i.test(patterns), false, 'SHELL_FILE_PATTERNS 又要预缓存音效了');

  const shellAssets = slice('const SHELL_ASSETS = [', '];');
  assert.ok(shellAssets.includes('...build'), 'SHELL_ASSETS 没有包含 build 产物');
  assert.ok(shellAssets.includes('files.filter'), 'SHELL_ASSETS 没有过滤 files');
});

test('`/api/` 直通排在所有缓存逻辑之前（SSE 与动作接口不许进缓存）', () => {
  const handler = slice("sw.addEventListener('fetch'", '});');

  // 自检：这一片里必须真的同时有「判断」与「回响应」，否则顺序断言毫无意义
  assert.ok(handler.includes('isApiPath('), 'fetch 处理器里没有 isApiPath 判断');
  assert.ok(handler.includes('event.respondWith('), 'fetch 处理器里没有 respondWith');
  assert.ok(handler.includes("request.mode === 'navigate'"), 'fetch 处理器里没有导航分支');

  const api = handler.indexOf('isApiPath(');
  // -1 不参与比较：缺失的那个入口由上面自检负责报，混进 Math.min 会把「没找到」当成「排在最前」
  const cached = ['respondWith(', 'caches.open(', 'cacheFirst(']
    .map((needle) => handler.indexOf(needle))
    .filter((index) => index >= 0);
  assert.ok(cached.length > 0, 'fetch 处理器里找不到任何缓存入口');
  const firstCached = Math.min(...cached);
  // 早退 return 必须在第一处缓存入口之前：这就是「直通」
  assert.ok(api < firstCached, 'isApiPath 排在缓存逻辑之后 —— SSE 会被缓存');

  // 函数本体也得真的是「/api 与 /api/**」
  const fn = slice('function isApiPath', '}');
  assert.ok(fn.includes("pathname === '/api'"), 'isApiPath 漏了裸 /api');
  assert.ok(fn.includes("pathname.startsWith('/api/')"), 'isApiPath 漏了 /api/**');
});

test('带 Range 的请求直通（音效用 new Audio() 流式播放，缓存整段会拖慢起播）', () => {
  const handler = slice("sw.addEventListener('fetch'", '});');
  const range = handler.indexOf("headers.has('range')");
  assert.ok(range > 0, '没有 Range 直通');
  assert.ok(range < handler.indexOf('respondWith('), 'Range 直通排在 respondWith 之后，等于没写');
});

test('开发模式整条缓存路径关掉（kit 的 dev 桩里 build 恒为空数组）', () => {
  assert.match(
    sw,
    /const CACHING_ENABLED = build\.length > 0/,
    'CACHING_ENABLED 不再以 build 是否为空判定：dev 里 build 是 []，这是唯一可靠的信号'
  );
  const install = slice("sw.addEventListener('install'", '});');
  assert.ok(install.includes('if (!CACHING_ENABLED) return;'), 'install 在 dev 里仍会预缓存');

  const handler = slice("sw.addEventListener('fetch'", '});');
  const guard = handler.indexOf('!CACHING_ENABLED');
  assert.ok(guard > 0, 'fetch 里没有 dev 早退');
  assert.ok(guard < handler.indexOf('respondWith('), 'dev 早退排在 respondWith 之后，等于没写：本地开发会吃到旧代码');
});

test('刻意不 skipWaiting：长开的牌桌标签不许被中途换代', () => {
  assert.equal(/skipWaiting/.test(sw), false, '又调用了 skipWaiting：正在打的一副会被换成另一份壳');
});

test('缓存按版本命名，activate 时清掉旧版本', () => {
  for (const name of ['SHELL_CACHE', 'PAGE_CACHE', 'ASSET_CACHE']) {
    const line = slice(`const ${name} = `, ';');
    assert.ok(line.includes('${version}'), `${name} 没按 version 命名，旧壳永远不会被换掉`);
  }
  const activate = slice("sw.addEventListener('activate'", '});');
  assert.ok(activate.includes('caches.keys()'), 'activate 没有列出现有缓存');
  assert.ok(activate.includes('caches.delete('), 'activate 没有删旧缓存');
  assert.ok(activate.includes('CURRENT_CACHES'), 'activate 没有按 CURRENT_CACHES 保留当前版本');
});

test('导航有离线兜底：先网络、失败回缓存、再失败给一页说明（不是空白页）', () => {
  const navigate = slice('async function navigate', '\n}');
  assert.ok(navigate.includes('await fetch(request)'), '导航没有走网络优先');
  assert.ok(navigate.includes('cache.match(request)'), '导航失败时没有回缓存');
  assert.ok(navigate.includes('OFFLINE_HTML'), '连缓存都没有时没有离线说明页');
  assert.ok(OFFLINE_HTML_HAS_RETRY(sw), '离线页没有重试入口（用户只能干看着）');
});

function OFFLINE_HTML_HAS_RETRY(text: string): boolean {
  return /OFFLINE_HTML\s*=\s*`[\s\S]*?location\.reload\(\)[\s\S]*?`/.test(text);
}
