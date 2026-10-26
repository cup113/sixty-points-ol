import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 壳的配置（ADR-0027）。
 *
 * 形态：WebView 直接加载线上站点（`server.url`），**不**把构建产物打进 APK ——
 * 这个站的对局状态在服务端（SSE + SQLite），没有可离线执行的静态站。
 * 代价写在 ADR 里：首启必须联网，Capacitor 官方也把 `server.url` 列为「不建议用于生产」。
 */

/**
 * 线上地址。它是**部署事实**，不是源码事实：本地 sync 用缺省占位，CI 由
 * `SIXTY_SERVER_URL`（或手动触发的 url 输入）覆盖，随后 `cap sync` 把它写进
 * `android/app/src/main/assets/capacitor.config.json` 再打进包里。
 */
const serverUrl = process.env.SIXTY_SERVER_URL ?? 'https://game.example.com';

const config: CapacitorConfig = {
  // 包名与应用名是仓库事实：改包名等于换一个应用（旧安装永远升不上来）
  appId: 'io.github.cup113.sixty',
  appName: '六十分',
  webDir: 'www',
  backgroundColor: '#0d4432',
  // 线上包里不要往 logcat 打调试日志
  loggingBehavior: 'none',
  server: {
    url: serverUrl,
    // 只走 https：Android 9+ 缺省就禁明文，这里钉住不给以后的人开口子
    cleartext: false,
    // 断网 / 内核过旧时加载的本地页（在 webDir 里，由 Capacitor 的本地服务器从 assets 提供）
    errorPath: 'offline.html',
    // Gitee 登录是整页 302 出去再 302 回来。缺省下站外链接被甩给系统浏览器，
    // cookie 落在浏览器里、回到应用仍是未登录；放行这两个域名让整条流程留在 WebView 内。
    allowNavigation: ['gitee.com', '*.gitee.com']
  },
  android: {
    // 低于这个内核直接走 errorPath，而不是白屏
    minWebViewVersion: 90,
    allowMixedContent: false
  }
};

export default config;
