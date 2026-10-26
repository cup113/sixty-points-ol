import { base } from '$app/paths';

/**
 * Capacitor 壳里与壳外的差别，全部集中在这一个文件（ADR-0027）。
 *
 * 壳（Android APK）是一个 WebView，**加载的是线上站点**：这个项目的对局状态在服务端
 * （SSE + SQLite），没有可离线执行的静态站，所以壳里没有第二套代码。
 * 需要区别对待的只有一件事 —— Service Worker：
 *
 * - 壳内**不注册**。注册了它会把线上页面缓存一份在 WebView 里，下一次部署之后
 *   用户必须彻底杀掉应用才能拿到新版（SW 没有 skipWaiting，壳里也不会有第二个
 *   标签页来触发更新）。同时 Capacitor 8 默认还会把 SW 的请求经本地服务器代理一遍。
 * - 壳外（普通浏览器）照旧注册，离线壳、安装入口都靠它。
 *
 * SvelteKit 的自动注册已关（svelte.config.js 里 `serviceWorker.register: false`），
 * 注册的时机与形式对齐它原来注入的那段：`load` 之后、**经典脚本**（生产构建的
 * service-worker.js 不是 module）。
 */

type CapacitorGlobal = { isNativePlatform?: () => boolean };

/** 是否跑在 Capacitor 壳里。不引 `@capacitor/*`：壳会在文档开始前注入 `window.Capacitor`。 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

/** 客户端启动时调一次（`+layout.svelte` 的 onMount）。 */
export function bootShell(): void {
  if (isNativeShell()) {
    void retireShellCaches();
    return;
  }

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const register = (): void => {
    void navigator.serviceWorker.register(`${base}/service-worker.js`).catch(() => {
      // 注册失败（隐私模式、非安全上下文）不该影响页面本身
    });
  };

  if (document.readyState === 'complete') register();
  else addEventListener('load', register, { once: true });
}

/**
 * 壳里以前注册过 SW 的（升级上来的安装）把它与缓存一起清掉。
 * 正常安装是空操作：没注册过就没有 registration，也没有 `sixty-` 开头的缓存。
 */
async function retireShellCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;

  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith('sixty-')).map((key) => caches.delete(key))
  );

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}
