import { error } from '@sveltejs/kit';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ApiError, createMcpServer } from '@sixty/mcp';
import {
  credentialOf,
  createIdentity,
  credentialPresent,
  identityFromCredentialOnly,
  normalizeName
} from '$lib/server/auth';
import { serverApi } from '$lib/server/mcp-api';
import type { RequestHandler } from './$types';

/**
 * MCP over Streamable HTTP —— **JSON 响应模式 + 无状态**。
 *
 * 没有 SSE：POST 直接回一整段 JSON，不开 GET 流、不发会话 id。
 * 这样中间层（Caddy / traefik / Coolify）不需要为它加任何「不缓冲」白名单，
 * 服务端也不用在内存里养会话表 —— 每个请求自带 `Authorization: Bearer <凭据串>`，
 * 身份当场解析、用完即弃。设计与理由见 ADR-0010。
 *
 * **凭据是可选的**（ADR-0014）：没带凭据就是一个**无身份会话** —— 工具表照旧全列，但只有
 * `read_rules`（纯本地）与 `claim`（建身份、把凭据串交给人类）调得动，其余返回指路错误。
 * 「没带凭据」与「凭据无效」必须分开：前者合法，后者一律 401，绝不静默降级成匿名。
 *
 * 身份解析**只认凭据串**（`identityFromCredentialOnly`，ADR-0023）：Gitee 身份的会话
 * cookie 在这里不算数 —— Gitee 身份拿不到凭据串，也就进不了 MCP（有意边界）。
 */
export const POST: RequestHandler = async (event) => {
  const identity = identityFromCredentialOnly(event);
  if (identity === null && credentialPresent(event)) {
    error(401, '凭据无效或已失效：请重新复制凭据串（没有凭据时可以直接连，但只有 read_rules 与 claim 能用）');
  }

  const server = createMcpServer({
    api: serverApi(identity?.id ?? null, {
      // 未鉴权也能建身份 —— 但撞名一律失败，绝不签发那条既有身份（否则输入别人的名字就等于冒名入座）
      claim: (raw) => {
        const name = normalizeName(raw);
        if (name === null) throw new ApiError('名字需为 1-12 个字符，且不含冒号', 400);
        const created = createIdentity(name);
        if (created === null) {
          throw new ApiError('这个名字已被使用，请换一个，或用凭据串导入你的身份', 400);
        }
        return { name: created.name, credential: credentialOf(created) };
      }
    })
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    // JSON 模式：整段响应在 resolveJson 之后才拼出来，所以 handleRequest 返回的
    // Response 里的 body 已经是完整的（不依赖连接继续活着）
    enableJsonResponse: true
    // 不传 sessionIdGenerator = 无状态：请求之间没有任何要记住的东西
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(event.request);
  } finally {
    await server.close();
  }
};

function unsupported(method: string): never {
  throw error(
    405,
    `${method} 不支持：这个端点是无状态的 JSON 模式 MCP（只用 POST；没有 SSE 流，也没有会话可删）`
  );
}

export const GET: RequestHandler = () => unsupported('GET');
export const DELETE: RequestHandler = () => unsupported('DELETE');
