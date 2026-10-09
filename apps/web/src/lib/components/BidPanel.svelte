<script lang="ts">
  import type { TableClient } from '$lib/client/table.svelte';
  import { SPECTATOR_LABEL_SEAT } from '$lib/role';
  import { BID_GLYPH, bidTiers, isRedStrain, type BidLayout } from '$lib/labels';
  import AuctionHistory from './AuctionHistory.svelte';
  import AuctionInfo from './AuctionInfo.svelte';

  let { client }: { client: TableClient } = $props();

  const view = $derived(client.view);
  const deal = $derived(view?.deal ?? null);
  /** 观战者没有座位（-1）：myTurn 恒为 false，于是只看到叫牌板、没有叫品按钮 */
  const mySeat = $derived(client.you?.seat ?? SPECTATOR_LABEL_SEAT);
  const names = $derived((client.table?.seats ?? []).map((seat) => seat.name));
  const myTurn = $derived(deal !== null && deal.phase === 'auction' && deal.auctionTurn === mySeat);
  /**
   * 档位基准是引擎负载里的**最高叫品**（`deal.highestBid`，由 `highestNonPass` 从叫牌史算出）。
   * 这里读的是**一个字段**，不是自己遍历叫牌史 —— 面板不许变成第二份叫牌记录面
   * （记录面是 `AuctionInfo` / `AuctionHistory`，见 test/table-chrome.test.ts）。
   */
  const top = $derived(deal?.highestBid ?? null);
  /**
   * 展开状态的复位判据：记住「为哪一副、哪个最高叫品展开过」。
   * 最高叫品一变（别人抬价）或进入新一副，基准键就跟着变，`expanded` 自动落回 false ——
   * 不需要 `$effect` 或 `{#key}` 重建，也不会把上一轮的展开带进下一轮。
   */
  const baseKey = $derived(`${deal?.dealNo ?? 0}:${top?.points ?? 0}:${top?.strain ?? ''}`);
  let expandedFor = $state<string | null>(null);
  const expanded = $derived(expandedFor === baseKey);
  /**
   * 档位与触发形态全在 `labels.ts` 的 `bidTiers` 里算（纯函数，四场景表与反证在 labels.test.ts）：
   * 固定五槽（不可叫的花色留隐形占位、**不补位**）、默认只摆非跳叫档 + 触发钮、展开后共五档。
   * 面板自己不判断「哪些花色合法」—— 那个判断有两份实现就迟早会不一致。
   */
  const emptyLayout: BidLayout = { tiers: [], trigger: 'none' };
  const layout = $derived(view === null ? emptyLayout : bidTiers(view, expanded));
</script>

<!-- 面板是 flex 列，里面**只有叫牌历史那一块**会滚（min-h-0 + flex-1 = 先被压缩、
     自己滚），「不叫」排在它后面、走正常文档流。于是页脚既不压住内容，也不会被裁掉。
     两代坏形状都被 `panel-guard.ts` 钉住了：
     1. 早先面板是 flex 列 + overflow-hidden，「不叫」排在最后 —— 内容超过 max-h 时它被
        从底部裁掉，且不在任何滚动区里，滚也滚不回来。
     2. 上一版改成「面板自己滚 + 不叫 sticky 贴底」：按钮点得到，但它是**浮**在内容上的，
        滚动时压住排在最后的历史行（手机上那半行叫牌记录就是这么被切掉的）——sticky 页脚
        的语义就是遮挡，换个顺序只是换谁被挡，所以这一版把它整个去掉。
     面板自己仍留 overflow-y-auto 兜底：万一固定块（信息面 + 候选档位 + 页脚）本身就超过
     可用高度（很矮的视口），整个面板可滚，按钮滚一下就到 —— 这是可滚，不是被裁。
     判据落在 `src/lib/panel-guard.ts`（`test/bid-panel.test.ts` 与 ui-check 共用同一份）。

     **几何（ADR-0020）**：面板不再自己写 `top-[22%] max-h-[56%]`，而是**吃满毡面的内容槽**
     （`absolute inset-0`，由牌桌页的三行格给出上下界）。早先那两个百分数各算各的偏移，
     手机 674px 高度上它只有 278px 可用、还要与上下两张座位卡争地；而它的固定块本身就要约
     272px（内边距 + 信息面 + 两档候选 + 表头 + 「不叫」），于是历史只剩个位数像素 ——
     截图里那条「只能显示一行」的历史、以及面板自带的整条滚动条，都是这个余量不足的表现。
     现在：内容槽给多少就是多少，固定块也按下面的三处收紧了。 -->
