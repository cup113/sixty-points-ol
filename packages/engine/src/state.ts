import {
  fullDeck,
  shuffled,
  cardsPoints,
  removeCards,
  rankLabel,
  SEATS,
  type Card,
  type Rank,
  type RNG,
  type Seat,
  type Strain
} from './cards.ts';
import { isPass, isHigherBid, validateCall, type Bid, type BidCall } from './auction.ts';
import { leadInfo, validateFollow, validateLead } from './validate.ts';
import { trickWinner, type TrickPlay } from './trick.ts';
import type { TrumpModel } from './order.ts';

export type { TrickPlay };

export interface Level {
  readonly rank: Rank;
  readonly cycle: number;
}

export const START_LEVEL: Level = { rank: 2, cycle: 0 };
export const LEVELS_PER_CYCLE = 13;
/** 结束阈值：2(+2) 与 2(+3) 的总进度 */
export const FINISH_TWO_AT = LEVELS_PER_CYCLE * 2 + 1;
export const FINISH_ONE_AT = LEVELS_PER_CYCLE * 3 + 1;

export function levelProgress(l: Level): number {
  return LEVELS_PER_CYCLE * l.cycle + (l.rank - 1);
}

export function levelFromProgress(p: number): Level {
  const safe = Math.max(1, Math.floor(p));
  return {
    rank: ((safe - 1) % LEVELS_PER_CYCLE) + 2,
    cycle: Math.floor((safe - 1) / LEVELS_PER_CYCLE)
  };
}

export function levelLabel(l: Level): string {
  // 点数走 `rankLabel`（J/Q/K/A），不在这里自己判 14：那会让 11/12/13 打成「11/12/13」，
  // 同一枚级别在编排台（StudioInspector 早就用的 rankLabel）与这里就成了两种字形。
  return `${rankLabel(l.rank)}(+${l.cycle})`;
}

/** 打成时按最终得分升级：40-59→1，60-69→2，70-79→3，80-89→4，≥90→5+(x-90)/5 */
export function madeLevels(finalScore: number): number {
  if (finalScore >= 90) return 5 + Math.floor((finalScore - 90) / 5);
  if (finalScore >= 80) return 4;
  if (finalScore >= 70) return 3;
  if (finalScore >= 60) return 2;
  return 1;
}

export interface Contract {
  readonly points: number;
  readonly strain: Strain;
  readonly declarerSeat: Seat;
}

export interface BidEntry {
  readonly seat: Seat;
  readonly call: BidCall;
}

export interface Trick {
  leaderSeat: Seat;
  plays: TrickPlay[];
}

export interface CompletedTrick {
  readonly leaderSeat: Seat;
  readonly plays: readonly TrickPlay[];
  readonly winnerSeat: Seat;
  readonly points: number;
}

export interface LevelChange {
  readonly seat: Seat;
  readonly from: Level;
  readonly to: Level;
  readonly levels: number;
}

export interface DealSummary {
  readonly dealNo: number;
  readonly contract: Contract;
  readonly trump: TrumpModel;
  readonly declarerTrickPoints: number;
  readonly defenderTrickPoints: number;
  readonly originalKitty: readonly Card[];
  readonly kitty: readonly Card[];
  readonly lastTrickSize: number;
  readonly protectedBottom: boolean;
  readonly multiplier: number;
  readonly kittyPoints: number;
  readonly finalScore: number;
  readonly made: boolean;
  readonly shortfall: number;
  readonly levelChanges: readonly LevelChange[];
}

export interface GameResult {
  readonly progress: readonly number[];
  readonly ranking: readonly Seat[];
}

export type DealPhase = 'auction' | 'bury' | 'play' | 'scored';

export interface DealState {
  phase: DealPhase;
  dealNo: number;
  dealerSeat: Seat;
  hands: Card[][];
  originalKitty: Card[];
  kitty: Card[];
  auction: BidEntry[];
  contract: Contract | null;
  trump: TrumpModel | null;
  trick: Trick | null;
  trickHistory: CompletedTrick[];
  captured: Card[][];
  summary: DealSummary | null;
}

export interface GameState {
  version: number;
  status: 'playing' | 'finished';
  dealerSeat: Seat;
  levels: Level[];
  dealNo: number;
  deal: DealState | null;
  history: DealSummary[];
  result: GameResult | null;
}

