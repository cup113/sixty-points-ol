<script lang="ts">
  /**
   * 「加入牌桌」的弹窗：只做一件事 —— 收一个邀请码（或整条邀请链接），交给大厅去入座。
   *
   * 为什么是弹窗而不是内联的输入框：牌桌入口只剩**两枚按钮**（新建 / 加入），
   * 大厅里不该常驻一个「你大概用不上」的输入框；而它一旦内联，就得配一个 tab 去选它，
   * 于是选中态与主操作各上一次金色（同一屏两处强调色，正是这次要收掉的东西）。
   *
   * 形状与 `LeaveConfirm` / `NewGameConfirm` 一致（`fixed inset-0` + 遮罩 + 22rem 卡片）。
   * 输入边打边归一化：粘贴整条链接时立刻变成 6 位邀请码（`parseInvite`），认不出来就把
   * 原因说在输入框下面 —— 但只在**动过之后**说，刚打开时不说。
   */
  import { parseInvite } from '$lib/invite';

  let {
    open = false,
    /** 打开时预填的内容（从邀请链接被带过来时就是那个邀请码） */
    initial = '',
    busy = false,
    error = null,
    onJoin,
    onClose
  }: {
    open?: boolean;
    initial?: string;
    busy?: boolean;
    error?: string | null;
    onJoin?: (code: string) => void;
    onClose?: () => void;
  } = $props();

  let value = $state('');
  let touched = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  // 每次打开都回到传进来的那一个（并抢焦点：这个弹窗是点了按钮才出来的）
  $effect(() => {
    if (!open) return;
    value = initial;
    touched = false;
    inputEl?.focus();
  });

  const code = $derived(parseInvite(value));
  /** 「认不出来」这件事只在用户动过输入之后才说 —— 空框不是错误 */
  const invalid = $derived(touched && value.trim().length > 0 && code === null);

  const input =
    'w-full min-w-0 rounded-lg bg-black/40 px-3 py-2 font-mono text-sm uppercase tracking-[.18em] outline-none ring-1 ring-white/15 transition focus:ring-gold';
  const primary =
    'rounded-lg bg-gold px-4 py-1.5 text-sm font-bold text-ink transition hover:brightness-110 active:scale-95 disabled:opacity-40';
  const ghost = 'rounded-lg px-4 py-1.5 text-sm text-white/80 ring-1 ring-white/20 transition hover:bg-white/10';
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    data-join-table-dialog="true"
    role="dialog"
    aria-modal="true"
    aria-label="加入牌桌"
  >
    <div class="w-[22rem] max-w-[94vw] rounded-2xl bg-felt-800 p-4 ring-1 ring-gold/30 sm:p-5">
      <h2 class="text-sm font-bold">加入牌桌</h2>

      <form
        class="mt-3"
        onsubmit={(event) => {
          event.preventDefault();
          if (code !== null) onJoin?.(code);
        }}
      >
        <input
          bind:this={inputEl}
          class={input}
          placeholder="邀请码或邀请链接"
          value={value}
          oninput={(event) => {
            touched = true;
            const raw = event.currentTarget.value;
            // 整条链接 → 6 位码；认不出来就原样留着，让用户看到自己贴了什么
            value = parseInvite(raw) ?? raw;
          }}
        />

        {#if invalid}
          <p class="mt-2 text-[11px] text-amber-200">没识别出邀请码 —— 6 位码或整条邀请链接都可以。</p>
        {/if}
        {#if error !== null}
          <p class="mt-2 rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200">{error}</p>
        {/if}

        <div class="mt-3 flex justify-end gap-2">
          <button type="button" class={ghost} disabled={busy} onclick={() => onClose?.()}>取消</button>
          <button type="submit" class={primary} disabled={busy || code === null}>
            {busy ? '加入中…' : '加入'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
