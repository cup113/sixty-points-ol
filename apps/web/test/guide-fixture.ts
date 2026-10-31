/**
 * 引导局测试夹具：用引擎 + 机器人策略**合成**一副打完的牌，再包成 `GuideDealData`。
 *
 * 为什么合成而不是放一份假数据进仓库：引导局的正式数据只能来自「三人非 bot」的真实牌局
 * （ADR-0025），仓库里不放编造的引导局；但会话状态机、强制判定与回放核对这些**机制**
 * 必须能被单测。合成用的驱动器与 `packages/bot/src/sim.ts` 同构 ——
 * 「个人视图 → moveFor/fallbackFor → dispatch」，所以产出的动作序列天然合法。
 */
import {
  cardKey,
  createGame,
  dealWith,
  dispatch,
  fullDeck,
  personalView,
  shuffled,
  type Action,
  type BidCall,
  type Card,
  type GameState,
  type Level,
  type RNG,
  type Seat
} from '@sixty/engine';
import { fallbackFor, moveFor, type BotMove } from '@sixty/bot';
import { actorOf } from '../src/lib/guide/replay.ts';
import type { GuideAction, GuideDealData } from '../src/lib/guide/types.ts';

/** 确定性 PRNG（与旧编排台的 mulberry32 同款；夹具不碰 cryptoRng） */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_LEVELS: readonly Level[] = [
  { rank: 2, cycle: 0 },
  { rank: 5, cycle: 0 },
  { rank: 10, cycle: 0 }
];

export interface PlayedDeal {
  readonly hands: readonly (readonly Card[])[];
  readonly kitty: readonly Card[];
  readonly dealerSeat: Seat;
  readonly levels: readonly Level[];
  /** 全副动作（含叫牌、埋底、出牌），按序回放即得这副牌 */
  readonly actions: readonly GuideAction[];
  /** 打完之后的终局状态（`deal.summary` 就取自它） */
  readonly finalState: GameState;
  readonly declarerSeat: Seat;
}

function toGuideAction(action: Extract<Action, { type: 'bid' | 'bury' | 'play' }>): GuideAction {
  switch (action.type) {
    case 'bid':
      return { type: 'bid', seat: action.seat, call: action.call };
    case 'bury':
    case 'play':
      return { type: action.type, seat: action.seat, cards: action.cards.map(cardKey) };
  }
}

function withSeat(move: BotMove, seat: Seat): Extract<Action, { type: 'bid' | 'bury' | 'play' }> {
  switch (move.type) {
    case 'bid':
      return { type: 'bid', seat, call: move.call };
    case 'bury':
      return { type: 'bury', seat, cards: move.cards };
    case 'play':
      return { type: 'play', seat, cards: move.cards };
  }
}

/** 三个机器人把一副牌从头打到尾，把每一步记下来（动作一定合法） */
export function playDeal(seed: number, levels: readonly Level[] = DEFAULT_LEVELS): PlayedDeal {
  const rng = mulberry32(seed);
  const deck = shuffled(fullDeck(), rng);
  const hands: Card[][] = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)];
  const kitty = deck.slice(51);
  const dealerSeat: Seat = 0;

  let state = createGame(dealerSeat);
  state.levels = levels.map((level) => ({ rank: level.rank, cycle: level.cycle }));
  state.dealNo = 1;
  state.deal = dealWith(hands, kitty, dealerSeat, 1);

  const actions: GuideAction[] = [];
  for (let steps = 0; steps < 20_000; steps += 1) {
    const deal = state.deal;
    if (deal === null || deal.phase === 'scored') break;
    const actor = actorOf(state);
    if (actor === null) break;
    const view = personalView(state, actor);
    const move = moveFor(view, view.you) ?? fallbackFor(view, view.you);
    if (move === null) throw new Error('夹具：策略给不出动作');
    const action = withSeat(move, actor);
    const result = dispatch(state, action, () => 0);
    if (!result.ok) throw new Error(`夹具：引导动作被引擎拒绝 —— ${result.message}`);
    actions.push(toGuideAction(action));
    state = result.state;
  }

  const summary = state.deal?.summary ?? null;
  if (summary === null) throw new Error('夹具：这副没打完');
  return {
    hands: hands.map((hand) => [...hand]),
    kitty,
    dealerSeat,
    levels,
    actions,
    finalState: state,
    declarerSeat: summary.contract.declarerSeat
  };
}

/** 把合成好的一副包成引导数据；`guides` 缺省时给每个用户动作一句占位引导词 */
export function asGuideDeal(
  played: PlayedDeal,
  learnerSeat: Seat,
  guides?: Readonly<Record<string, { readonly text: string; readonly why?: string }>>
): GuideDealData {
  const summary = played.finalState.deal!.summary!;
  const filled: Record<string, { readonly text: string }> = {};
  played.actions.forEach((action, index) => {
    if (action.seat !== learnerSeat) return;
    filled[String(index)] = guides?.[String(index)] ?? { text: `夹具引导词 #${index}` };
  });
  const role = learnerSeat === played.declarerSeat ? 'declarer' : 'defender';
  const aliases: [string, string, string] = ['甲', '乙', '丙'];
  const named = aliases.map((alias, seat) => (seat === learnerSeat ? '你' : alias)) as [
    string,
    string,
    string
  ];
  return {
    version: 1,
    slug: `fixture-${String(learnerSeat)}`,
    title: '夹具引导局',
    role,
    learnerSeat,
    aliases: named,
    source: { table: 'FIXTURE', dealNo: 1, date: '1970-01-01' },
    facts: {
      hands: played.hands.map((hand) => hand.map(cardKey)),
      originalKitty: played.kitty.map(cardKey),
      dealerSeat: played.dealerSeat,
      levels: played.levels.map((level) => ({ rank: level.rank, cycle: level.cycle })),
      dealNo: 1
    },
    actions: played.actions,
    guides: filled,
    review: { intro: '夹具复盘', outro: '夹具收尾' },
    expect: summary
  };
}

/** 一副现成的夹具：`learnerSeat` 由调用方指定（想测当庄家就传庄家座位） */
export function fixtureDeal(seed: number, learnerSeat: Seat): { deal: GuideDealData; played: PlayedDeal } {
  const played = playDeal(seed);
  return { deal: asGuideDeal(played, learnerSeat), played };
}

export type { BidCall };
