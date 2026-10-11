/**
 * 引导局的会话状态机（**纯函数层**）：下一步该谁动、用户这一手放不放行、快进到哪一步。
 *
 * 与 `.svelte.ts` 那层的分工：这里一个 rune 都没有 —— 定时器、动画、点击全归接线层，
 * 而「节奏之外的每一步规则」都在这里，于是它可以被 `node:test` 直接单测（ADR-0008 的同一条纪律）。
 *
 * 三条不变量：
 * - 状态只由 `dispatch` 前进，动作只从引导数据里取（用户「自己想的」那一手永远不被写进牌局）；
 * - `index` 是「**下一条**待执行动作」的下标，绝不指向已执行过的那条；
 * - 用户座位的动作只能由 `submit*` 放行，而放行条件 = 与引导目标完全一致（两类拒绝见 `forcing.ts`）。
 */
import {
  dispatch,
  type BidCall,
  type Card,
  type CompletedTrick,
  type GameState,
  type TrickPlay
} from '@sixty/engine';
import { guidedCall, guidedCards, judgeBid, judgeBury, judgePlay, type Rejection } from './forcing.ts';
import { actorOf, dealtGuideState, toEngineAction } from './replay.ts';
import type { GuideAction, GuideDealData } from './types.ts';

export type SessionPhase = 'playing' | 'done' | 'error';

export interface SessionSnapshot {
  readonly state: GameState;
  /** 下一条待执行动作的下标（= 已执行的动作条数） */
  readonly index: number;
  readonly phase: SessionPhase;
  /** `phase === 'error'` 时的原因（正常永远为 null；数据坏了才会出现） */
  readonly error: string | null;
}

/** 这一步按引导数据走完之后会不会收墩 —— 接线层用它决定要不要等动画 */
export interface StepEvents {
  readonly scored: boolean;
  readonly trickWon: boolean;
}

export function startSession(deal: GuideDealData): SessionSnapshot {
  return { state: dealtGuideState(deal), index: 0, phase: 'playing', error: null };
}

/** 推进一条动作（**不校验座位**：接线层只在「轮到的不是用户」时调它，`submit*` 走另一条路） */
export function stepOnce(
  snap: SessionSnapshot,
  deal: GuideDealData
): { readonly snapshot: SessionSnapshot; readonly events: StepEvents } {
  if (snap.phase !== 'playing') return { snapshot: snap, events: { scored: false, trickWon: false } };
  const action = deal.actions[snap.index];
  if (action === undefined) {
    return { snapshot: { ...snap, phase: 'done' }, events: { scored: false, trickWon: false } };
  }
  const converted = toEngineAction(action);
  if (!converted.ok) {
    return {
      snapshot: { ...snap, phase: 'error', error: `第 ${snap.index + 1} 步：${converted.message}` },
      events: { scored: false, trickWon: false }
    };
  }
  const result = dispatch(snap.state, converted.action, () => 0);
  if (!result.ok) {
    return {
      snapshot: { ...snap, phase: 'error', error: `第 ${snap.index + 1} 步：${result.message}` },
      events: { scored: false, trickWon: false }
    };
  }
  let scored = false;
  let trickWon = false;
  for (const event of result.events) {
    if (event.type === 'dealScored') scored = true;
    if (event.type === 'trickWon') trickWon = true;
  }
  const index = snap.index + 1;
  const done = index >= deal.actions.length || result.state.deal?.phase === 'scored';
  return {
    snapshot: { state: result.state, index, phase: done ? 'done' : 'playing', error: null },
    events: { scored, trickWon }
  };
}

/**
 * 快进到 `targetIndex`（第 targetIndex 条动作**之前**停下）：深链与「续读」用它。
 * 不播动画、不等节奏 —— 恢复的正确性只看「重放到那一步」，与走过来时是同一批动作。
 */
export function fastForward(deal: GuideDealData, targetIndex: number): SessionSnapshot {
  const clamped = Math.max(0, Math.min(deal.actions.length, targetIndex));
  let snap = startSession(deal);
  while (snap.phase === 'playing' && snap.index < clamped) {
    snap = stepOnce(snap, deal).snapshot;
  }
  return snap;
}

/** 此刻轮到用户了吗；是的话把那条动作一并给出来（教练栏高亮 / 强制判定都用它） */
export function learnerTurn(
  snap: SessionSnapshot,
  deal: GuideDealData
): { readonly index: number; readonly action: GuideAction } | null {
  if (snap.phase !== 'playing') return null;
  const actor = actorOf(snap.state);
  if (actor === null || actor !== deal.learnerSeat) return null;
  const action = deal.actions[snap.index];
  if (action === undefined || action.seat !== deal.learnerSeat) return null;
  return { index: snap.index, action };
}

