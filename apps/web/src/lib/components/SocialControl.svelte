<script lang="ts">
  import type { TableClient } from '$lib/client/table.svelte';
  import { AWAY_MINUTES, EMOTES, MAX_MESSAGE_LENGTH, type AwayMinutes, type EmoteKey } from '$lib/social';

  /**
   * 「我」底栏右端那枚笑脸：桌边消息的唯一入口（ADR-0028）。
   *
   * 面板里三件事挤在一个 264px 的弹层里：8 个固定表情、一句最多 24 字的短话、
   * 以及一枚「暂离」按钮 —— 点它才展开 6 档时长，默认不占地方。
   *
   * 三个刻意的边界：
   * - **不是聊天面板**：没有历史、没有未读、没有第二个页签；发出去只换座位卡旁那一条气泡；
   * - **不抢焦**：弹层 `absolute`，开合不改变毡面任何一行的位置；
   * - **失败留在原地**：限速 / 长度这类错误显示在面板底部，而不是把人赶去页头找那行红字。
   */
  let { client }: { client: TableClient } = $props();

  let open = $state(false);
  let mode = $state<'main' | 'away'>('main');
  let text = $state('');
  let localError = $state<string | null>(null);

  const busy = $derived(client.busy);
  const canSend = $derived(!busy && text.trim().length > 0);

  function toggle(): void {
    open = !open;
    if (open) {
      mode = 'main';
      localError = null;
    }
  }

  function fail(problem: string | null): void {
    localError = problem ?? '没发出去，再试一下';
  }

  async function sendEmote(key: EmoteKey): Promise<void> {
    if (busy) return;
    localError = null;
    const problem = await client.emote(key);
    if (problem === null) open = false;
    else fail(problem);
  }

  async function sendText(): Promise<void> {
    if (!canSend) return;
    localError = null;
    const problem = await client.say(text);
    if (problem === null) {
      text = '';
      open = false;
    } else {
      fail(problem);
    }
  }

  async function sendAway(minutes: AwayMinutes): Promise<void> {
    if (busy) return;
    localError = null;
    const problem = await client.away(minutes);
    if (problem === null) open = false;
    else fail(problem);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') open = false;
  }

  /** 点面板外才收起：面板、表情钮与触发器都在 `[data-social-root]` 里 */
  function onWindowClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-social-root]') !== null) return;
    open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<div class="relative" data-social-root="true">
  <button
    type="button"
    class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black/25 text-white/70 ring-1 ring-white/15 transition hover:bg-white/10 hover:text-white"
    data-social="true"
    title="桌边消息"
    aria-label="桌边消息"
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={toggle}
  >
    <!-- 内联 SVG 而不是 emoji：与机器人头像同一条理由 —— 各平台字体不同，彩色 emoji 在 24px 的圆里对不齐 -->
    <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.6" />
      <circle cx="9.1" cy="10.1" r="1.15" fill="currentColor" />
      <circle cx="14.9" cy="10.1" r="1.15" fill="currentColor" />
      <path
        d="M8.2 14.2c1 1.25 2.3 1.85 3.8 1.85s2.8-.6 3.8-1.85"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  </button>

  {#if open}
    <div
      class="absolute bottom-full right-0 z-40 mb-2 w-[16.5rem] max-w-[calc(100vw-2rem)] rounded-xl bg-felt-950/95 p-2.5 text-left shadow-2xl ring-1 ring-white/15 backdrop-blur"
      role="dialog"
      aria-label="桌边消息"
    >
      {#if mode === 'main'}
        <div class="grid grid-cols-4 gap-1">
          {#each EMOTES as emote (emote.key)}
            <button
              type="button"
              class="grid h-9 place-items-center rounded-lg bg-white/10 text-lg leading-none transition hover:bg-white/15 disabled:opacity-40"
              data-emote={emote.key}
              title={emote.label}
              aria-label={emote.label}
              disabled={busy}
              onclick={() => void sendEmote(emote.key)}
            >
              {emote.glyph}
            </button>
          {/each}
        </div>

        <form
          class="mt-1.5 flex items-center gap-1.5"
          onsubmit={(event) => {
            event.preventDefault();
            void sendText();
          }}
        >
          <!-- 16px 是 iOS 的免缩放线：小于它，聚焦输入框时 Safari 会把整页放大、顶动 100dvh 的牌桌 -->
          <input
            class="min-w-0 flex-1 rounded-lg bg-black/50 px-2 py-1.5 text-[16px] leading-none text-ivory outline-none ring-1 ring-white/15 transition placeholder:text-white/30 focus:ring-gold"
            type="text"
            placeholder="说一句…"
            aria-label="桌边消息内容"
            maxlength={MAX_MESSAGE_LENGTH}
            bind:value={text}
          />
          <button
            type="submit"
            class="grid h-[30px] w-8 shrink-0 place-items-center rounded-lg bg-gold text-sm font-bold text-ink transition enabled:hover:brightness-110 disabled:opacity-30"
            aria-label="发送"
            disabled={!canSend}
          >
            →
          </button>
        </form>

        <button
          type="button"
          class="mt-1.5 flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] text-white/55 transition hover:bg-white/10 hover:text-white/80"
          onclick={() => (mode = 'away')}
        >
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" aria-hidden="true">
            <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path d="M12 7.4v5.1l3.2 1.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
          暂离
          <span class="ml-auto text-white/30" aria-hidden="true">›</span>
        </button>
      {:else}
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="grid h-6 w-6 place-items-center rounded-md text-sm text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="返回"
            onclick={() => (mode = 'main')}
          >
            ←
          </button>
          <span class="text-[11px] font-semibold text-white/70">暂离多久</span>
        </div>
        <div class="mt-1.5 grid grid-cols-3 gap-1">
          {#each AWAY_MINUTES as minutes (minutes)}
            <button
              type="button"
              class="rounded-lg bg-white/10 px-1 py-2 text-[11px] tabular-nums text-white/75 transition hover:bg-gold/20 hover:text-gold disabled:opacity-40"
              disabled={busy}
              onclick={() => void sendAway(minutes)}
            >
              {minutes} 分
            </button>
          {/each}
        </div>
      {/if}

      {#if localError}
        <p class="mt-1.5 text-[10px] leading-snug text-rose-300" role="alert">{localError}</p>
      {/if}
    </div>
  {/if}
</div>
