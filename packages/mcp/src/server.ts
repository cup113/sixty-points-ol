import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GameApi } from './api.ts';
import { callTool, ToolError, TOOLS, type ToolRuntime } from './tools.ts';

export const SERVER_NAME = 'sixty-points';
export const SERVER_VERSION = '0.1.0';

/**
 * 一次性说明（`initialize` 的 `instructions` 字段）：**共用的话只说一遍**。
 *
 * 这些句子（一副牌的调用节奏、牌码格式、座位由服务端定）本来要在每个工具的描述里各写一遍，
 * 而工具描述是每个请求都随上下文重发的 —— 放在这里既省体积，也保证所有工具的说法一致。
 * 单个工具的描述仍然自给自足：有客户端不注入 `instructions` 时，工具本身也不会说不清。
 * （**刻意不写工具数**：数字写进注释就会随着加减工具烂掉 —— 这条注释曾经写着 13，后来改 15 而真值是 16。）
 */
export const SERVER_INSTRUCTIONS = [
  '一副牌：先 read_rules 读一遍玩法（整局一次就够，内容不变），再 get_state 看局面。',
  '能行动时用 bid / bury / play / deal —— 动作成功后会自动等到下一次轮到你（wait 默认 true），',
  '所以每个回合通常只需一次工具调用；返回里 timedOut 为 true 表示「动作已生效但还没轮到你」，',
  '这时改用 wait_for_turn 继续等，不要重复那次动作。',
  '牌码是短字符串："S14" = ♠A、"S10" = ♠10、"C5" = ♣5、"j0" = 小王、"j1" = 大王；',
  '牌码在出参与入参里同形，you.hand 的元素可以原样喂回 play / bury。',
  '轮到你时 turn 里已经给了合法叫品 legalBids 或跟牌约束 legalPlay，不必逐个试探。',
  '出参默认**只给此刻行动所需的**，加上自你上次看到以来新发生的事（最近完成的一墩）；',
  '更早的牌史与跨副战报是记忆力的事，不重复投喂。若对话被截断或换了会话，用 get_state 传 verbose: true',
  '取回完整局面（座位名字、级别、全部牌史都在里面）。',
  '动作不接受座位号：座位一律由服务端按凭据判定（服务端是唯一裁判）。',
  '身份判定一句话：除 read_rules 与 claim 之外的任何一次调用**没有被**「还没有身份」那句话拒绝',
  '（而是正常返回了局面或某个具体错误），就说明本连接**已经带着有效凭据** —— 不要再让用户去配置凭据；',
  '只有错误原话正是「还没有身份…」时，才需要按那句提示去配置。'
].join('\n');

/**
 * 无身份会话的说明（ADR-0014）。
 *
 * 工具表对未带凭据的连接**照旧全列**（模型要能看见配好凭据后会拿到什么），所以这一段必须在开场
 * 就说清「现在只有两个能用」以及「怎么才会变成有身份」，否则模型会把开局几步花在撞那堵墙上。
 */
export const ANONYMOUS_INSTRUCTIONS = [
  '当前这个连接**没有身份**：现在只有 read_rules（读玩法说明，纯本地）与 claim（新建一个身份）能用，',
  '其余工具一律回一句指路错误。',
  '要让人玩起来：用 claim 传一个名字，把它返回的凭据串交给人类 —— 人类在浏览器大厅用「粘贴凭据串」',
  '导入（或填进他自己的 MCP 客户端配置：stdio 是 SIXTY_CREDENTIAL，/api/mcp 是 Authorization: Bearer），',
  '之后带上凭据重连即可使用全部工具。本会话不会接管 claim 建出来的身份。'
].join('\n');

export interface ServerOptions {
  readonly api: GameApi;
  /** wait_for_turn 轮询间隔（毫秒） */
  readonly pollMs?: number | undefined;
  readonly defaultWaitSeconds?: number | undefined;
}

/**
 * 把**同一份**工具表（src/tools.ts）挂到 MCP 服务器上。
 *
 * stdio 侧（src/stdio.ts）与 web 的 `/api/mcp` 路由都只调这个函数，
 * 所以两条传输的工具清单、描述、错误形状不可能漂移。
 *
 * 工具清单**不按凭据筛**：无身份会话也 list 到全集（它得知道配好凭据后能拿到什么），
 * 「需要身份」这道门在 `callTool` 里按 `requiresIdentity` 把守（默认拒绝，见 ADR-0014）。
 */
export function createMcpServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: options.api.authenticated
        ? SERVER_INSTRUCTIONS
        : `${SERVER_INSTRUCTIONS}\n\n${ANONYMOUS_INSTRUCTIONS}`
    }
  );
  const runtime: ToolRuntime = {
    api: options.api,
    pollMs: options.pollMs,
    defaultWaitSeconds: options.defaultWaitSeconds
  };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
      async (args) => {
        try {
          const value = await callTool(tool, runtime, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
        } catch (error) {
          // 工具级失败（服务端拒绝、参数错、超时）：回一句人话 + isError，
          // 让调用方自己决定是重读局面还是改参数，而不是把整个会话打崩。
          const message =
            error instanceof ToolError || error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: message }], isError: true };
        }
      }
    );
  }

  return server;
}