/** 用户**接下来**的那个动作（不要求现在轮到他）：教练栏要提前把话摆出来 */
export function nextLearnerAction(
  deal: GuideDealData,
  fromIndex: number
): { readonly index: number; readonly action: GuideAction } | null {
  for (let index = Math.max(0, fromIndex); index < deal.actions.length; index += 1) {
    const action = deal.actions[index]!;
    if (action.seat === deal.learnerSeat) return { index, action };
  }
  return null;
}

type Submit = { readonly ok: true; readonly snapshot: SessionSnapshot; readonly events: StepEvents } | {
  readonly ok: false;
  readonly rejection: Rejection;
};

function dispatchGuided(snap: SessionSnapshot, deal: GuideDealData, index: number): Submit {
  const action = deal.actions[index]!;
  const converted = toEngineAction(action);
  if (!converted.ok) return { ok: false, rejection: { kind: 'illegal', reason: converted.message } };
  const result = dispatch(snap.state, converted.action, () => 0);
  if (!result.ok) return { ok: false, rejection: { kind: 'illegal', reason: result.message } };
  let scored = false;
  let trickWon = false;
  for (const event of result.events) {
    if (event.type === 'dealScored') scored = true;
    if (event.type === 'trickWon') trickWon = true;
  }
  const next = index + 1;
  const done = next >= deal.actions.length || result.state.deal?.phase === 'scored';
  return {
    ok: true,
    snapshot: { state: result.state, index: next, phase: done ? 'done' : 'playing', error: null },
    events: { scored, trickWon }
  };
}

/** 用户出牌：与引导目标完全一致才放行 */
export function submitPlay(snap: SessionSnapshot, deal: GuideDealData, cards: readonly Card[]): Submit {
  const turn = learnerTurn(snap, deal);
  if (turn === null || turn.action.type !== 'play') {
    return { ok: false, rejection: { kind: 'illegal', reason: '现在不是该你出牌' } };
  }
  const target = guidedCards(turn.action) ?? [];
  const verdict = judgePlay(snap.state, deal.learnerSeat, target, cards);
  if (verdict !== null) return { ok: false, rejection: verdict };
  return dispatchGuided(snap, deal, turn.index);
}

/** 用户叫牌（含「不叫」） */
export function submitBid(snap: SessionSnapshot, deal: GuideDealData, call: BidCall): Submit {
  const turn = learnerTurn(snap, deal);
  if (turn === null || turn.action.type !== 'bid') {
    return { ok: false, rejection: { kind: 'illegal', reason: '现在不是该你叫牌' } };
  }
  const target = guidedCall(turn.action) ?? 'pass';
  const verdict = judgeBid(snap.state, deal.learnerSeat, target, call);
  if (verdict !== null) return { ok: false, rejection: verdict };
  return dispatchGuided(snap, deal, turn.index);
}

/** 用户埋底 */
export function submitBury(snap: SessionSnapshot, deal: GuideDealData, cards: readonly Card[]): Submit {
  const turn = learnerTurn(snap, deal);
  if (turn === null || turn.action.type !== 'bury') {
    return { ok: false, rejection: { kind: 'illegal', reason: '现在不是该你埋底' } };
  }
  const target = guidedCards(turn.action) ?? [];
  const verdict = judgeBury(snap.state, deal.learnerSeat, target, cards);
  if (verdict !== null) return { ok: false, rejection: verdict };
  return dispatchGuided(snap, deal, turn.index);
}

// ── 界面要用的只读切片 ───────────────────────────────────────────────

/** 用户自己的手牌（过程只见自己 —— 与 **个人视图** 同语义） */
export function learnerHand(snap: SessionSnapshot, deal: GuideDealData): readonly Card[] {
  return snap.state.deal?.hands[deal.learnerSeat] ?? [];
}

/** 别人还剩几张（牌面不给看，只报张数） */
export function handCounts(snap: SessionSnapshot): readonly number[] {
  const deal = snap.state.deal;
  if (deal === null) return [0, 0, 0];
  return deal.hands.map((hand) => hand.length);
}

/** 当前这一墩已经出的牌（还没人出就是空数组） */
export function currentPlays(snap: SessionSnapshot): readonly TrickPlay[] {
  return snap.state.deal?.trick?.plays ?? [];
}

/** 最近收掉的那一墩（复盘与出牌区回显共用） */
export function lastTrick(snap: SessionSnapshot): CompletedTrick | null {
  const history = snap.state.deal?.trickHistory ?? [];
  return history.length === 0 ? null : history[history.length - 1]!;
}

/** 埋底阶段：拿上来的那 3 张（只对庄家亮，闲家章用不到） */
export function takenKitty(snap: SessionSnapshot): readonly Card[] {
  const deal = snap.state.deal;
  if (deal === null || deal.phase !== 'bury') return [];
  return deal.originalKitty;
}
