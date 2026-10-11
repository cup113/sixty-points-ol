<script lang="ts">
  import { cardClass, isJoker, type Card, type Rank, type TrumpModel } from '@sixty/engine';
  import { cardFace } from '$lib/card-face';

  let {
    card,
    trump = null,
    /**
     * 叫牌阶段的主牌预示：三家当前的级别点数（谁的级别都可能成为本副级牌点数）。
     * 非 null 时——王按主牌上色（它恒是主牌），点数命中的牌按「可能成为级牌」上更浅一档金。
     * 定约成交后改由 `trump` 说话（`cardClass`），这个预示自动退场。
     */
    candidateRanks = null,
    size = 'md',
    selected = false,
    muted = false,
    /** 蓝描边标记：埋底阶段用来指出「这几张是拿上来的底牌」 */
    marked = false,
    /** 金色虚线描边：引导局里「教练点名要出的这几张」（与选中的金条、底牌的蓝框都不同形） */
    hinted = false,
    onclick
  }: {
    card: Card;
    trump?: TrumpModel | null;
    candidateRanks?: readonly Rank[] | null;
    size?: 'sm' | 'md' | 'lg';
    selected?: boolean;
    muted?: boolean;
    marked?: boolean;
    hinted?: boolean;
    onclick?: () => void;
  } = $props();

  const face = $derived(cardFace(card));
  /** 主牌：定约后问 `cardClass`；叫牌阶段只有王是确定的（王恒为主牌，与将牌花色无关） */
  const isTrump = $derived(
    trump !== null ? cardClass(card, trump) === 'T' : candidateRanks !== null && isJoker(card)
  );
  /**
   * 叫牌阶段的「可能成为级牌」：本副级牌点数取自庄家的级别，而庄家还没定，
   * 所以三家级别里任一命中点数的牌都标出来（王不在其列，它走上面的主牌色）。
   */
  const isRankHint = $derived(
    trump === null && candidateRanks !== null && !isJoker(card) && candidateRanks.includes(card.rank)
  );
</script>

<!-- 除了主牌浅金底与级牌候选淡金底，牌上没有第二个装饰性标记：角落只有点数 + 花色
     （王则是「大/小」+「王」），正中只有那一门的字形（王则是「大王」/「小王」）。分牌靠点数自己认。 -->
<button
  type="button"
  class={[
    'card',
    size === 'sm' && 'card-sm',
    size === 'lg' && 'card-lg',
    face.red && 'red',
    isTrump && 'trump',
    isRankHint && 'rank-hint',
    muted && 'muted'
  ]}
  data-selected={selected}
  data-marked={marked}
  data-hinted={hinted}
  disabled={onclick === undefined}
  aria-label={face.aria}
  onclick={() => onclick?.()}
>
  <span class="idx">
    <span>{face.rank}</span>
    <i>{face.glyph}</i>
  </span>
  <span class="pip" class:joker={face.joker}>{face.pip}</span>
  <span class="idx br">
    <span>{face.rank}</span>
    <i>{face.glyph}</i>
  </span>
</button>
