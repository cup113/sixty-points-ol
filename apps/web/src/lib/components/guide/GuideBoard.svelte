<script lang="ts">
  /**
   * 引导局的教学桌面（CONTEXT.md 的 **引导局**、**教练栏**、**座位气泡** 与 **收墩停留**）。
   *
   * 分工：**规则全在 `guide/session.ts`（纯函数）里**，这里只有接线与手感 ——
   * 定时器、选中态、拒绝提示、动画。于是「强制怎么判、下一步该谁动」都被单测盯着，
   * 而这一层改排版不会碰到规则（ADR-0008 的同一条纪律）。
   *
   * 七件事在这里实现：
   * 1. **对手自动出牌**：延迟按动作分档（叫牌/埋底 1.5s、出牌 1.1s）——教程要留出
   *    读叫牌历史表与引导词的时间，反而该比真桌的机器人（0.5–1.5s）慢；随时可「跳过等待」。
   * 2. **收墩停留 + 两行式出牌区**：`events.trickWon` 在这里被消费 —— 一墩收起时三家牌
   *    **原地停 2 秒**配赢家徽标；停留结束不是清场，整墩带着同一个 key 从「这一墩」行
   *    flip 搬进「上一墩」行（缩一档常驻）—— 效仿正式打牌的摆两行，收墩不跳变。
   * 3. **座位气泡**：对手动作的 `notes` 解说挂在**动作者那一席**下面的气泡里 ——
   *    最近 `SAY_WINDOW` 条**并存**（同一席连说两条只留最新，原地换字），一条新气泡
   *    冒出来不许把上一条顶走；文案里的 `**粗体**` 走 `RichText`，星号不上屏。
   * 4. **轮次只有一个真相源**：`actingSeat` = 段内下一条动作的座位。座位卡的轮次环、
   *    叫牌盘的引导金框（经 `active` 门）、等待栏的「X 在想」读的都是它 ——
   *    没轮到你，金框不亮，你不会以为该自己了。
   * 5. **用户座位全量强制**：他点牌只是「选择」，出手一律由 `submit*` 判定 ——
   *    不合法给引擎的理由，合法但非引导牌指回教练栏（两类拒绝，见 `forcing.ts`）。
   * 6. **过程只见自己的手牌**：对手只报张数；复盘屏才全亮三家。手牌过引擎的
   *    `sortHand`（真桌 **个人视图** 同一份序：主牌在前、副牌黑红交替、同门内大到小）。
   * 7. **实时数住进信息须，讲解面贴着手牌**：定约 / 级牌 / 庄已抓 / 轮数在出牌区顶上
   *    摆成大号金字（真桌 **信息须** 的引导局版，不再缩成一行 10px 小字）；教练栏排在
   *    手牌**正上方** —— 它讲的就是底下那几张牌，讲解面不垫底。
   */
  import {
    cardKey,
    declarerTrickPoints,
    highestBid,
    rankLabel,
    sortHand,
    type Card,
    type CompletedTrick,
    type TrickPlay
  } from '@sixty/engine';
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import AuctionHistory from '$lib/components/AuctionHistory.svelte';
  import HandFan from '$lib/components/HandFan.svelte';
  import TrickCluster from '$lib/components/TrickCluster.svelte';
  import { callText, cardText, isRedStrain, strainGlyph, trickSideBadge } from '$lib/labels';
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
  import RichText from './RichText.svelte';

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
  /** 收墩后的停留：三家牌原地摆着 + 赢家徽标，然后才搬进「上一墩」行（「跳过等待」可立即过去） */
  const TRICK_HOLD_MS = 2000;
  /** 系统要求减少动态：flip/fade 是 Svelte 过渡不是纯 CSS，归零要组件自己来（app.css 媒体查询的另一半） */
  const CALM =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** 完成的一墩从「这一墩」行搬进「上一墩」行的时长 */
  const FLIP_MS = CALM ? 0 : 480;
  const FADE_MS = CALM ? 0 : 160;
  /** 气泡巷同时留几条对手解说：新的一条冒出来时前一条还在 —— 别一冒就走 */
  const SAY_WINDOW = 2;

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
  /** 拿上来的底牌（只在埋底阶段给庄家亮，闲家那一章用不到） */
  const kittyTaken = $derived(takenKitty(snapshot));
  const declarerSeat = $derived(dealState?.contract?.declarerSeat ?? null);
  const contract = $derived(dealState?.contract ?? null);
  /** 当前最高叫品：叫牌没结束时它就是要成为定约的那个 —— 信息须「定约」格先摆它 */
  const highest = $derived(dealState === null ? null : highestBid(dealState.auction));
  /** 庄家已抓的分（真桌 **信息须** 同一个来源：引擎 `declarerTrickPoints`） */
  const declarerPts = $derived(dealState === null ? 0 : declarerTrickPoints(dealState));
  /** 还在叫牌阶段时，按三家级别点数预示「哪些牌可能成为本副级牌」 */
  const candidateRanks = $derived(trump === null ? deal.facts.levels.map((level) => level.rank) : null);

  /** 现在该谁动：段内下一条动作的座位（轮到你时它就是 deal.learnerSeat）。座位卡的轮次环、叫牌盘的金框门、等待栏的「X 在想」读的都是这一份 —— 轮次只有一个真相源，金框才不会先亮 */
  const actingSeat = $derived(
    snapshot.phase !== 'playing' || snapshot.index >= range.to
      ? null
      : (deal.actions[snapshot.index]?.seat ?? null)
  );

  /**
   * 最近的对手解说（新在前，最多 `SAY_WINDOW` 条）：各挂各的席位 —— 一条新气泡冒出来时，
   * 前一条**还在**，两条对话同摆桌上才是牌桌。同一席连着说了两条（赢下这墩又领下一墩）
   * 只留最新：那一席的气泡原地换字（`{#key at}` 重弹），不叠两条。
   */
  const says = $derived.by(() => {
    const recent: { seat: number; at: number; text: string }[] = [];
    for (let at = snapshot.index - 1; at >= 0 && recent.length < SAY_WINDOW; at--) {
      const actor = deal.actions[at]?.seat;
      const note = deal.notes?.[String(at)];
      if (note === undefined || actor === undefined || actor === deal.learnerSeat) continue;
      if (recent.length > 0 && recent[0]?.seat === actor) break;
      recent.push({ seat: actor, at, text: note });
    }
    return recent;
  });

  function nameOf(seat: number): string {
    return deal.aliases[seat] ?? `座位 ${seat}`;
  }

  /** 出牌区的一行：key = 墩序（1 起）。同一墩从「这一墩」行搬进「上一墩」行时 key 不变，flip 才接得住这次搬家 */
  interface TrickRow {
    readonly key: number;
    readonly plays: readonly TrickPlay[];
    readonly trick: CompletedTrick | null;
    readonly mini: boolean;
  }

  /** 两行式：第一行永远是「这一墩」（进行中或收墩停留，谁出的牌摆在谁那一列），第二行是「上一墩」缩一档常驻 —— 收墩是**搬下去**，不是清场重来 */
  const trickRows = $derived.by(() => {
    const history = dealState?.trickHistory ?? [];
    const rows: TrickRow[] = [];
    if (heldTrick !== null) {
      rows.push({ key: history.length, plays: heldTrick.plays, trick: heldTrick, mini: false });
      const prev = history.length >= 2 ? (history[history.length - 2] ?? null) : null;
      if (prev !== null) rows.push({ key: history.length - 1, plays: prev.plays, trick: prev, mini: true });
    } else {
      rows.push({ key: history.length + 1, plays: played, trick: null, mini: false });
      const prev = history.length >= 1 ? (history[history.length - 1] ?? null) : null;
      if (prev !== null) rows.push({ key: history.length, plays: prev.plays, trick: prev, mini: true });
    }
    return rows;
  });

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
  <!-- 座位行：三家都在（含「你」），列序与底下出牌区一一对齐 —— 气泡与牌列都以它为锚。
       轮到谁，谁的卡亮金环（牌面照旧不给看，只报张数；定约未定时说「叫牌中」，不冒称闲家） -->
  <div class="grid grid-cols-3 gap-1.5">
    {#each [0, 1, 2] as seat (seat)}
      <div
        class={[
          'rounded-xl px-2 py-1 transition',
          'bg-black/30',
          actingSeat === seat
            ? 'ring-2 ring-gold/80'
            : seat === deal.learnerSeat
              ? 'ring-1 ring-gold/30'
              : 'ring-1 ring-white/10'
        ]}
        data-guide-seat={seat}
        data-turn={actingSeat === seat}
      >
        <p
          class={[
            'truncate text-[11px]',
            seat === deal.learnerSeat ? 'font-semibold text-gold' : 'text-ivory'
          ]}
        >
          {nameOf(seat)}
        </p>
        <p class="truncate text-[10px] text-white/45">
          {declarerSeat === null ? '叫牌中' : seat === declarerSeat ? '庄家' : '闲家'} ·
          {dealState?.hands[seat]?.length ?? 0} 张
        </p>
      </div>
    {/each}
  </div>

  <!-- 解说气泡巷：最近两条对手解说各挂各的席位（新的一条冒出来，前一条还在），同一席
       连说两条时原地换字；巷高按三行解说预留足，冒泡不顶动桌面（再长的 note 由
       line-clamp-3 收进这个高度里）。文案里的 **粗体** 走 RichText -->
  <div class="grid min-h-[3.2rem] grid-cols-3 gap-1.5" data-say-lane aria-live="polite">
    {#each [0, 1, 2] as seat (seat)}
      {@const note = says.find((item) => item.seat === seat) ?? null}
      <div class="relative min-w-0">
        {#if note !== null}
          {#key note.at}
            <div
              class="say pts-pop relative rounded-lg bg-felt-800 px-2 py-1 ring-1 ring-white/15"
              data-say={seat}
              transition:fade={{ duration: FADE_MS }}
            >
              <i
                class="absolute -top-1 left-1/2 -ml-1 size-2 rotate-45 rounded-[2px] bg-felt-800"
                aria-hidden="true"></i>
              <p class="line-clamp-3 text-[10px] leading-snug text-ivory">
                <RichText text={note.text} />
              </p>
            </div>
          {/key}
        {/if}
      </div>
    {/each}
  </div>

  <!-- 出牌区（两行式，效仿正式打牌摆两行）：第一行 = 这一墩（进行中或收墩停留），
       第二行 = 上一墩缩一档。收墩时牌不消失：整墩带着同一个 key 从第一行 flip 搬进第二行，
       再由更老的墩把它顶出去。赢家徽标摆在赢家那一列（与真桌 TrickArea 同一语义：位置即身份） -->
  <div class="rounded-xl bg-black/25 p-2">
    <!-- 桌面信息须：定约 / 级牌 / 庄已抓 / 轮数四个大号金字（真桌 InfoRail 的引导局版）——
         级牌、庄分这些实时数决定进退，不该缩成一行 10px 小字。叫牌没结束时「定约」格
         先摆当前最高叫品（它就是要成为定约的那个），级牌 / 庄分照旧「—」；标签小、值大，
         与真桌那条同一套视觉语言（值一律 text-gold + tabular-nums） -->
    <div class="grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-white/10 text-center" data-guide-rail>
      <div class="bg-black/40 px-1 pb-1.5 pt-1.5" data-guide-rail-cell="contract">
        <p class="text-[10px] leading-none text-white/45">定约</p>
        <b class="mt-1 block truncate text-base font-black leading-none tabular-nums text-gold">
          {#if contract !== null}
            {contract.points}<span class={isRedStrain(contract.strain) ? 'text-rose-300' : ''}>{strainGlyph(contract.strain)}</span>
          {:else if highest !== null}
            {callText(highest)}
          {:else}
            —
          {/if}
        </b>
      </div>
      <div class="bg-black/40 px-1 pb-1.5 pt-1.5" data-guide-rail-cell="level">
        <p class="text-[10px] leading-none text-white/45">级牌</p>
        <b class="mt-1 block truncate text-base font-black leading-none tabular-nums text-gold">
          {trump === null ? '—' : rankLabel(trump.rank)}
        </b>
      </div>
      <div class="bg-black/40 px-1 pb-1.5 pt-1.5" data-guide-rail-cell="points">
        <p class="text-[10px] leading-none text-white/45">庄已抓</p>
        <b class="mt-1 block truncate text-base font-black leading-none tabular-nums text-gold">
          {#if contract === null}—{:else}{declarerPts}<span class="ml-0.5 text-[10px] font-normal text-white/60">分</span>{/if}
        </b>
      </div>
      <div class="bg-black/40 px-1 pb-1.5 pt-1.5" data-guide-rail-cell="round">
        <p class="text-[10px] leading-none text-white/45">轮数</p>
        <b class="mt-1 block truncate text-base font-black leading-none text-gold">
          {#if dealState === null || dealState.phase === 'auction'}
            叫牌
          {:else if dealState.phase === 'bury'}
            埋底
          {:else if dealState.phase === 'scored'}
            结算
          {:else}
            第 {(dealState.trickHistory.length ?? 0) + 1} 轮
          {/if}
        </b>
      </div>
    </div>
    <div class="mt-1.5 flex flex-col gap-1.5">
      {#each trickRows as row (row.key)}
        <div
          class={['grid grid-cols-3 gap-1.5', row.mini ? 'trick-mini opacity-60' : 'trick-live']}
          animate:flip={{ duration: FLIP_MS }}
          transition:fade={{ duration: FADE_MS }}
          data-trick-row={row.mini ? 'prev' : 'live'}
        >
          {#each [0, 1, 2] as seat (seat)}
            {@const play = row.plays.find((item) => item.seat === seat)}
            <div class="min-w-0">
              {#if play !== undefined}
                <TrickCluster
                  cards={play.cards}
                  {trump}
                  badge={
                    row.trick !== null && declarerSeat !== null && row.trick.winnerSeat === seat
                      ? trickSideBadge(declarerSeat, row.trick.winnerSeat, row.trick.points)
                      : null
                  }
                />
              {:else}
                <div class="spot-empty"></div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  {#if needsBid || dealState?.phase === 'auction'}
    <GuideBidBoard
      {highest}
      target={coachAction !== null && coachAction.type === 'bid' ? coachAction.call : 'pass'}
      active={needsBid}
      onpick={pickBid}
    />
    <!-- 叫牌历史：与真桌同一份三列表格（列 = 三家、行 = 一轮、最高叫品标金） -->
    <div class="rounded-xl bg-black/25 p-2.5">
      <AuctionHistory deal={dealState} mySeat={deal.learnerSeat} names={[...deal.aliases]} />
    </div>
  {/if}

  {#if waiting}
    <div class="flex items-center justify-between gap-2 rounded-xl bg-black/25 px-2.5 py-1.5 text-[11px] text-white/50">
      <!-- 解说已经搬进座位气泡，这里只报「谁在想」—— 与座位卡上的轮次环同一份真相 -->
      <span class="min-w-0 flex-1 truncate" data-waiting>
        {actingSeat !== null ? `${nameOf(actingSeat)} 在想⋯` : '等对手出手⋯'}
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

  <!-- 教练栏：手牌正上方 —— 它讲的就是底下那几张牌，建议得贴着牌说；
       引导词给的「接下来那一手」在等待时也摆这里，学员的眼睛不用桌面底端找一圈 -->
  {#if coachWord !== null}
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

  <!-- 自己的手牌：过程只见自己这一手；引导目标点金色虚线 -->
  <div class="rounded-xl bg-black/25 px-2 py-3" data-guide-hand>
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

  <!-- 底部元信息：只说身份与副号 —— 定约 / 级牌 / 庄分 / 轮数这些实时数在信息须，不在这里抄第二份 -->
  <p class="text-center text-[10px] text-white/35" data-guide-meta>
    {deal.role === 'declarer' ? '你坐庄' : '你当闲家'} · 第 {deal.facts.dealNo} 副
  </p>
</div>