export type Action =
  | { readonly type: 'deal' }
  | { readonly type: 'bid'; readonly seat: Seat; readonly call: BidCall }
  | { readonly type: 'bury'; readonly seat: Seat; readonly cards: readonly Card[] }
  | { readonly type: 'play'; readonly seat: Seat; readonly cards: readonly Card[] }
  | { readonly type: 'newGame' };

export type EngineEvent =
  | { readonly type: 'dealt'; readonly dealNo: number; readonly dealerSeat: Seat }
  | { readonly type: 'redeal'; readonly dealerSeat: Seat }
  | { readonly type: 'bid'; readonly seat: Seat; readonly call: BidCall }
  | { readonly type: 'contract'; readonly contract: Contract }
  | { readonly type: 'buried'; readonly seat: Seat; readonly cards: readonly Card[] }
  | { readonly type: 'played'; readonly seat: Seat; readonly cards: readonly Card[] }
  | {
      readonly type: 'trickWon';
      readonly leaderSeat: Seat;
      readonly plays: readonly TrickPlay[];
      readonly winnerSeat: Seat;
      readonly points: number;
    }
  | { readonly type: 'dealScored'; readonly summary: DealSummary }
  | { readonly type: 'gameFinished'; readonly result: GameResult }
  | { readonly type: 'gameReset' };

export interface DispatchError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type DispatchResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly EngineEvent[] }
  | DispatchError;

export const CARDS_PER_SEAT = 17;
export const KITTY_SIZE = 3;

function err(code: string, message: string): DispatchError {
  return { ok: false, code, message };
}

export function createGame(dealerSeat: Seat = 0): GameState {
  return {
    version: 0,
    status: 'playing',
    dealerSeat,
    levels: [{ ...START_LEVEL }, { ...START_LEVEL }, { ...START_LEVEL }],
    dealNo: 0,
    deal: null,
    history: [],
    result: null
  };
}

export function newDeal(dealNo: number, dealerSeat: Seat, rng: RNG): DealState {
  const deck = shuffled(fullDeck(), rng);
  const hands: Card[][] = [
    deck.slice(0, CARDS_PER_SEAT),
    deck.slice(CARDS_PER_SEAT, CARDS_PER_SEAT * 2),
    deck.slice(CARDS_PER_SEAT * 2, CARDS_PER_SEAT * 3)
  ];
  return dealWith(hands, deck.slice(CARDS_PER_SEAT * 3), dealerSeat, dealNo);
}

/**
 * 用**已知**的三家手牌与底牌构造一副（叫牌阶段）。洗牌只是牌的一个来源：
 * 机器重演要把结算过的那副牌原样重发给三个机器人重打（ADR-0016），
 * 构造本身不该绑死在 RNG 上。入参一律拷贝，构造后互不影响。
 */
export function dealWith(
  hands: readonly (readonly Card[])[],
  originalKitty: readonly Card[],
  dealerSeat: Seat,
  dealNo: number
): DealState {
  return {
    phase: 'auction',
    dealNo,
    dealerSeat,
    hands: hands.map((hand) => [...hand]),
    originalKitty: [...originalKitty],
    kitty: [...originalKitty],
    auction: [],
    contract: null,
    trump: null,
    trick: null,
    trickHistory: [],
    captured: [[], [], []],
    summary: null
  };
}

export function auctionTurn(deal: DealState): Seat {
  return ((deal.dealerSeat + deal.auction.length) % 3) as Seat;
}

export function playTurn(deal: DealState): Seat | null {
  if (deal.phase !== 'play' || deal.trick === null) return null;
  return ((deal.trick.leaderSeat + deal.trick.plays.length) % 3) as Seat;
}

export function highestBid(auction: readonly BidEntry[]): Bid | null {
  for (let i = auction.length - 1; i >= 0; i--) {
    const call = auction[i]!.call;
    if (!isPass(call)) return call;
  }
  return null;
}

export function isDeclarerSide(seat: Seat, deal: DealState): boolean {
  return deal.contract !== null && deal.contract.declarerSeat === seat;
}

export function capturedPoints(deal: DealState, seat: Seat): number {
  return cardsPoints(deal.captured[seat]!);
}

export function declarerTrickPoints(deal: DealState): number {
  return deal.contract === null ? 0 : capturedPoints(deal, deal.contract.declarerSeat);
}

