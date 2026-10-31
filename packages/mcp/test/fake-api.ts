/**
 * 测试替身：一个最小的内存版服务器。
 *
 * 它与真服务器对齐三件事：
 *   1. 座位号由服务端注入（工具面永远不传 seat）；
 *   2. 负载形状与浏览器一致：`view` 是**公共视图**（不含 `you`），`you` 单独一份；
 *   3. 角色由服务端决定 —— `seat: null` 就是观战者（`view` 有、`you` 为 null、动作被拒）。
 *
 * 规则判定直接复用引擎的 dispatch —— 测试里不需要重写一遍规则，
 * 真实的两条 HTTP 链路由 scripts/mcp-check.ts 端到端覆盖。
 */
import {
  auctionTurn,
  createGame,
  dispatch,
  personalView,
  playTurn,
  publicView,
  type Action,
  type Card,
  type GameState,
  type Seat
} from '@sixty/engine';
import { ApiError, type ClaimedIdentity, type GameApi, type SeatlessAction, type TablePayload } from '../src/api.ts';
import type { Role, TableSummary, TableView } from '../src/wire.ts';

/** 固定 RNG：同一局在每次运行里都一样，测试只看规则不看随机 */
export const rng = (): number => 0.5;

export function fakeTableView(code = 'ABC123', online = true, spectatorCount = 0): TableView {
  return {
    code,
    seats: [
      { seat: 0, userId: 1, name: '甲', online: true, bot: false, announcement: null },
      { seat: 1, userId: 2, name: '乙', online, bot: false, announcement: null },
      { seat: 2, userId: 3, name: '丙', online: false, bot: false, announcement: null }
    ],
    seatedCount: 3,
    ready: true,
    spectatorCount,
    // 「距上一步」的年龄：工具面不消费它，测试固定一个值即可（形状与真实响应一致）
    actionAgeMs: 0
  };
}

function must(result: ReturnType<typeof dispatch>): GameState {
  if (!result.ok) throw new Error(`测试用例自身的动作非法：${result.message}`);
  return result.state;
}

/** 发完牌、还没人叫牌 */
export function dealtState(): GameState {
  return must(dispatch(createGame(0), { type: 'deal' }, rng));
}

/** 拍卖成交（座位 0 叫 40♣、其余 pass），庄家拿着 20 张、还没埋底 */
export function contractState(): GameState {
  let state = dealtState();
  state = must(dispatch(state, { type: 'bid', seat: 0, call: { points: 40, strain: 'C' } }, rng));
  state = must(dispatch(state, { type: 'bid', seat: 1, call: 'pass' }, rng));
  state = must(dispatch(state, { type: 'bid', seat: 2, call: 'pass' }, rng));
  return state;
}

/** 拍卖成交（座位 0 叫 40♣、其余 pass），庄家已埋底，进入打牌且由庄家领出 */
export function playingState(): GameState {
  const state = contractState();
  const hand = state.deal!.hands[0]!;
  return must(dispatch(state, { type: 'bury', seat: 0, cards: hand.slice(0, 3) }, rng));
}

/** 座位 0 之外的某一手：合法的一张单张（找不到返回 null，正常牌局不会发生） */
function anyLegalSingle(state: GameState, seat: Seat): Card | null {
  const hand = state.deal!.hands[seat]!;
  for (const card of hand) {
    if (dispatch(state, { type: 'play', seat, cards: [card] }, rng).ok) return card;
  }
  return null;
}

/**
 * 让**除了「我的座位」之外**的某个座位走上一步。
 *
 * 这是测试里唯一能让牌局真的往前走的东西：`FakeApi` 只持有一张桌的状态，没有别的客户端，
 * 所以「动作自带等待」要靠注入的 `sleep` 调它 —— 否则等的是一个永远不会变的局面。
 *
 * `mine` 是留给工具面驱动的那个座位（默认 0；要测「跟牌」时会把它设成 1，
 * 这样座位 0 的首攻由这里代打，轮到 1 时正好是跟牌）。
 *
 * 返回 false = 现在轮到我，或者本副已经结算/走不动（调用方据此停下）。
 */
