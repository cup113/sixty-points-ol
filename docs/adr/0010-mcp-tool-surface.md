# MCP 工具面：两条传输共用一套工具，只给个人视图

让 LLM 也能上桌打牌，做法是把「一个身份能看到什么、能做什么」包成一组 MCP 工具。定义只有一份
（`packages/mcp/src/tools.ts`，不 import SDK、不认识网络），两条传输都挂它：

- **stdio**：`packages/mcp/src/stdio.ts`（bin `sixty-mcp`），取数走现有公开 HTTP 接口（`/view`、`/action` 等），
  所以它**只可能**拿到个人视图 —— 作弊不是纪律问题，是它没有别的路。
- **`POST /api/mcp`**：内嵌在 web 应用里（`WebStandardStreamableHTTPServerTransport`），取数走进程内适配层
  `src/lib/server/mcp-api.ts`。这条路离完整状态很近，所以由静态守卫（`apps/web/test/mcp-guard.test.ts`）
  钉死：那两个文件不许出现 `getGameState` / `db` / `dispatch` / `personalView` 等名字，import 也被白名单限制。

身份就是已有的 **身份**：人在浏览器里建好身份、点「复制凭据」，把凭据串填进 MCP 客户端配置
（stdio 用环境变量 `SIXTY_CREDENTIAL`，HTTP 用 `Authorization: Bearer <凭据串>`）。这里当初写的是
「MCP 侧**不提供自注册**：那会平白多出一个『免费造身份/抢名字』的入口，而现有 `register(name)` 在名字已存在时
会返回那条已有 user 行（含令牌）—— 这是个独立缺陷，不该由新功能顺手放大」。**那个缺陷已经由 ADR-0009 修掉**
（`createIdentity` 撞名一律返回 `null`，撞名不可能拿到任何凭据），所以这条结论在 ADR-0014 里被**重新决定**：
凭据变成可选，没带凭据的连接是 **无身份会话**，只放行 `read_rules`（纯本地）与 `claim`
（建身份并把凭据串交给人类，会话自己不接管）。工具表仍然**不按凭据筛**：未鉴权会话也 list 到全集，
「需要身份」这道门在调用时按 `requiresIdentity` 把守（默认拒绝）。

**不用长连接。** 客户端拿状态靠 `get_state` 快照，等轮次靠 `wait_for_turn` 有界轮询（默认 1.5s × 30s，上限 60s）。
理由有两条硬事实：Node 24.19 没有全局 `EventSource`（只有 `--experimental-eventsource` 才有），而标准
`EventSource` 又无法带自定义请求头 —— 拿它连 `/stream` 连 `Authorization` 都放不上去。另一条是概念上的：
MCP 的 Streamable HTTP 传输自己就用 SSE（POST 可返回 `text/event-stream`，还可开一条 GET 流），
所以"换 Streamable HTTP 就没有 SSE 断连"并不成立。于是 `/api/mcp` 选 **JSON 响应模式 + 无状态**：
POST 回一整段 JSON，不开 GET 流、不发会话 id，中间层（Caddy / traefik / Coolify）不需要为它加任何白名单。

连带的一个决定：**在线** 的定义从「有 SSE 订阅」扩成「有 SSE 订阅 **或** 最近 60 秒内有过请求」
（`hub.ts` 的 `touch` / `isRecentlyActive`，触发点放在 `viewFor` 与 `applyTableAction`，HTTP 与进程内两条路都覆盖）。
不这么做的话，一个正在打牌的 agent 在别人屏幕上会永远显示离线 —— 界面在说假话。

工具返回的是引擎的 `PersonalView` **原样**（外加一层 `turn` 摘要：轮到谁、能不能动、该做什么），
不复刻第二套视图类型（ADR-0002：引擎类型即共享契约）。卡牌对象保持引擎形状，`get_state` 里拿到的元素可以
直接喂给 `play`，省掉一整类"重新编码花色字形"的低级错误。
（**这一条后来被 ADR-0011 收窄**：默认出参改为紧凑投影以省投喂量，`verbose: true` 时仍是这里的原样；
浏览器那份负载不受影响。）顺带把三处"只能有一个来源"的规则纯函数搬进引擎包：
`help.ts`（说明文本，web 的「?」弹层与 `read_rules` 共用；`/rules` 是**另一份**长文，靠 `anchor`
对应 —— 见 ADR-0019 的更正）、`bidCandidates`（合法叫品集，叫牌面板与
`legal_bids` 共用）、`checkPlay`（本地合法性预判，界面与 `check_play` 共用）。合法的叫品集若有两份实现，
迟早会漂移成"工具面说合法、服务端说非法"。

新增 `GET /api/tables`（暴露既有的 `tablesOf`）：agent 不该被要求先被人告知 6 位邀请码，
`list_my_tables` 让它自己找到该坐哪张桌；顺带把大厅页面那份 `{code, seated}` 摘要收成同一个函数。

**不做**：仓库不提供自动打牌策略（"会不会打牌"取决于接上来的宿主），不新增观战视图，不做计时/托底，
也不实现多实例 —— 与 ADR-0001 的单实例前提一致。
（**「不提供自动打牌策略」这一条后来被 ADR-0015 修订**：机器人座位落地后，仓库确实带了基线启发式策略
（`packages/bot`）。这里对 **MCP 席位** 的结论不变 —— 服务器仍然分不出对面是不是 LLM，
策略也仍然只喂个人视图；变的只是多了一种服务器自己代打的无令牌身份。）

理由：把"人怎么打"和"agent 怎么打"收敛到同一条服务器权威路径上，能复用的全部复用（身份、同桌、动作接口、
规则引擎），不能复用的（视图、合法性）绝不开第二个来源；而 MCP 这层薄到可以整层删掉而不动游戏本身。

后果：多了一个包与一个端点，以及一个必须跟着改的地方 —— `packages/mcp/src/wire.ts` 里声明的平台层 wire 形状
（`TableView` / `SeatInfo`；它们原本只在 `apps/web/src/lib/shared.ts`，是 SvelteKit 的 `$lib` 作用域，MCP 包引不到）。
它由 `scripts/mcp-check.ts` 拿真实响应逐字段核对，服务器一改形状脚本就红。`packages/mcp` 的 tsconfig 也放宽了
`exactOptionalPropertyTypes`（MCP SDK 的类型不是按它写的），其余包保持全严。工具面依赖轮询，所以"人机互等"
仍然没有上限（本仓库本来也没有计时器）。
