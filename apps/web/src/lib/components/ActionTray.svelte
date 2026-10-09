<script lang="ts">
  import type { TableClient } from '$lib/client/table.svelte';

  let { client }: { client: TableClient } = $props();

  const view = $derived(client.view);
  const deal = $derived(view?.deal ?? null);
  const selectedCount = $derived(client.selected.length);
  const me = $derived(client.you);

  /**
   * 只有「这一手归你动」时才存在：打牌轮到你、或埋底轮到庄家。
   * 观战者两样都不成立（`me` 为 null），不必再写一套分支。
   */
  const visible = $derived(
    deal !== null &&
      me !== null &&
      ((deal.phase === 'play' && deal.playTurn === me.seat) ||
        (deal.phase === 'bury' && me.isDeclarer))
  );

  /**
   * 三个 class 常量都带 `whitespace-nowrap`：窄屏上「出 牌」「清 空」「确认埋底」被压缩时，
   * CJK 可以在任意字间断行，动词会竖排成两行（截图里的那次返工）。
   */
  const gold =
    'whitespace-nowrap rounded-lg bg-gold px-4 py-1.5 text-xs font-bold text-ink transition enabled:hover:brightness-110 disabled:opacity-30';
  const ghost =
    'whitespace-nowrap rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30';
  /**
   * 主操作与旁边同级尺寸（一行的形状由它决定）：早先它是 `px-7 py-2.5 text-base` + 44px 命中高度，
   * 在一行里显得又高又胖，把整条托盘撑得比手牌还抢眼。`disabled:opacity-40`（而不是 30）
   * 让它没选牌时不像一坨灰的禁用态；`.play-btn` 只剩 z-index 与 36px 命中高度（见 app.css）。
   */
  const play =
    'play-btn inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-gold px-5 py-1.5 text-sm font-bold tracking-wide text-ink shadow-[0_4px_14px_-6px_rgba(216,180,90,.7)] transition enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-40';

  /** 计数在左、动作在中、清空在右 —— 两个阶段同一形状，宽度可算（窄屏一行放得下） */
  const count = 'whitespace-nowrap text-xs text-white/70';
</script>

<!-- 动作托盘 = 「轮到你了」的那一套控件，居**中**住在毡面与操作条之间那条常驻动作带里（ADR-0020）。
     ① **在毡面之外**：它原先钉在操作条上沿（`bottom-full`，而那 40px 正好整根落在毡面的最后
        40px 里）—— 手机 375px 上它与自己的座位卡竖直重叠 32px、水平重叠 84px（截图里的 #4）。
        「把座位卡抬高」只是把同一块地方换个方式占掉，所以「毡面最后这条带归谁」必须明确：
        **归托盘**。带子常驻（不分轮到自己还是轮空），所以切换时毡面与手牌零回流。
     ② **单行不换行**（`flex-nowrap`）：早先是 `flex-wrap`，窄屏上「清空」与红字各自挤出一行，
        托盘被撑到近 180px 高，正好盖住手牌上半截。
     ③ **`w-max`** 是宽度修理，不是排版偏好：居中 + 宽度 auto 时，shrink-to-fit 的可用宽度会
        退化成内容的一半，flex 子项被压缩，而 CJK 可以在任意字间断行 ——「出 牌」「清 空」
        于是竖排成两行（计数自带 `whitespace-nowrap` 所以它断不了：截图里「已选 0 张」安然无恙、
        两个按钮都竖着，正是这条的证据）。宽度取 max-content 后没有负空间可分配；
        按钮自己再带 `whitespace-nowrap` 作第二道防线。**不加** `max-w-*` —— 一旦被上限钳住
        就退回「压缩 ⇒ 换行」。
     ④ `z-30`：压过上浮的选中牌与操作条。
     它只出现在该你出手时，所以不会与「?」的弹层抢位置（弹层向上开、在左侧）。 -->
{#if visible}
  <div class="absolute inset-0 z-30 flex items-center justify-center">
    <div
      class="flex w-max flex-nowrap items-center gap-2 rounded-2xl bg-black/55 px-2.5 py-1 ring-1 ring-white/10 backdrop-blur-sm"
      data-action-tray="true"
    >
      {#if deal?.phase === 'bury'}
        <span class={count}>已选 <b class="tabular-nums text-gold">{selectedCount}</b> / 3</span>
        <button
          type="button"
          class={gold}
          disabled={selectedCount !== 3 || client.busy}
          onclick={() => void client.bury()}
        >
          确认埋底
        </button>
      {:else}
        <span class={count}>已选 <b class="tabular-nums text-gold">{selectedCount}</b> 张</span>
        <button
          type="button"
          class={play}
          disabled={selectedCount === 0 || client.playError !== null || client.busy}
          onclick={() => void client.play()}
        >
          出 牌
        </button>
      {/if}
      <button type="button" class={ghost} disabled={selectedCount === 0} onclick={() => client.clearSelection()}>
        清空
      </button>
    </div>

    <!-- 不合法的选牌原因：**绝对定位浮在带子之上**，不进带子的流 ——
         `playError` 是实时推导的（选到不合法的一组就立刻出现），若让它占一行，带子的高度就会
         随选择来回变，窄屏上正好把手牌压掉。长句自己折行、向上长（那里是毡面的下缘）。 -->
    {#if client.playError}
      <span
        class="absolute bottom-full left-1/2 mb-1 w-max max-w-[min(92vw,22rem)] -translate-x-1/2 rounded-lg bg-black/70 px-2 py-1 text-center text-[11px] text-red-300 ring-1 ring-red-400/20"
        data-play-error="true"
      >
        {client.playError}
      </span>
    {/if}
  </div>
{/if}
