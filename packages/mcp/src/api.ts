import type { BidCall, Card } from '@sixty/engine';
import type { StreamPayload, TableSummary } from './wire.ts';

/**
 * 一条不带 seat 的动作：座位号一律由服务端按身份推导（ADR-0002）。
 *
 * 这不是「引擎 Action 的简化版」——它是**工具面唯一允许发出的形状**：
 * 引擎的 `Action` 里 bid/bury/play 都带 seat，客户端填什么都会被服务端覆盖，
 * 所以这一层在类型上就不给 seat 留位置。
 */
export type SeatlessAction =
  | { readonly type: 'deal' }
  | { readonly type: 'newGame' }
  | { readonly type: 'bid'; readonly call: BidCall }
  | { readonly type: 'bury'; readonly cards: readonly Card[] }
  | { readonly type: 'play'; readonly cards: readonly Card[] }
  /** 认赢（ADR-0028）：只说「我要认」—— 末轮张数与成不成立都由引擎当场判 */
  | { readonly type: 'claim' };

export interface TablePayload extends StreamPayload {}

/** 服务端/传输层拒绝。`status` 为 0 表示没拿到 HTTP 响应（网络或超时）。 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** 新建身份的结果：凭据串是**给人类的**，工具面自己不留用（见 ADR-0014） */
export interface ClaimedIdentity {
  readonly name: string;
  readonly credential: string;
}

/**
 * 工具面唯一的取数出口：只交出**负载**（公共视图 + 自己的那一份），
 * 没有第二个方法能碰到完整牌局状态。两条传输各有一个实现（HTTP / 进程内），
 * 工具层对二者的差异一无所知 —— 两条路因此不可能给出不同答案。
 */
export interface GameApi {
  /**
   * 这个实现是否带着身份。
   *
   * `false` ＝ **无身份会话**：工具表照旧全列（模型要能看见将来配好凭据后能拿到什么），
   * 但需要身份的工具在调到这里之前就被 `callTool` 挡下并给出指路错误（ADR-0014）。
   */
  readonly authenticated: boolean;
  table(code: string): Promise<TablePayload>;
  act(code: string, action: SeatlessAction): Promise<void>;
  listTables(): Promise<readonly TableSummary[]>;
  createTable(): Promise<string>;
  /** 进入同桌：有空座就入座，满座则以**观战者**身份进入（不再报错） */
  enterTable(code: string): Promise<void>;
  /**
   * 离座：座位空出、本人转为观战者；本来不在座也成功（幂等，按钮双击/重试不该报错）。
   *
   * 它刻意**不是** `SeatlessAction`：座位是**同桌成员关系**，不是引擎动作（引擎没有这类 action），
   * 所以走单独的方法，而不是混进动作那条路。
   */
  leaveSeat(code: string): Promise<void>;
  /** 补位：有空座就入座并继承该座位的级别与手牌；已在座是幂等（`inherited` 为 false） */
  takeSeat(code: string): Promise<{ readonly seat: number; readonly inherited: boolean }>;
  /**
   * 新建一个身份并返回**凭据串**（未鉴权也能用，见 ADR-0014）。
   *
   * 名字全局唯一，撞名一律失败 —— **绝不返回既有身份**，否则输入别人的名字就等于接管他的座位与手牌
   * （ADR-0009 修掉的正是这个口子）。工具面自己不留用这个身份：凭据串是交给人类的。
   */
  claim(name: string): Promise<ClaimedIdentity>;
}
