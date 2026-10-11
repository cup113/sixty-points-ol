/**
 * 引导局的回放核心：**烘焙事实 → 引擎状态**，唯一一份口径。
 *
 * 两条与 ADR-0025 绑在一起的规矩：
 * 1. **从显式手牌构造，不从种子构造**。线上那副牌是 `cryptoRng` 发的，不可复现；引导数据把
 *    三家 17 张 + 拿上来的底牌存成事实，这里用引擎的 `dealWith` 直接搭出那一副（与机器重演同一招）。
 * 2. **引擎状态只由 `dispatch` 产生**，且每次递进去的 `Action` 都是**新建的普通对象** ——
 *    调用方手里可能是 Svelte 5 的响应式代理，代理被子对象塞进 `state.deal` 后，下一次
 *    `dispatch` 的 `structuredClone(prev)` 会抛 DataCloneError（编排台踩过这个坑，见 ADR-0008）。
 */
import {
  auctionTurn,
  cardKey,
  createGame,
  dealWith,
  dispatch,
  fullDeck,
  playTurn,
  type Action,
  type BidCall,
  type Card,
  type GameState,
  type Level,
  type Seat
} from '@sixty/engine';
import type { DealSegment, GuideAction, GuideDealData } from './types.ts';

/** 键 → 牌：全仓库唯一一份映射；写错键必须立刻失败，而不是悄悄出一张不存在的牌 */
const DECK_BY_KEY: ReadonlyMap<string, Card> = new Map(fullDeck().map((card) => [cardKey(card), card]));

/** 写课程文案时用 `J/Q/K/A/T` 比 `11/12/13/14/10` 可读；`cardKey` 自己用数字 */
const RANK_ALIAS: Readonly<Record<string, number>> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

/**
 * 可读写法 → 规范牌键：`CK` → `C13`、`j1` → `j1`。规范键本身就是幂等的。
 * 引导局的**生成数据**一律是规范键（提取脚本直接写 `cardKey`），这里只是让手写的测验题面好读。
 */
export function normalizeCardKey(key: string): string {
  if (key.startsWith('j') || key.startsWith('J')) return key.toLowerCase();
  const suit = key.slice(0, 1).toUpperCase();
  const rest = key.slice(1).toUpperCase();
  const rank = RANK_ALIAS[rest] ?? Number(rest);
  return Number.isFinite(rank) ? `${suit}${rank}` : key;
}

export function isCardKey(key: string): boolean {
  return cardOf(key) !== null;
}

/** 认可读写法，也认规范键；认不出来返回 null */
export function cardOf(key: string): Card | null {
  return DECK_BY_KEY.get(key) ?? DECK_BY_KEY.get(normalizeCardKey(key)) ?? null;
}

export function keysOf(cards: readonly Card[]): string[] {
  return cards.map(cardKey);
}

/** 牌键 → 牌；键不存在就抛错（生成物被手改时必须立刻失败） */
export function handFromKeys(keys: readonly string[]): Card[] {
  return keys.map((key) => {
    const card = cardOf(key);
    if (card === null) throw new Error(`牌键不存在：${key}`);
    return card;
  });
}

/** 多重集合相等：牌的大小完全相等只可能是副级，所以按 `cardKey` 计数比较即可 */
export function sameCards(a: readonly Card[], b: readonly Card[]): boolean {
  if (a.length !== b.length) return false;
  const quota = new Map<string, number>();
  for (const card of a) {
    const key = cardKey(card);
    quota.set(key, (quota.get(key) ?? 0) + 1);
  }
  for (const card of b) {
    const key = cardKey(card);
    const left = quota.get(key) ?? 0;
    if (left === 0) return false;
    quota.set(key, left - 1);
  }
  return true;
}

/**
 * 引导局的 rng：只 dispatch `bid` / `bury` / `play`，三者都不取随机数
 * （取随机数的只有 `deal`，而发牌由 `dealWith` 完成）。喂一个死函数，顺带把这件事钉住。
 */
const deadRng = (): number => 0;

export interface ReplayedPlay {
  readonly seat: Seat;
  readonly cards: readonly Card[];
  /** 这一手对应的动作下标（复盘定位与深链都用它） */
  readonly stepIndex: number;
}

export interface ReplayedTrick {
  readonly ordinal: number;
  readonly leaderSeat: Seat;
  readonly plays: readonly ReplayedPlay[];
  readonly winnerSeat: Seat;
  readonly points: number;
}

export interface GuideReplay {
  /** 发牌态（`dealWith` 构造完、尚未叫牌的初始状态） */
  readonly initial: GameState;
  /** `states[i]` = 应用 `actions[i]` 之后的状态 */
  readonly states: readonly GameState[];
  /** 全部动作之后的状态（正常即 `phase === 'scored'`） */
  readonly state: GameState;
  readonly tricks: readonly ReplayedTrick[];
  readonly error: { readonly index: number; readonly message: string } | null;
}

/**
 * 发牌态：级别取自引导数据（级牌点数由庄家级别决定，必须还原到开打前），
 * 三家手牌与底牌直接构造 —— 线上那副怎么发的不可复现，也不需要可复现。
 */