export function dispatch(prev: GameState, action: Action, rng: RNG): DispatchResult {
  const state = structuredClone(prev) as GameState;
  const events: EngineEvent[] = [];
  const fail = (e: DispatchError): DispatchError => e;

  switch (action.type) {
    case 'deal': {
      if (state.status !== 'playing') return fail(err('game_over', '对局已结束'));
      if (state.deal !== null && state.deal.phase !== 'scored') {
        return fail(err('deal_in_progress', '当前牌局尚未结束'));
      }
      const dealerSeat = (state.deal === null
        ? state.dealerSeat
        : ((state.deal.dealerSeat + 1) % 3)) as Seat;
      state.dealerSeat = dealerSeat;
      state.dealNo += 1;
      state.deal = newDeal(state.dealNo, dealerSeat, rng);
      events.push({ type: 'dealt', dealNo: state.dealNo, dealerSeat });
      break;
    }

    case 'bid': {
      const deal = state.deal;
      if (deal === null) return fail(err('no_deal', '尚未发牌'));
      if (deal.phase !== 'auction') return fail(err('not_auction', '当前不是叫牌阶段'));
      if (action.seat !== auctionTurn(deal)) return fail(err('not_your_turn', '还没轮到你叫牌'));
      const bad = validateCall(action.call, highestBid(deal.auction));
      if (bad !== null) return fail(err('illegal_bid', bad));

      deal.auction.push({ seat: action.seat, call: action.call });
      events.push({ type: 'bid', seat: action.seat, call: action.call });

      const allPass = deal.auction.length === 3 && deal.auction.every((e) => isPass(e.call));
      if (allPass) {
        const dealerSeat = ((deal.dealerSeat + 1) % 3) as Seat;
        state.dealerSeat = dealerSeat;
        state.dealNo += 1;
        state.deal = newDeal(state.dealNo, dealerSeat, rng);
        events.push({ type: 'redeal', dealerSeat });
        break;
      }

      const n = deal.auction.length;
      const last = deal.auction[n - 1]!;
      const secondLast = n >= 2 ? deal.auction[n - 2]! : null;
      const bidCount = deal.auction.filter((e) => !isPass(e.call)).length;
      if (bidCount >= 1 && isPass(last.call) && secondLast !== null && isPass(secondLast.call)) {
        const winnerEntry = [...deal.auction].reverse().find((e) => !isPass(e.call))!;
        const win = winnerEntry.call as Bid;
        const contract: Contract = {
          points: win.points,
          strain: win.strain,
          declarerSeat: winnerEntry.seat
        };
        deal.contract = contract;
        deal.trump = { strain: contract.strain, rank: state.levels[contract.declarerSeat]!.rank };
        deal.hands[contract.declarerSeat] = [...deal.hands[contract.declarerSeat]!, ...deal.kitty];
        deal.phase = 'bury';
        events.push({ type: 'contract', contract });
      }
      break;
    }

    case 'bury': {
      const deal = state.deal;
      if (deal === null) return fail(err('no_deal', '尚未发牌'));
      if (deal.phase !== 'bury' || deal.contract === null) {
        return fail(err('not_bury', '当前不是埋底阶段'));
      }
      if (action.seat !== deal.contract.declarerSeat) return fail(err('not_declarer', '只有庄家能埋底'));
      if (action.cards.length !== KITTY_SIZE) return fail(err('bury_size', `必须埋 ${KITTY_SIZE} 张底牌`));
      const rest = removeCards(deal.hands[action.seat]!, action.cards);
      if (rest === null) return fail(err('not_in_hand', '手牌中没有这些牌'));
      deal.hands[action.seat] = rest;
      deal.kitty = [...action.cards];
      deal.phase = 'play';
      deal.trick = { leaderSeat: action.seat, plays: [] };
      events.push({ type: 'buried', seat: action.seat, cards: [...action.cards] });
      break;
    }

    case 'play': {
      const deal = state.deal;
      if (deal === null) return fail(err('no_deal', '尚未发牌'));
      if (deal.phase !== 'play' || deal.trick === null || deal.trump === null) {
        return fail(err('not_play', '当前不是出牌阶段'));
      }
      const trick = deal.trick;
      const turn = playTurn(deal)!;
      if (action.seat !== turn) return fail(err('not_your_turn', '还没轮到你出牌'));

      const hand = deal.hands[action.seat]!;
      let bad: string | null;
      if (trick.plays.length === 0) {
        bad = validateLead(hand, action.cards, deal.trump);
      } else {
        const lead = leadInfo(trick.plays[0]!.cards, deal.trump);
        if (lead === null) return fail(err('bad_state', '领出牌型异常'));
        bad = validateFollow(hand, action.cards, lead, deal.trump);
      }
      if (bad !== null) return fail(err('illegal_play', bad));

      const rest = removeCards(hand, action.cards)!;
      deal.hands[action.seat] = rest;
      trick.plays.push({ seat: action.seat, cards: [...action.cards] });
      events.push({ type: 'played', seat: action.seat, cards: [...action.cards] });

      if (trick.plays.length === 3) {
        const winnerSeat = trickWinner(trick.plays, deal.trump);
        const all = trick.plays.flatMap((p) => p.cards);
        const points = cardsPoints(all);
        deal.captured[winnerSeat] = [...deal.captured[winnerSeat]!, ...all];
        const done: CompletedTrick = {
          leaderSeat: trick.leaderSeat,
          plays: [...trick.plays],
          winnerSeat,
          points
        };
        deal.trickHistory.push(done);
        events.push({
          type: 'trickWon',
          leaderSeat: done.leaderSeat,
          plays: done.plays,
          winnerSeat,
          points
        });
        if (deal.hands.every((h) => h.length === 0)) {
          scoreDeal(state, deal, events);
        } else {
          deal.trick = { leaderSeat: winnerSeat, plays: [] };
        }
      }
      break;
    }

    case 'newGame': {
      if (state.status !== 'finished') return fail(err('not_finished', '对局尚未结束'));
      state.status = 'playing';
      state.levels = [{ ...START_LEVEL }, { ...START_LEVEL }, { ...START_LEVEL }];
      state.dealerSeat = ((state.dealerSeat + 1) % 3) as Seat;
      state.dealNo = 0;
      state.deal = null;
      state.history = [];
      state.result = null;
      events.push({ type: 'gameReset' });
      break;
    }
  }

  state.version = prev.version + 1;
  return { ok: true, state, events };
}

