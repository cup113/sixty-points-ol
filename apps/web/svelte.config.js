import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    // 不自动注册 Service Worker：注册点挪到 `$lib/native-shell`，
    // 因为 Capacitor 壳里必须**不**注册（ADR-0027）—— 壳里的页面被 SW 缓存住，
    // 下一次部署之后用户得彻底杀掉应用才拿到新版。浏览器里照旧注册。
    serviceWorker: { register: false }
  }
};

export default config;
