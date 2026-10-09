# 六十分（Sixty Points）线上版

三人 1v2 的顺子类牌戏：一副 54 张，桥牌式叫牌定庄定将，双升式打牌与升级赛程。线上实现为
SvelteKit + SSE 单实例应用，规则引擎是零依赖纯 TypeScript 包并有完整单测/属性测试。

[![CI](https://github.com/cup113/sixty-points-ol/actions/workflows/ci.yml/badge.svg)](https://github.com/cup113/sixty-points-ol/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/github/license/cup113/sixty-points-ol?label=license)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-386-3fb950)](https://github.com/cup113/sixty-points-ol/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/cup113/sixty-points-ol)](https://github.com/cup113/sixty-points-ol/commits/main)
[![Node](https://img.shields.io/badge/node-24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-11.22-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)

[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/docs/kit)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Docker image](https://img.shields.io/badge/ghcr.io-sixty--points--ol-2496ED?logo=docker&logoColor=white)](https://github.com/cup113/sixty-points-ol/pkgs/container/sixty-points-ol)

## 目录

```
packages/engine     纯 TS 规则引擎（零依赖，可被服务端与客户端共用）
  src/              cards / order / validate / trick / auction / state / view / help
  test/             node:test 表驱动 + 属性测试（默认 60 个随机整局，GAME_SEEDS 可放大）
packages/bot        机器人策略（零依赖，只 import 引擎；纯函数「个人视图 → 动作」，见 ADR-0015）
  src/              policy（叫牌/埋底/出牌）/ sight（记牌与拆链）/ sim（机器重演：结算过的牌重打一遍）
  test/             表驱动单测 + 整局属性测试（三个机器人直驱引擎打完整场）+ 纯净守卫 + 重演自洽
packages/mcp        MCP 工具面（stdio 入口 + 与传输无关的工具定义，两条传输共用）
  src/              tools（工具表）/ server（挂到 SDK）/ http-api（stdio 取数）/ bootstrap（启动判定）/ wire / stdio
  test/             node:test：工具层单测 + 内存链对上的协议单测 + stdio 启动契约
  scripts/          mcp-check.ts（两条传输各打一整副 + 形状/在线/权威守卫）
apps/web            SvelteKit 2 + Svelte 5 + Tailwind 4 + adapter-node
  src/lib/server/   SQLite（node:sqlite）、身份凭据、牌桌服务、SSE hub、MCP 进程内适配层、机器人调度、
                    机器重演存档（replays，结算时同步算好，见 ADR-0016）
  src/routes/       大厅、牌桌页、规则演示（/learn）、文字教程（/rules）、牌局编排台（/studio）、
                    REST 动作接口（含入座/离座/加机器人）、SSE 流、MCP（/api/mcp）
  src/hooks.server.ts  启动时补扫机器人回合（重启自愈，见 ADR-0015）
  src/lib/tutorial/ 演示页的幻灯片模型（deck.ts）与示例数据（scenarios.ts）
  src/lib/tutorial/stories/  由 docs/deals 生成的故事数据（勿手改，见 ADR-0010）
  src/lib/story/    牌局编排台的内核：种子↔牌局、回放、说明标签、导出/导入、草稿存储
  scripts/          smoke.ts（三人 HTTP 端到端 + 机器重演存档逐副核对）、resume-check.ts（重启续局校验）
                    lobby-check.ts（开局入口回归）、ui-check.ts（版面与文案守卫）
                    spectate-check.ts（观战/离座/改名换身份的端到端回归）
                    bot-check.ts（1 人 + 2 机器人打两副 + 中途踢/补的端到端）
                    shot-auction.ts（版面**几何**验收：自拉 vite dev + 无头 Chromium，截图并实测关键几何后断言）
                    build-deal-stories.ts（牌局 JSON → 演示页数据 + 复核清单）
CONTEXT.md          领域词汇表（术语与已敲定的规则歧义）
docs/adr/           架构决策记录
docs/deals/         牌局故事：<slug>.json（牌手导出，原话不改）+ notes/（润色与补写）+ <slug>.review.md（逐条复核）
```

## 规则实现要点

- 一副牌无对子，多张出牌即「单张顺子」；副牌顺子跳过级牌，主牌顺子按全序
  `…A < 副级 < 主级 < 小王 < 大王` 相邻，且至多含一张副级牌。
- 打牌中三张副级牌完全相等（花色序只用于叫牌），平张先出为大。
- 跟牌「结构优先」：所选 n 张的连续段分解必须字典序最大（领 4 顺持 3+2 必出 3 顺 + 任 1 张）。
  实现见 `packages/engine/src/order.ts` 的 `segments`/`bestProfile`（按最长连续链贪心抽取）。
- 结算：庄家抓分 ± 底牌分 × 末轮张数；打成按 40/60/70/80/90+ 升级表，打输则两名闲家各升
  `ceil(差/10)` 级；两家达 2(+2) 或一家达 2(+3) 结束，总进度最高者为冠军。

细节与全部已敲定决策见 `CONTEXT.md`；架构理由见 `docs/adr/`。

## 本地运行

```bash
pnpm install          # 工作区依赖（esbuild 的构建脚本已显式关闭，见 ADR-0004）
pnpm test             # 规则引擎测试（node:test，零额外依赖）
pnpm test:bot         # 机器人策略测试：叫牌/埋底/出牌表驱动单测 + 整局属性测试（3 个机器人打完一场）
                      #                 + 纯净守卫（策略只许依赖引擎、无 IO/随机）
pnpm test:web         # 前端纯函数测试：扇形布局 / 邀请码解析 / 阶段说明 / 牌面映射 / 结算门槛 / 教程示例 /
                      #                   牌局编排台（回放·导出·草稿）/ 说明标签 / 牌局故事完整性 / 演示页结构 /
                      #                   角色与观战投影 + 在线态判定 + MCP 作弊面守卫 + 叫牌面板可达性（唯一滚动区、「不叫」钉底）
                      #                 + 机器人座位的进程内集成（延迟调零：打完一副、补位、权限与上限、
                      #                   踢出语义、身份认不出、重启自愈）+ 机器人作弊面守卫
pnpm test:mcp         # MCP 工具层单测：工具语义、参数校验、等待超时、协议注册一致性、stdio 启动契约
pnpm check            # 引擎 tsc + 机器人包 tsc + MCP 包 tsc + 应用 svelte-check
pnpm dev              # SvelteKit 开发服务器（默认 http://localhost:5173）
pnpm build            # 产出 apps/web/build（adapter-node）
pnpm start            # 跑构建产物（默认端口 3000，见下）
pnpm deal             # 把 docs/deals/*.json 重生成演示页数据 + <slug>.review.md
pnpm deal:check       # 只校验：仓库里的生成物是否等于现场重算（不改文件）
```

改牌局讲解的流程：在 `/studio` 里改并重新导出 `docs/deals/<slug>.json`，把润色/补写写进
`docs/deals/notes/<slug>.json`，然后 `pnpm deal`（生成物是提交进仓库的，所以 CI 与镜像构建不需要跑脚本）。
`pnpm deal:check` 会在「手改生成物」或「改完源文件忘了重跑」时报红。

环境变量：`PORT`（默认 3000）、`HOST`、`SIXTY_DB`（默认 `<cwd>/data/sixty.db`）。

> ⚠️ **不要设置空的 `ORIGIN`。** 留空（例如 Compose 里的 `ORIGIN=${ORIGIN:-}`、`ORIGIN=` 或 `ORIGIN=""`）会让
> adapter-node 直接拒绝启动：
> `Error: Invalid ORIGIN: ''. ORIGIN must be a valid URL with http:// or https:// protocol.`
> 不定义该变量时服务端会按请求头推导来源，反代部署正是想要这种行为；确实需要固定来源时，写成完整 URL
> （如 `ORIGIN=https://game.example.com`）。留空 ≠ 不设置，这是两回事。

端到端冒烟（需先启动服务端）：

```bash
BASE=http://127.0.0.1:5178 pnpm --filter web smoke     # 3 个身份打完 N 副（DEALS=n），含 SSE 推送校验
BASE=http://127.0.0.1:5178 pnpm --filter web lobby     # 开局回归：未开局必须渲染「开始第一副」按钮 + 三个座位都列出玩家名
                                                       # 另含「未注册点邀请链接」：邀请码带进大厅、注册后回到原桌
BASE=http://127.0.0.1:5178 pnpm --filter web ui        # 版面/文案守卫：position 类不得混用、毡面是三行格（顶行两张对手卡
                                                       #   走正常文档流、不许自己定位），邀请码可点复制、常驻提示已清空、
                                                       # ? 按阶段给说明、无方位称谓、
                                                       # /rules 九个小节齐备且渲染真实牌面、
                                                       # 王牌面（名字只在角落索引、正中是 ☀/☾ 图案）、
                                                       # 出货样式表里不得再有牌角装饰点（.card.pt / .card.trump::after）、
                                                       # 叫牌面板是唯一滚动区、「不叫」在它之后、走正常文档流且不可 sticky
                                                       # 动作托盘住在毡面之外那条动作带里（旧锚 bottom-full 会压住「我」的底栏）
                                                       # 收墩后的徽标只说「庄 +N 分 / 闲 +N 分」，同时出现「上一轮」回看入口
                                                       #   （浮层默认关着，SSR 首帧里没有 data-trick-review）
                                                       # /learn 有幻灯片语义与自动播放、深链 ?s=245-trick-8 必须直接
                                                       #   服务端渲染出那一墩的牌面、大厅与 /rules 都指向它
BASE=http://127.0.0.1:5178 pnpm --filter web resume    # 重启服务端后再跑，校验 SQLite 续局
BASE=http://127.0.0.1:5178 pnpm --filter web spectate  # 观战/离座/改名换身份：满座第 4 人只看公共信息、
                                                       # 观战负载不含在座手牌、补位继承该座位的手牌与级别、
                                                       # 在座不能改名或换身份、改名后旧凭据失效
BASE=http://127.0.0.1:5178 pnpm mcp-check              # MCP 端到端：两条传输各打一整副（stdio 真 spawn + /api/mcp）
                                                       # 顺带核对 wire 形状、MCP 座位的在线态、以及非法出牌必被服务端拒绝
BASE=http://127.0.0.1:5178 pnpm bot-check              # 机器人端到端：1 人 + 2 机器人打两副；人类座位也由**同一份策略**出手，
                                                       # 所以顺带证明策略给出的动作真的被服务器接受；另含
                                                       # 未入座者加不了 / 第 3 个被上限挡住 / 踢出后本副停在空座 / 补位接着打完
pnpm shot                                              # 版面**几何**验收（自拉 vite dev + 无头 Chromium，不需要 BASE）：
                                                       # 逐个阶段截图并**量**关键几何后断言 —— 两行候选档位的同一列必须
                                                       #   对齐（360px 窄屏上是被 flex 压窄才错开的，390px 上量不出来）、
                                                       #   叫牌历史容量 ≥3 行、内容槽与顶卡/底栏零相交、非座位层都在内容槽里、
                                                       #   出牌三簇互不相交、托盘整个落在动作带内。产物在 apps/web/.shots/
```

冒烟脚本用 `data/smoke-run.json` 保存凭据供续局校验使用。

> 受限沙箱（piped stdio 一律 EPERM，见 AGENTS 规则 5）里 `mcp-check` 要加 `SPAWN=0`：
> 它改用 SDK 的内存链对驱动同一套工具表，只是不起 stdio 子进程；
> stdio 那条进程级契约由 `pnpm test:mcp` 里的启动契约测试覆盖（同样需要能 spawn 子进程）。

`bot-check` 想跑快就给服务端把拟人延迟调零：`SIXTY_BOT_DELAY_MIN_MS=0 SIXTY_BOT_DELAY_MAX_MS=0`
（CI 就是这么跑的；默认 0.5–1.5 秒是给人看的节奏）。

## 界面约定

- **说明只在一处**：牌桌上的阶段玩法说明全部收在左下角的「?」弹层（内容与 `/rules` 教程同源，
  见 `packages/engine/src/help.ts`）；界面上不再有常驻提示文案，玩家不需要在三个角落各读一遍。
- **三处讲解分工**（见 CONTEXT.md）：牌桌「?」弹层是**打牌时的即时说明**（按阶段给）、`/learn` 是**演示**
  （幻灯片，含三副真实牌局的逐步讲解）、`/rules` 是**逐段查证**的长文。三者共用术语与被引擎核对过的示例，
  不互相复制整段文本；`/learn` 是默认入口（大厅与 `/rules` 都指它），两边互链。
- **玩家名而不是方位**：文案里一律用玩家名或「你」（`whoLabel`），不出现「东/南/西家」——
  座位卡显示的就是名字，而**座位在屏幕上没有锚点位置**。
- **毡面是三行格**（ADR-0020）：`[顶行：两张对手卡][内容槽][底行：「我」那条底栏]`。
  阶段状态条、出牌区、埋底面板、叫牌面板、大厅面板**全部**住在中间那格（`data-felt-row="slot"`）——
  它们的上下界由槽给出，**自己一个偏移都不写**。早先这些层各自绝对定位（`top-[4.5rem]` /
  `top-[22%] max-h-[56%]` / `top-36`…），每个都自己算偏移，于是手机短屏上状态条压住埋底槽位、
  叫牌面板压住座位卡、动作托盘压住「我」那张卡。三行格把这些变成**结构上不可能**：
  非座位层出不了内容槽，而三道行边界互不相交。
  这张版面**源码守卫看不见几何**，所以除源码/出货 HTML 守卫外还有 `pnpm shot` 的实测断言。
- **动作带**：毡面与操作条之间那条常驻的空带归属**动作托盘**（出牌 / 确认埋底 / 清空）。
  托盘原先钉在操作条上沿，而那 40px 整根落在毡面的最后 40px 里 —— 手机 375px 上它与自己的座位卡
  竖直重叠 32px、水平重叠 84px。「把座位卡抬高」只是把同一块地方换个方式占掉，所以这一带要有个
  明确归属。带子常驻（不分轮到自己还是轮空），所以切换时毡面与手牌零回流。
- **拟选**（ADR-0021）：在座玩家**没轮到自己**时也能点牌（选中态照旧上浮＋金条），有人领出后
  每个人都看得到「该跟哪一门」的蓝框。牌局推进（别人出牌、收墩、换轮次）**不**清掉你正在拟的牌；
  只有「这些牌已经不在我手上」才清。合法性仍由托盘的 `checkPlay` 在你出手那一刻判。
- **机器人** 的座位与人类没有区别，身份标记只有**头像里那枚内联 SVG**（不用 emoji：各平台字体不同、
  有的会渲染成彩色图片，在 36px 的圆里对不齐）；名字前缀「机器人·」是服务端给的**身份名**。
  加/请离它的入口在抽屉「牌桌」页 —— 它们是「改一张桌子」，与入座/离座同类；
  叫牌/埋底/出牌/结算这些**牌局动作**仍一律留在桌面。
- **点邀请码即复制链接**：`<origin>/table/<邀请码>`；大厅的入座框既接受 6 位邀请码，也接受直接粘贴的完整链接
  （`parseInvite`）。局域网 http 下浏览器没有 Clipboard API，会自动退化成可手动复制的链接输入框。
  还没注册的人点开链接会被带到大厅，但**邀请码随 URL 一起带过去**（`/?join=<邀请码>`）：注册或导入身份后
  自动回到那张桌，不需要重新点一次链接。
- **无重复信息**：同一件事只说一遍（如「庄已抓 X / 需 Y」里的分母就是旁边的定约分，只保留一个）。
- **「上一轮」回看**：机器人出手只有 0.5–1.5 秒，收墩后**赢家立刻领出**下一轮，而出牌区只显示正在打的
  这一墩 —— 上一墩三家出的牌一晃就过。所以状态条上常驻一枚「上一轮」入口（收过墩才出现，排在「定约 /
  庄已抓」之后），点开是一个**只覆盖毡面**的浮层：按出牌顺序竖排三家这一墩的牌（每行写着是谁出的，
  赢家那行带 `庄 / 闲 +N 分`），表头是「上一轮 · 第 N 轮」。它**不占整屏**（手机端抽屉是整屏，看回看时
  就看不到手牌了），手牌始终可见、可继续选牌；Esc / × / 点毡面背景都能关，默认关着。只看最近一墩
  （整份 `trickHistory` 本来就在负载里，观战者也有；要往前翻只是加一个下标）。徽标文案一字不改 ——
  「上一轮」二字只属于入口与表头。
- **牌面**：主牌靠**浅金底色**区分（早先用金边，但在缩略牌、重叠扇面与斜摆的墩里几乎认不出来）；
  四个角没有任何装饰点（点看着像另一张牌）；分牌就是 5 / 10 / K，认点数即可。
  大小王按真牌的布局：**牌名只在两处角落索引里**（「大/小 + 王」），两处镜像一致；**正中是一枚图案**（大王 ☀ / 小王 ☾）。
  牌名在牌上只出现一次，不会角落与正中各写一遍（`cardFace`）。
- **新手教程**：`/rules` 复用牌桌同一套牌渲染组件（`Card` / `HandFan` / `LevelBadge` / `TrickCluster`），
  含两道练手题（用与服务端同源的 `checkPlay` 即时判定）。依赖级牌的每个示例都标出将牌环境（`trumpText`），
  升级表只列**真实可达**的分数（得分恒为 5 的倍数），叫牌一节讲清阻击叫的心理博弈。
  教程里每个示例都由引擎函数在 `test:web` 中核对，规则改动导致示例失效会直接测试失败。
- **观战与离座**：满座（3 人）时用邀请链接进来即成为观战者，只看**公共视图**（手牌张数与已打出的牌，
  不含任何手牌与结算前的底牌）；在座者随时可点「离座」，座位空出、本副停在空座上等人补位，
  补位者继承该座位的级别与手牌（若本副尚未结算，界面会明说「你补进了空座、接下这手 N 张牌」，免得拿着
  陌生手牌发愣）。观战人数（实时连接数）在页头右上角，座位状态在右侧活页签抽屉的「牌桌」页里。
  不在座位上时才能改名字或换身份 —— 改名会让凭据串重签，大厅与观战页都会把新串写回本机。
  观战记录不会自动清除（只有入座才清），所以大厅「我的牌桌」会一直列出你在观战的那张桌（上限 20 条）。
- **机器人（凑桌陪练）**：在座的任何人类都能在**空座位**上点「+ 机器人」凑桌，一桌至多 2 个
  （至少留一个人类座位去按「开下一副」—— 机器人从不发起发牌）。进行中加入就是**补位**：它接手这个座位
  现有的手牌与级别，这一副接着打完。机器人座位卡照旧显示名字与在线点，只多一枚「机器人」徽标和一个
  「请离」入口（离座语义：本副停在空座等补位，界面会先说清）。它**没有凭据串**，所以没人能冒充或接管它；
  它的动作走与人类完全同一条服务器权威路径，也只看得见**个人视图**（见 ADR-0015）。
  屏幕上它出手有点慢（0.5–1.5 秒拟人延迟），那是给人看清局面用的。
  牌风上是「稳」而不是「怂」：叫牌恒开 40、不跳叫，但门槛不高 —— 实测开叫率约五成、竞叫约三成，
  全 pass 重发只剩 5%（初版是 36%），所以别指望它每次都把庄家位让给你；埋底默认不埋分，
  只有主牌控制到「几乎必然保住末轮」时才埋不超过 10 分（约四分之一的副数），
  于是「机器人做庄必然 0 分底」并不成立。
- **机器重演（Bot replay，见 ADR-0016）**：每副牌**结算那一刻**，服务端用**机器人策略**把
  **整副牌（含叫牌）**重打一遍并存档；战报的每副卡卡尾、结算弹窗的升级表下方各有一枚
  「机器重演」按钮，点开就是「换三个机器人来打会怎样」的对照。它**不是**模拟 —— 没有搜索、
  没有随机，同一副牌永远是同一个结果。定约与庄家可能与真实那副不同（重演连叫牌一起重走），
  所以展开体头行写的是**重演的**定约；重演自己也可能三家 pass（约 5%），那时如实说
  「机器人全 pass · 这副会被作废重发」，不靠重试凑一个定约出来。重演看的是「**这副牌**」
  而不是「当初那桌」—— 手牌序没有保存，而策略的取舍与下标有关。升级到这一版之前结算的老副
  没有记录，点开会说一句；**升级表模式里没有这个入口**（它说的是真实进度）。
- **手机端页头与右侧活页签抽屉**：页头只留 `← 大厅`、邀请码，以及右上角的**桌况簇**
  （观战人数含 0 常显；在座给「离座」、不在座给「改名」，有空座才多一枚「入座」—— 补位有时限，
  不藏起来）。两次「页头爆满」堆进去的都是**查阅**入口，而这一簇是有界的一行，所以它留在页头。
  **连接状态不是常驻指示器**：绿点已下线 —— 手机上没有 hover 能解释一枚圆点，
  而它平时显示的恰恰是「什么都没发生」；只有 SSE 断开时才在页头下方出一条
  `连接中断，正在重连…画面可能停在上一帧。`（`role="status"`，重连成功即自动消失）。
  其余收进右边缘**常驻**的四个活页签 `战报 / 叫牌 / 底牌 / 牌桌`：点一个从右侧
  拉起该页，手机端整屏覆盖、桌面端 22rem 浮层；再点当前页签、点 ×、按 Esc（桌面还可点抽屉外）收起。
  页签顺序不随阶段变，抽屉**不自动打开、不自动换页**；「战报」页里另有**页内**的两模式
  （逐副 / 升级表），它不占页签。
  边界只有一条：**抽屉只承载查阅面，动作面留桌面** —— 叫牌候选按钮、确认埋底、出牌按钮、每副结束的
  结算弹窗都在原来的位置，抽屉里放的是「查一下」的东西（战报与升级进程、叫牌记录、庄家埋下去的 3 张底牌、
  座位与身份）。`apps/web/test/table-chrome.test.ts` 与 `scripts/ui-check.ts` 一起守着这些
  （页头白名单 + 桌况簇三态 + 页签清单 + 动作面不许进抽屉 + 连接提示只许在断线时出现），
  免得页头再一次被堆满。
- **规则演示**：`/learn` 是幻灯片式演示（键盘 ← → / 空格翻页、自动播放、每屏深链 `/learn?s=<屏 id>`）。
  「基本概念」15 屏的示例全部复用 `/rules` 那份被引擎核对过的数据；三副实战牌局来自 `docs/deals/`，
  每一手都有讲解，**讲解的来路**（原话 / 润色 / 补写）逐条记在 `docs/deals/<slug>.review.md`。
  牌局数据是生成物（`stories/<slug>.ts`）并提交进仓库，页面渲染不跑回放、不碰随机数 —— 所以引擎或随机数
  将来变了，已发布的讲解也不会变味；真要变是 `pnpm deal:check` 报红，由人决定重新生成（见 ADR-0010）。

## 身份与凭据

无密码：输入名字即注册并签发令牌，浏览器 localStorage 保存 `base64url(名字:令牌)` 的凭据串，
一键复制到其它浏览器粘贴即可继续同一身份（服务端同时下发 httpOnly cookie 供 SSE 鉴权）。

## 让 LLM 也来玩（MCP）

LLM 在这套系统里**就是一个普通身份**：服务器不区分人类与 LLM，座位上也没有「LLM 席位」这种东西。
仓库提供的是 **MCP 工具面**（工具定义只有一份，理由与取舍见 ADR-0010；投喂量怎么省见 ADR-0011）；
"会不会打牌"由接上来的宿主决定 —— LLM 宿主自带策略。
**凭据是可选的**：没配也能连上（**无身份会话**：只能读规则、或替人类建一个身份，见 ADR-0014）——
所以「AI 一步步教人类把身份配起来」这条路上的第一步不需要先有一个身份。

> **别把它和「机器人」搞混。** 机器人是服务器自己代打的那种身份（无凭据串、由「+机器人」加进空座，
> 见 ADR-0015 与上面「机器人（凑桌陪练）」一节），跟 MCP 席位是两回事：MCP 对面是人还是 LLM，
> 服务器依旧分不出来。至于**打得好不好**：机器人那套基线启发式策略是独立小包
> `packages/bot`（纯函数：个人视图 → 动作），接上来的宿主想拿它当参考策略或对照基准都可以直接复用。

### 1. 先给 agent 一个身份

浏览器里「创建身份」（例如 `小六`）→ 点**复制凭据**。凭据串是 `base64url(名字:令牌)`，
和"复制到别的浏览器继续用"是同一个东西：MCP 客户端只是**另一台设备**。

**一个座位一个凭据**：同一个凭据同时被人和 agent 用，两边会互相抢着出牌（会看到「还没轮到你」）。

也可以反着来：宿主**先不配凭据**连上（见下），让 agent 用 `claim` 传一个名字建出身份，
把它返回的凭据串交给人类 —— 人类在同一个服务器的站点用大厅的「粘贴凭据串」导入即可。
这条路上 agent 只是**代建**：它拿到了那串东西就得交出去，自己的连接仍然是「没有身份」。

### 2. 接 stdio（本地进程；Claude Code / Claude Desktop 等）

```json
{
  "mcpServers": {
    "sixty-points": {
      "command": "node",
      "args": ["/path/to/sixty-points-ol/packages/mcp/src/stdio.ts"],
      "env": {
        "SIXTY_BASE_URL": "https://game.example.com",
        "SIXTY_CREDENTIAL": "<第 1 步复制的凭据串>"
      }
    }
  }
}
```

启动时会先自检一次：地址写错、服务没起**当场以非 0 退出并说明原因**，而不是等到第一次工具调用才失败；
带了凭据时顺带验一次凭据。日志一律走 stderr（stdout 是 MCP 协议通道）。
**`SIXTY_CREDENTIAL` 是可选的**：不填就是**无身份会话**（只有 `read_rules` 与 `claim` 能用，
见上文「工具」一节），所以「先连上、再让 AI 教你怎么配」这条路不需要先有一个身份（ADR-0014）。
反过来，配好凭据之后就**不该再催着配**：`instructions` 里给模型一条明确的判断 ——
除 `read_rules` 与 `claim` 之外的调用只要没被「还没有身份」那句话拒绝，就说明凭据已经生效
（会话开始时是无身份、之后人类重连的情况，模型照着旧上下文很容易误判）。

### 3. 或者连服务端自带的 `/api/mcp`

不需要本地 Node：`POST https://game.example.com/api/mcp`，用 `Authorization: Bearer <凭据串>` 鉴权。
它是 Streamable HTTP 的 **JSON 响应模式 + 无状态**：不开 SSE 流、不发会话 id，所以反代
（Caddy / traefik / Coolify）不需要为它加任何白名单；没有会话，也就没有「谁的会话」这回事。
一个 POST 最长会挂 30 秒（动作自带等待：等你下一次能行动就返回），`wait_for_turn` 最长 60 秒；
反代只要没有更短的响应超时即可（Caddy / traefik 默认没有）—— 若部署侧的响应超时更短，
给动作传 `wait: false`、并把 `wait_for_turn` 的 `timeout_seconds` 调小即可避开。

### 工具（16 个）

| 工具 | 作用 |
| --- | --- |
| `get_state` | 读当前局面：**只有你的手牌** + 公开信息，并附 `turn`（轮到谁、能不能动、该做什么） |
| `wait_for_turn` | 等到能行动再返回（默认 30s、上限 60s；超时返回 `timedOut`，直接再调一次即可） |
| `read_rules` | 读玩法说明；不传 `key` 返回全部 11 段（9 个**阶段键** + `trump-order`/`runs` 两个**参考键**：主牌大小顺序与顺子规则）；**整局读一次就够**；**不需要身份** |
| `legal_bids` | 当前所有合法叫品（与牌桌叫牌面板同一份实现）；**叫牌阶段之外返回空表** |
| `check_play` | 出牌前的本地预判，一次可验多组候选（服务端始终是唯一裁判） |
| `bid`／`bury`／`play`／`deal`／`new_game` | 动作，**成功后自动等到下一次轮到你**（`wait`，默认 true），返回那一刻的局面 |
| `list_my_tables`／`join_table`／`create_table` | 找到该坐哪张桌／用邀请码入座／自己开一张桌 |
| `leave_seat`／`take_seat` | 离座转观战（座位空出、本副停在空座上等人补位）／补位入座并**继承该座位的级别与手牌** |
| `claim` | 还没有身份时新建一个：返回名字与凭据串（交给人类用）；**不需要身份**，撞名一律失败 |

工具**不接受座位号**：座位一律由服务端按身份推导（ADR-0002）。所有读写都只经过**个人视图**，
所以 agent 看不到别人的手牌与底牌；进程内那条路另有静态守卫钉着（随 `pnpm test:web` 跑）。

**没有身份也能连**（ADR-0014）：`read_rules` 与 `claim` 不需要凭据，其余工具会回一句
「还没有身份：……」并说清怎么配凭据、怎么自己建。工具清单**不按凭据筛** —— 没带凭据的连接也 list
到全部 16 个，好让模型知道配好之后能拿到什么。反过来，**带了却无效的凭据一律 401**，
绝不静默降级成「没有身份」。离座之后要回座用 `take_seat`：重新 `join_table` 只会让你继续观战
（到达语义见 ADR-0007）。

牌面写成短码：`"S14"` = ♠A、`"S10"` = ♠10、`"C5"` = ♣5、`"j0"` = 小王。出参与入参同形 ——
`get_state` 里 `you.hand` 的元素可以原样喂回 `play`／`bury`。轮到你时 `turn.legalBids` /
`turn.legalPlay` 已经把「能怎么做」给出来了，**不需要逐张试探**。

出参默认**只给此刻行动所需的**，加上**自你上次看到以来新发生的事**（最近完成的一墩）：跨副战报与
更早的墩不再每帧重发 —— 宿主每个请求都会重发整段会话，模型已经看过那些帧，重复投喂只是把成本
乘在回合数上。记牌因此**属于牌手能力**（有意为之，见 ADR-0019）；对话被截断或换了会话时，
给 `get_state` 传 `verbose: true` 取回完整局面（座位名字、级别、全部牌史都在里面）。

### 一副牌要说多少话

工具面是**每个回合都要重发一遍**的（宿主每个请求都带着整段会话与工具面 schema），
所以这里花的不是一次性的钱。按座位 0 打完整一副实测（RNG 固定，见 ADR-0011／0019）：

| | 逐字负载 + 每回合两次调用 | 紧凑投影（ADR-0011） | 行动投影（现状） |
| --- | --- | --- | --- |
| 一副牌的实收负载 | 116,278 字符 | 35,636 | **18,453** |
| 模型累计读入（一副） | 1,845,222 | 401,156 | **288,904** |
| 结算那一刻的单份局面 | 6,232 | ~2,760 | **1,355** |
| 一整局的实收负载 | — | 396,503 | **139,207** |
| 一整局的累计读入 | — | 26,710,960 | **11,333,093** |
| 整局里最大的一份负载 | — | 4,402（随副数涨） | **1,393（基本不动）** |
| 每副的调用数 | 38 | **21** | 21 |

最下面那两行最要紧：**跨副不再累积** —— 整局里最大的一份负载曾经随副数线性上涨，现在与第几副无关。

真正的预算是会红的断言（`packages/mcp/test/payload-budget.test.ts` 卡单副与整局，
`pnpm mcp-check` 再对真服务器卡一次调用数与字节数）。

界面上的那颗点对 agent 也有效：它没有 SSE，但每次请求都会刷新「最近活跃」，
因此它在打牌时显示**在线**，停手一分钟才转灰。状态变了要**推出去**才算数 ——
`join_table` 入座、以及它从离线变在线的那一刻，都会广播给牌桌的连接，所以牌桌页上的座位卡、
`ready` 与「开始第一副」不用等谁先出一次牌（见 ADR-0012）。反过来，**连接真的断了就立刻变灰**：
关标签页、浏览器崩掉都会当场把那个 60 秒窗口作废，别人不用等一分钟（见 ADR-0013；
拔网线/休眠这种「TCP 还活着」的情形仍然发现不了，只有加客户端心跳才能覆盖）。

写路径（`bid`／`bury`／`play`／`deal`／`new_game`／`create_table`／`join_table`／`leave_seat`／
`take_seat`／`claim`）**不会自动重试**：
服务端没有幂等键，重发一次就可能把已经生效的动作变成两次、或者凭空多开一张桌。所以连接在提交后
断掉时，工具会如实说「无法确认这次请求是否已经生效」，并让你先用 `get_state`／`list_my_tables`
核对现状再决定 —— 读（`get_state`／`list_my_tables`）是幂等的，会自己重试一次。
`claim` 是唯一换了一句文案的：它没有局面可核对，所以改问「同名再 claim 一次会告诉你『这个名字已被使用』」。

## 一键部署

### Docker Compose（单机 / VPS）

```bash
docker compose up -d --build                     # → http://<主机>:3000
DOMAIN=game.example.com docker compose --profile https up -d --build   # → https://game.example.com（Caddy 自动证书）
```

- 镜像：`node:24-bookworm-slim` 两阶段构建（装依赖+构建 → 只带产物与运行期依赖），非 root 运行。
- 数据：命名卷 `sixty-data` 挂到容器 `/data`（`SIXTY_DB=/data/sixty.db`）。牌局状态、身份、座位与观战记录、事件日志都在这里，容器重建/升级不丢；重启续局已实测。
  **这一行只对 `docker compose` 与 Coolify 的 Docker Compose 资源生效**：Coolify 用 **Docker Image** 资源时不会自动带上它，必须手动加 Persistent Storage，见下文「Coolify」的 A 路径。
- 环境变量全部带默认值，可用 `${X:-默认}` 直接改：`PORT`（容器内端口，默认 3000）、`PUBLIC_PORT`（宿主映射，默认同 PORT）、`SIXTY_DB`、`DOMAIN`（仅 https profile）。
  **`ORIGIN` 例外：不要用 `${ORIGIN:-}` 这种写法**（宿主未设置时会注入空串导致容器起不来），需要时就写完整 URL 或整行留空不定义，见上文「本地运行」的警示。
- 健康检查：容器内 `GET /` 返回 200；`docker compose ps` 里看到 `healthy` 即就绪。
- 升级：`git pull && docker compose up -d --build`。
- 备份 / 恢复：
  ```bash
  docker run --rm -v sixty-points-ol_sixty-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/sixty-backup.tgz -C /data .
  # 恢复：把 tar 解回同一个卷后再 up
  ```

### 预构建镜像（GHCR，GitHub Actions 自动构建）

`.github/workflows/ci.yml` 在 CI 上构建镜像并推到 `ghcr.io/cup113/sixty-points-ol`：先过 `pnpm test` / `pnpm test:web` / `pnpm test:mcp` / `pnpm check`，
再用**构建产物**起服务跑一遍 MCP 端到端（两条传输各打一整副），全绿才出镜像。

| 触发 | 产出的标签 |
| --- | --- |
| push `main` | `latest`、`main`、`sha-<7位>`（如 `sha-af7ae45`） |
| push `v*` 标签（如 `v0.2.0`） | `0.2.0`、`0.2`，外加分支规则命中时的标签 |
| PR | 只试构建，**不推送** |
| Actions 页面手动 `Run workflow` | 按所在分支 / 标签出标签 |

镜像只覆盖 `linux/amd64`（ARM 主机需本地 build，或按 ADR-0006 加 QEMU 多架构）；不需要任何 Secret，用仓库内置 `GITHUB_TOKEN` 授权。

不依赖仓库、直接拉预构建镜像运行（数据卷必须保留，否则每次重建都清空牌局）：

```bash
docker pull ghcr.io/cup113/sixty-points-ol:latest
docker run -d --name sixty -p 3000:3000 -v sixty-data:/data \
  -e PORT=3000 ghcr.io/cup113/sixty-points-ol:latest
```

要可回滚就固定版本：`:sha-af7ae45` 或 `:0.2.0`。

Coolify 用预构建镜像：新建资源 → **Docker Image**（不是 Docker Compose），镜像填 `ghcr.io/cup113/sixty-points-ol:latest`，Domain 端口仍填**容器端口** `3000`，并**手动加 Persistent Storage**（步骤见下文「Coolify」的 A 路径）。注意 `docker-compose.yml` 本身仍是本地 build（compose 里 `build:` 优先于 `image:`），别指望现有 compose 资源自动改用 CI 镜像。

排查：

- `docker pull` 报 `denied` / 404：到 GHCR 里把该包可见性设为 Public（公开仓库的包通常默认就是）。
- CI 推镜像报 `write_package` / `permission_denied`：仓库 Settings → Actions → General → Workflow permissions 设为 **Read and write**。

### Coolify

先选资源类型 —— 两条路的代价完全不同。

**A. Docker Image 资源（推荐：镜像来自 GHCR，服务器不构建）**

1. 新建资源 → **Docker Image**，镜像填 `ghcr.io/cup113/sixty-points-ol:latest`；要可回滚就填固定 tag（`:0.2.0`、`:sha-af7ae45`）。
2. **Domain 填 `<你的域名>:3000`** —— Coolify 里的端口是**容器端口**，不是公网端口；写错会 502。容器监听 3000（`PORT=3000`）。
3. **Persistent Storage 必须手动加**：Application → Persistent Storage → Add —— Name `sixty-data`、**Destination Path `/data`**（必须与 `SIXTY_DB` 的目录一致）、Source Path 留空即用 Docker 命名卷。
   **漏了这一步就会每次部署清空牌局**：这类资源既不继承仓库 `docker-compose.yml` 里的卷，也不继承镜像里的 `VOLUME ["/data"]`，于是每次重新部署都挂一个**全新的匿名卷** —— 用户凭据、MCP 凭据、房间全部静默消失，而健康检查仍然是绿的。
4. 验证：`docker inspect -f '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' <容器>` 应显示 `sixty-data -> /data`，而不是一串 64 位十六进制名。
5. 备份（Coolify 的命名卷就叫 Persistent Storage 里的 Name，不带项目前缀）：
   ```bash
   docker run --rm -v sixty-data:/data -v "$PWD":/backup alpine \
     tar czf /backup/sixty-backup.tgz -C /data .
   ```
6. 需要 Coolify 自动注入域名变量时，在该资源的 Environment Variables 里加 `SERVICE_FQDN_APP_3000=<你的域名>`。

**B. Docker Compose 资源（指向本仓库，在服务器本机构建）**

1. 新建资源 → **Docker Compose** → 指向本仓库（compose 文件在根目录，无需改路径）。
2. **Domain 填 `<你的域名>:3000`**（同上：端口是容器端口）。
3. 数据卷由 compose 里的 `- sixty-data:/data` 自动带上（见上文「Docker Compose（单机 / VPS）」），别删那一行。
4. 代价：镜像在**服务器本机**构建（`git clone` + `docker compose build --pull`），构建期内存可能吃到几个 GB；小 VPS 会被 OOM kill 或长时间卡住 —— 服务器余量不足就选 A。
5. 需要 Coolify 自动注入域名变量时，在 `app.environment` 加一行 `- SERVICE_FQDN_APP_3000=<你的域名>`。

### SSE（实时推送）踩坑说明

回合制对战靠服务器推送（`/api/tables/<code>/stream`，`text/event-stream`）。中间层一旦缓冲或 gzip，症状是**页面正常但状态永远不刷新**：

- 应用侧已发 `Content-Type: text/event-stream` + `Cache-Control: no-cache` + `X-Accel-Buffering: no`。
- `docker-compose.yml` 已带 `traefik.http.middlewares.gzip.compress=false`（Coolify 默认会注入 gzip 中间件，必须关掉）。
- 用自带的 Caddy（`--profile https`）时，`deploy/Caddyfile` 对 SSE 路径单独设 `flush_interval -1`，其余路径正常压缩。

### 本机沙箱下的注意事项

`pnpm dev` / `pnpm build` / `docker` 需要 spawn 子进程与访问 Docker 命名管道，在受限沙箱里会 `EPERM`；在自己机器或 CI 上不受影响（镜像构建已在 `.github/workflows/ci.yml` 里跑，本地沙箱受限只影响本地 build/dev）。若镜像构建在 esbuild 步骤报错，把 `pnpm-workspace.yaml` 里的 `allowBuilds: esbuild` 改成 `true` 再构建（本仓库默认关掉它，是因为它只是可选的原生二进制补装，关掉后构建同样可跑）。

## 暂未实现（v1 范围外）

聊天/表情、计时器、观战者的全知/延迟视图、多实例水平扩展。

「机器人补位」**已从这张单子移出** —— 机器人座位与基线启发式策略已落地（见 ADR-0015）。
仍未做的是**更强的**机器人与难度梯度：现在只有一档规则式启发，不搜索、不学牌谱，
`packages/bot` 的纯函数形状留了加档位的口子，但第一版刻意不做。

## 许可

[Apache License 2.0](LICENSE) © 2026 Jason Li
