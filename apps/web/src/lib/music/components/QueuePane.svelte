<script lang="ts">
  import TrackRow from './TrackRow.svelte';
  import { positionInOrder } from '../playback.ts';
  import type { Queue } from '../queue.ts';
  import type { Track } from '../types.ts';

  /**
   * 队列页：插入序列表 + 当前曲目高亮。
   *
   * 随机模式下「下一首」走的不是这个顺序（是洗好的那一份），所以页头同时说明
   * 「第几首 / 共几首」—— 只看列表顺序会让人以为下一首就是下面那一首。
   */
  interface Props {
    queue: Queue;
    likedIds: ReadonlySet<number>;
    failedIds: ReadonlySet<number>;
    onPlayAt: (index: number) => void;
    onRemove: (index: number) => void;
    onClear: () => void;
    onLike: (track: Track) => void;
  }

  let { queue, likedIds, failedIds, onPlayAt, onRemove, onClear, onLike }: Props = $props();

  const position = $derived(positionInOrder(queue));
</script>

<div class="flex min-h-0 flex-1 flex-col" data-music-queue="true">
  <div class="flex items-center gap-2 px-3 pt-2 pb-1 text-[11px] text-white/45">
    <span>
      共 {queue.tracks.length} 首{#if queue.index >= 0}（正在放第 {position} 首）{/if}
    </span>
    {#if queue.tracks.length > 0}
      <button
        type="button"
        class="ml-auto rounded-md px-2 py-0.5 text-white/50 hover:bg-white/5 hover:text-red-200"
        onclick={onClear}
        data-music-clear="true"
      >
        清空
      </button>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
    {#if queue.tracks.length === 0}
      <p class="px-2 py-6 text-center text-xs text-white/45">队列是空的：上面搜一首，点一下就放</p>
    {:else}
      <ul class="space-y-0.5">
        {#each queue.tracks as track, index (track.id)}
          <TrackRow
            {track}
            {index}
            current={index === queue.index}
            failed={failedIds.has(track.id)}
            likeable
            liked={likedIds.has(track.id)}
            onPlay={() => onPlayAt(index)}
            onLike={() => onLike(track)}
            onRemove={() => onRemove(index)}
          />
        {/each}
      </ul>
    {/if}
  </div>
</div>
