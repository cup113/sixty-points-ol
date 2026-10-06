<script lang="ts">
  import Glyph from './Glyph.svelte';
  import TrackRow from './TrackRow.svelte';
  import LoginPane from './LoginPane.svelte';
  import type { MineTab } from '../player.svelte.ts';
  import type { PlaylistBrief, QrStatus, Track } from '../types.ts';

  /**
   * 「我的」页：喜欢 / 歌单 / 最近播放 / 每日推荐。
   *
   * 未登录时**不做假内容**：只放登录引导（日推与歌单其实匿名也能看一部分，
   * 但「我的喜欢」必然要登录 —— 一半能点一半不能点更容易让人以为是坏了）。
   */
  interface Props {
    tab: MineTab;
    loggedIn: boolean;
    loading: boolean;
    likedIds: ReadonlySet<number>;
    likedTracks: readonly Track[];
    playlists: readonly PlaylistBrief[];
    recent: readonly Track[];
    daily: readonly Track[];
    currentId: number | null;
    failedIds: ReadonlySet<number>;
    nickname: string | null;
    qrStatus: QrStatus | null;
    qrImage: string;
    onTab: (tab: MineTab) => void;
    onPlay: (track: Track) => void;
    onPlayAll: (tracks: readonly Track[]) => void;
    onPlayPlaylist: (id: number) => void;
    onLike: (track: Track) => void;
    onLogin: () => void;
    onLogout: () => void;
  }

  let {
    tab,
    loggedIn,
    loading,
    likedIds,
    likedTracks,
    playlists,
    recent,
    daily,
    currentId,
    failedIds,
    nickname,
    qrStatus,
    qrImage,
    onTab,
    onPlay,
    onPlayAll,
    onPlayPlaylist,
    onLike,
    onLogin,
    onLogout
  }: Props = $props();

  const TABS: readonly { key: MineTab; label: string }[] = [
    { key: 'liked', label: '喜欢' },
    { key: 'playlists', label: '歌单' },
    { key: 'recent', label: '最近' },
    { key: 'daily', label: '日推' }
  ];

  const shown = $derived(tab === 'liked' ? likedTracks : tab === 'recent' ? recent : daily);
</script>

{#if !loggedIn}
  <LoginPane {loggedIn} {nickname} {qrStatus} {qrImage} onStart={onLogin} onLogout={onLogout} />
{:else}
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center gap-1 px-3 pt-2 text-[11px]">
      {#each TABS as item (item.key)}
        <button
          type="button"
          class={`rounded-md px-2 py-1 ${tab === item.key ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}
          onclick={() => onTab(item.key)}
          data-music-mine={item.key}
        >
          {item.label}
        </button>
      {/each}
      <span class="ml-auto flex items-center gap-1 text-white/40">
        <Glyph name="user" size={12} />{nickname ?? ''}
      </span>
    </div>

    <div class="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-music-mine-body="true">
      {#if loading}
        <p class="px-2 py-4 text-center text-xs text-white/50">加载中…</p>
      {:else if tab === 'playlists'}
        {#if playlists.length === 0}
          <p class="px-2 py-4 text-center text-xs text-white/45">没有歌单</p>
        {:else}
          <ul class="space-y-0.5">
            {#each playlists as item (item.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-white/5"
                  onclick={() => onPlayPlaylist(item.id)}
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
      {:else if shown.length === 0}
        <p class="px-2 py-4 text-center text-xs text-white/45">这里还是空的</p>
      {:else}
        <button
          type="button"
          class="mx-1.5 mb-1 flex w-[calc(100%-0.75rem)] items-center justify-center gap-1 rounded-lg bg-white/5 py-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
          onclick={() => onPlayAll(shown)}
          data-music-play-all="true"
        >
          播放全部（{shown.length} 首）
        </button>
        <ul class="space-y-0.5">
          {#each shown as track (track.id)}
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
    </div>
  </div>
{/if}