export function advanceOtherSeats(api: FakeApi, mine: Seat = 0): boolean {
  const state = api.state;
  const deal = state?.deal ?? null;
  if (state === null || deal === null) return false;

  if (deal.phase === 'auction') {
    const seat = auctionTurn(deal);
    if (seat === mine) return false;
    api.state = must(dispatch(state, { type: 'bid', seat, call: 'pass' }, rng));
    return true;
  }
  if (deal.phase === 'bury') {
    const seat = deal.contract!.declarerSeat;
    if (seat === mine) return false;
    api.state = must(dispatch(state, { type: 'bury', seat, cards: deal.hands[seat]!.slice(0, 3) }, rng));
    return true;
  }
  if (deal.phase === 'play') {
    const seat = playTurn(deal);
    if (seat === null || seat === mine) return false;
    const card = anyLegalSingle(state, seat);
    if (card === null) return false;
    api.state = must(dispatch(state, { type: 'play', seat, cards: [card] }, rng));
    return true;
  }
  return false;
}

/** 一直让别的座位走，直到轮到我或本副结束 */
export function advanceUntilMyTurn(api: FakeApi, mine: Seat = 0, maxSteps = 200): number {
  let steps = 0;
  while (steps < maxSteps && advanceOtherSeats(api, mine)) steps += 1;
  return steps;
}

/**
 * 一整副打完的**结算后**状态（三家都由引擎直驱）。
 *
 * 用途是那类需要「牌史最长、`history` 已有内容」的断言（投影体积、结算阶段的行为）——
 * 顺手也证明了 `advanceOtherSeats` 那套走子确实能把一副牌走完。
 */
export function scoredState(): GameState {
  let state = dealtState();
  for (let step = 0; step < 600 && state.deal!.phase !== 'scored'; step += 1) {
    const deal = state.deal!;
    if (deal.phase === 'auction') {
      const seat = auctionTurn(deal);
      const call = deal.auction.length === 0 ? { points: 40, strain: 'C' } as const : 'pass' as const;
      state = must(dispatch(state, { type: 'bid', seat, call }, rng));
      continue;
    }
    if (deal.phase === 'bury') {
      const seat = deal.contract!.declarerSeat;
      state = must(dispatch(state, { type: 'bury', seat, cards: deal.hands[seat]!.slice(0, 3) }, rng));
      continue;
    }
    const seat = playTurn(deal)!;
    const card = anyLegalSingle(state, seat);
    if (card === null) throw new Error(`座位 ${seat} 找不到合法单张，用例本身坏了`);
    state = must(dispatch(state, { type: 'play', seat, cards: [card] }, rng));
  }
  if (state.deal!.phase !== 'scored') throw new Error('一整副没走完（600 步上限）');
  return state;
}

/**
 * 把一副牌的结算历史**凑够 n 条**（只为投影的边界用例）。
 *
 * 不真打 n 副：整局打不了几副就会结束（闲家涨级很快），而这里要的只是「历史比上限长」。
 */
export function scoredStateWithHistory(n: number): GameState {
  const state = scoredState();
  const row = state.history[0];
  if (row === undefined) throw new Error('没有结算历史可用');
  return {
    ...state,
    dealNo: n,
    history: Array.from({ length: n }, (_, index) => ({ ...row, dealNo: index + 1 }))
  };
}

export interface FakeApiOptions {
  readonly state?: GameState | null;
  /** `null` = 观战者（不在座位上） */
  readonly seat?: Seat | null;
  readonly tables?: readonly TableSummary[];
  /** 非 null 时 act/table 一律抛这个错（模拟服务端拒绝或断线） */
  readonly failWith?: ApiError | null;
  /** false = **无身份会话**（工具表照旧全列，但只有 read_rules 与 claim 调得动，见 ADR-0014） */
  readonly authenticated?: boolean;
  /** 已经被占用的名字：claim 传这些名字一律失败（绝不返回既有身份，见 ADR-0009） */
  readonly takenNames?: readonly string[];
  /** take_seat 是否报告「接下了这个座位的手牌」（补位那条路） */
  readonly inheritedOnTake?: boolean;
}

