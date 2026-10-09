import { z } from 'zod';
import {
  bidCandidates,
  BID_STEP,
  checkPlay,
  HELP_KEYS,
  MIN_BID,
  phaseHelp,
  playHint,
  type BidCall,
  type BidOption,
  type Card,
  type HelpKey,
  type PlayHint,
  type PlayerSeat,
  type TrumpModel
} from '@sixty/engine';
import { ApiError, type GameApi, type SeatlessAction } from './api.ts';
import { decodeCall, decodeCard, decodeCards, encodeCall } from './codec.ts';
import { project, type CompactPayload } from './project.ts';
import type { Role, StreamPayload, TableSummary } from './wire.ts';

/** 参数格式不对、或调用方式错了（不是服务端的判定） */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ToolRuntime {
  readonly api: GameApi;
  /** wait_for_turn 的轮询间隔；低于 500ms 会被夹到 500ms */
  readonly pollMs?: number | undefined;
  /** 等待不传 timeout_seconds 时的默认秒数 */
  readonly defaultWaitSeconds?: number | undefined;
  /** 注入点：测试里可以立即返回，不真的等 */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** zod raw shape：SDK 直接拿它生成 JSON Schema，本层用它做同一份校验 */
  readonly input: z.ZodRawShape;
  /**
   * 这个工具要不要身份。**省略 ＝ 要**（默认拒绝）：新工具忘了写它，也不会漏进无身份会话。
   *
   * 工具表对所有会话**一视同仁地全列**（无身份会话也要能看见配好凭据后会拿到什么），
   * 这道门在**调用**时把守（`callTool`）。只有两个工具是 `false`：`read_rules`（纯本地读规则）
   * 与 `claim`（建身份并把凭据串交给人类），见 ADR-0014。
   */
  readonly requiresIdentity?: boolean;
  readonly run: (rt: ToolRuntime, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * 无身份会话碰到需要身份的工具时统一说这一句。
 *
 * 这是模型唯一的指路牌（工具清单不会替它筛），所以三件事都要说清：怎么配、怎么自己建、哪些不用身份。
 */
export const NO_IDENTITY_HINT =
  '还没有身份：让人类在浏览器里建身份、点「复制凭据」，把凭据串填进 SIXTY_CREDENTIAL（stdio）或 ' +
  'Authorization: Bearer（/api/mcp）后重连即可使用全部工具；也可以直接用 claim 建一个身份，' +
  '把它返回的凭据串交给人类。read_rules 与 claim 不需要身份。';

export const DEFAULT_WAIT_SECONDS = 30;
export const MAX_WAIT_SECONDS = 60;
export const DEFAULT_POLL_MS = 1500;
export const MIN_POLL_MS = 500;

/**
 * 牌码：`"S14"` = ♠A、`"C5"` = ♣5、`"j0"` = 小王、`"j1"` = 大王。
 *
 * 出参与入参同形 —— `get_state` 里 `you.hand` 的元素可以原样喂回 `play`/`bury`。
 * 用短字符串而不是 `{suit,rank}` 对象纯粹是为了体积：一副牌里牌史占投喂量的八成，
 * 单张 `{"suit":"S","rank":14}` 是 22 字符、`"S14"` 是 5 个（见 src/codec.ts）。
 *
 * 字段上的描述**刻意很短**：工具面 schema 是每个请求都随上下文重发的，同一句话写三遍
 * 就是三倍价钱；格式与协议细节统一放在 `server.ts` 的 `instructions` 里说一遍。
 */
const CardCode = z.string().min(1).describe('牌码，如 "S14"、"j0"');

/**
 * 叫品入参是**扁平字符串**，不是 `z.union`：MCP SDK 把 union 播报成 `anyOf`，而宿主在把工具 schema
 * 交给模型之前会清洗它 —— Cuplivo 会把 `anyOf` 拍平成**第一个分支**（`"pass"`），对象分支整个消失，
 * 于是「只有 pass 能叫出去」。字符串既压不坏，又与出参同形（见 codec.ts 的 `decodeCall`）。
 */
const CallSchema = z
  .string()
  .min(1)
  .describe(`叫品："pass" 或 "40C"/"45NT"（分数为不低于 ${MIN_BID} 的 ${BID_STEP} 的倍数，花色 C/D/H/S/NT）`);

/**
 * `code` 字段刻意**不写描述**：它在 8 个工具里重复出现，而 schema 是每个请求都要重发的 ——
 * 「省略＝该凭据唯一那张桌」这句话在 `server.ts` 的 `instructions` 里说一遍就够。
 * 也不加 `min(1)`：空串与省略同义（`resolveCode` 一律当作「没给」）。
 */
const CODE_FIELD = z.string().optional();
const WAIT_FIELD = z.boolean().optional().describe('动作后等到下次轮到你');
const VERBOSE_FIELD = z.boolean().optional().describe('true＝原样负载');

/** 只在需要 6 位码的动作里带上 code 字段 */
const codeField = { code: CODE_FIELD };

export interface TurnSummary {
  /** 现在你能做点事吗（发牌/叫牌/埋底/出牌/开下一副都算） */
  readonly canAct: boolean;
  /** 一句话：此刻该干什么。规则细节归 read_rules，这里不复述（每帧都重发的字段要短） */
  readonly hint: string;
  /** 轮到你在叫牌：合法叫品集，紧凑叫品串（与牌桌叫牌面板同一份 `bidCandidates` 派生） */
  readonly legalBids?: readonly string[] | undefined;
  /** 轮到你在出牌：跟牌/领出的**约束**（不复述手牌，模型自己手上有 you.hand） */
  readonly legalPlay?: PlayHint | undefined;
}

/**
 * 「现在轮到谁、我能做什么」—— 工具面自己的摘要，不新增任何视图类型：
 * 事实全部来自服务器的负载（公共视图 + `you`），这里只是翻译成 agent 一眼能读懂的判断。
 *
 * **不重复**（每帧都重发，重复的字段是纯税）：
 *   - `phase`：`view.deal.phase` 已经有了，大厅时 `view === null` 本身就说明了；
 *   - `isYourTurn`：它的值与 `canAct` 在**每一个分支**里都相同 —— 留一个就够。
 */
export function turnOf(role: Role, view: StreamPayload['view'], you: PlayerSeat | null): TurnSummary {
  // 角色只认 `role`：`you` 为 null 有第二种含义（在座、但这副还没发牌），不能拿来判断观战
  if (role !== 'player') {
    return {
      canAct: false,
      hint: '你在观战：能读局面与说明，动作要求先入座（take_seat；有邀请码才用 join_table）。'
    };
  }

  if (view === null || view.deal === null) {
    return { canAct: true, hint: '还没发牌：人齐后用 deal 开第一副。' };
  }
  if (view.status === 'finished') {
    return { canAct: true, hint: '对局已结束（见 view.result）：用 new_game 开新局。' };
  }
  if (you === null) {
    // 有牌局却拿不到自己那一份：服务端的角色判定异常，如实说出来而不是瞎猜
    return {
      canAct: false,
      hint: '服务端判你在座却没给手牌（you 为 null）：重新 get_state，或检查这个凭据的身份。'
    };
  }

  const deal = view.deal;
  switch (deal.phase) {
    case 'auction': {
      const mine = deal.auctionTurn === you.seat;
      return {
        canAct: mine,
        hint: mine
          ? '轮到你叫牌：turn.legalBids 里挑一个原样喂给 bid.call（也可 "pass"）。'
          : `等座位 ${deal.auctionTurn} 叫牌（要等用 wait_for_turn）。`
      };
    }
    case 'bury': {
      const mine = you.isDeclarer;
      return {
        canAct: mine,
        hint: mine ? '你是庄家：用 bury 恰好扣 3 张进底。' : '等庄家埋底。'
      };
    }
    case 'play': {
      const mine = deal.playTurn === you.seat;
      const leading = deal.trick === null || deal.trick.plays.length === 0;
      return {
        canAct: mine,
        hint: mine
          ? leading
            ? '轮到你领出：单张，或同门顺子。'
            : '轮到你跟牌：按 turn.legalPlay 出（同门同张数、结构优先）。'
          : `等座位 ${deal.playTurn ?? '?'} 出牌（要等用 wait_for_turn）。`
      };
    }
    case 'scored':
      return { canAct: true, hint: '本副已结算（见 view.deal.summary）：用 deal 开下一副。' };
  }
}

/** 紧凑投影 + turn：默认出参 */
export interface TableState extends CompactPayload {
  readonly turn: TurnSummary;
}

/** `verbose: true` 的原样出参：引擎类型逐字（ADR-0010 的那条路仍然在，只是不再是默认） */
export interface RawTableState extends StreamPayload {
  readonly code: string;
  readonly turn: TurnSummary;
}

export type AnyTableState = TableState | RawTableState;

/** 动作与等待在局面之外多说的两句：`timedOut` 只表示「等了但没等到」 */
export type ActionResult = AnyTableState & { readonly timedOut?: boolean; readonly note?: string };

/**
 * 合法叫品集拍平成紧凑串（`["40C","40D",…,"55NT"]`，分数升序、同分按 C<D<H<S<NT）。
 *
 * 分组的形状（`{points, strains[]}`）对模型是要「拼」的：入参既然收 `"45H"` 这样的字符串，
 * 出参就直接给字符串 —— 抄一下即可，少一类拼错（与牌码「出参与入参同形」同一条纪律）。
 * 引擎的 `bidCandidates` 与浏览器叫牌面板不受影响：这里只是把同一份数据换个写法。
 */
function flatCalls(rows: readonly BidOption[]): string[] {
  return rows.flatMap((row) => row.strains.map((strain) => encodeCall({ points: row.points, strain })));
}

/**
 * 轮到你时顺手把「合法集」给出，**不让模型逐个试探**。
 *
 * 这不是省几个字符的事：每次 `check_play` 都是一次完整的模型回合（整段会话重发一次），
 * 每回合多探 3 次就把一副牌的总投喂量抬到 2.8 倍、多探 17 次抬到 16 倍。约束只有几行，
 * 而探测是整个回合 —— 所以合法性由状态直接给，`check_play` 只留作一次验多组的兜底。
 */
function legalOf(payload: StreamPayload): Pick<TurnSummary, 'legalBids' | 'legalPlay'> {
  const { role, view, you } = payload;
  if (role !== 'player' || view === null || you === null || view.status === 'finished') return {};
  const deal = view.deal;
  if (deal === null) return {};

  if (deal.phase === 'auction' && deal.auctionTurn === you.seat) {
    return { legalBids: flatCalls(bidCandidates(view)) };
  }
  if (deal.phase === 'play' && deal.playTurn === you.seat && deal.trump !== null) {
    const lead = deal.trick !== null && deal.trick.plays.length > 0 ? deal.trick.plays[0]!.cards : null;
    return { legalPlay: playHint(you.hand, deal.trump, lead) };
  }
  return {};
}

export function turnFor(payload: StreamPayload): TurnSummary {
  return { ...turnOf(payload.role, payload.view, payload.you), ...legalOf(payload) };
}

/** 同桌码：显式给了就用，否则从该凭据的桌里推断（0 张 / 多张各有各的话要说） */
export async function resolveCode(rt: ToolRuntime, code: unknown): Promise<string> {
  if (typeof code === 'string' && code.trim().length > 0) return code.trim().toUpperCase();
  const tables = await rt.api.listTables();
  if (tables.length === 0) {
    throw new ToolError('这个凭据还没在任何一张同桌里：用 join_table 拿邀请码入座，或用 create_table 自己开一张。');
  }
  if (tables.length === 1) return tables[0]!.code.toUpperCase();
  throw new ToolError(
    `这个凭据在多张同桌里（${tables.map((t) => t.code).join('、')}）：请用 code 参数指定用哪一张。`
  );
}

/** 取一次局面：码只解析一次（轮询里每次重新解析会白白多打一次 /api/tables） */
async function rawOf(rt: ToolRuntime, codeArg: unknown): Promise<{ code: string; payload: StreamPayload }> {
  const code = await resolveCode(rt, codeArg);
  return { code, payload: await rt.api.table(code) };
}

async function stateOf(rt: ToolRuntime, codeArg: unknown, verbose = false): Promise<AnyTableState> {
  const { code, payload } = await rawOf(rt, codeArg);
  const turn = turnFor(payload);
  return verbose ? { ...payload, code, turn } : { ...project(payload, code), turn };
}

/** 牌码数组 → 引擎牌；认不出来时点名是哪一个（一次参数错要白跑一个回合，所以要说清楚） */
function cardsOf(codes: readonly string[], field: string): Card[] {
  const cards = decodeCards(codes);
  if (cards !== null) return cards;
  const bad = codes.find((code) => decodeCard(code) === null);
  throw new ToolError(`参数格式不正确：${field} 里有认不出的牌码「${String(bad)}」（格式如 "S14"、"C5"、"j0"、"j1"）`);
}

/**
 * 紧凑叫品 → 引擎叫品；认不出来时点名是哪一个。
 *
 * 这里只挡**形状**错（分数不是 5 的倍数、低于 40、花色拼错）—— 那不需要看局面，当场说清能省一个回合；
 * 「是否高于当前叫品」仍然由服务端裁决，工具面绝不替它放水（ADR-0002）。
 */
function callOf(code: string): BidCall {
  const call = decodeCall(code);
  if (call !== null) return call;
  throw new ToolError(
    `参数格式不正确：call「${code}」认不出来（"pass"，或 "40C"、"45NT" 这样的紧凑叫品：` +
      `分数为不低于 ${MIN_BID} 的 ${BID_STEP} 的倍数，花色取 C/D/H/S/NT）`
  );
}

interface PlayContext {
  readonly hand: readonly Card[];
  readonly trump: TrumpModel;
  readonly lead: readonly Card[] | null;
}

/** 出牌校验需要的三样东西；拿不齐时返回一句人话 */
function playContextOf(payload: StreamPayload): PlayContext | string {
  if (payload.role !== 'player') return '你在观战，没有手牌可出（先用 take_seat 坐上空座）';
  const deal = payload.view?.deal ?? null;
  if (payload.view === null || deal === null || deal.trump === null || deal.phase !== 'play') {
    return '现在不是出牌阶段';
  }
  if (payload.you === null) return '拿不到你的手牌（you 为 null）';
  const lead = deal.trick !== null && deal.trick.plays.length > 0 ? deal.trick.plays[0]!.cards : null;
  return { hand: payload.you.hand, trump: deal.trump, lead };
}

interface WaitOutcome {
  readonly state: AnyTableState;
  readonly timedOut: boolean;
}

/**
 * 等到「你能行动」为止。观战者没有座位，等多久都不会轮到 —— 立刻说清楚而不是空转到超时。
 *
 * `code` 必须是**已经解析过**的码：轮询里每次重新解析会多打一次 `/api/tables`。
 */
async function waitUntilCanAct(
  rt: ToolRuntime,
  code: string,
  secondsArg: unknown,
  verbose: boolean
): Promise<WaitOutcome> {
  const requested = typeof secondsArg === 'number' && Number.isFinite(secondsArg) ? secondsArg : undefined;
  const seconds = Math.min(Math.max(requested ?? rt.defaultWaitSeconds ?? DEFAULT_WAIT_SECONDS, 0), MAX_WAIT_SECONDS);
  const timeoutMs = seconds * 1000;
  const pollMs = Math.max(rt.pollMs ?? DEFAULT_POLL_MS, MIN_POLL_MS);
  const sleep = rt.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const startedAt = Date.now();
  for (;;) {
    const state = await stateOf(rt, code, verbose);
    if (state.turn.canAct) return { state, timedOut: false };
    if (state.role === 'spectator') return { state, timedOut: false };
    if (Date.now() - startedAt >= timeoutMs) return { state, timedOut: true };
    await sleep(pollMs);
  }
}

/**
 * 动作：成功之后**顺手等到下一次轮到你**（`wait`，默认 true）。
 *
 * 这一步同时省掉两样东西：每回合的第二次工具调用，以及那份重复投喂的完整局面 ——
 * 「动作结果」与「等待结果」本来就是同一份负载，现在只给一次。
 * 动作被服务端拒绝时**不等待**：立刻把原话回给调用方，让它自己改参数。
 */
async function act(
  rt: ToolRuntime,
  codeArg: unknown,
  action: SeatlessAction,
  waitArg: unknown
): Promise<ActionResult> {
  const code = await resolveCode(rt, codeArg);
  await rt.api.act(code, action);

  if (waitArg === false) return stateOf(rt, code);

  const { state, timedOut } = await waitUntilCanAct(rt, code, undefined, false);
  return timedOut
    ? {
        ...state,
        timedOut: true,
        note: '动作**已经生效**，只是还没轮到你：用 wait_for_turn 继续等，不要重复这次动作。'
      }
    : { ...state, timedOut: false };
}

function decodeCandidates(raw: readonly (readonly string[])[]): Card[][] {
  return raw.map((codes, index) => cardsOf(codes, `candidates[${index}]`));
}

/**
 * 工具表：与传输无关的**唯一**工具定义。
 *
 * stdio 包（src/stdio.ts）与 web 的 `/api/mcp` 路由都把这张表挂到各自的 SDK 服务器上，
 * 所以两条传输的能力、文案、错误形状永远一致；这里不 import SDK，也不需要网络。
 * 服务端始终是唯一裁判：读写都经过 `GameApi`，而它的出口只有个人视图。
 *
 * 出参默认走 `project.ts` 的紧凑投影（每副牌省约八成投喂量），`verbose: true` 可以拿回
 * 引擎类型逐字的那一份 —— 见 ADR-0011。
 */
export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'get_state',
    description:
      '读当前局面（幂等）：role、view（公开信息）、you（你的手牌）、table、turn（轮到谁、能不能动、该做什么；轮到你时还带合法叫品 legalBids 或跟牌约束 legalPlay）。',
    input: { ...codeField, verbose: VERBOSE_FIELD },
    run: (rt, args) => stateOf(rt, args['code'], args['verbose'] === true)
  },
  {
    name: 'wait_for_turn',
    description: `等到你能行动再返回（阻塞 ≤ ${MAX_WAIT_SECONDS} 秒，默认 ${DEFAULT_WAIT_SECONDS} 秒）：超时把 timedOut 置 true 并原样返回当前局面，直接再调一次即可。`,
    input: {
      ...codeField,
      timeout_seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional(),
      verbose: VERBOSE_FIELD
    },
    run: async (rt, args) => {
      const code = await resolveCode(rt, args['code']);
      const { state, timedOut } = await waitUntilCanAct(rt, code, args['timeout_seconds'], args['verbose'] === true);
      return timedOut
        ? { ...state, timedOut: true, note: '还没轮到你：直接再调一次 wait_for_turn 继续等。' }
        : { ...state, timedOut: false };
    }
  },
  {
    name: 'read_rules',
    description: `读玩法说明（**整局读一次就够**，内容不会变）：不传 key 返回全部 ${HELP_KEYS.length} 段；key 取 ${HELP_KEYS.join('/')}。`,
    input: { key: z.string().optional().describe('阶段键；省略则返回全部阶段') },
    // 纯本地读引擎里的说明文本，不碰服务器 —— 所以没有身份也能用（ADR-0014）
    requiresIdentity: false,
    run: async (_rt, args) => {
      const raw = args['key'];
      if (raw !== undefined && !HELP_KEYS.includes(raw as HelpKey)) {
        throw new ToolError(`key 只能是 ${HELP_KEYS.join(' / ')}；收到「${String(raw)}」`);
      }
      const keys: readonly HelpKey[] = raw === undefined ? HELP_KEYS : [raw as HelpKey];
      return {
        entries: keys.map((k) => {
          const entry = phaseHelp(k);
          return { key: k, title: entry.title, anchor: entry.anchor, lines: entry.body };
        }),
        note: '完整图文教程在 /rules#<anchor>；升级表与顺子示例都在里面。'
      };
    }
  },
  {
    name: 'claim',
    description:
      '还没有身份时用它新建一个：返回名字与凭据串（交给人类用）。名字全局唯一，已被占用就失败；本工具**不**接管这个身份。',
    input: { name: z.string().min(1).max(12).describe('身份名，1-12 字符、不含冒号') },
    // 未鉴权也能用：这正是「AI 帮人类把身份配起来」的那一步（见 ADR-0014）
    requiresIdentity: false,
    run: async (rt, args) => {
      const claimed = await rt.api.claim(args['name'] as string);
      return {
        name: claimed.name,
        credential: claimed.credential,
        note:
          '把凭据串交给人类：在**同一个服务器**的站点用大厅的「粘贴凭据串」导入，或填进他自己的 MCP 配置' +
          '（stdio 是 SIXTY_CREDENTIAL，/api/mcp 是 Authorization: Bearer）。本会话不会接管这个身份，' +
          '凭据也只对签发它的服务器有效。'
      };
    }
  },
  {
    name: 'legal_bids',
    description:
      '列出当前所有合法叫品（紧凑叫品串，与牌桌叫牌面板同一份实现）：轮到你叫牌时 turn.legalBids 里已经有同一份；**叫牌阶段之外一律空表**。',
    input: codeField,
    run: async (rt, args) => {
      const { code, payload } = await rawOf(rt, args['code']);
      const view = payload.view;
      const deal = view?.deal ?? null;
      // 阶段门：埋底/出牌/结算之后叫品已经没有意义，`deal.highestBid` 却还留着 —— 不能照着它给一整套候选
      const inAuction = view !== null && view.status !== 'finished' && deal !== null && deal.phase === 'auction';
      const options = inAuction && view !== null ? flatCalls(bidCandidates(view)) : [];
      return {
        code,
        phase: deal?.phase ?? 'lobby',
        highestBid: deal?.highestBid == null ? null : encodeCall(deal.highestBid),
        turn: turnFor(payload),
        options,
        note:
          options.length > 0
            ? '同分之下 strain 越大越高：C < D < H < S < NT。'
            : '现在没有可叫的叫品（不是叫牌阶段，或者已经轮不到你）。'
      };
    }
  },
  {
    name: 'check_play',
    description:
      '出牌前的本地预判（服务端仍是唯一裁判）：一次可以验多组候选 —— candidates 是「牌码数组」的数组，逐条返回 {ok, error}。轮到你时 turn.legalPlay 已经给了约束，这里只在拿不准时兜底用。',
    input: { ...codeField, candidates: z.array(z.array(CardCode).min(1)).min(1) },
    run: async (rt, args) => {
      const { payload } = await rawOf(rt, args['code']);
      const candidates = decodeCandidates(args['candidates'] as string[][]);
      const context = playContextOf(payload);
      const results = candidates.map((cards) => {
        if (typeof context === 'string') return { ok: false, error: context };
        const error = checkPlay(context.hand, cards, context.trump, context.lead);
        return { ok: error === null, error };
      });
      return { results };
    }
  },
  {
    name: 'bid',
    description:
      '叫牌：call 传 "pass"，或紧凑叫品 "40C"/"45NT"（与 highestBid、auction 里同格式；分数为 5 的倍数、≥40，花色取 C/D/H/S/NT）。',
    input: { ...codeField, call: CallSchema, wait: WAIT_FIELD },
    run: (rt, args) => act(rt, args['code'], { type: 'bid', call: callOf(args['call'] as string) }, args['wait'])
  },
  {
    name: 'bury',
    description: '庄家埋底：恰好 3 张牌码（从你的 20 张里扣进暗底）。',
    input: { ...codeField, cards: z.array(CardCode).length(3), wait: WAIT_FIELD },
    run: (rt, args) => act(rt, args['code'], { type: 'bury', cards: cardsOf(args['cards'] as string[], 'cards') }, args['wait'])
  },
  {
    name: 'play',
    description:
      '出牌：cards 是这次要出的 1 张或多张牌码（多张必须同门顺子/结构优先）；牌码直接取 get_state 里 you.hand 的原样元素。',
    input: { ...codeField, cards: z.array(CardCode).min(1), wait: WAIT_FIELD },
    run: (rt, args) => act(rt, args['code'], { type: 'play', cards: cardsOf(args['cards'] as string[], 'cards') }, args['wait'])
  },
  {
    name: 'deal',
    description: '发下一副（上一副已结算、或还没开始第一副时可用；三人到齐才发得出去）。',
    input: { ...codeField, wait: WAIT_FIELD },
    run: (rt, args) => act(rt, args['code'], { type: 'deal' }, args['wait'])
  },
  {
    name: 'new_game',
    description: '对局结束后开新对局（级别重置、发牌人轮转）；没结束时会失败。',
    input: { ...codeField, wait: WAIT_FIELD },
    run: (rt, args) => act(rt, args['code'], { type: 'newGame' }, args['wait'])
  },
  {
    name: 'list_my_tables',
    description: '列出这个凭据所在的同桌（邀请码 + 已入座人数 + 我在那张桌的角色）。',
    input: {},
    run: async (rt) => {
      const tables: readonly TableSummary[] = await rt.api.listTables();
      return { tables };
    }
  },
  {
    name: 'join_table',
    description: '用邀请码进桌：有空座就入座（坐上空座会继承该座位的级别与手牌），满座则以观战者身份进入。',
    input: { code: z.string().min(1) },
    run: async (rt, args) => {
      const code = (args['code'] as string).trim().toUpperCase();
      await rt.api.enterTable(code);
      return stateOf(rt, code);
    }
  },
  {
    name: 'leave_seat',
    description:
      '离座：座位空出、本人转为观战者（本副不废，停在空座上等人补位）；本来不在座也成功。要回座用 take_seat。',
    input: codeField,
    // 只回一句回执，不附局面：离座后只剩公共视图，而工具面出参是每个回合都要重发的
    run: async (rt, args) => {
      const code = await resolveCode(rt, args['code']);
      await rt.api.leaveSeat(code);
      return {
        ok: true,
        code,
        role: 'spectator',
        note:
          '你现在是观战者（能读局面与说明，动作要求先入座）。座位空着，本副停在空座上等人补位；' +
          '要坐回来用 take_seat。'
      };
    }
  },
  {
    name: 'take_seat',
    description:
      '补位入座：占用第一个空座，**继承该座位的级别与手牌**（本副尚未结算时会接下这手牌继续打）；已在座是空操作。',
    input: codeField,
    // 补位者会接到一手陌生的牌，所以这里必须回完整局面（否则模型不知道该出什么）
    run: async (rt, args) => {
      const code = await resolveCode(rt, args['code']);
      const { seat, inherited } = await rt.api.takeSeat(code);
      const state = await stateOf(rt, code);
      return inherited
        ? {
            ...state,
            note: `你补进了座位 ${seat} 的空座：接下这个座位的手牌继续打完这一副（级别也随座位继承），**不是**从头开始。`
          }
        : { ...state, note: `你坐在座位 ${seat} 上。` };
    }
  },
  {
    name: 'create_table',
    description: '自己开一张新同桌，返回邀请码（随后要把码告诉同桌的另外两人）。',
    input: {},
    run: async (rt) => {
      const code = await rt.api.createTable();
      return { code, note: '把邀请码发给另外两人，他们在大厅粘贴邀请链接即可入座。' };
    }
  }
];

