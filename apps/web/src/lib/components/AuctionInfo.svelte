<script lang="ts">
  import type { PublicView } from '@sixty/engine';
  import { SPECTATOR_LABEL_SEAT } from '$lib/role';
  import { BID_GLYPH, highestCall, isRedStrain, strainGlyph, trumpText, whoLabel } from '$lib/labels';

  /**
   * 叫牌信息面：**一行**装完「叫牌 · 第 N 副 · 最高叫品 · 轮次 chip」，成交后另起一行写定约。
   *
   * 为什么压成一行（ADR-0020）：早先是「标题行 + 大字行」两行（合计 58px），而面板的可用高度
   * 由内容槽给出、固定块每省一档就多一行叫牌历史。压成一行后仍保留全部四样信息，
   * 最高叫品仍是 `text-3xl` 的**大号金字**（它是这一屏最该被一眼看到的东西）。
   *
   * 与 `AuctionHistory`（三列表格）分开，是为了让毡面面板把**候选档位插在两者之间**：
   * 历史表排在候选档位之后才是安全的（见 `BidPanel.svelte`）。抽屉里由 `AuctionRecord`
   * 把两块拼回去，视觉基本不变（只是标题行由它自己给）。
   *
   * 这里**不写「某某 发牌」**：发牌人只在规则里讲「谁先叫」时才重要，而轮次 chip
   * 已经把「谁在叫」说清楚了 ——「发牌」这个词本身对新手并不透明。
   */
  let {
    view,
    mySeat = SPECTATOR_LABEL_SEAT,
    names = [],
    heading = true
  }: {
    view: PublicView;
    /** 文案里的「我的座位」：观战者传 -1，于是都显示玩家名 */
    mySeat?: number;
    names?: readonly (string | null)[];
    /** 抽屉里已有页签标题时不重复写一遍「叫牌」 */
    heading?: boolean;
  } = $props();

  const deal = $derived(view.deal);
  /** 顶部大字显示的是**最高叫品**（将要成为定约的那个）；「不叫」只进历史 */
  const top = $derived(highestCall(view));
  const inAuction = $derived(deal !== null && deal.phase === 'auction');
  const myTurn = $derived(inAuction && deal?.auctionTurn === mySeat);
</script>

<div class="flex items-center gap-2">
  {#if heading}
    <h2 class="shrink-0 text-sm font-bold">叫牌</h2>
  {/if}
  <span class="shrink-0 text-[11px] text-white/45">第 {deal?.dealNo ?? 1} 副</span>

  <!-- 最高叫品：**大号金字**，它是这一屏最该被一眼看到的数 -->
  <span class="ml-1 min-w-0">
    {#if top === null}
      <span class="text-xl font-black tracking-wide text-white/35">还没人叫</span>
    {:else}
      <span class="text-3xl font-black leading-none tracking-wide tabular-nums text-gold">
        {top.points}<span class={isRedStrain(top.strain) ? 'text-rose-300' : ''}>{BID_GLYPH[top.strain]}</span>
      </span>
    {/if}
  </span>

  {#if deal !== null && inAuction}
    <span
      class={[
        'ml-auto shrink-0 rounded-md px-2 py-1 text-[11px]',
        myTurn ? 'bg-gold/25 ring-1 ring-gold/40' : 'bg-white/10 text-white/55'
      ]}
    >
      {myTurn ? '轮到你' : `${whoLabel(names, mySeat, deal.auctionTurn)} 叫牌中`}
    </span>
  {/if}
</div>

<!-- 成交后：定约与将牌在打牌/结算阶段才是要查的东西（叫牌阶段它们还不存在） -->
{#if deal !== null && deal.contract !== null}
  <p class="mt-1.5 text-[11px] text-white/55">
    定约 <b class="tabular-nums text-gold">{deal.contract.points}{strainGlyph(deal.contract.strain)}</b>
    · 庄家 {whoLabel(names, mySeat, deal.contract.declarerSeat)}
    {#if deal.trump !== null}
      · {trumpText(deal.trump)}
    {/if}
  </p>
{/if}
