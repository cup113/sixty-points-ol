<script lang="ts">
  import { cardKey, type Card, type TrumpModel } from '@sixty/engine';
  import CardView from './Card.svelte';

  let {
    verdict,
    cards,
    lastTrick,
    trump = null
  }: {
    /** 一句话判决：`你亮牌 · 剩下的都归你` / `某某 亮牌 · 剩下的都归他` */
    verdict: string;
    /** 认赢者亮出来的整手牌（`summary.claim.revealed` 的同一份） */
    cards: readonly Card[];
    /** 末轮张数（底牌倍数），引擎算的 */
    lastTrick: number;
    trump?: TrumpModel | null;
  } = $props();
</script>

<!-- 认赢的第一拍（ADR-0028）：**亮牌 + 一句判决**，然后才轮到亮底牌与结算弹窗。

     为什么需要这一拍：认赢把「剩下的牌」一口气收走，输家那一侧什么都看不见 ——
     弹窗里只有一行「认赢 · 剩余全收」。而这一副到底怎么结束的，答案就在**这手牌**里：
     他每一门都是剩下的最大几张、主牌全在他手上，所以谁也没有一墩可拿。摊开来，
     那句话才是可核的；不摊开，它只是一句宣布。

     与 `KittyReveal` 同一条形状：外层 `absolute inset-0` 只是定位壳（它覆盖整格，
     不能拿它量），内层 `data-claim-reveal` 才是那块牌匾；整块 `pointer-events-none`，
     这一拍里没有一个可点的东西（「跳过」在操作条那一行）。

     动效：牌匾 `drop-in`，17 张牌再各自错开 28ms 落下 —— 顺序读下来就是「一手牌摊开」，
     而不是「一堆牌砰地出现」。系统要求减少动态效果时两处都归零（见 app.css）。 -->
<div data-claim-reveal-layer="true" class="pointer-events-none absolute inset-0 grid place-items-center">
  <div data-claim-reveal="true" class="claim-reveal drop-in">
    <p class="mb-1 text-center text-[11px] font-bold tracking-[.18em] text-gold/85">{verdict}</p>
    <div class="claim-cards">
      {#each cards as card, index (cardKey(card))}
        <span class="claim-card" style="animation-delay: {Math.min(index, 17) * 28}ms">
          <CardView {card} {trump} size="sm" />
        </span>
      {/each}
    </div>
    <p class="mt-1 text-center text-[11px] tabular-nums text-white/50">
      末轮 {lastTrick} 张 · 底牌按 {lastTrick} 倍算
    </p>
  </div>
</div>
