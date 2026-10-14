<script lang="ts">
  /**
   * 引导局的教学桌面（CONTEXT.md 的 **引导局**、**教练栏** 与 **收墩停留**）。
   *
   * 分工：**规则全在 `guide/session.ts`（纯函数）里**，这里只有接线与手感 ——
   * 定时器、选中态、拒绝提示、动画。于是「强制怎么判、下一步该谁动」都被单测盯着，
   * 而这一层改排版不会碰到规则（ADR-0008 的同一条纪律）。
   *
   * 四件事在这里实现：
   * 1. **对手自动出牌**：延迟按动作分档（叫牌/埋底 1.5s、出牌 1.1s）——教程要留出
   *    读叫牌历史表与引导词的时间，反而该比真桌的机器人（0.5–1.5s）慢；随时可「跳过等待」。
   * 2. **收墩停留**：`stepOnce`/`submit*` 返回的 `events.trickWon` 在这里被消费 ——
   *    一墩收起时三家牌在出牌区**原地停 2 秒**配赢家徽标，才清场进下一轮。
   * 3. **用户座位全量强制**：他点牌只是「选择」，出手一律由 `submit*` 判定 ——
   *    不合法给引擎的理由，合法但非引导牌指回教练栏（两类拒绝，见 `forcing.ts`）。
   * 4. **过程只见自己的手牌**：对手只报张数；复盘屏才全亮三家。手牌过引擎的
   *    `sortHand`（真桌 **个人视图** 同一份序：主牌在前、副牌黑红交替、同门内大到小）。
   */
  import { cardKey, declarerTrickPoints, highestBid, sortHand, type Card, type CompletedTrick } from '@sixty/engine';
  import { untrack } from 'svelte';
  import AuctionHistory from '$lib/components/AuctionHistory.svelte';
  import HandFan from '$lib/components/HandFan.svelte';
  import TrickCluster from '$lib/components/TrickCluster.svelte';
  import { callText, cardText, trickSideBadge, trumpText } from '$lib/labels';
  import { describeTarget, guidedCards, judgeBury, judgePlay, type Rejection } from '$lib/guide/forcing';
  import { dealSpans, handFromKeys, sameCards } from '$lib/guide/replay';
  import {
    currentPlays,
    fastForward,
    lastTrick,
    learnerHand,
    learnerTurn,
    nextLearnerAction,
    startSession,
    stepOnce,
    submitBid,
    submitBury,
    submitPlay,
    takenKitty,
    type SessionSnapshot
  } from '$lib/guide/session';
  import type { DealSegment, GuideDealData } from '$lib/guide/types';
  import CoachBar from './CoachBar.svelte';
  import GuideBidBoard from './GuideBidBoard.svelte';

  let {
    deal,
    segment,
    /** 从哪一条动作接着打（深链 / 续读用）；缺省从这一段的开头 */
    startAt = null,
    /** 每前进一步报一次（页面据此把续读位置写进 localStorage） */
    onprogress,
    /** 这一段打完了 */
    ondone
  }: {
    deal: GuideDealData;
    segment: DealSegment;
    startAt?: number | null;
    onprogress?: (index: number) => void;
    ondone: () => void;
  } = $props();

  /** 对手叫牌/埋底的延迟：思考型动作，留出读历史表与引导词的时间 */
  const THINK_DELAY_MS = 1500;
  /** 对手出牌的延迟：看清谁出了什么就够了 */
  const PLAY_DELAY_MS = 1100;
  /** 收墩后的停留：三家牌原地摆着 + 赢家徽标，然后才清场（「跳过等待」可立即过去） */
  const TRICK_HOLD_MS = 2000;

  const spans = $derived(dealSpans(deal));
  const range = $derived(
    segment === 'auction'
      ? { from: 0, to: spans.auctionEnd }
      : segment === 'play'
        ? { from: spans.auctionEnd, to: spans.total }
        : { from: 0, to: spans.total }
  );

  /**
   * 引擎快照**必须留在响应式代理之外**：`dispatch` 一进来就 `structuredClone(prev)`，
   * 而 `$state` 的深代理一被结构化克隆就抛 `DataCloneError`（对手自动出牌与「跳过等待」
   * 会当场全挂，画面停在「0 手已叫」不动）。快照本来就是整体替换、从不就地改，
   * 所以 `$state.raw` 正合身 —— 换走的只有代理，响应性一点没少（重新赋值照样通知）。
   */
  let snapshot = $state.raw<SessionSnapshot>(
    // 起始快照只算一次（深链 / 续读给的那条动作之前停下）：`untrack` 让「只取初值」这件事显式化，
    // 之后推进一律靠 `stepOnce` / `submit*`，没人会回到这个表达式
    untrack(() => fastForward(deal, Math.max(range.from, startAt ?? range.from)))
  );
  let selected = $state<string[]>([]);
  let rejection = $state<Rejection | null>(null);
  let announced = $state(false);
  /** 收墩停留中的那一墩（`null` = 不在停留）：清场由它自己的定时器负责 */
  let heldTrick = $state<CompletedTrick | null>(null);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  // 停留定时器不进响应式图，卸载时手动清
  $effect(() => {
    return () => {
      if (holdTimer !== null) clearTimeout(holdTimer);
    };
  });

  const dealState = $derived(snapshot.state.deal);
  const trump = $derived(dealState?.trump ?? null);
  const myTurn = $derived(learnerTurn(snapshot, deal));
  const nextMine = $derived(nextLearnerAction(deal, snapshot.index));
  const hand = $derived(sortHand(learnerHand(snapshot, deal), trump));
  /** 引导目标（手牌上要点出来的那几张） */
  const targetCards = $derived(myTurn === null ? [] : (guidedCards(myTurn.action) ?? []));
  const targetKeys = $derived(targetCards.map(cardKey));
  /** 教练栏给出的那一手：轮到我时是这一手，否则是**接下来**那一手（先读着） */
  const coachAction = $derived(myTurn?.action ?? nextMine?.action ?? null);
  const coachIndex = $derived(myTurn?.index ?? nextMine?.index ?? -1);
  const coachWord = $derived(coachIndex < 0 ? null : (deal.guides[String(coachIndex)] ?? null));
  const waiting = $derived(myTurn === null && snapshot.phase === 'playing' && snapshot.index < range.to);
  const played = $derived(currentPlays(snapshot));
  const lastWon = $derived(
    played.length === 0 ? (dealState?.trickHistory ?? []).at(-1) ?? null : null
  );
  /** 拿上来的底牌（只在埋底阶段给庄家亮，闲家那一章用不到） */
  const kittyTaken = $derived(takenKitty(snapshot));
  const declarerSeat = $derived(dealState?.contract?.declarerSeat ?? null);
  /** 庄家已抓的分（真桌 **信息须** 同一个来源：引擎 `declarerTrickPoints`） */
  const declarerPts = $derived(dealState === null ? 0 : declarerTrickPoints(dealState));
  /** 还在叫牌阶段时，按三家级别点数预示「哪些牌可能成为本副级牌」 */
  const candidateRanks = $derived(trump === null ? deal.facts.levels.map((level) => level.rank) : null);
  /** 等对手出手那条的解说：刚出手那家在 notes 里留了话就显示（notes 此前几乎看不到） */
  const waitingNote = $derived.by(() => {
    if (!waiting || snapshot.index === 0) return null;
    const note = deal.notes?.[String(snapshot.index - 1)];
    const actor = deal.actions[snapshot.index - 1]?.seat;
    if (note === undefined || actor === undefined || actor === deal.learnerSeat) return null;
    return `${deal.aliases[actor] ?? `座位 ${actor}`}：${note}`;
  });

  function nameOf(seat: number): string {
    return deal.aliases[seat] ?? `座位 ${seat}`;
  }

  function seatOfCluster(index: number): number {
    const play = played[index];
    return play === undefined ? -1 : play.seat;
  }

  /** 一次推进之后：收墩了就把那墩**原地停住**（`events.trickWon` 在这里被消费） */
  function holdIfWon(next: SessionSnapshot, trickWon: boolean): SessionSnapshot {
    if (trickWon) {
      heldTrick = lastTrick(next);
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        heldTrick = null;
        holdTimer = null;
      }, TRICK_HOLD_MS);
    }
    return next;
  }

  // 对手自动出牌：读一步、等一拍、再推进；定时器随快照/段界/停留重建，卸载即清。
  // 读 `heldTrick` 让「停留中」成为依赖：停着不出手、停留结束这一拍自然排下一条动作。
  $effect(() => {
    if (snapshot.phase !== 'playing') return;
    if (snapshot.index < range.from || snapshot.index >= range.to) return;
    if (learnerTurn(snapshot, deal) !== null) return;
    if (heldTrick !== null) return;
    const action = deal.actions[snapshot.index];
    const delay = action !== undefined && action.type === 'play' ? PLAY_DELAY_MS : THINK_DELAY_MS;
    const timer = setTimeout(() => {
      const out = stepOnce(snapshot, deal);
      rejection = null;
      if (out.snapshot.index <= range.to) snapshot = holdIfWon(out.snapshot, out.events.trickWon);
      else snapshot = { ...snapshot, index: range.to, phase: 'done' };
    }, delay);
    return () => clearTimeout(timer);
  });

  // 段界到了就交给页面（`announced` 保证只报一次，否则 effect 会自激）
  $effect(() => {
    if (snapshot.phase === 'playing' && snapshot.index < range.to) return;
    if (snapshot.index < range.from) return;
    if (announced) return;
    announced = true;
    ondone();
  });

  $effect(() => {
    onprogress?.(snapshot.index);
  });

  function skip(): void {
    if (snapshot.phase !== 'playing') return;
    if (snapshot.index >= range.to) return;
    // 停留也算「等待」：跳过先清掉它
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    heldTrick = null;
    const out = stepOnce(snapshot, deal);
    rejection = null;
    snapshot = holdIfWon(
      out.snapshot.index <= range.to ? out.snapshot : { ...snapshot, index: range.to, phase: 'done' },
      out.events.trickWon
    );
  }

  /** 点牌：先看这张在不在引导目标里 —— 不在就当场给两类拒绝中的一类，且**不选中**它 */
  function toggle(card: Card): void {
    const turn = myTurn;
    if (turn === null || turn.action.type === 'bid') return;
    const key = cardKey(card);
    if (selected.includes(key)) {
      selected = selected.filter((item) => item !== key);
      rejection = null;
      return;
    }
    const target = guidedCards(turn.action) ?? [];
    const inTarget = target.some((item) => cardKey(item) === key);
    if (!inTarget) {
      // 把这一张凑进当前选择再问引擎：引擎的理由（张数不对 / 必须跟门 / 结构优先）能原样给出来，
      // 而不是笼统说一句「不行」。判定是纯函数，动的是临时数组，不碰会话状态。
      const attempt: Card[] = [...handFromKeys(selected), card];
      const verdict =
        turn.action.type === 'bury'
          ? judgeBury(snapshot.state, deal.learnerSeat, target, attempt)
          : judgePlay(snapshot.state, deal.learnerSeat, target, attempt);
      rejection = verdict ?? { kind: 'off-guide', reason: `教程带你打：${target.map(cardText).join(' ')}` };
      return;
    }
    selected = [...selected, key];
    rejection = null;
  }

  function confirmPlay(): void {
    const turn = myTurn;
    if (turn === null || turn.action.type !== 'play') return;
    const out = submitPlay(snapshot, deal, handFromKeys(selected));
    if (!out.ok) {
      rejection = out.rejection;
      return;
    }
    selected = [];
    rejection = null;
    snapshot = holdIfWon(out.snapshot, out.events.trickWon);
  }

  function confirmBury(): void {
    const turn = myTurn;
    if (turn === null || turn.action.type !== 'bury') return;
    const out = submitBury(snapshot, deal, handFromKeys(selected));
    if (!out.ok) {
      rejection = out.rejection;
      return;
    }
    selected = [];
    rejection = null;
    snapshot = out.snapshot;
  }

  function pickBid(call: Parameters<typeof submitBid>[2]): void {
    const out = submitBid(snapshot, deal, call);
    if (!out.ok) {
      rejection = out.rejection;
      return;
    }
    rejection = null;
    snapshot = out.snapshot;
  }

  const needsBury = $derived(myTurn?.action.type === 'bury');
  const needsBid = $derived(myTurn?.action.type === 'bid');
  const selectionReady = $derived(
    targetKeys.length > 0 && selected.length === targetKeys.length && sameCards(handFromKeys(selected), targetCards)
  );
