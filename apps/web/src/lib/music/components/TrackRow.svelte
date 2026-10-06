<script lang="ts">
  import Glyph from './Glyph.svelte';
  import { durationText, trackBadge } from '../format.ts';
  import type { Track } from '../types.ts';

  /**
   * 一行曲目：搜索结果、队列、我的喜欢、最近播放、日推都复用这一行。
   *
   * 「能不能播」在这里就说清楚（`trackBadge`：无播放权限 / VIP / 试听），
   * 而不是等点了才报错 —— 无版权的歌点了会自动跳过，没有标注的话看起来像播放器坏了。
   */
  interface Props {
    track: Track;
    /** 是不是正在放的那一首 */
    current?: boolean;
    /** 这一首本次已经试过并失败（无版权），行内标注 */
    failed?: boolean;
    likeable?: boolean;
    liked?: boolean;
    onPlay: () => void;
    onLike?: () => void;
    /** 队列页才给：从队列里删掉 */
    onRemove?: () => void;
    /** 队列页的序号 */
    index?: number;
  }

  let {
    track,
    current = false,
    failed = false,
    likeable = false,
    liked = false,
    onPlay,
    onLike,
    onRemove,
    index
  }: Props = $props();

  const badge = $derived(trackBadge(track));
  const meta = $derived([track.artists, track.album].filter((text) => text !== '').join(' · '));
</script>

<li
  class={`group flex items-center gap-2 rounded-lg px-1.5 py-1.5 ${current ? 'bg-gold/10' : 'hover:bg-white/5'}`}
  data-music-track={track.id}
  data-current={current}
>
  {#if index !== undefined}
    <span class="w-4 shrink-0 text-right text-[11px] tabular-nums text-white/35">{index + 1}</span>
  {/if}

  <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={onPlay} title={`播放 ${track.name}`}>
    <span class="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-white/10 ring-1 ring-white/10">
      {#if track.cover !== null}
        <img src={track.cover} alt="" class="h-full w-full object-cover" loading="lazy" />
      {/if}
      {#if current}
        <span class="absolute inset-0 flex items-center justify-center bg-black/45 text-gold">
          <Glyph name="volume" size={14} />
        </span>
      {/if}
    </span>
    <span class="min-w-0 flex-1">
      <span class={`block truncate text-[13px] ${current ? 'text-gold' : 'text-white/90'}`}>{track.name}</span>
      <span class="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
        <span class="truncate">{meta}</span>
        {#if badge !== null && (track.unplayable || track.vipOnly || track.trialOnly)}
          <span
            class={`shrink-0 rounded px-1 py-px text-[10px] ring-1 ${
              badge === '无播放权限'
                ? 'bg-red-400/15 text-red-200 ring-red-400/30'
                : badge === '试听'
                  ? 'bg-amber-400/15 text-amber-200 ring-amber-400/30'
                  : 'bg-gold/15 text-gold ring-gold/30'
            }`}
          >
            {badge}
          </span>
        {/if}
        {#if failed}
          <span class="shrink-0 text-[10px] text-red-300">播不了</span>
        {/if}
      </span>
    </span>
    <span class="shrink-0 text-[11px] tabular-nums text-white/35">{durationText(track)}</span>
  </button>

  {#if likeable}
    <button
      type="button"
      class={`shrink-0 rounded p-1 ${liked ? 'text-gold' : 'text-white/35 hover:text-white'}`}
      aria-label={liked ? `取消喜欢 ${track.name}` : `喜欢 ${track.name}`}
      title={liked ? '取消喜欢' : '喜欢'}
      onclick={() => onLike?.()}
    >
      <Glyph name="like" size={15} />
    </button>
  {/if}

  {#if onRemove !== undefined}
    <button
      type="button"
      class="shrink-0 rounded p-1 text-white/35 hover:text-red-300"
      aria-label={`从队列移除 ${track.name}`}
      title="从队列移除"
      onclick={onRemove}
    >
      <Glyph name="close" size={14} />
    </button>
  {/if}
</li>
