<script lang="ts">
  import { onMount } from 'svelte';
  import Glyph from './Glyph.svelte';
  import PlayerWindow from './PlayerWindow.svelte';
  import { MusicPlayer } from '../player.svelte.ts';
  import { announceMusic } from '../bus.ts';
  import { loadQueue, loadView, saveQueue, saveView, storageOf, writeAllowed, type StorageLike } from '../store.ts';
  import type { MusicView } from '../types.ts';

  /**
   * 音乐悬浮窗的**唯一入口** —— 牌桌页只挂这一行标签。
   *
   * 三条纪律：
   * 1. **`onMount` 之前什么都不渲染**：SSR 首帧里没有它（`ui-check` 对牌桌首帧的断言因此不受影响），
   *    也顺带保证了 `localStorage` / `Audio` 只在浏览器里被碰。
   * 2. **与牌桌零交互**：不读 `client`、不认 `view`、不发牌桌上的请求，只跟 `/api/music/*` 说话。
   * 3. **失败只影响自己**：边车没起来时窗口里显示一句可重试的提示，牌桌照常能打。
   *
   * 「完全解耦」也体现在这里：整块功能可以**只删这一个文件下的 import 与一行标签**就下线，
   * 牌桌页其他部分一个字节都不用动（守卫见 `apps/web/test/music-guard.test.ts`）。
   */
  interface Props {
    /** 服务端下一副开的功能开关（`SIXTY_MUSIC=off` 时为 false，整块不渲染） */
    enabled: boolean;
    /** 登录用户的音质偏好（`SIXTY_MUSIC_LEVEL`） */
    level: string;
  }

  let { enabled, level }: Props = $props();

  /** 首帧的默认视野：右下角、让开操作条（真正的存档在 `onMount` 里读） */
  const INITIAL_VIEW: MusicView = { x: 16, y: 96, collapsed: true, volume: 60, mode: 'list' };

  let mounted = $state(false);
  /** 只在挂载后才有值：`localStorage` 在 SSR 里不存在 */
  let storage = $state<StorageLike | null>(null);
  let player = $state<MusicPlayer | null>(null);
  let audio = $state<HTMLAudioElement | null>(null);
  let shell = $state<HTMLDivElement | null>(null);
  /** 存档写失败（隐私模式 / 配额满）要说一声，否则用户以为记住了 */
  let writeProblem = $state(false);

  onMount(() => {
    mounted = true;
    if (!enabled) return;
    const jar = storageOf();
    storage = jar;
    const restored = loadView(jar);
    const created = new MusicPlayer({ view: restored, level });
    player = created;

    // 只恢复队列、**不自动播放**：浏览器会拦下无手势的播放，而且进桌就出声很唐突
    const saved = loadQueue(jar, restored.mode);
    if (saved.tracks.length > 0) {
      created.queue = saved;
      created.durationMs = saved.tracks[saved.index]?.durationMs ?? 0;
      created.view = { ...created.view, collapsed: false };
    }
    void created.refreshSession();

    return () => {
      // 离开牌桌就停：组件卸载，声音跟着停（只挂本页是刻意的）
      created.detach();
      announceMusic(false);
    };
  });

  // audio 元素出现后交给播放器（`bind:this` 的引用在挂载后才非空）
  $effect(() => {
    if (player !== null && audio !== null) player.attach(audio);
  });

  // 视野设置一变就落盘（拖动、音量、播放模式、收起展开都走这一条）
  $effect(() => {
    const snapshot = player?.view;
    if (player === null || storage === null || snapshot === undefined) return;
    if (saveView(storage, snapshot) === false && writeAllowed(storage)) writeProblem = true;
  });

  // 队列变化就落盘（同样只在本机；坏存档在 `loadQueue` 里被吃掉）
  $effect(() => {
    const queue = player?.queue;
    if (player === null || storage === null || queue === undefined || queue.tracks.length === 0) return;
    saveQueue(storage, queue);
  });

  // 播/停时知会别的音频通道（见 bus.ts；对方不在也什么都不发生）
  $effect(() => {
    const playing = player?.playing ?? false;
    announceMusic(playing);
  });

  /** 窗口尺寸（拖动夹取用；收起态是药丸，尺寸小得多） */
  function size(): { width: number; height: number } {
    const box = shell?.getBoundingClientRect();
    return { width: box?.width ?? 340, height: box?.height ?? 60 };
  }

  /* ---------- 拖动：Pointer Events + 指针捕获（鼠标/触屏/触控笔同一套） ---------- */
  let dragging = $state(false);
  let origin = { x: 0, y: 0, px: 0, py: 0, moved: false };

  function onDragStart(event: PointerEvent): void {
    if (player === null || event.button !== 0) return;
    /**
     * 起点落在**按钮/输入**上时不进入拖动。
     *
     * `setPointerCapture` 会把后续的 pointerup 也送到这一层，那个元素因此拿不到配对的 up，
     * 浏览器就不合成 click —— 症状是「收起键点了没反应」。实测确认过一次：`elementFromPoint`
     * 已经落在按钮里，而它的 onclick 从不执行。
     */
    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest('button, input, a, select, textarea') !== null) return;
    const box = shell?.getBoundingClientRect();
    if (box === undefined) return;
    dragging = true;
    origin = { x: box.left, y: box.top, px: event.clientX, py: event.clientY, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDragMove(event: PointerEvent): void {
    if (!dragging || player === null) return;
    const dx = event.clientX - origin.px;
    const dy = event.clientY - origin.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) origin.moved = true;
    if (!origin.moved) return;
    player.dragTo(origin.x + dx, origin.y + dy, size());;
  }

  function onDragEnd(event: PointerEvent): void {
    if (!dragging || player === null) return;
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    // 没挪动就是一次点击：药丸上点一下 = 展开（收起态没有别的可点区域）
    if (!origin.moved && player.view.collapsed) player.toggleCollapsed();
  }

  /** 键盘：Esc 收起（窗口是浮层，符合用户对浮层的预期） */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && player !== null && !player.view.collapsed) player.toggleCollapsed();
  }
