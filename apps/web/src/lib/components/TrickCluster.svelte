<script lang="ts">
  import { cardKey, type Card, type TrumpModel } from '@sixty/engine';
  import { computeClusterStep } from '$lib/fan-layout';
  import CardView from './Card.svelte';

  let {
    cards,
    trump = null,
    caption = null,
    badge = null
  }: {
    cards: readonly Card[];
    trump?: TrumpModel | null;
    /** 牌堆上方的小字（真实牌局里是出牌人） */
    caption?: string | null;
    /** 牌堆下方的金色徽标（如「庄 +20 分」：这墩分归哪一方） */
    badge?: string | null;
  } = $props();

  /**
   * 宽度预算 = **这一个出牌点的盒子宽度**（`TrickArea` 给每点一个固定宽度，ADR-0020）。
   * 量的是外面那一层（`data-trick-spot` 的父节点就是我），不是牌堆自己 —— 牌堆自己一旦被
   * 内容撑宽，量它自己就等于「量了结果」，永远量不出「放不下」。
   */
  let budget = $state(0);
  let cardWidth = $state(0);
  let rootEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    void cards.length;
    void budget;
    const host = rootEl?.parentElement ?? null;
    budget = host === null ? 0 : host.getBoundingClientRect().width;
    const first = rootEl?.querySelector<HTMLElement>('.card') ?? null;
    cardWidth = first === null ? 0 : first.getBoundingClientRect().width;
  });

  const step = $derived(computeClusterStep({ count: cards.length, cardWidth, budget }));
  /**
   * 未测量（SSR / 首帧）或只有一张时不写内联值：没有「相邻间距」可言，
   * 交给 `.cluster` 自己的默认 gap（与 `HandFan` 同一条纪律）。
   */
  const measured = $derived(cards.length > 1 && cardWidth > 0 && budget > 0);
</script>

<!-- 一家的出牌堆：桌面与 /rules 教程共用，别在教程里重画一份。
     `--step` 是相邻两张牌左边缘的间距 → 负边距 = step - 牌宽（与手牌扇面同一套算法）。
     放不下时由 `computeClusterStep` 一路收到放得下，所以两簇不会相撞（见 TrickArea）。 -->
<div bind:this={rootEl}>
  {#if caption}
    <p class="mb-1 text-center text-[10px] text-white/45">{caption}</p>
  {/if}
  <div
    class="cluster drop-in"
    data-measured={measured}
    style={measured ? `--step:${step}px` : null}
  >
    {#each cards as card (cardKey(card))}
      <CardView {card} {trump} size="sm" />
    {/each}
  </div>
  {#if badge}
    <p class="mt-1 text-center">
      <span class="rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-ink shadow">{badge}</span>
    </p>
  {/if}
</div>