function scoreDeal(state: GameState, deal: DealState, events: EngineEvent[]): void {
  const contract = deal.contract!;
  const declarer = contract.declarerSeat;
  const declaredPoints = capturedPoints(deal, declarer);
  const defenderPoints = SEATS.filter((s) => s !== declarer).reduce<number>(
    (sum, s) => sum + capturedPoints(deal, s),
    0
  );

  const last = deal.trickHistory[deal.trickHistory.length - 1]!;
  const multiplier = last.plays[0]!.cards.length;
  const protectedBottom = last.winnerSeat === declarer;
  const kittyPoints = cardsPoints(deal.kitty);
  const finalScore = declaredPoints + (protectedBottom ? multiplier * kittyPoints : -multiplier * kittyPoints);
  const made = finalScore >= contract.points;

  const changes: LevelChange[] = [];
  const bump = (seat: Seat, levels: number): void => {
    const from = state.levels[seat]!;
    const to = levelFromProgress(levelProgress(from) + levels);
    state.levels[seat] = to;
    changes.push({ seat, from, to, levels });
  };

  let shortfall = 0;
  if (made) {
    bump(declarer, madeLevels(finalScore));
  } else {
    shortfall = contract.points - finalScore;
    const levels = Math.ceil(shortfall / 10);
    for (const s of SEATS) if (s !== declarer) bump(s, levels);
  }

  const summary: DealSummary = {
    dealNo: deal.dealNo,
    contract,
    trump: deal.trump!,
    declarerTrickPoints: declaredPoints,
    defenderTrickPoints: defenderPoints,
    originalKitty: [...deal.originalKitty],
    kitty: [...deal.kitty],
    lastTrickSize: multiplier,
    protectedBottom,
    multiplier,
    kittyPoints,
    finalScore,
    made,
    shortfall,
    levelChanges: changes
  };

  deal.summary = summary;
  deal.phase = 'scored';
  state.history.push(summary);
  events.push({ type: 'dealScored', summary });

  const progress = state.levels.map(levelProgress);
  const atTwo = progress.filter((p) => p >= FINISH_TWO_AT).length;
  const atThree = progress.filter((p) => p >= FINISH_ONE_AT).length;
  if (atTwo >= 2 || atThree >= 1) {
    const ranking = [...SEATS].sort((a, b) => progress[b]! - progress[a]!);
    state.status = 'finished';
    state.result = { progress, ranking };
    events.push({ type: 'gameFinished', result: state.result });
  }
}
