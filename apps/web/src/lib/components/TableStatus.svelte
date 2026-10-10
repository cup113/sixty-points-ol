<script lang="ts">
  import type { PublicView } from '@sixty/engine';
  import { isRedStrain, strainGlyph } from '$lib/labels';

  let {
    view,
    onReviewTrick
  }: {
    view: PublicView;
    /** 「上一轮」回看入口：传入才渲染（内容见 `TrickReview`；不传时这一条仍是纯信息条） */
    onReviewTrick?: () => void;
  } = $props();

  const deal = $derived(view.deal);
  const contract = $derived(deal?.contract ?? null);
  /** 收过墩才有「上一轮」可回看（还没打过牌、或换副重发的当口都没有） */
  const canReview = $derived(onReviewTrick !== undefined && (deal?.trickHistory.length ?? 0) > 0);
  const declarerPoints = $derived(
    contract === null ? 0 : (deal?.captured[contract.declarerSeat]?.points ?? 0)
  );

  /**
   * 定约与「庄已抓」是本副最该被一眼看到的两个数（打牌时决定进退，埋底/结算时是背景），
   * 所以它们是**大号金色数字**，不是和小字同级的 chip。
   */
  const stat = 'flex items-baseline gap-1.5 rounded-xl bg-black/45 px-3 py-1 ring-1';
  const num = 'text-xl font-black leading-none tabular-nums text-gold sm:text-2xl';
  const label = 'text-[11px] text-white/60';
</script>

<!-- 普通文档流（**不再自己绝对定位**）：由牌桌页把它和埋底面板放进同一个列容器，
     于是短屏上「定约」等信息不会压到埋底槽位上（手机端曾经两处各定各的位置而重叠）。
     不再单列「级牌 X」（庄家座位卡上的级别数字就是它），也不再写「庄已抓 X / 需 Y」
     ——分母就是旁边那个定约分，重复一次只会让状态条更长。
     纯信息条（除了回看入口没有一个可点元素）⇒ 也让它让开点击：它与座位卡同处一层，
     窄桌面上会盖住座位卡上的动作按钮（「+ 机器人」/「请离」）。
     唯一的例外是「上一轮」那枚回看入口：它自己 pointer-events-auto 把点击接回来，
     整条的 pointer-events-none 照旧 —— 少了那一句，按钮会看得见点不到（BuryPanel 记过这个坑）。

     `data-status-row` 是测量钩子：这一条是 `flex-wrap` 的，折行与否只能实测
     （`scripts/shot-auction.ts` 的 ⑬ 看子元素的竖直中线）。

     顺序：**「上一轮」在最左**，它取代了原来的「第 N 轮」chip。
     为什么轮次号可以直接删：「第 N 轮」在这里没有信息量 —— 打到第几轮由毡面上那墩牌自己说明，
     而唯一需要说清轮次的地方是**回看浮层**（标题写着「上一轮 · 第 N 轮」，见 TrickReview），
     那里说的才是「你看的是哪一轮」。删掉它同时给这一条腾出约 60px：三项最坏情形
     （定约与庄已抓都两位数、名字最长）实测约 262px < 375px 上的可用宽度 ~335px，
     折行风险随之消失；判据在 test/table-chrome.test.ts 的 trickReviewCheck（入口必须是首项）
     与 shot 的 ⑬（不折行）。px-1.5 让这枚按钮比其他 chip 窄一档。 -->
<div
  data-status-row="true"
  class="pointer-events-none flex flex-wrap items-center justify-center gap-x-2 gap-y-1"
>
  {#if canReview}
    <!-- bot 出手只有 0.5–1.5 秒，收墩后赢家立刻领出下一轮 —— 入口就在这一条状态条上，
         浮层见 TrickReview。 -->
    <button
      type="button"
      class="pointer-events-auto whitespace-nowrap rounded-full border border-gold/40 px-1.5 py-0.5 text-[11px] font-bold text-gold hover:bg-gold/10"
      onclick={() => onReviewTrick?.()}>上一轮</button
    >
  {/if}
  {#if contract}
    <span class={`${stat} ring-gold/25`}>
      <b class={num}>
        {contract.points}<span class={isRedStrain(contract.strain) ? 'text-rose-300' : ''}>{strainGlyph(
          contract.strain
        )}</span>
      </b>
      <span class={label}>定约</span>
    </span>
    <span class={`${stat} ring-white/10`}>
      <span class={label}>庄已抓</span>
      <b class={num}>{declarerPoints}</b>
      <span class={label}>分</span>
    </span>
  {/if}
</div>
