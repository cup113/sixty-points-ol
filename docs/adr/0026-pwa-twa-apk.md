# PWA 外壳与 Android 安装包（TWA）

> **已撤回**（见 ADR-0027）：PWA 那半边仍然有效；Android 安装包从 TWA 换成 Capacitor 壳，
> `deploy/twa/`、`/.well-known/assetlinks.json` 与 `SIXTY_TWA_*` 服务端变量都已删除。
> 下面保留的是当时的决策记录，不是现状。

站点按 PWA 标准补全：`static/manifest.webmanifest`（名/图标/standalone/主题色）、`static/icons/` 三张 PNG（192、512、maskable 512）、`app.html` 挂清单，以及 SvelteKit **内建**的 `src/service-worker.ts`（`register` 默认开，不引 `vite-plugin-pwa`）。Android 包走 **TWA（Trusted Web Activity）**：`.github/workflows/apk.yml` 在 `workflow_dispatch` 里用官方镜像 `ghcr.io/googlechromelabs/bubblewrap`（自带 JDK 17 与 Android SDK，构建镜像时已跑过 `yes | bubblewrap doctor`）从 `deploy/twa/twa-manifest.template.json` 生成工程并签名，产物是 `app-release-signed.apk`（直装）与 `.aab`。

理由：国内用户习惯「下载一个安装包点开装上」，而 Play 不在分发路径上；TWA 把**同一份**线上站点包成应用，不产生第二套代码（对比 Capacitor/原生壳：那要复制一层 UI 与鉴权，而本项目的身份、SSE、MCP 全在服务端）；`fallbackType: "webview"` 专治国内 ROM 常常没有支持 TWA 的浏览器 —— 缺省 `customtabs` 会把用户甩到系统浏览器或一个空页，`webview` 则留在应用内。SW 用框架自带机制而非 `vite-plugin-pwa`：那个插件的价值在预渲染工作流，而这里要的只有「壳缓存 + 一条不许缓存的边界」，自己写反而能把 `/api/` 直通写在第一行。

Service Worker 的边界都取正确性，不取新鲜度：`/api/`（含 SSE `/api/tables/<code>/stream` 与 `/api/mcp`）与带 `Range` 的请求**一律直通**，判断排在所有缓存逻辑之前；预缓存只有 `$service-worker` 的 `build` 产物与从 `files` 里挑出的 manifest/图标/favicon，音效（约 730KB）不预缓存、首次播放后进运行期缓存；导航 network-first（缓存上限 20 条），联不上网时回壳，连壳都没有就给一页带重试的离线说明。**开发模式整条缓存路径关闭**：kit 在 dev 里给的是桩模块、`build` 恒为空数组，而那时的资源直接从 `@fs`/`src` 来，缓存它们只会让本地开发吃到上一版代码。**刻意不 `skipWaiting()`**：牌桌页是长开标签，中途换代会把正在打的一副换成另一份壳，新版本等用户下次打开页面生效，`activate` 清旧版本缓存。代价是**缓存里留着换身份前的个人视图**，它与本机保存的凭据串属同一个信任边界（都在这台设备的浏览器里），因此不额外加一层清理 —— 清理漏一条路径的副作用是「看起来正常的旧画面」。

`/.well-known/assetlinks.json` 由 `apps/web/src/lib/server/assetlinks.ts` 从 `SIXTY_TWA_PACKAGE` 与 `SIXTY_TWA_FINGERPRINTS` 生成，与 Gitee 登录同一口径：**变量没配齐就 404（功能隐身），不发空声明**；配了但包名不合法或指纹不是 SHA-256 则**抛**（工具路由回 500）—— 这份声明写错不会「打不开」，只会让 TWA 悄悄退化成带地址栏的窗口，所以宁可当场红。指纹接受大小写、空格、漏冒号，统一归一化成 `AB:CD:…`。点开头目录路由能成立是核过的：SvelteKit 2.70.3 的路由扫描对所有子目录递归、没有点目录过滤；`.webmanifest` 的 MIME 也核过（adapter-node 产物的 mime 表里是 `application/manifest+json`）。

工作流有两条不能省的细节：`bubblewrap build` 在工程目录没有 `manifest-checksum.txt` 时会**交互询问**是否更新工程（CI 里没人回答），所以先跑 `update --skipVersionUpgrade`（全程无提示并写下 checksum）；签名密码走 `BUBBLEWRAP_KEYSTORE_PASSWORD` / `BUBBLEWRAP_KEY_PASSWORD` 两个环境变量（官方为 CI 留的口子）。签名材料按「泄露了会怎样」分类，不按「看起来敏感」分类：**secret** 只有 keystore 文件与两个口令（泄露 = 别人能发你的更新）；**别名是 keystore 里的一个标签、证书指纹是公开信息**，两者都放进仓库**变量**（把别名要求成 secret 只会在发布时因一个可推导的值卡住；把指纹当秘密则失去它的用处）——指纹因此被**钉住并断言**，指纹一变 CI 当场红，否则「换钥匙的包照样装得上、却永远升级不了已装的那份」这件事只在发布当天才被发现。口令进容器走环境变量、进 keytool 走 `-storepass:env`（`-storepass xxx` 会出现在进程列表里），keystore 解到 `$RUNNER_TEMP`（工作区之外，任何 artifact 通配都扫不到）并在 `if: always()` 的步骤里删掉。没配 `ANDROID_KEYSTORE_B64` 时现场生成一次性 keystore 并告警 —— 那种包的指纹每次都不同，assetlinks 对不上，只能用来试装。

后果：**域名必须公网 HTTPS 可达**（bubblewrap 生成工程时要拉 `iconUrl` 与 `webManifestUrl`），APK 与域名一一绑定，换域名要重打包；触发面只有手动与 `v*` 标签，**永不在 `pull_request` 上跑**（fork 拿不到 secret，PR 里也不该产出可安装的包），标签构建的域名/包名/应用名从仓库变量读；改分包名或换签名证书 = 指纹变 = 服务端 `SIXTY_TWA_FINGERPRINTS` 要跟着改并重装；没配 assetlinks 时 APK 仍能装能用，只是带着浏览器地址栏；局域网 http 部署没有 SW 也没有安装入口（非安全上下文的硬限制），与既有现状一致；微信/QQ 内置浏览器里没有安装入口，那里的分享链接只能当**下载**入口，不是 PWA 的落地场景；长开标签会一直用旧壳直到重开页面；Play 上架不在本期范围（`.aab` 已产出，要上架时再接 `bubblewrap play publish` 与 service account）。
