import {
  ApiError,
  type ClaimedIdentity,
  type GameApi,
  type SeatlessAction,
  type TablePayload
} from '@sixty/mcp';
import {
  applyTableAction,
  createTable,
  enterTable,
  getTableByCode,
  leaveSeat as leaveSeatOf,
  myTables,
  payloadFor,
  takeSeat as takeSeatOf,
  type TableAction
} from './tables';

/**
 * 进程内版的 `GameApi`：`/api/mcp` 路由用它，stdio 侧用的是 HTTP 版（packages/mcp）。
 *
 * 两件事必须同时成立：
 *
 * 1. **它只调 tables.ts 里那几个公开函数**，一个字节都不碰 `getGameState`/`db`/`dispatch` ——
 *    工具面拿不到完整牌局状态，所以「MCP 客户端看不到别人的手牌与底牌」不靠自律，
 *    靠这里没有别的路可走（由 apps/web/test/mcp-guard.test.ts 静态断言，并按 AGENTS 规则 9 证明守卫非空）。
 *    `claim` 因此**注入进来**（路由从 auth.ts 拿 createIdentity 交进来），而不是在这里 import 它 ——
 *    白名单保持最紧：这个文件仍然只认识 `./tables`。
 * 2. **行为与 HTTP 路由逐条对齐**（见 `routes/api/tables/[code]/view`、`.../join`、`.../seat`）：
 *    读负载不要求入座（不在座位上的人拿到的是观战负载，即公共视图 + `you: null`），
 *    动作才要求座位。否则同一套 MCP 工具会因为「本地还是远程」给出不同答案。
 */
function toEngineAction(action: SeatlessAction): TableAction {
  // 座位号：服务端按身份覆盖（ADR-0002），这里填 0 只是满足引擎的类型。
  // 认赢的末轮张数也不在这里 —— 它由引擎自己算（ADR-0028）。
  switch (action.type) {
    case 'bid':
    case 'bury':
    case 'play':
    case 'claim':
      return { ...action, seat: 0 };
    default:
      return action;
  }
}

export interface ServerApiPorts {
  /**
   * 未鉴权也能走的那一步：新建身份并返回凭据串。
   *
   * 实现必须**撞名即失败**、绝不返回既有身份（ADR-0009），并且要自己校验名字（`normalizeName`）——
   * 带冒号的名字会让凭据串解析不出令牌。
   */
  readonly claim: (name: string) => ClaimedIdentity;
}

export function serverApi(userId: number | null, ports: ServerApiPorts): GameApi {
  /**
   * 需要身份的方法在无身份会话里**走不到**（`callTool` 先按 `requiresIdentity` 挡下并指路）。
   * 这里兜一句，是为了万一有人绕过工具层直接调它时，别静默地拿着 `null` 去查库。
   */
  function requireUser(): number {
    if (userId === null) throw new Error('这个工具需要身份：先用 claim 建一个，或让人类把凭据配好');
    return userId;
  }

  return {
    authenticated: userId !== null,

    async table(code: string): Promise<TablePayload> {
      const id = requireUser();
      const table = getTableByCode(code);
      if (table === null) throw new ApiError('牌桌不存在', 404);
      // payloadFor 现算角色：在座 → 个人视图（公共 + you），观战 → 公共视图（you 为 null）
      return payloadFor(table, id);
    },

    async act(code: string, action: SeatlessAction): Promise<void> {
      const result = applyTableAction(code, requireUser(), toEngineAction(action));
      if (!result.ok) throw new ApiError(result.message, 400);
    },

    async listTables() {
      return myTables(requireUser());
    },

    async createTable(): Promise<string> {
      return createTable(requireUser()).code;
    },

    async enterTable(code: string): Promise<void> {
      const result = enterTable(code, requireUser());
      if ('error' in result) throw new ApiError(result.error, 400);
    },

    async leaveSeat(code: string): Promise<void> {
      const result = leaveSeatOf(code, requireUser());
      if (!result.ok) throw new ApiError(result.message, 400);
    },

    async takeSeat(code: string): Promise<{ seat: number; inherited: boolean }> {
      const result = takeSeatOf(code, requireUser());
      if ('error' in result) throw new ApiError(result.error, 400);
      return { seat: result.seat, inherited: result.inherited };
    },

    async claim(name: string): Promise<ClaimedIdentity> {
      // 这是唯一**不要求**身份的方法：无身份会话靠它把身份建出来交给人类（见 ADR-0014）
      return ports.claim(name);
    }
  };
}
