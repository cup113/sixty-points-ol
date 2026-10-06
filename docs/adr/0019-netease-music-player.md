# 网易云音乐悬浮窗：旁挂服务 + 白名单代理，与主功能零耦合

**动机**：牌桌上一副牌动辄十几分钟，等对手出牌的空档很长；想听点什么就得切到另一个标签页，切走就看不到牌桌。
所以这次在牌桌页右下角加一个可拖拽的网易云音乐播放器。唯一的硬约束是**与主功能完全解耦** ——
牌局是主线，音乐是可选旁挂件：它不该给牌局带来新依赖、新失败点、新数据表；关掉它时，牌局一个字节都不变。

## 上游：`@neteasecloudmusicapienhanced/api`

- 原版 `Binaryify/NeteaseCloudMusicApi` 的 GitHub 仓库已删库停更，续作里 `@neteasecloudmusicapienhanced/api`
  是维护得最完整的那个：**MIT**、npm 上持续发版（本次核对 2026-10-06：latest `4.41.1`），
  官方镜像 `moefurina/ncm-api` 也在更新（Docker Hub 上 11 万+ 拉取）。以后要换别的实现，只改 `SIXTY_MUSIC_API`。
- 网易云那套加密与签名（weapi / eapi）是逆向出来的、随客户端版本漂移，**我们自己不写**，
  也**不把它装进主仓库**：那个包 13MB（tarball 13.4MB、解包 15.3MB）、17 个直接依赖（本次核对 latest
  的 `unpackedSize` 与 `dependencies`），装进 `apps/web` 等于把整棵依赖树、它的升级节奏与它的安全面一起搬进来。

## 决定

- **旁挂服务（docker compose 的 `ncm` 服务）+ 本仓库 `/api/music/[op]` 白名单代理**：浏览器只跟本站说话，
  「谁去连网易云、连哪个地址」是部署者的事。主仓库**零新增 npm 依赖**。
- **浏览器从不直连网易云，也不直连边车**：边车默认 `CORS_ALLOW_ORIGIN=*`，把它的地址交给前端等于把内网服务
  变成人人可用的开放代理；而且会话凭据（`MUSIC_U` 那一串 cookie）必须留在服务端 —— 我们把它存进自己的
  **httpOnly cookie `sixty.music.session`**（`sameSite=lax`、30 天、不强制 `secure`，因为内网部署常是 http），
  前端只拿 `{ loggedIn, nickname, userId, vipType }`。XSS 也偷不走它，它本来也不该被页面脚本看见。
- **白名单就是全部**：`MUSIC_OPS` 里 18 个 op —— `search` / `songUrl` / `songDetail` / `lyric` /
  `loginQrKey` / `loginQrCreate` / `loginQrCheck` / `logout` / `loginStatus` / `recommendSongs` /
  `personalizedPlaylist` / `toplist` / `playlistDetail` / `playlistTrackAll` / `userPlaylist` / `likelist` /
  `songLike` / `recordRecent`；参数逐条校验（`buildUpstreamRequest` 是纯函数：未知 op 404、必填缺失或
  非法 400、未知参数直接丢掉）。上游公开 400+ 个端点，改名 / 上传 / 删除 / 投币 / 云盘之类一个都不放行 ——
  它不是开放代理。（`playlistDetail` 界面暂未用到，先留在表里：那是「点开歌单看详情」这个读接口的位置。）
- **音质由登录态推出**：`qualityTierOf(vipType, preferred)`，匿名恒 `standard`。不把档位写成配置文件里的
  死值 —— 给匿名用户配 `lossless` 只会让每一次取地址都拿到 `url: null`，看起来像「这歌没版权」。
- **只挂牌桌页**：`+page.svelte` 一行 import + 一行 `<MusicDock>`。离开牌桌即卸载、音乐停止；
  不进 `+layout.svelte` —— 全站常驻会把音乐插进全局布局，牌局之外的页面不该为它付首帧成本。
- **硬开关 `SIXTY_MUSIC=off`**：悬浮窗不渲染、`/api/music/*` 一律 404（连「有没有这个功能」都不暴露），
  牌局功能一个字节不变。这是给「不想在这台机器上连网易云」的部署留的总闸。
- **四个环境变量**：`SIXTY_MUSIC`（只有字面量 `off` 才算关，默认开）、`SIXTY_MUSIC_API`
  （边车地址，默认 `http://127.0.0.1:4000`；compose 里是 `http://ncm:4000`）、`SIXTY_MUSIC_TIMEOUT_MS`
  （单次上游请求超时，默认 5000，夹在 500–30000 之间）、`SIXTY_MUSIC_LEVEL`（登录用户的音质偏好，默认 `exhigh`）。
- **只对读重试一次**：客户端对幂等的读（GET）失败重试一次，写（`songLike` / `logout`）一次都不重发 ——
  服务端没有幂等键，重发会让「喜欢」多喜欢一次。重试的判据是「这个 op 幂等」，不是「这个错误看起来能重试」；
  这与 ADR-0012 的「写路径不重试」是同一条纪律。
- **上游各种坏法一律收敛到 503**：超时、连不上、非 2xx、返回的不是 JSON，全部落成 503（`code` 区分
  `timeout` / `upstream`），于是前端只有一条判断（5xx 就重试），不必去认它改变不了行为的 502/504。
  非 JSON 的响应如实说「音乐服务返回了看不懂的内容」，绝不把一段 HTML 塞进界面。
