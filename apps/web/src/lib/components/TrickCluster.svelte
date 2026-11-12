<script lang="ts">
  import { cardKey, type Card, type TrumpModel } from '@sixty/engine';
  import { computeClusterStep } from '$lib/fan-layout';
  import CardView from './Card.svelte';

  let {
    cards,
    trump = null,
    caption = null,
    badge = null,
    leading = false,
    trailing = false
  }: {
    cards: readonly Card[];
    trump?: TrumpModel | null;
    /** 牌堆上方的小字（真实牌局里是出牌人） */
    caption?: string | null;
    /** 牌堆下方的金色徽标（如「庄 +20 分」：这墩分归哪一方） */
    badge?: string | null;
    /** 这一簇**现在最大**（两家出完之后才有意义）：名字转金 —— 牌面一点不动 */
    leading?: boolean;
    /** 这一簇已经被压过去了：整簇淡一档，好让眼睛直接找到现在最大的那一簇 */
    trailing?: boolean;
  } = $props();

  /**
   * 宽度预算 = **这一个出牌点的盒子宽度**（`TrickArea` 给每点一个固定宽度，ADR-0020）。
   *
   * 量的是自己的**根节点**，不是牌堆：根节点是块级元素，宽度 = 出牌点那个盒子的宽度，
   * 与内容无关 —— 而牌堆自己一旦被内容撑宽，量它就等于「量了结果」，永远量不出「放不下」。
   * 走 `bind:clientWidth`（与 `HandFan` 同一条纪律）而不是一次性的 `getBoundingClientRect()`：
   * 后者在旋转屏幕 / 改变窗口后**不会重算**，牌堆会一直用着旧宽度的步距。
   */
  let budget = $state(0);
  let cardWidth = $state(0);
  let rootEl = $state<HTMLDivElement | null>(null);

  // 牌宽随断点变化（桌面 56 / 窄屏 38），实测比猜断点可靠
  $effect(() => {
    void cards.length;
    void budget;
    const first = rootEl?.querySelector<HTMLElement>('.card') ?? null;
    cardWidth = first === null ? 0 : first.getBoundingClientRect().width;
  });

  const step = $derived(computeClusterStep({ count: cards.length, cardWidth, budget }));
  /**
   * 未测量（SSR / 首帧）或只有一张时不写内联值：没有「相邻间距」可言，
   * 交给 `.cluster` 自己的回退间距（与 `HandFan` 同一条纪律）。
   */
  const measured = $derived(cards.length > 1 && cardWidth > 0 && budget > 0);
</script>

<!-- 一家的出牌堆：桌面与 /rules 教程共用，别在教程里重画一份。
     `--step` 是相邻两张牌左边缘的间距 → 负边距 = step - 牌宽（与手牌扇面同一套算法）。
     放不下时由 `computeClusterStep` 一路收到放得下，所以两簇不会相撞（见 TrickArea）。

     **现在最大**（`leading` / `trailing`，见 CONTEXT.md）：两家出完之后，最大的那一簇名字转金，
     其余几簇整簇淡一档（0.6）—— 只是帮眼睛找，不新加徽标、不改牌面的尺寸与位置。
     淡的那一层落在**根节点**上，不落在 `.cluster` 上：那个盒子带着 `drop-in` 入场动画，
     而动画的 `both` 填充会一直把 `opacity` 钉在 1，普通规则压不过它（实测量到 opacity 仍是 1）。 -->
<div
  bind:this={rootEl}
  bind:clientWidth={budget}
  class="trick-cluster"
  data-trailing={trailing}
  data-leading={leading}
>
  {#if caption}
    <p class="mb-1 text-center text-[10px] {leading ? 'text-gold/80' : 'text-white/45'}">{caption}</p>
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
