# Android 安装包改用 Capacitor 壳（TWA 撤回）

`756e73f` 那条 TWA 路线整条撤回：删掉 `/.well-known/assetlinks.json` 与它的 `assetlinks.ts`、`deploy/twa/`，`apk.yml` 从 bubblewrap 换成 Gradle。改为 `apps/mobile/`：Capacitor 8 的 Android 工程，`capacitor.config.ts` 里 `server.url` 指向线上站点，`cap sync` 把它写进 `android/app/src/main/assets/capacitor.config.json` 再打进包。PWA 那半边（manifest、三张图标、`service-worker.ts`）**原样保留**，它跟壳不冲突，且 iOS 与桌面只有这一条安装路径。

**撤 TWA 的理由是它的两个前置条件都不在我们手里**：设备上得有一个支持 TWA 的浏览器（国内 ROM 常只有厂商浏览器，`fallbackType: "webview"` 只是把那种机器降级成带我们自己 WebView 的窗口），以及服务端必须吐出一条与签名指纹对得上的 assetlinks（配错不报错，只是悄悄退化成带地址栏的窗口）。Capacitor 把这两条一起去掉：系统 WebView 每个 ROM 都有，签名指纹只影响「能不能覆盖升级」，不影响「能不能装」。

**没有走「把构建产物塞进 APK」那条路，因为这个站没有可执行的前端对局**：牌局状态、身份、SSE 推送、MCP 全在服务端（ADR-0001、ADR-0002），`adapter-node` 产物是一个 Node 服务而不是静态目录。要离线打牌就得把引擎与存储搬进客户端，那是一次架构改造，不是打包工作。因此壳里的 WebView 直接加载 `https://<域名>`，`www/` 只剩一页 `offline.html`（`server.errorPath` 指向它，断网或 WebView 低于 `minWebViewVersion: 90` 时显示，页面里直接提示去更新 Android System WebView）。**代价要认**：首启必须联网；Capacitor 官方把 `server.url` 标注为 “not intended for production”（原意是给 live-reload 用）。接受这条的理由是它换掉了上面两个更硬的前置条件，且我们完全控制被加载的那份站点——同一份代码、同一条 CSP、同一次部署。

壳里**不注册 Service Worker**。SvelteKit 的自动注册关掉（`svelte.config.js` 的 `serviceWorker.register: false`），注册点挪到 `apps/web/src/lib/native-shell.ts`：非原生环境照旧注册（时机与形式对齐框架原来注入的那段——`load` 之后、经典脚本），壳内直接返回并顺手清掉 `sixty-` 前缀的缓存与已有 registration。理由是一次部署之后的陈旧：壳里的页面被 SW 缓存住，而壳不会开第二个标签页去触发更新，用户得彻底杀掉应用才能拿到新版；顺带也避开了 Capacitor 8 默认把 SW 请求再经本地服务器代理一遍。

**Gitee 登录在 `allowNavigation` 里放行 `gitee.com` 与 `*.gitee.com`**：那条流程是整页 302 出去、再 302 回来，而 `Bridge.launchIntent` 对「非本站 host 且不在放行表里」的导航一律 `ACTION_VIEW` 甩给系统浏览器——cookie 落在浏览器里，回到应用仍是未登录。放行后整条流程留在同一个 WebView 的 cookie 罐里。在系统浏览器里打开站点登录也照旧可用，**但那是另一个罐，两边不互通**；要互通得加 intent-filter 与一次性换取码端点，另立项目。

**返回键自己接管**（`MainActivity`）：核过 `@capacitor/android` 8.5.3 的源码——`BridgeActivity` 没有 `onBackPressed` 覆写，核心 `App` 类只剩状态通知，回退事件归 `@capacitor/app` 插件管。我们没引那个插件，不写这段的话按键就是「不论在哪一屏都直接退出应用」。现在用 `OnBackPressedDispatcher` 回调：`webView.canGoBack()` 就后退，退到底才交回系统。

签名材料按「泄露了会怎样」分类，与 TWA 时期同一口径：**secret** 只有 keystore 文件与两个口令；别名是 keystore 里的标签、证书指纹是公开信息，两者放仓库**变量**并被 CI 断言（指纹一变当场红，否则「换钥匙的包照样装得上、却永远升级不了已装的那份」只在发布当天被发现）。口令只经环境变量进 Gradle、只经 `-storepass:env` 进 keytool，keystore 解到 `$RUNNER_TEMP` 并在 `if: always()` 里删除。版本号也走环境变量（`SIXTY_VERSION_CODE` / `SIXTY_VERSION_NAME`），构建期取值不写回受版本控制的文件；缺 key 时 `taskGraph.whenReady` 直接抛 `GradleException`，**绝不产出未签名的 release**。

**三次本地构建各证明一件事**（缺一次就会漏一类错）：无密钥 debug 证明工程可编译；无密钥 release 必须红，证明拦截生效；一次性密钥 release 证明环境变量接线通了并出现 V2 签名。实测这三次抓到了两个只在真构建里出现的错：`versionCode (expr)` 少了等号（Groovy 派发成「调用还没赋值的属性」→ `IllegalArgumentException: Value is null`），以及局部变量与 `signingConfigs` 属性重名（`keyAlias keyAlias` → `No signature of method: java.lang.String.call()`，变量名加 `signing` 前缀解决）。Gradle wrapper 的首次下载在这台机器上 10s 超时（到不了 `services.gradle.org`）：临时把 `distributionUrl` 指向本机已有的 `gradle-8.14-all`，构建完**逐字节还原**并比对 sha256（`9A479A85…7435`），不提交那次替换。

资源侧三处必须自己改，模板给的都不合用：`res/values/colors.xml` 覆盖 `@capacitor/android` 的靛蓝 `colorPrimary`（否则启动画面与状态栏漏出别人的品牌色）；`ic_launcher_background` 从 `#FFFFFF` 改成毡面绿、前景换成自己的图（模板是 Capacitor logo）；启动图按各密度重画。自适应图标的前景缩在 108dp 画布的 **66dp 安全圆**内，`apk.test.ts` 里真解码 PNG 量最远像素，而不是相信生成脚本里的常量。

后果：APK 与域名在**构建期**绑定，换域名要重打；首启需联网；`minSdk 24`（Capacitor 8 的下限）、`targetSdk 36`；触发面只有手动与 `v*` 标签，永不在 `pull_request` 上跑（fork 拿不到 secret，PR 里也不该产出可安装的包）；Play 上架不在本期（不产 `.aab`）；iOS 没有这条路，仍靠 Safari「添加到主屏幕」。