- **功能分两层**：匿名可用（搜索、播放、队列、歌词，以及白名单里的公开读：个性化推荐、榜单、歌单详情与曲目）
  + App 扫码登录（我的喜欢、自己的歌单、最近播放、日推、喜欢 / 取消喜欢）。**不做手机号验证码登录**。
- **与同时开着的 PR #7（`feat/bg-music`：本地 CC0 背景音乐 + 音效 + 震动）的关系**：两条独立音频通道
  会互相盖住。接口只用 DOM 事件（`apps/web/src/lib/music/bus.ts`：在 `document` 上派发 `sixty:music`，
  detail `{ playing: boolean }`），**两个模块互不 import**。PR #7 先合并了，所以让位由它那一侧落地：
  `SoundBoard.yieldToPlayer()` 把「给点播让位」并进 `#musicShouldPlay()`（= 音量 > 0 且标签页可见
  **且没在让位**），悬浮窗一出声 BGM 就暂停，一停就按**原音量**接回来 —— 让位不动音量滑块的值、
  也不落盘（临时状态）。名字写岔会**静默失联**（BGM 不再让位但仍会响，不报任何错），
  所以 `sound.test.ts` 从两端各抠一次常量名比对，并配了三条反证。
- **命名**：叫**音乐悬浮窗**，不叫「背景音乐 / 音效」（那是 PR #7 的**声音反馈**，另一条通道），
  也别叫「内置播放器」——它放的是外部的网易云，仓库里没有任何音乐内容。已记进 `CONTEXT.md`。

## 被否的替代

- **把 API 包装进 `apps/web` 依赖、进程内 require**：13MB 的包与 17 个传递依赖进主仓库，
  与「完全解耦」相悖，它的升级与安全公告从此变成我们的。
- **浏览器直连边车**：CORS `*` 等于开放代理，凭据进 JS —— 一次 XSS 就交出一个网易云账号。
- **无白名单的通用转发**：等于开放代理，上游 400+ 端点里能改账号数据的全在射程内。
- **挂在 `+layout.svelte` 全站常驻**：把音乐插进全局布局，切页不断音乐；也等于让每个页面都为它付首帧成本。
- **页头加一个入口按钮**：页头是紧俏位置，`table-chrome.test.ts` 有一份页头白名单（往页头加一样东西
  就要显式改它，上一个功能「上一轮」回看刚往这个文件里加过一组判据）；悬浮窗是可拖拽的旁挂件，
  本来就不占页头。
- **手机号验证码登录**：那要求用户把手机号交给这台自建服务器；扫码全程凭据只走「我们的服务端 → 网易云」一跳。
- **缓存音频 blob 做离线播放**：直链有时效，缓存就要处理失效与配额；播放器不做本地库，离线是另一个产品。
- **用 `BroadcastChannel` 让多标签页共用一个播放器**：多开两张桌时两处都在放，谁说话、谁暂停都是新规则；
  本机视野与队列存 `localStorage` 已经够用。

## 后果与守卫

- **改动面**：牌桌页 1 行 import + 1 行标签；`+page.server.ts` 多两个字段（`musicEnabled` / `musicLevel`）。
  悬浮窗在 `onMount` 之前不渲染，所以 `ui-check` 对牌桌 SSR 首帧的断言不受影响。
- **守卫**：`apps/web/test/music.test.ts`（纯函数：歌词解析、队列、播放决策、白名单与参数校验、配置、
  客户端重试语义、代理转发、本机存储）；`apps/web/test/music-guard.test.ts`（解耦守卫：进向 / 出向 /
  服务端那半三个方向，各带反证）；`apps/web/scripts/music-check.ts`（真服务端端到端，含假 ncm-api 桩，
  CI 里跑：白名单 / Origin / 会话 cookie / 音质 / 失败收敛 / `SIXTY_MUSIC=off` 六组）。
- **测试与实机结果**：`pnpm test:web` 302（新增 `music.test.ts` 48 + `music-guard.test.ts` 9）、
  engine 91、bot 57、mcp 91，全绿；`pnpm check` 0 error 0 warning；`pnpm build` 通过。
  `pnpm music-check`（含假边车）通过；仓库自带的 `ui` / `lobby` / `spectate` / `smoke` / `resume`
  五个端到端脚本对着构建产物也全过。另外用真浏览器（Playwright + Chromium，未进仓库）
  走了 34 条：拖拽 / 位置记忆 / 收起展开 / 搜索 / 点歌出声 / 进度 / 歌词高亮与翻译 / 队列 /
  暂停继续 / 播放模式 / 音量落盘，全过。
- **已知边界**：音频直链有时效（播到一半可能失效，界面如实说一句并让用户点下一首，不自动重放）；
  真正出声的那一段只能人工试听（`player.svelte.ts` 用 rune，`node:test` 直接 import 会 `$state is not defined`）；
  不做离线、不做多标签页共享、不做手机号登录。
- **三个只有真浏览器才能发现的缺陷**（纯函数测试全绿时它们都活着 —— `player.svelte.ts` 用 rune，
  `node:test` 进不来这一层）：`view` 曾是**普通字段**（改坐标不触发重渲染，拖动「写进了 localStorage
  却纹丝不动」）；页头的 `setPointerCapture` **吃掉子按钮的 click**（「收起」点了没反应）；
  窗口只接了 `onDragStart`（按住页头拖不动，而搜索/播放/队列全都正常）。留下一条通用教训：
  **挂在 `fixed` 上的可拖拽浮层，拖动、收起、点击这三条路径都要在真浏览器里各点一次**。
