<script lang="ts">
  import Glyph from './Glyph.svelte';
  import { formatTime } from '../format.ts';
  import { highlightLine, lyricKey } from '../playback.ts';
  import type { LyricLine } from '../types.ts';

  /**
   * 歌词页：高亮当前行、点某行跳过去。
   *
   * 滚动交给浏览器（`scrollIntoView({ block: 'center' })`）而不是自己算偏移：
   * 这一层的高度是弹性的，自己算必然在窄屏上差半行。
   */
  interface Props {
    lyrics: readonly LyricLine[];
    loading: boolean;
    positionMs: number;
    onSeek: (ms: number) => void;
  }

  let { lyrics, loading, positionMs, onSeek }: Props = $props();

  const active = $derived(highlightLine(lyrics, positionMs));
  let list = $state<HTMLDivElement | null>(null);

  // 每当前行变化就把它滚到中间。`active` 是派生的，所以这里只在「真的换了行」时才动 DOM。
  $effect(() => {
    const index = active;
    if (index < 0 || list === null) return;
    const node = list.querySelector<HTMLElement>(`[data-line="${index}"]`);
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
</script>

{#if loading}
  <p class="px-3 py-4 text-center text-xs text-white/50">歌词加载中…</p>
{:else if lyrics.length === 0}
  <p class="px-3 py-4 text-center text-xs text-white/50">这首没有歌词（纯音乐或还没上架）</p>
{:else}
  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2" bind:this={list} data-music-lyrics="true">
    <ul class="space-y-2 pb-6">
      {#each lyrics as line, index (lyricKey(line))}
        <li>
          <button
            type="button"
            data-line={index}
            data-active={index === active}
            class={`w-full rounded-md px-2 py-1 text-left text-[13px] leading-snug transition-colors ${
              index === active
                ? 'bg-gold/15 text-gold'
                : 'text-white/65 hover:bg-white/5 hover:text-white'
            }`}
            onclick={() => onSeek(line.timeMs)}
            title={`跳到 ${formatTime(line.timeMs)}`}
          >
            <span class="block">{line.text}</span>
            {#if line.translated !== null}
              <span class={`mt-0.5 block text-[11px] ${index === active ? 'text-gold/80' : 'text-white/40'}`}>
                {line.translated}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}
