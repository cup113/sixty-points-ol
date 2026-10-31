<script lang="ts">
  import { cardKey } from '@sixty/engine';
  import type { TableClient } from '$lib/client/table.svelte';
  import { SPECTATOR_LABEL_SEAT } from '$lib/role';
  import { whoLabel } from '$lib/labels';
  import CardView from './Card.svelte';

  /**
   * 认赢的现场（ADR-0028）：**待表决**时盖住内容槽的那一块。
   *
   * 它盖住出牌区是有意的：认赢期间牌局冻结、没有任何人该出牌，两名对手要判断的正是
   * 「亮出来的这手牌 + 他报的末轮张数」，而不是已经落地的那一墩。30 秒封顶，所以它不会赖着不走。
   *
   * `client.table.claimMsLeft` 是**服务端算好的剩余毫秒**（与 `actionAgeMs` 同一条口径）：
   * 这里每收到一帧就用它重新锚定本地倒计时，两端的钟差多少都不影响读数。
   */
  let { client }: { client: TableClient } = $props();

  const view = $derived(client.view);
  const deal = $derived(view?.deal ?? null);
  const claim = $derived(deal?.claim ?? null);
  const trump = $derived(deal?.trump ?? null);
  const names = $derived((client.table?.seats ?? []).map((seat) => seat.name));
  const mySeat = $derived(client.you?.seat ?? SPECTATOR_LABEL_SEAT);

  const pending = $derived(claim !== null && claim.status === 'pending');
  const remaining = $derived(
    deal === null ? 0 : deal.handCounts.reduce((sum, n) => sum + n, 0) + (deal.trick?.plays.flatMap((play) => play.cards).length ?? 0)
  );

  /** 我是不是那个还要表态的对手（认赢者自己、观战者、已经投过票的人都不是） */
  const myVote = $derived(mySeat >= 0 ? (claim?.answers[mySeat] ?? null) : null);
  const responder = $derived(claim !== null && mySeat >= 0 && claim.claimant !== mySeat);

  let expiresAt = $state(0);
  $effect(() => {
    const ms = client.table?.claimMsLeft ?? null;
    expiresAt = ms === null ? 0 : Date.now() + ms;
  });
  let now = $state(Date.now());
  $effect(() => {
    if (expiresAt === 0) return;
    const id = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(id);
  });
  const secondsLeft = $derived(expiresAt === 0 ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000)));

  const waiting = $derived.by(() => {
    if (claim === null) return '';
    if (mySeat >= 0 && claim.claimant === mySeat) return '等两名对手表态：都认输就立刻结算，有人不认就继续打。';
    if (myVote === true) return '你已认输 · 等另一位对手。';
    if (myVote === false) return '你已不认：他的牌一直公开到这一副结束。';
    return '等两名对手表态。';
  });

  const gold =
    'whitespace-nowrap rounded-lg bg-gold px-4 py-1.5 text-xs font-bold text-ink transition enabled:hover:brightness-110 disabled:opacity-30';
  const ghost =
    'whitespace-nowrap rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30';
</script>

{#if pending && claim !== null}
  <section
    data-claim-panel="true"
    class="absolute inset-0 z-20 flex flex-col gap-2 rounded-2xl bg-black/75 p-3 ring-1 ring-gold/30 backdrop-blur-sm"
  >
    <header class="flex shrink-0 items-baseline gap-2">
      <p class="min-w-0 flex-1 truncate text-sm font-bold text-gold">
        {whoLabel(names, mySeat, claim.claimant)} 认赢
      </p>
      {#if secondsLeft !== null}
        <span class="shrink-0 text-xs tabular-nums text-white/60" data-claim-left={secondsLeft}>{secondsLeft}s</span>
      {/if}
    </header>
    <p class="shrink-0 text-[11px] text-white/55">
      末轮 <b class="tabular-nums text-ivory">{claim.lastTrick}</b> 张 · 剩
      <b class="tabular-nums text-ivory">{remaining}</b> 张全收
    </p>

    <!-- 亮牌：紧凑码不是给人看的，所以这里按牌面画（`size="sm"`，17 张也就三行）。
         `data-claim-revealed` 是量它用的钩子：17 张在 320px 上必须能滚，而不是被挤成一条缝
         （判据在 shot-auction.ts 的 ⑳）。 -->
    <div data-claim-revealed="true" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div class="flex flex-wrap gap-1">
        {#each claim.revealed as card (cardKey(card))}
          <CardView {card} {trump} size="sm" />
        {/each}
      </div>
    </div>

    {#if responder && myVote === null}
      <div class="flex shrink-0 gap-2">
        <button
          type="button"
          class={gold}
          data-claim-answer="agree"
          disabled={client.busy}
          onclick={() => void client.answerClaim(true)}
        >
          认输
        </button>
        <button
          type="button"
          class={ghost}
          data-claim-answer="doubt"
          disabled={client.busy}
          onclick={() => void client.answerClaim(false)}
        >
          不认
        </button>
      </div>
      <p class="shrink-0 text-[11px] leading-relaxed text-white/40">不认之后他的牌一直公开，直到这一副结束。</p>
    {:else}
      <p class="shrink-0 text-[11px] leading-relaxed text-white/50" data-claim-waiting="true">{waiting}</p>
    {/if}
  </section>
{/if}