export class FakeApi implements GameApi {
  state: GameState | null;
  /** 可变：`leaveSeat` / `takeSeat` 会翻转它，于是 get_state 的角色跟着变 */
  seat: Seat | null;
  tables: TableSummary[];
  failWith: ApiError | null;
  readonly authenticated: boolean;
  private readonly takenNames: Set<string>;
  private readonly inheritedOnTake: boolean;
  /** 工具面实际发出的动作，逐条记录（用来断言「不带 seat」） */
  readonly actions: SeatlessAction[] = [];
  readonly created: string[] = [];
  readonly entered: string[] = [];
  /** 座位工具留下的痕迹 */
  readonly left: string[] = [];
  readonly sat: string[] = [];
  /** claim 过的名字 */
  readonly claimed: string[] = [];
  /** table() 被调用了几次（wait_for_turn 的轮询次数靠它数） */
  reads = 0;

  constructor(options: FakeApiOptions = {}) {
    this.state = options.state === undefined ? dealtState() : options.state;
    this.seat = options.seat === undefined ? 0 : options.seat;
    this.tables = options.tables === undefined ? [{ code: 'ABC123', seated: 3, role: 'player' }] : [...options.tables];
    this.failWith = options.failWith ?? null;
    this.authenticated = options.authenticated ?? true;
    this.takenNames = new Set(options.takenNames ?? []);
    this.inheritedOnTake = options.inheritedOnTake ?? false;
  }

  get role(): Role {
    return this.seat === null ? 'spectator' : 'player';
  }

  async table(code: string): Promise<TablePayload> {
    this.reads += 1;
    if (this.failWith !== null) throw this.failWith;
    const state = this.state;
    if (state === null) {
      return { role: this.role, view: null, you: null, table: fakeTableView(code) };
    }
    return {
      role: this.role,
      // 与真服务器一致：公共视图里不含 you，玩家私有那一份单独放在 you
      view: publicView(state),
      you: this.seat === null ? null : personalView(state, this.seat).you,
      table: fakeTableView(code)
    };
  }

  async act(_code: string, action: SeatlessAction): Promise<void> {
    this.actions.push(action);
    if (this.failWith !== null) throw this.failWith;
    // 与 applyTableAction 一致：观战者不能动手
    if (this.seat === null) throw new ApiError('你在观战，入座后才能操作', 400);
    let state = this.state;
    if (state === null) {
      // 与 applyTableAction 一致：还没开局时只有 deal 有意义
      if (action.type !== 'deal') throw new ApiError('三人到齐后由任意一人发牌', 400);
      state = createGame(0);
    }
    const serverAction: Action =
      action.type === 'bid' || action.type === 'bury' || action.type === 'play'
        ? { ...action, seat: this.seat }
        : action;
    this.state = must(dispatch(state, serverAction, rng));
  }

  async listTables(): Promise<readonly TableSummary[]> {
    if (this.failWith !== null) throw this.failWith;
    return this.tables;
  }

  async createTable(): Promise<string> {
    const code = 'NEW111';
    this.created.push(code);
    this.tables = [...this.tables, { code, seated: 1, role: 'player' }];
    return code;
  }

  async enterTable(code: string): Promise<void> {
    this.entered.push(code);
  }

  /** 与 tables.ts 一致：离座即转观战者；本来不在座也成功（幂等） */
  async leaveSeat(code: string): Promise<void> {
    this.left.push(code);
    if (this.failWith !== null) throw this.failWith;
    this.seat = null;
  }

  /** 与 tables.ts 一致：占用座位；已在座是空操作 */
  async takeSeat(code: string): Promise<{ seat: Seat; inherited: boolean }> {
    this.sat.push(code);
    if (this.failWith !== null) throw this.failWith;
    this.seat = this.seat ?? 0;
    return { seat: this.seat, inherited: this.inheritedOnTake };
  }

  /** 与 /api/auth/claim 一致：撞名一律失败，绝不返回那条既有身份 */
  async claim(name: string): Promise<ClaimedIdentity> {
    this.claimed.push(name);
    if (this.failWith !== null) throw this.failWith;
    if (this.takenNames.has(name)) {
      throw new ApiError('这个名字已被使用，请换一个，或用凭据串导入你的身份', 400);
    }
    return { name, credential: Buffer.from(`${name}:fake-token`, 'utf8').toString('base64url') };
  }
}
