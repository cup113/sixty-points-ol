<script lang="ts">
  import Glyph from './Glyph.svelte';
  import SearchPane from './SearchPane.svelte';
  import QueuePane from './QueuePane.svelte';
  import LyricPane from './LyricPane.svelte';
  import MinePane from './MinePane.svelte';
  import { formatTime } from '../format.ts';
  import { MODE_LABEL, progressPermille, seekFromPermille } from '../playback.ts';
  import type { MusicPlayer } from '../player.svelte.ts';

  /**
   * 展开后的播放器窗口。
   *
   * 版面是「页头（拖动把柄）+ 内容区 + 播放条」三段，内容区 `min-h-0 overflow-hidden`
   * 才压得住长列表 —— 少这一句列表会把整个窗口撑成页面高度（挂在 `fixed` 上的常见坑）。
   *
   * 三条拖动回调**都要**接上（真实缺陷吃过一次：只接了 `onDragStart`，症状是按住页头
   * 拖不动，而搜索、播放、队列全都正常 —— 断掉的只是指针事件链的一环，不报任何错）。
   */
  interface Props {
    player: MusicPlayer;
    onDragStart: (event: PointerEvent) => void;
    onDragMove: (event: PointerEvent) => void;
    onDragEnd: (event: PointerEvent) => void;
    onMinimize: () => void;
  }

  let { player, onDragStart, onDragMove, onDragEnd, onMinimize }: Props = $props();

  type Tab = 'search' | 'queue' | 'lyrics' | 'mine';
  let tab = $state<Tab>('search');

  const track = $derived(player.current);
  const permille = $derived(progressPermille(player.positionMs, player.durationMs));
  const modeIcon = $derived(
    player.view.mode === 'list' ? 'modeList' : player.view.mode === 'one' ? 'modeOne' : 'modeShuffle'
  );
  const TABS: readonly { key: Tab; label: string; icon: 'search' | 'queue' | 'lyrics' | 'user' }[] = [
    { key: 'search', label: '搜索', icon: 'search' },
    { key: 'queue', label: '队列', icon: 'queue' },
    { key: 'lyrics', label: '歌词', icon: 'lyrics' },
    { key: 'mine', label: '我的', icon: 'user' }
  ];

  // 歌词页要看到当前行，所以切到歌词时补一次加载（切歌时也会自动拉，见 player）
  $effect(() => {
    if (tab === 'lyrics' && player.lyrics.length === 0 && !player.lyricsLoading) void player.loadLyrics();
  });
</script>

