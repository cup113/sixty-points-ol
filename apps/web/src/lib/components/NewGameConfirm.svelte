<script lang="ts">
  import type { TableClient } from '$lib/client/table.svelte';

  /**
   * 「开新对局」的二次确认。**必须挂在页面级**，理由与 `LeaveConfirm` 同形但不同源：
   *
   * - 它会**重置三家级别**（回 2(+0)）、清空本场战报与机器重演 —— 不可逆；
   * - 它的入口是终局卡上唯一的主按钮，紧挨着「看看桌面」，误触的代价是整场的账；
   * - 而它不能被挂在终局卡里：那张卡自己有 `max-h-[92dvh] overflow-y-auto`，
   *   `fixed` 在滚动容器里**不覆盖全屏**（抽屉那边是被 `transform` 困住，这里是被滚动区困住）。
   *
   * 与结算三拍那把锁**不是一回事**：那把锁管「全桌节奏」（末墩 2.0s + 底牌 3.2s），
   * 这把管「别把这一场抹掉」。两把锁都满足才点得动那颗按钮。
   */
  let {
    client,
    open = false,
    dealCount = 0,
    onClose
  }: {
    client: TableClient;
    open?: boolean;
    /** 这一场打完了几副 —— 写进正文，让「清掉的是什么」具体 */
    dealCount?: number;
    onClose?: () => void;
  } = $props();

  const ghost = 'rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10';

  async function start(): Promise<void> {
    if (await client.newGame()) onClose?.();
  }
</script>

{#if open}
  <div
    data-new-game-confirm="true"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
  >
    <div class="w-[22rem] max-w-[94vw] rounded-2xl bg-felt-800 p-4 ring-1 ring-gold/30 sm:p-5">
      <h2 class="text-sm font-bold">开新对局？</h2>
      <p class="mt-3 text-xs leading-relaxed text-white/70">
        三家的级别回到 2(+0)，这 {dealCount} 副的战报与机器重演一并清掉。
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class={ghost} onclick={() => onClose?.()}>取消</button>
        <button
          type="button"
          class="rounded-md bg-gold px-4 py-1 text-xs font-bold text-ink transition hover:brightness-110 disabled:opacity-40"
          disabled={client.busy}
          onclick={() => void start()}
        >
          开新对局
        </button>
      </div>
      {#if client.error}
        <p class="mt-2 rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200">{client.error}</p>
      {/if}
    </div>
  </div>
{/if}
