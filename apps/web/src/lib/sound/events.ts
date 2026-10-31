/**
 * 把两帧视图之间的变化翻译成提示音事件（**纯函数**，无 IO、不碰 AudioContext）。
 *
 * 为什么单独抽一层：音效的触发判据全是「上一帧与这一帧之差」，而 AudioContext 只有在浏览器里
 * 才存在。判据留在这里就能在 node 里逐年逐帧地测（见 `test/sound.test.ts`），
 * `board.svelte.ts` 只负责把事件变成声音。
 *
 * 视图来源是**公共视图**：出牌、收墩、结算本来就是公开事件，观战者与在座者听的是同一套。
 * 只有「该你了」需要 `you`（观战者拿不到，也就永远不会响）。
 */
import type { PublicView } from '@sixty/engine';
import type { PlayerHand } from '$lib/shared';

/** 引擎权威的阶段类型：从公共视图上取，避免在这里另写一份联合 */
type DealPhase = NonNullable<PublicView['deal']>['phase'];

export type SoundCue = 'turn' | 'card' | 'trick' | 'settle';

/**
 * 一帧里与声音有关的那几个数。
 *
 * 刻意只留**原始计数**（当前墩出牌数、已完成墩数）而不是布尔标记：增量比较在
 * `soundEvents` 里一处完成，快照本身可以照原样打印、对照，出问题时一眼看得出是哪一帧。
 */
export interface SoundSnapshot {
  readonly phase: DealPhase | null;
  readonly dealNo: number | null;
  /** 我的座位；观战者（以及还没发牌的桌上没有座位的人）为 `null` */
  readonly mySeat: number | null;
  readonly isDeclarer: boolean;
  readonly auctionTurn: number | null;
  readonly playTurn: number | null;
  /** 当前这一墩已经落地几张 */
  readonly trickPlays: number;
  /** 已经收走的墩数 */
  readonly tricksDone: number;
  /** 已结算的那一副的副号；未结算为 `null` */
  readonly settledDealNo: number | null;
  /**
   * 待我表态的认赢（认赢者的座位）；没有则为 `null`。
   *
   * 认赢期间引擎的 `playTurn` 是 null（牌局冻结），所以「该我了」不能只看出牌轮次 ——
   * 30 秒的窗口里轮到的是**两名对手的表态**，那一声提醒正是这里最需要的。
   */
  readonly claimVote: number | null;
}

export function soundSnapshot(view: PublicView | null, you: PlayerHand | null): SoundSnapshot {
  const deal = view?.deal ?? null;
  const claim = deal?.claim ?? null;
  const mySeat = you?.seat ?? null;
  return {
    phase: deal?.phase ?? null,
    dealNo: deal?.dealNo ?? null,
    mySeat,
    isDeclarer: you?.isDeclarer ?? false,
    auctionTurn: deal?.auctionTurn ?? null,
    playTurn: deal?.playTurn ?? null,
    trickPlays: deal?.trick?.plays.length ?? 0,
    tricksDone: deal?.trickHistory.length ?? 0,
    settledDealNo: deal?.summary?.dealNo ?? null,
    claimVote:
      claim !== null && claim.status === 'pending' && mySeat !== null && claim.claimant !== mySeat && claim.answers[mySeat] === null
        ? claim.claimant
        : null
  };
}

/**
 * 这一帧是否「该我出手」：叫牌轮到我的座位、埋底轮到我（我是庄家）、出牌轮到我。
 *
 * 埋底没有单独的轮次字段 —— 那一阶段就是庄家的活（见 CONTEXT.md 的 **埋底**），
 * 所以「我是庄家」即「轮到我」。
 */
export function isMyTurn(snapshot: SoundSnapshot): boolean {
  if (snapshot.mySeat === null) return false;
  // 认赢待我表态：与「轮到我出牌」同一条意思（牌局冻着，等的是我这一票）
  if (snapshot.claimVote !== null) return true;
  if (snapshot.phase === 'auction') return snapshot.auctionTurn === snapshot.mySeat;
  if (snapshot.phase === 'bury') return snapshot.isDeclarer;
  if (snapshot.phase === 'play') return snapshot.playTurn === snapshot.mySeat;
  return false;
}

/**
 * 两帧之间该响哪几声（顺序即依次播放的顺序）。
 *
 * 四条判据各有一次真实取舍：
 *
 * ① **「该你了」看的是布尔，不是「阶段 + 座位」**：叫牌的最后一人成交后立刻作为庄家埋底，
 *    两个阶段的「轮到我」首尾相接；按复合键算会连响两声，按布尔算只响一声。
 * ② **首帧也算**（`prev === null`）：刷新/重连后正轮到你，那一下正是需要的提醒。
 * ③ **只在同一副内比较计数**：开新一副时 `trickPlays` 会从 0 重新数起，跨副比较会把
 *    「上一副的最后一墩」误读成这一副的出牌。
 * ④ **收墩与结算可以同帧**：末墩落地那一帧引擎收墩并结算，两声一起给（先墩后结算）。
 */
export function soundEvents(prev: SoundSnapshot | null, next: SoundSnapshot): SoundCue[] {
  const cues: SoundCue[] = [];

  const turnNow = isMyTurn(next);
  const turnBefore = prev !== null && isMyTurn(prev);
  if (turnNow && !turnBefore) cues.push('turn');

  const sameDeal = prev !== null && prev.dealNo !== null && prev.dealNo === next.dealNo;
  if (sameDeal && next.phase === 'play' && next.trickPlays > prev.trickPlays) cues.push('card');
  if (sameDeal && next.tricksDone > prev.tricksDone) cues.push('trick');

  if (next.settledDealNo !== null && next.settledDealNo !== (prev?.settledDealNo ?? null)) {
    cues.push('settle');
  }

  return cues;
}