<div class="flex h-full min-h-0 flex-col" data-music-window="true">
  <!-- 页头即拖动把柄：整条都能拖，只有里面那几个按钮自己吃掉点击。
       `role="toolbar"` + `tabindex="-1"` 是给 a11y 检查的（项目 check 是 `--fail-on-warnings`）：
       它准确描述了这一层 —— 一排控件，加一条可拖动的空白，本身不进 Tab 序列
       （Tab 该走到的是里面那枚「收起」按钮）。 -->
  <header
    class="flex shrink-0 cursor-grab touch-none items-center gap-2 rounded-t-2xl bg-white/5 px-2.5 py-2 active:cursor-grabbing"
    role="toolbar"
    tabindex="-1"
    aria-label="播放器标题栏（可拖动）"
    onpointerdown={onDragStart}
    onpointermove={onDragMove}
    onpointerup={onDragEnd}
    onpointercancel={onDragEnd}
    data-music-handle="true"
    title="按住这里拖动窗口"
  >
    <span class="min-w-0 flex-1 select-none">
      <span class="block truncate text-[13px] text-white/90">{track?.name ?? '网易云音乐'}</span>
      <span class="block truncate text-[11px] text-white/45">
        {#if track !== null}{track.artists}{:else}搜一首歌开始{/if}
      </span>
    </span>
    <button
      type="button"
      class="shrink-0 rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
      aria-label="收起播放器"
      title="收起"
      onclick={onMinimize}
      data-music-minimize="true"
    >
      <Glyph name="minimize" size={16} />
    </button>
  </header>

  <nav class="flex shrink-0 items-center gap-0.5 border-b border-white/10 px-2 py-1" aria-label="播放器分区">
    {#each TABS as item (item.key)}
      <button
        type="button"
        class={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
          tab === item.key ? 'bg-white/10 text-gold' : 'text-white/50 hover:text-white'
        }`}
        onclick={() => (tab = item.key)}
        data-music-tab={item.key}
      >
        <Glyph name={item.icon} size={13} />{item.label}
      </button>
    {/each}
  </nav>

  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if player.error !== null}
      <p
        class="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-red-500/15 px-2 py-1.5 text-[11px] text-red-200 ring-1 ring-red-400/25"
        role="status"
        data-music-error="true"
      >
        <span class="min-w-0 flex-1">{player.error.message}</span>
        {#if player.error.retryable}
          <button
            type="button"
            class="shrink-0 rounded border border-red-300/30 px-1.5 py-0.5 hover:bg-red-400/10"
            onclick={() => void player.loadMine(player.mineTab)}
          >
            重试
          </button>
        {/if}
      </p>
    {/if}

    {#if tab === 'search'}
      <SearchPane
        kind={player.searchKind}
        results={player.results}
        playlists={player.resultPlaylists}
        total={player.resultTotal}
        loading={player.searching}
        likedIds={player.likedIds}
        failedIds={player.failedIds}
        currentId={track?.id ?? null}
        onSearch={(keywords, kind, offset) => void player.search(keywords, kind, offset)}
        onPlay={(item) => void player.play(item)}
        onPlayPlaylist={(id) => void player.playPlaylist(id)}
        onLike={(item) => void player.toggleLike(item)}
      />
    {:else if tab === 'queue'}
      <QueuePane
        queue={player.queue}
        likedIds={player.likedIds}
        failedIds={player.failedIds}
        onPlayAt={(index) => void player.playAt(index)}
        onRemove={(index) => player.removeFromQueue(index)}
        onClear={() => player.clearQueue()}
        onLike={(item) => void player.toggleLike(item)}
      />
    {:else if tab === 'lyrics'}
      <LyricPane
        lyrics={player.lyrics}
        loading={player.lyricsLoading}
        positionMs={player.positionMs}
        onSeek={(ms) => player.seekTo(ms)}
      />
    {:else}
      <MinePane
        tab={player.mineTab}
        loggedIn={player.session.loggedIn}
        loading={player.mineLoading}
        likedIds={player.likedIds}
        likedTracks={player.likedTracks}
        playlists={player.playlists}
        recent={player.recent}
        daily={player.daily}
        currentId={track?.id ?? null}
        failedIds={player.failedIds}
        nickname={player.session.nickname}
        qrStatus={player.qrStatus}
        qrImage={player.qrImage}
        onTab={(next) => void player.loadMine(next)}
        onPlay={(item) => void player.play(item)}
        onPlayAll={(list) => void player.playAll(list)}
        onPlayPlaylist={(id) => void player.playPlaylist(id)}
        onLike={(item) => void player.toggleLike(item)}
        onLogin={() => void player.startLogin()}
        onLogout={() => void player.logout()}
      />
    {/if}
  </div>

  <!-- 播放条：上一首 / 播放 / 下一首 + 进度 + 音量 + 播放模式 -->
  <footer class="shrink-0 border-t border-white/10 px-2.5 py-2" data-music-bar="true">
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
        aria-label="上一首"
        onclick={() => void player.previous()}
        data-music-prev="true"
      >
        <Glyph name="previous" size={16} />
      </button>
      <button
        type="button"
        class="rounded-full bg-gold/20 p-1.5 text-gold ring-1 ring-gold/30 hover:bg-gold/30 disabled:opacity-50"
        aria-label={player.playing ? '暂停' : '播放'}
        disabled={player.buffering || track === null}
        onclick={() => void player.toggle()}
        data-music-toggle="true"
        data-playing={player.playing}
      >
        <Glyph name={player.playing ? 'pause' : 'play'} size={16} />
      </button>
      <button
        type="button"
        class="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
        aria-label="下一首"
        onclick={() => void player.next()}
        data-music-next="true"
      >
        <Glyph name="next" size={16} />
      </button>

      <span class="ml-1 w-8 shrink-0 text-right text-[10px] tabular-nums text-white/45">
        {formatTime(player.positionMs)}
      </span>
      <input
        class="h-1 min-w-0 flex-1 accent-[var(--color-gold)]"
        type="range"
        min="0"
        max="1000"
        value={permille}
        disabled={player.durationMs <= 0}
        aria-label="播放进度"
        data-music-seek="true"
        oninput={(event) => player.seekTo(seekFromPermille(Number(event.currentTarget.value), player.durationMs))}
      />
      <span class="w-8 shrink-0 text-[10px] tabular-nums text-white/45">{formatTime(player.durationMs)}</span>
    </div>

    <div class="mt-1.5 flex items-center gap-1.5">
      <button
        type="button"
        class="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
        aria-label={MODE_LABEL[player.view.mode]}
        title={MODE_LABEL[player.view.mode]}
        onclick={() => player.cycleMode()}
        data-music-mode={player.view.mode}
      >
        <Glyph name={modeIcon} size={15} />
      </button>
      <Glyph name={player.view.volume === 0 ? 'mute' : 'volume'} size={14} class="shrink-0 text-white/45" />
      <input
        class="h-1 min-w-0 flex-1 accent-[var(--color-gold)]"
        type="range"
        min="0"
        max="100"
        value={player.view.volume}
        aria-label="音量"
        data-music-volume="true"
        oninput={(event) => player.setVolume(Number(event.currentTarget.value))}
      />
      <span class="w-6 shrink-0 text-right text-[10px] tabular-nums text-white/40">{player.view.volume}</span>
      <span class="shrink-0 text-[10px] text-white/30">{player.effectiveLevel}</span>
    </div>

    {#if player.blocked}
      <p class="mt-1 text-[10px] text-amber-200" role="status">浏览器拦下了自动播放，点一下播放键</p>
    {/if}
  </footer>
</div>