<section
  data-bid-panel="true"
  class="absolute inset-0 flex flex-col overflow-y-auto overscroll-contain rounded-2xl bg-black/55 p-3 ring-1 ring-white/10 backdrop-blur-sm sm:mx-auto sm:w-[22rem] sm:p-4"
>
  {#if view !== null}
    <div class="shrink-0">
      <AuctionInfo {view} {mySeat} {names} />
    </div>

    {#if myTurn}
      <!-- 候选区：**花色恒定位**（♣ ♦ ♥ ♠ NT 五槽，不可叫的花色是隐形占位、绝不让后面往前补位），
           默认只摆非跳叫档，其余收在「▶ 跳叫」触发钮后面（展开后共 BID_TIER_LIMIT 档）。
           形状由 labels.ts 的 bidTiers 给出，这里不自己判断 —— 四场景判据见 test/labels.test.ts。
           shrink-0：抬高叫品时整块往下长，被压缩的是历史区。
           **档位行恒为「数字 + 五格」，触发器另起一行**：触发器挤进行内会让那一行更宽，
           而槽位（w-9，`shrink-0` 只是第二道防线）会被 flex 压窄 —— 实测两行的 NT 右缘相差
           18.3px（360px 视口）。独立成行之后对齐是结构保证（见 labels.ts 的 BidTrigger）。 -->
      <div data-bid-trigger={layout.trigger} class="mt-2 shrink-0 space-y-1.5">
        {#each layout.tiers as tier (tier.points)}
          <!-- `data-bid-row` 是**测量钩子**：叫牌面板里唯一能被「量出来」的缺陷是
               「同一列在不同档之间没对齐」。源码守卫看不见几何，所以这一列的位置由
               `scripts/shot-auction.ts` 的实测断言钉住（见那里的 assertLayout）。 -->
          <div data-bid-row={tier.points} class="flex items-center gap-1.5">
            <span class="w-7 shrink-0 text-right text-xs tabular-nums text-white/55">{tier.points}</span>
            {#each tier.slots as slot (slot.strain)}
              {#if slot.legal}
                <button
                  type="button"
                  data-bid-slot="legal"
                  class={['bidbtn w-9 shrink-0 rounded-lg bg-white/10 py-1.5 text-center text-[13px] hover:bg-white/20',
                    isRedStrain(slot.strain) && 'text-rose-300']}
                  disabled={client.busy}
                  onclick={() => void client.bid({ points: tier.points, strain: slot.strain })}
                >
                  {BID_GLYPH[slot.strain]}
                </button>
              {:else}
                <!-- 不可叫的花色：**同尺寸隐形占位**（visibility:hidden —— 不占命中区、读屏也跳过）。
                     绝不让后面的槽往前补位：补位之后同一个横向位置在不同档之间换了花色，手快就是误触。
                     `shrink-0` 与可叫槽同宽，所以两行的第 5 格永远是同一条竖线。 -->
                <span
                  data-bid-slot="invisible"
                  aria-hidden="true"
                  class="invisible w-9 shrink-0 py-1.5 text-center text-[13px]"
                >{BID_GLYPH[slot.strain]}</span>
              {/if}
            {/each}
          </div>
        {/each}
        {#if layout.trigger === 'line'}
          <!-- 触发钮**独立成行**（右对齐细钮）：档位行因此恒为「数字 + 五格」，
               两行必然同宽、槽位必然同列。它挨着档位区（可发现），但不参与档位行的宽度竞争。 -->
          <div class="flex justify-end">
            <button
              type="button"
              data-bid-jump="line"
              class="bidbtn shrink-0 rounded-lg border border-white/25 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-40"
              disabled={client.busy}
              onclick={() => (expandedFor = baseKey)}
            >▶ 跳叫</button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- 面板里唯一自己滚的一块：高度由上面的固定块决定，历史多了就在这里滚，
         绝不会淌到页脚底下（页脚不在这个滚动区里）。 -->
    <div data-bid-history="true" class="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <AuctionHistory {view} {mySeat} {names} />
    </div>
  {/if}

  {#if myTurn}
    <button
      type="button"
      class="mt-2 flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/5 px-4 py-2 text-sm font-bold text-ivory transition hover:bg-white/10 disabled:opacity-40"
      disabled={client.busy}
      onclick={() => void client.bid('pass')}
    >
      不叫
    </button>
  {/if}
</section>
