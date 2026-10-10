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
   *
   * 它出现的那一刻，操作条上那句状态**一定**是 null（`ActionBar` 的 `status` 在
   * 「叫牌轮到我 / 我埋底 / 我出牌」三种情况下都返回 null）—— 所以这一格是**换内容**，
   * 不是叠内容：问号右边要么是别人在动的状态句，要么是这一套动作控件，不会同时出现两样。
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

<!-- 动作托盘 = 「轮到你了」的那一套控件，**在操作条那一行里**（问号右边那一格，ADR-0020 修订）。
     为什么从「毡面与操作条之间那条 44px 常驻带」搬回这一行：
     ① 带子的理由是「轮到我 / 轮空之间零回流」，而这一行本来就 `min-h-[2.6rem]`（41.6px），
        托盘的三个控件都在这条线以内 —— 于是零回流由**行高**保证，不必再占 44px 的空白；
        那 44px 还给牌区（320px 短屏上正是出牌点竖向差 2px 就相撞的那点余量）。
     ② 它不再浮着：**在流内**（不再 `absolute`），所以不可能压住毡面最后一行或「我」那条底栏
        —— 截图 #4 那类重叠在结构上不成立（判据：托盘矩形必须落在这一行里、且与毡面零相交）。
     ③ **单行不换行**（`flex-nowrap`）：早先是 `flex-wrap`，窄屏上「清空」与红字各自挤出一行，
        托盘被撑到近 180px 高，正好盖住手牌上半截。
     ④ **`w-max`** 是宽度修理，不是排版偏好：居中 + 宽度 auto 时，shrink-to-fit 的可用宽度会
        退化成内容的一半，flex 子项被压缩，而 CJK 可以在任意字间断行 ——「出 牌」「清 空」
        于是竖排成两行（计数自带 `whitespace-nowrap` 所以它断不了：截图里「已选 0 张」安然无恙、
        两个按钮都竖着，正是这条的证据）。宽度取 max-content 后没有负空间可分配；
        按钮自己再带 `whitespace-nowrap` 作第二道防线。**不加** `max-w-*` —— 一旦被上限钳住
        就退回「压缩 ⇒ 换行」。 -->
{#if visible}
  <div
    class="relative flex w-max flex-nowrap items-center gap-2 rounded-2xl bg-black/55 px-2.5 py-1 ring-1 ring-white/10 backdrop-blur-sm"
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

    <!-- 不合法的选牌原因：**绝对定位浮在托盘之上**，不进这一行的流 ——
         `playError` 是实时推导的（选到不合法的一组就立刻出现），若让它占一行，这一行的高度就会
         随选择来回变，窄屏上正好把手牌压掉。长句自己折行、向上长（那里是毡面的下缘，
         与它今天的行为一致：它本来就是浮在毡面最后一行上的一条提示，几秒就消失）。 -->
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
