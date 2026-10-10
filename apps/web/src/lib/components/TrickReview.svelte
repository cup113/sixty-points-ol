<script lang="ts">
  import type { TableClient } from '$lib/client/table.svelte';
  import { SPECTATOR_LABEL_SEAT } from '$lib/role';
  import { lastCompletedTrick, trickSideBadge, whoLabel } from '$lib/labels';
  import TrickCluster from './TrickCluster.svelte';

  /**
   * 「上一轮」回看浮层：最近收掉的那一墩，三家各出了什么。
   *
   * 为什么需要它：机器人出手只有 0.5–1.5 秒，收墩后**赢家立刻领出**下一轮，而毡面出牌区
   * 「有当前墩就只显示当前墩」—— 上一墩的三家出牌一眨眼就没了。毡面那块地方是给**正在打**
   * 的这一墩的，所以回看得另开一层：入口是信息须上那枚「上一轮」（`InfoRail`，排在
   * 整条**最左**、取代了原来的「第 N 轮」chip，理由写在那里），内容是 `deal.trickHistory` 的末项
   * （整份负载里本来就有，观战者也拿得到）。
   *
   * 五条已定判据（改动前先读这里）：
   * 1. **只覆盖毡面**（`absolute inset-0`，不是 `fixed`）：手牌始终可见、可继续选牌 ——
   *    这也是它没有做成右侧抽屉一页的原因（手机端抽屉是整屏，看回看时手牌就没了）。
   * 2. **根节点让开点击**（`pointer-events-none`）：横跨毡面的层若吃掉点击，座位卡上的
   *    「+ 机器人」/「请离」就会看得见点不到（`LobbyPanel` 记过这个坑）；可点的只有
   *    **背景按钮**与**面板**自己，各自 `pointer-events-auto`。
   * 3. **`z-20` 低于 `ActionTray` 的 `z-30`**：该你出手时托盘悬在操作条上方、会压到毡面下缘，
   *    它必须仍然点得到 —— 所以浮层在毡面内**垂直居中**且四周留 `p-3`，不伸到那条托盘带。
   * 4. **这一墩的牌面不许有第二份实现**：一律走 `TrickCluster`（毡面与 /rules 共用的那一个）。
   * 5. **默认关着**：`open` 初值由页面给（false），SSR 首帧里没有这一层。
   *    三条关闭路径：背景按钮 / × / Esc。
   */
  let {
    client,
    open = false,
    onClose
  }: { client: TableClient; open?: boolean; onClose?: () => void } = $props();

  const deal = $derived(client.view?.deal ?? null);
  const trump = $derived(deal?.trump ?? null);
  /** 最近收掉的那一墩；还没有收过墩（含换副、全 pass 重发）时为 null —— 那时整层不渲染 */
  const trick = $derived(lastCompletedTrick(deal));
  /** 这一墩的轮次号：末项的下标 + 1。与状态条 `第 N 轮` 同一套口径（当前轮 = 已收墩数 + 1） */
  const ordinal = $derived(deal?.trickHistory.length ?? 0);
  const declarerSeat = $derived(deal?.declarerSeat ?? null);
  /** 观战者没有座位：所有座位都显示玩家名（与 ActionBar / DealSummary 同一套） */
  const mySeat = $derived(client.you?.seat ?? SPECTATOR_LABEL_SEAT);
  const names = $derived((client.table?.seats ?? []).map((seat) => seat.name));

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) onClose?.();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open && trick !== null}
  <!-- 半径与 .felt 一致 + overflow-hidden：背景那层黑纱跟着毡面的圆角走，不会在四角出方边 -->
  <div
    class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden rounded-[1.75rem] p-3 sm:rounded-[2.5rem]"
    data-trick-review="true"
  >
    <!-- 背景即关闭键。用 button 而不是 div：非交互元素挂 onclick 会触发 svelte 的 a11y 警告，
         而本项目 check 是 --fail-on-warnings（同 TableDrawer 的「桌面端点抽屉外关闭」）。 -->
    <button
      type="button"
      tabindex="-1"
      aria-label="关闭回看"
      class="pointer-events-auto absolute inset-0 cursor-default bg-black/55"
      onclick={() => onClose?.()}
    ></button>

    <div
      class="pointer-events-auto relative max-h-[70%] w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl bg-felt-800/95 p-3 ring-1 ring-gold/30 shadow-xl backdrop-blur"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <!-- 写轮次号而不是只写「上一轮」：状态条上的「第 N 轮」说的是**当前**轮，
             回看时要说清看的是哪一轮，否则两边都叫「第 N 轮」反而对不上。 -->
        <h2 class="text-sm font-bold text-ivory">上一轮 · 第 {ordinal} 轮</h2>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 text-lg leading-none text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="关闭"
          onclick={() => onClose?.()}>×</button
        >
      </div>

      <!-- 按**出牌顺序**竖排（`trick.plays` 本来就是从领出者起排的）：手机毡面放不下三簇并排，
           而每行牌堆上方就写着是谁出的，顺序与名字一起把「谁跟了谁的牌」说清楚。 -->
      <div class="flex flex-col gap-2">
        {#each trick.plays as play (play.seat)}
          <TrickCluster
            cards={play.cards}
            {trump}
            caption={whoLabel(names, mySeat, play.seat)}
            badge={play.seat === trick.winnerSeat
              ? trickSideBadge(declarerSeat, play.seat, trick.points)
              : null}
          />
        {/each}
      </div>
    </div>
  </div>
{/if}