</script>

{#if enabled && mounted && player !== null}
  <div
    class="fixed z-40 select-none"
    style={`left:${player.view.x}px; top:${player.view.y}px;`}
    bind:this={shell}
    onkeydown={onKeydown}
    role="presentation"
    data-music-dock="true"
    data-collapsed={player.view.collapsed}
  >
    <div
      class={`overflow-hidden border border-white/10 bg-felt-950/95 text-ivory shadow-2xl backdrop-blur ${
        player.view.collapsed ? 'rounded-full' : 'rounded-2xl'
      }`}
    >
      {#if player.view.collapsed}
        <!-- 收起态：一枚药丸，整条都能拖；没拖动的那一下点击 = 展开。
             `role="group"` 是给 a11y 检查的（项目 check 是 `--fail-on-warnings`）：
             这一层是拖动区，真正的控件是里面那两个真按钮 —— 都带中文 `aria-label`。 -->
        <div
          class="flex cursor-grab touch-none items-center gap-1.5 py-1.5 pr-2 pl-1.5 active:cursor-grabbing"
          role="group"
          aria-label="音乐播放器（可拖动，点一下展开）"
          onpointerdown={onDragStart}
          onpointermove={onDragMove}
          onpointerup={onDragEnd}
          onpointercancel={onDragEnd}
          data-music-pill="true"
        >
          <span class="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
            {#if player.current?.cover != null}
              <img src={player.current.cover} alt="" class="h-full w-full object-cover" />
            {/if}
          </span>
          <span class="max-w-[9rem] truncate text-[11px] text-white/80">
            {player.current?.name ?? '网易云音乐'}
          </span>
          <button
            type="button"
            class="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label={player.playing ? '暂停' : '播放'}
            onpointerdown={(event) => event.stopPropagation()}
            onclick={() => void player?.toggle()}
            data-music-pill-toggle="true"
          >
            <Glyph name={player.playing ? 'pause' : 'play'} size={14} />
          </button>
        </div>
      {:else}
        <div class="h-[30rem] max-h-[80vh] w-[21rem] max-w-[calc(100vw-1rem)]">
          <PlayerWindow
            {player}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onMinimize={() => player?.toggleCollapsed()}
          />
        </div>
      {/if}
    </div>

    {#if writeProblem}
      <p class="mt-1 max-w-[21rem] rounded bg-black/60 px-2 py-1 text-[10px] text-amber-200">
        位置 / 音量存不进本机（隐私模式或空间不足），这次的设置关掉页面就丢
      </p>
    {/if}
  </div>

  <!-- 播放器本体：不给 `src`，由播放器取到 URL 之后再交上来（`player.attach`）。
       `preload="none"`：没点播放之前不下载任何音频。 -->
  <audio
    bind:this={audio}
    preload="none"
    onended={() => void player?.onEnded()}
    ontimeupdate={(event) => {
      if (player !== null) player.positionMs = event.currentTarget.currentTime * 1000;
    }}
    ondurationchange={(event) => {
      const seconds = event.currentTarget.duration;
      if (player !== null && Number.isFinite(seconds) && seconds > 0) player.durationMs = seconds * 1000;
    }}
    onerror={() => {
      // 音频直链有时效：说一句并松开播放态，队列不动（用户自己决定下一首还是重试）
      if (player === null) return;
      player.error = { code: 'upstream', message: '音频地址失效（直链有时效），点下一首或重试', retryable: true };
      player.playing = false;
    }}
    data-music-audio="true"
  ></audio>
{/if}
