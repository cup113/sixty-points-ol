<script lang="ts">
  import { cardKey, type Card, type Rank, type TrumpModel } from '@sixty/engine';
  import { computeFanLayout } from '$lib/fan-layout';
  import CardView from './Card.svelte';

  let {
    hand,
    trump = null,
    /** 叫牌阶段的主牌预示（三家级别点数）；缺省 null = 不预示（打牌、教程等一律不传） */
    candidateRanks = null,
    selected = [],
    /** 需要标蓝描边的牌（埋底阶段 = 拿上来的底牌）；空数组即无标记 */
    marked = [],
    /** 需要标金虚线描边的牌（引导局 = 教练点名要出的那几张） */
    hinted = [],
    selectable = false,
    onToggle
  }: {
    hand: readonly Card[];
    trump?: TrumpModel | null;
    candidateRanks?: readonly Rank[] | null;
    selected?: readonly string[];
    marked?: readonly string[];
    hinted?: readonly string[];
    selectable?: boolean;
    onToggle?: (card: Card) => void;
  } = $props();

  let containerWidth = $state(0);
  let cardWidth = $state(0);
  let fanEl = $state<HTMLDivElement | null>(null);

  const count = $derived(hand.length);

  // 牌宽随断点变化（桌面 68 / 窄屏 50），实测比猜断点可靠
  $effect(() => {
    void count;
    void containerWidth;
    const first = fanEl?.querySelector<HTMLElement>('.card');
    cardWidth = first ? first.getBoundingClientRect().width : 0;
  });

  const layout = $derived(computeFanLayout({ count, cardWidth, containerWidth }));

  /** 多行时按 perRow 切片；单行时就是一个整行 */
  const rows = $derived.by(() => {
    if (layout.rows <= 1) return [hand as readonly Card[]];
    const out: Card[][] = [];
    for (let i = 0; i < hand.length; i += layout.perRow) {
      out.push(hand.slice(i, i + layout.perRow) as Card[]);
    }
    return out;
  });

  // 未测量时不写内联变量，样式交给 app.css 的默认回退值
  const measured = $derived(layout.override && cardWidth > 0);
</script>

<!-- 只画手牌：阶段说明一律走左下角的「?」弹层，这里不再有信息行 -->
<div class="fan-rows" bind:clientWidth={containerWidth} bind:this={fanEl}>
  {#each rows as row, rowIndex (rowIndex)}
    <div
      class={['fan', selectable && 'selectable']}
      data-measured={measured}
      style={measured ? `--step:${layout.step}px` : null}
    >
      {#each row as card (cardKey(card))}
        <CardView
          {card}
          {trump}
          {candidateRanks}
          size="lg"
          selected={selected.includes(cardKey(card))}
          marked={marked.includes(cardKey(card))}
          hinted={hinted.includes(cardKey(card))}
          onclick={selectable ? () => onToggle?.(card) : undefined}
        />
      {/each}
    </div>
  {/each}
</div>
