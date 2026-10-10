<script lang="ts">
  import { cardKey, type Card, type TrumpModel } from '@sixty/engine';
  import CardView from './Card.svelte';

  let {
    cards,
    trump = null
  }: {
    /** 亮出来的那 3 张（`summary.kitty`：结算时对所有人公开的**埋下的底牌**） */
    cards: readonly Card[];
    trump?: TrumpModel | null;
  } = $props();
</script>

<!-- 一副结束时的第二拍：**亮底牌**（ADR-0022）。

     为什么底牌要当众摊开：末墩赢家决定**底牌倍数**、底牌本身决定**保底还是抠底** ——
     这两句话都要在结算弹窗里逐字读，但玩家得先**看见**这两件东西才读得进去。而收墩那一刻
     弹窗就来了，底牌于是只活在弹窗的算式里（那里它只有 26px）。

     **两层，两个钩子**：外层 `data-kitty-layer` 是 `absolute inset-0` 的定位壳（它当然覆盖整格，
     所以不能拿它当「亮出来的那一块」去量 —— 第一版就是那么挂的，`shot` 当场量出「底牌块
     1137×600px 压住三个出牌点」）；内层 `data-kitty-reveal` 才是那块可见的牌匾（标签 + 3 张牌），
     几何判据量它、也比它。

     整块 `pointer-events-none`：这一拍里没有一个可点的东西（「跳过」在操作条那一行）。
     牌宽取 46px（比结算算式里的 26px 大、比出牌堆的 56px 略小，见 `app.css` 的 `.kitty-reveal`）：
     26px 的角标要凑近才读得出，而 56px 在 320px 上会把这一行撑得比两翼还宽。 -->
<div
  data-kitty-layer="true"
  class="pointer-events-none absolute inset-0 grid place-items-center"
>
  <div data-kitty-reveal="true" class="kitty-reveal drop-in">
    <p class="mb-1 text-center text-[11px] font-bold tracking-[.2em] text-gold/85">底牌</p>
    <div class="flex justify-center">
      {#each cards as card (cardKey(card))}
        <CardView {card} {trump} size="sm" />
      {/each}
    </div>
  </div>
</div>
