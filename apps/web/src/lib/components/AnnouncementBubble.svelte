<script lang="ts">
  import type { SeatAnnouncement } from '$lib/shared';
  import { awayRemainingText, emoteGlyph, emoteLabel } from '$lib/social';

  /**
   * 座位卡**下方**那**一条**桌边消息的气泡（ADR-0028）。
   *
   * 三种消息共用它：表情、短句、暂离。它是 `absolute` 的，所以座位卡的高度、行距、
   * 名字与等级徽标的位置**都不因为它改变**；它挂在卡的下沿（不是压在卡上），
   * 会盖住一点下面的牌面 —— 而点一下它自己就消失（本地 dismissal，不写服务端：
   * 谁点掉的只对谁生效）。
   *
   * `remainingMs` 是服务端在**这一帧**算出的剩余时间；这里只负责本地倒数，
   * 到 0 就隐藏，不向服务端要一次「到点了」的请求（与 `ActionClock` 同一条纪律）。
   */
  let {
    announcement,
    side = 'left'
  }: {
    announcement: SeatAnnouncement;
    /** left / right = 两张对手卡（气泡挂在卡下方、各朝外）；bar = 「我」那条底栏（气泡在栏上方） */
    side?: 'left' | 'right' | 'bar';
  } = $props();

  let dismissedId = $state<number | null>(null);
  let anchorAt = $state(0);
  let tick = $state(0);

  $effect(() => {
    // 每一帧都重新锚定：帧之间的走时由本地钟负责，真相仍来自服务端
    if (announcement !== null) anchorAt = Date.now();
  });

  const live = $derived(announcement.remainingMs > 0);
  $effect(() => {
    if (!live) return;
    const id = setInterval(() => (tick += 1), 1000);
    return () => clearInterval(id);
  });

  const remaining = $derived.by(() => {
    void tick;
    if (anchorAt === 0) return announcement.remainingMs;
    return Math.max(0, announcement.remainingMs - (Date.now() - anchorAt));
  });

  const visible = $derived(announcement.id !== dismissedId && remaining > 0);
  const awayText = $derived(announcement.kind === 'away' ? awayRemainingText(remaining) : null);
  const glyph = $derived(announcement.kind === 'emote' ? emoteGlyph(announcement.body) : '');
  const content = $derived(
    announcement.kind === 'emote'
      ? emoteLabel(announcement.body)
      : announcement.kind === 'away'
        ? `暂离，${awayText ?? ''}`
        : (announcement.body ?? '')
  );

  const position = $derived(
    side === 'bar'
      ? 'bottom-[calc(100%+6px)] left-7'
      : side === 'right'
        ? 'top-full right-2 mt-1'
        : 'top-full left-2 mt-1'
  );
  const tail = $derived(
    side === 'bar'
      ? '-bottom-1 left-3'
      : side === 'right'
        ? '-top-1 right-3'
        : '-top-1 left-3'
  );
</script>

{#if visible}
  <button
    type="button"
    class={['bubble absolute z-30 block max-w-[11rem] rounded-xl bg-ivory text-left text-ink shadow-lg ring-1 ring-black/25', position, announcement.kind === 'emote' ? 'px-2 py-1' : 'px-2.5 py-1.5']}
    data-announcement={announcement.kind}
    title="点一下收起"
    aria-label={`${content}，点一下收起`}
    onclick={(event) => {
      event.stopPropagation();
      dismissedId = announcement.id;
    }}
  >
    <span class={['absolute h-2 w-2 rotate-45 rounded-[1px] bg-ivory', tail]} aria-hidden="true"></span>
    {#if announcement.kind === 'emote'}
      <span class="block text-center text-lg leading-none" aria-hidden="true">{glyph}</span>
    {:else if announcement.kind === 'away'}
      <span class="block text-[11px] font-bold leading-tight text-amber-700">暂离</span>
      <span class="block whitespace-nowrap text-[10px] leading-tight text-ink/60">{awayText}</span>
    {:else}
      <span class="line-clamp-3 block break-words text-[12px] leading-snug">{announcement.body}</span>
    {/if}
  </button>
{/if}

<style>
  .bubble {
    animation: bubble-in 160ms ease-out;
  }

  @keyframes bubble-in {
    from {
      opacity: 0;
      transform: translateY(3px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bubble {
      animation: none;
    }
  }
</style>