</script>

<div class="space-y-2" data-guide-board>
  <!-- 顶行：两张对手卡（牌面不给看，只报张数；定约未定时说「叫牌中」，不冒称闲家） -->
  <div class="grid grid-cols-2 gap-2">
    {#each [0, 1, 2].filter((seat) => seat !== deal.learnerSeat) as seat (seat)}
      <div class="rounded-xl bg-black/30 px-2.5 py-1.5" data-guide-seat={seat}>
        <p class="flex items-baseline justify-between gap-2 text-[11px]">
          <b class="truncate text-ivory">{nameOf(seat)}</b>
          <span class="shrink-0 text-white/45">
            {declarerSeat === null
              ? '叫牌中'
              : seat === declarerSeat
                ? '庄家'
                : '闲家'} · 剩 {dealState?.hands[seat]?.length ?? 0} 张
          </span>
        </p>
      </div>
    {/each}
  </div>

  <!-- 出牌区：三家各一个点，谁出的牌就摆在谁那一格里 -->
  <div class="rounded-xl bg-black/25 p-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-[10px] text-white/45">
        {#if dealState?.phase === 'auction'}
          叫牌 · 第 {deal.facts.dealNo} 副 · {dealState.auction.length} 手已叫
        {:else if trump !== null}
          {trumpText(trump)} · {dealState?.phase === 'bury' ? '埋底中' : '出牌中'} · 第 {(dealState?.trickHistory.length ?? 0) + 1} 轮
        {:else}
          —
        {/if}
      </p>
      {#if (heldTrick ?? lastWon) !== null && declarerSeat !== null}
        <span
          class="rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold"
          data-trick-badge
        >
          {heldTrick !== null ? '这一轮' : '上一轮'} {nameOf((heldTrick ?? lastWon)!.winnerSeat)} 赢 ·
          {trickSideBadge(declarerSeat, (heldTrick ?? lastWon)!.winnerSeat, (heldTrick ?? lastWon)!.points)}
        </span>
      {/if}
    </div>
    <div class="mt-1.5 grid grid-cols-3 gap-1.5">
      {#if heldTrick !== null}
        <!-- 收墩停留：整墩原地摆住，谁出的还在谁那格 -->
        {#each [0, 1, 2] as seat (seat)}
          {@const play = heldTrick.plays.find((item) => item.seat === seat)}
          <div class="min-w-0">
            {#if play !== undefined}
              <TrickCluster cards={play.cards} {trump} caption={nameOf(seat)} />
            {:else}
              <div class="min-h-[3.5rem]"></div>
            {/if}
          </div>
        {/each}
      {:else}
        {#each [0, 1, 2] as slot (slot)}
          {@const seat = seatOfCluster(slot)}
          {@const play = played[slot]}
          <div class="min-w-0">
            {#if play !== undefined}
              <TrickCluster cards={play.cards} {trump} caption={nameOf(play.seat)} />
            {:else}
              <div class="min-h-[3.5rem]"></div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
    <!-- 上一轮的小行：停留期间不渲染（同墩不双显），停留结束后接手回看 -->
    {#if lastWon !== null && heldTrick === null}
      <div class="mt-1.5 flex flex-wrap items-end gap-2">
        {#each lastWon.plays as play (play.seat)}
          <TrickCluster cards={play.cards} {trump} caption={`上轮 · ${nameOf(play.seat)}`} />
        {/each}
      </div>
    {/if}
  </div>

  {#if needsBid || dealState?.phase === 'auction'}
    <GuideBidBoard
      highest={dealState === null || dealState === undefined ? null : highestBid(dealState.auction)}
      target={coachAction !== null && coachAction.type === 'bid' ? coachAction.call : 'pass'}
      onpick={pickBid}
    />
    <!-- 叫牌历史：与真桌同一份三列表格（列 = 三家、行 = 一轮、最高叫品标金） -->
    <div class="rounded-xl bg-black/25 p-2.5">
      <AuctionHistory deal={dealState} mySeat={deal.learnerSeat} names={[...deal.aliases]} />
    </div>
  {/if}

  {#if waiting}
    <div class="flex items-center justify-between gap-2 rounded-xl bg-black/25 px-2.5 py-1.5 text-[11px] text-white/50">
      <span class="min-w-0 flex-1 truncate" data-waiting-note={waitingNote !== null}>
        {waitingNote ?? '等对手出手⋯'}
      </span>
      <button
        type="button"
        class="shrink-0 rounded-md px-2 py-0.5 ring-1 ring-white/15 hover:bg-white/10"
        onclick={skip}
      >
        跳过等待
      </button>
    </div>
  {/if}

  <!-- 自己的手牌：过程只见自己这一手；引导目标点金色虚线 -->
  <div class="rounded-xl bg-black/25 px-2 py-3">
    <HandFan
      {hand}
      {trump}
      {candidateRanks}
      {selected}
      hinted={targetKeys}
      marked={needsBury ? kittyTaken.map(cardKey) : []}
      selectable={myTurn !== null && myTurn.action.type !== 'bid'}
      onToggle={toggle}
    />
    {#if needsBury}
      <p class="mt-2 text-center text-[11px] text-white/50">
        拿上来的底牌已用蓝框标出；埋回去的 3 张按教练栏点选（金色虚线 = 引导目标）
      </p>
    {/if}
  </div>

  {#if rejection !== null}
    <p
      class={[
        'rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed ring-1',
        rejection.kind === 'illegal'
          ? 'bg-rose-500/10 text-rose-200 ring-rose-400/30'
          : 'bg-amber-400/10 text-amber-100 ring-amber-300/30'
      ]}
      data-guide-rejection={rejection.kind}
      role="status"
    >
      {#if rejection.kind === 'illegal'}
        <b>不能这么出：</b>
      {:else}
        <b>这手能出，但教程带你打另一手：</b>
      {/if}
      {rejection.reason}
    </p>
  {/if}

  <!-- 动作托盘：与真桌同一条「计数在左、动作在中、清空在右」 -->
  {#if myTurn !== null && (myTurn.action.type === 'play' || myTurn.action.type === 'bury')}
    <div class="flex flex-nowrap items-center justify-center gap-2" data-guide-tray>
      <span class="shrink-0 whitespace-nowrap text-[11px] text-white/50">
        已选 {selected.length}{needsBury ? ' / 3' : ` / ${targetKeys.length}`}
      </span>
      <button
        type="button"
        class="shrink-0 whitespace-nowrap rounded-lg bg-gold/20 px-3 py-1 text-[11px] font-semibold text-gold ring-1 ring-gold/40 disabled:opacity-40"
        disabled={!selectionReady}
        onclick={needsBury ? confirmBury : confirmPlay}
      >
        {needsBury ? '确认埋底' : '出 牌'}
      </button>
      <button
        type="button"
        class="shrink-0 whitespace-nowrap rounded-lg border border-white/20 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10 disabled:opacity-40"
        disabled={selected.length === 0}
        onclick={() => {
          selected = [];
          rejection = null;
        }}
      >
        清空
      </button>
    </div>
  {/if}

  {#if coachWord !== null || waitingNote !== null}
    <CoachBar
      word={coachWord?.text ?? '跟上这一手。'}
      why={coachWord?.why ?? null}
      target={coachAction === null ? null : describeTarget(coachAction)}
      {waiting}
    />
  {/if}

  <!-- 叫牌目标是「不叫」这类没有牌面可点的动作，托盘里给一枚明确的确认 -->
  {#if needsBid && coachAction !== null && coachAction.type === 'bid'}
    <p class="text-center text-[11px] text-white/50">
      教练带你叫 <b class="text-gold">{callText(coachAction.call)}</b>
      {#if coachAction.call === 'pass'}（点在叫牌盘右上那颗「不叫」）{/if}
    </p>
  {/if}

  <!-- 底部元信息：只说「这一副怎么打 + 打到哪 + 账面」。引导目标由教练栏与金虚线自己说，不在这里抄第三份 -->
  <p class="text-center text-[10px] text-white/35" data-guide-meta>
    {deal.role === 'declarer' ? '你坐庄' : '你当闲家'}
    {#if trump !== null}· {trumpText(trump)}{/if}
    {#if dealState?.phase === 'auction'}
      · 叫牌中 · 第 {dealState.auction.length} 手
    {:else if dealState !== null}
      · 第 {dealState.trickHistory.length + 1} 轮
      {#if declarerSeat !== null}· 庄已抓 {declarerPts} 分{/if}
    {/if}
  </p>
</div>