export function toolByName(name: string): ToolSpec | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/**
 * 统一的调用入口：先按 zod shape 校验参数，再把错误收敛成一句人话（SDK 侧转成 isError）
 *
 * 无身份会话的**唯一**那道门也在这里：工具表照旧全列（模型要能看见配好凭据后会拿到什么），
 * 但需要身份的工具在碰 `GameApi` 之前就被挡下 —— 默认拒绝（`requiresIdentity` 省略即「要身份」，见 ADR-0014）。
 */
export async function callTool(spec: ToolSpec, rt: ToolRuntime, rawArgs: unknown): Promise<unknown> {
  if (spec.requiresIdentity !== false && rt.api.authenticated !== true) throw new ToolError(NO_IDENTITY_HINT);
  const parsed = z.object(spec.input).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') ?? '(参数)';
    throw new ToolError(`参数格式不正确：${where} ${issue?.message ?? ''}`.trim());
  }
  try {
    return await spec.run(rt, parsed.data as Record<string, unknown>);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (error instanceof ApiError) {
      // `status === 0` = 压根没拿到响应（连不上/超时/响应读到一半断了），那不是服务端的判定，
      // 不能说成「服务器拒绝」——写路径还可能已经生效了，得让调用方先去核对（见 ADR-0012）。
      throw new ToolError(error.status === 0 ? error.message : `服务器拒绝：${error.message}`);
    }
    throw new ToolError(error instanceof Error ? error.message : String(error));
  }
}