export function dealtGuideState(deal: GuideDealData): GameState {
  const state = createGame(deal.facts.dealerSeat);
  state.levels = deal.facts.levels.map((level: Level) => ({ rank: level.rank, cycle: level.cycle }));
  state.dealerSeat = deal.facts.dealerSeat;
  state.dealNo = deal.facts.dealNo;
  state.deal = dealWith(
    deal.facts.hands.map((hand) => handFromKeys(hand)),
    handFromKeys(deal.facts.originalKitty),
    deal.facts.dealerSeat,
    deal.facts.dealNo
  );
  return state;
}

type Converted =
  | {
      readonly ok: true;
      readonly action: Extract<Action, { type: 'bid' | 'bury' | 'play' }>;
      readonly cards: readonly Card[];
    }
  | { readonly ok: false; readonly message: string };

/** 引导动作 → 引擎动作。牌一律新建对象，绝不把代理/生成物里的引用递进引擎 */
export function toEngineAction(action: GuideAction): Converted {
  switch (action.type) {
    case 'bid': {
      const call: BidCall =
        action.call === 'pass' ? 'pass' : { points: action.call.points, strain: action.call.strain };
      return { ok: true, action: { type: 'bid', seat: action.seat, call }, cards: [] };
    }
    case 'bury':
    case 'play': {
      const cards: Card[] = [];
      for (const key of action.cards) {
        const card = cardOf(key);
        if (card === null) return { ok: false, message: `牌键不存在：${key}` };
        cards.push(card);
      }
      return { ok: true, action: { type: action.type, seat: action.seat, cards }, cards };
    }
  }
}

/** 完整重放一副引导局；任何一步不合法就停在原地并如实记错（校验脚本靠它报红） */
export function replayGuide(deal: GuideDealData): GuideReplay {
  let state = dealtGuideState(deal);
  const initial = state;
  const states: GameState[] = [];
  const tricks: ReplayedTrick[] = [];
  let pending: ReplayedPlay[] = [];
  let error: GuideReplay['error'] = null;

  for (let index = 0; index < deal.actions.length; index += 1) {
    const converted = toEngineAction(deal.actions[index]!);
    if (!converted.ok) {
      error = { index, message: converted.message };
      break;
    }
    const result = dispatch(state, converted.action, deadRng);
    if (!result.ok) {
      error = { index, message: result.message };
      break;
    }
    state = result.state;

    let redeal = false;
    for (const event of result.events) {
      if (event.type === 'redeal') {
        error = { index, message: '引导局里不允许出现全 pass 重发（那会换掉整副牌）' };
        redeal = true;
        break;
      }
      // 只认 `played` 那一条事件：一次出牌若同时收墩，`result.events` 里还会有 `trickWon`，
      // 用「动作是出牌」当条件会把它也塞进这一墩（第三家于是出现两次）
      if (event.type === 'played') {
        pending.push({ seat: event.seat, cards: event.cards, stepIndex: index });
      }
      if (event.type === 'trickWon') {
        tricks.push({
          ordinal: tricks.length,
          leaderSeat: event.leaderSeat,
          plays: pending,
          winnerSeat: event.winnerSeat,
          points: event.points
        });
        pending = [];
      }
    }
    if (redeal) break;
    states.push(state);
  }

  return { initial, states, state, tricks, error };
}

/** 此刻该谁动：叫牌轮到的座位 / 庄家埋底 / 打牌轮到的座位；结算后为 null */
export function actorOf(state: GameState): Seat | null {
  const deal = state.deal;
  if (deal === null) return null;
  if (deal.phase === 'auction') return auctionTurn(deal);
  if (deal.phase === 'bury') return deal.contract === null ? null : deal.contract.declarerSeat;
  if (deal.phase === 'play') return playTurn(deal);
  return null;
}

/** 引导局的段落边界：叫牌段 = `[0, auctionEnd)`，其余（埋底 + 出牌）= `[auctionEnd, total)` */
export interface DealSpans {
  /** 定约成立那一步之后的下标（叫牌段到此为止） */
  readonly auctionEnd: number;
  readonly total: number;
}

/**
 * 现算段落边界，不在课程里写死下标：叫牌段的终点是「定约成立的那一步」，
 * 而那一步是引擎说了算的（连续两家不叫），改写引导数据也不会让课程错位。
 */
export function dealSpans(deal: GuideDealData): DealSpans {
  const replay = replayGuide(deal);
  let auctionEnd = deal.actions.length;
  for (let index = 0; index < replay.states.length; index += 1) {
    const phase = replay.states[index]!.deal?.phase;
    if (phase !== undefined && phase !== 'auction') {
      auctionEnd = index + 1;
      break;
    }
  }
  return { auctionEnd, total: deal.actions.length };
}

/** 某一屏要打的动作区间（`segment` 见 `types.ts`） */
export function segmentRange(
  deal: GuideDealData,
  segment: DealSegment
): { readonly from: number; readonly to: number } {
  const spans = dealSpans(deal);
  if (segment === 'auction') return { from: 0, to: spans.auctionEnd };
  if (segment === 'play') return { from: spans.auctionEnd, to: spans.total };
  return { from: 0, to: spans.total };
}
