<script lang="ts">
  import Glyph from './Glyph.svelte';
  import TrackRow from './TrackRow.svelte';
  import type { PlaylistBrief, Track } from '../types.ts';
  import type { SearchKindUI } from '../player.svelte.ts';

  /**
   * 搜索页：单曲 / 歌单两块。
   *
   * 输入在**回车**或**停下来 300ms** 后才发请求 —— 每敲一个字搜一次会把上游的限流打出来，
   * 而 300ms 刚好是「停下来想一下」的长度。
   */
  interface Props {
    kind: SearchKindUI;
    results: readonly Track[];
    playlists: readonly PlaylistBrief[];
    total: number;
    loading: boolean;
    likedIds: ReadonlySet<number>;
    failedIds: ReadonlySet<number>;
    currentId: number | null;
    onSearch: (keywords: string, kind: SearchKindUI, offset: number) => void;
    onPlay: (track: Track) => void;
    onPlayPlaylist: (id: number) => void;
    onLike: (track: Track) => void;
  }

  let {
    kind,
    results,
    playlists,
    total,
    loading,
    likedIds,
    failedIds,
    currentId,
    onSearch,
    onPlay,
    onPlayPlaylist,
    onLike
  }: Props = $props();

  /**
   * 输入框是**非受控**的：`text` 归这个组件，敲字不经过父组件。
   *
   * （早先是从 `query` 属性初始化再 `$effect` 同步，编译器当场报 `state_referenced_locally`：
   * 那样写每次敲字都要把光标位置跟外部值对齐一次，是光标乱跳的经典来源。搜索词仍然会
   * 通过 `onSearch` 写回播放器 —— 只有「输入框当前该显示什么」归本地。）
   */
  let text = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  function submit(): void {
    if (timer !== null) clearTimeout(timer);
    onSearch(text, kind, 0);
  }

  function changed(value: string): void {
    text = value;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => onSearch(value, kind, 0), 300);
  }

  const TABS: readonly { key: SearchKindUI; label: string }[] = [
    { key: 'song', label: '单曲' },
    { key: 'playlist', label: '歌单' }
  ];
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex items-center gap-2 px-3 pt-2">
    <label
      class="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-black/30 px-2 py-1.5 ring-1 ring-white/10 focus-within:ring-gold/40"
    >
      <Glyph name="search" size={14} class="shrink-0 text-white/40" />
      <input
        class="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-white/35 focus:outline-none"
        placeholder="搜歌名 / 歌手 / 歌单"
        bind:value={text}
        oninput={(event) => changed(event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        aria-label="搜索音乐"
        data-music-search="true"
      />
    </label>
    <button
      type="button"
      class="shrink-0 rounded-lg bg-gold/20 px-2.5 py-1.5 text-[12px] text-gold ring-1 ring-gold/30 hover:bg-gold/30"
      onclick={submit}
    >
      搜索
    </button>
  </div>

  <div class="mt-2 flex items-center gap-1 px-3 text-[11px]">
    {#each TABS as tab (tab.key)}
      <button
        type="button"
        class={`rounded-md px-2 py-1 ${kind === tab.key ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}
        onclick={() => {
          if (timer !== null) clearTimeout(timer);
          onSearch(text, tab.key, 0);
        }}
        data-music-kind={tab.key}
      >
        {tab.label}
      </button>
    {/each}
    {#if total > 0}
      <span class="ml-auto text-white/35">共 {total} 条</span>
    {/if}
  </div>

  <div class="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-music-results="true">
    {#if loading}
      <p class="px-2 py-4 text-center text-xs text-white/50">搜索中…</p>
    {:else if kind === 'playlist'}
      {#if playlists.length === 0}
        <p class="px-2 py-4 text-center text-xs text-white/45">
          {text.trim() === '' ? '输入关键词开始搜索' : '没有结果'}
        </p>
      {:else}
        <ul class="space-y-0.5">
          {#each playlists as item (item.id)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-white/5"
                onclick={() => onPlayPlaylist(item.id)}
                title={`播放歌单 ${item.name}`}
                data-music-playlist={item.id}
              >
                <span class="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-white/10 ring-1 ring-white/10">
                  {#if item.cover !== null}
                    <img src={item.cover} alt="" class="h-full w-full object-cover" loading="lazy" />
                  {/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] text-white/90">{item.name}</span>
                  <span class="mt-0.5 block truncate text-[11px] text-white/45">
                    {item.trackCount} 首{#if item.creator !== null} · {item.creator}{/if}
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if results.length === 0}
      <p class="px-2 py-4 text-center text-xs text-white/45">
        {text.trim() === '' ? '输入关键词开始搜索' : '没有结果'}
      </p>
    {:else}
      <ul class="space-y-0.5">
        {#each results as track (track.id)}
          <TrackRow
            {track}
            current={track.id === currentId}
            failed={failedIds.has(track.id)}
            likeable
            liked={likedIds.has(track.id)}
            onPlay={() => onPlay(track)}
            onLike={() => onLike(track)}
          />
        {/each}
      </ul>
    {/if}

    {#if results.length + playlists.length > 0 && total > results.length + playlists.length}
      <button
        type="button"
        class="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] text-white/60 hover:bg-white/5 hover:text-white"
        onclick={() => onSearch(text, kind, results.length + playlists.length)}
        data-music-more="true"
      >
        <Glyph name="plus" size={13} /> 加载更多（还有 {total - results.length - playlists.length} 条）
      </button>
    {/if}
  </div>
</div>
