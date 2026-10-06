/**
 * 播放器：**IO 与状态**在这一层（audio 元素、计时、存储、网络），决策在 `playback.ts` / `queue.ts` 的纯函数里。
 *
 * 为什么这么切：这个文件用 rune（`$state`），而 `node:test` 直接 import 时 `$state` 不存在（实测
 * `ReferenceError: $state is not defined`）—— 所以**能测的部分必须住在纯 `.ts` 里**。
 * 这里只留「拿浏览器 API 干活」的那部分，别把判断搬进来。
 *
 * 与主功能零耦合：不认识牌桌客户端、引擎、SSE。它唯一的输入是一个「本机视野设置」，
 * 唯一的输出是「播到哪儿了」。
 */
import { createMusicClient, type MusicClient, type FetchLike } from './client.ts';
import { clamp, clampPosition, qualityTierOf } from './format.ts';
import {
  advanceOnEnd,
  advanceOnFailure,
  advanceOnNext,
  advanceOnPrev,
  fromPlaylist,
  playbackLevel,
  type Advance
} from './playback.ts';
import {
  EMPTY_QUEUE,
  clearQueue,
  enqueue,
  enqueueAll,
  removeAt,
  selectAt,
  withMode,
  type Queue
} from './queue.ts';
import {
  ANONYMOUS_SESSION,
  type LyricLine,
  type MusicError,
  type MusicView,
  type PlayMode,
  type PlaylistBrief,
  type QrStatus,
  type SearchKind,
  type SessionInfo,
  type Track
} from './types.ts';

/** 队列页里的分区（我的喜欢 / 歌单 / 最近播放 / 日推） */
export type MineTab = 'liked' | 'playlists' | 'recent' | 'daily';

/** 搜索页只做这两块：歌手结果要多一次 `artist/songs` 才有歌可放，不在这一版的范围内 */
export type SearchKindUI = 'song' | 'playlist';

export interface MusicPlayerOptions {
  readonly view: MusicView;
  /** 登录用户的音质偏好（服务端 env `SIXTY_MUSIC_LEVEL`） */
  readonly level: string;
  readonly client?: MusicClient;
  readonly fetch?: FetchLike;
}

export class MusicPlayer {
  /**
   * 本机视野设置（位置/收起态/音量/播放模式）。
   *
   * **必须是 rune**：它由组件读（`player.view.collapsed ? 药丸 : 窗口`），而改它的是
   * 拖动与按钮（都在**类的方法**里）。写成普通字段时，方法里的 `this.view = {...}`
   * 只是换了个普通对象，Svelte 根本不知道要重渲染 —— 实测症状是「拖动改了坐标、
   * localStorage 也写了，界面却纹丝不动；点一下也不展开」。落盘由 `MusicDock` 的
   * `$effect` 负责（它读得到这个 rune）。
   */
  view = $state<MusicView>({ x: 16, y: 96, collapsed: true, volume: 60, mode: 'list' });
  readonly level: string;

  queue = $state<Queue>(EMPTY_QUEUE);
  session = $state<SessionInfo>(ANONYMOUS_SESSION);

  /** 当前有没有真的在放 */
  playing = $state(false);
  buffering = $state(false);
  positionMs = $state(0);
  durationMs = $state(0);
  /** `Audio#play()` 被浏览器拦下（还没发生用户手势）—— 界面提示「点一下播放」 */
  blocked = $state(false);
  error = $state<MusicError | null>(null);
  /** 本次连跳里已经试过、播不出来的曲目（行内标注用，也是防死循环的凭据） */
  failedIds = $state<ReadonlySet<number>>(new Set());

  lyrics = $state<readonly LyricLine[]>([]);
  lyricsLoading = $state(false);
  /** 当前歌词属于哪一首：换歌时旧歌词不许留在屏幕上 */
  lyricsTrackId = $state(-1);

  searchQuery = $state('');
  searchKind = $state<SearchKindUI>('song');
  results = $state<readonly Track[]>([]);
  /** 歌单结果单独放：它的形状与曲目不同（一个歌单点开是「铺进队列」，不是「放这一首」） */
  resultPlaylists = $state<readonly PlaylistBrief[]>([]);
  resultTotal = $state(0);
  searching = $state(false);

  mineTab = $state<MineTab>('liked');
  mineLoading = $state(false);
  playlists = $state<readonly PlaylistBrief[]>([]);
  likedIds = $state<ReadonlySet<number>>(new Set());
  likedTracks = $state<readonly Track[]>([]);
  recent = $state<readonly Track[]>([]);
  daily = $state<readonly Track[]>([]);

  qrStatus = $state<QrStatus | null>(null);
  qrImage = $state('');

  #client: MusicClient;
  #audio: HTMLAudioElement | null = null;
  /** 见过、被当成「一首歌」塞进队列的歌单 id（见 `playback.ts` 的 `fromPlaylist`） */
  #playlists = new Set<number>();
  /** 上一次交给 audio 的曲目 id（-1 = 还没放过）—— `toggle()` 据此决定是接着放还是重新取 URL */
  #lastTrackId = -1;
  #tried = new Set<number>();
  #qrKey = '';
  #qrTimer: ReturnType<typeof setTimeout> | null = null;
  #onVisibility: (() => void) | null = null;

  constructor(options: MusicPlayerOptions) {
    // 初始值来自存档（`loadView`），之后由这里的方法改
    this.view = options.view;
    this.level = options.level;
    const fetchImpl = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    this.#client = options.client ?? createMusicClient({ fetch: fetchImpl });
  }

  /* ---------- 生命周期 ---------- */

  /** 绑到真实的 `<audio>` 元素上（组件里 `bind:this`）；同时接上「切到别的标签页就暂停」 */
  attach(audio: HTMLAudioElement): void {
    this.#audio = audio;
    if (this.#onVisibility !== null) document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#onVisibility = () => {
      if (document.visibilityState === 'hidden') audio.pause();
    };
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.applyVolume();
  }

  detach(): void {
    if (this.#onVisibility !== null) document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#onVisibility = null;
    this.#audio?.pause();
    this.#audio = null;
    this.#stopPolling();
  }

  /** 页面加载后问一次登录态（失败就当匿名，不让它打断牌桌） */
  async refreshSession(): Promise<void> {
    const result = await this.#client.session();
    if (result.ok) this.session = result.data;
  }

  /* ---------- 播放控制 ---------- */

  get current(): Track | null {
    return this.queue.index >= 0 ? (this.queue.tracks[this.queue.index] ?? null) : null;
  }

  isCurrent(id: number): boolean {
    return this.current?.id === id;
  }

  /** 音量 0~100 → audio 的 0~1（浏览器里没有 audio 时只改设置） */
  applyVolume(): void {
    if (this.#audio !== null) this.#audio.volume = clamp(this.view.volume, 0, 100) / 100;
  }

  /** 点一首歌：入队（已在队列里就切过去）并立刻播放 */
  async play(track: Track, seed = Date.now()): Promise<void> {
    if (this.#playlists.has(track.id) || this.playlists.some((item) => item.id === track.id)) {
      await this.playPlaylist(track.id);
      return;
    }
    this.queue = enqueue(this.queue, track, seed);
    await this.#startCurrent(true);
  }

  /** 播放整批（歌单 / 日推 / 最近播放） */
  async playAll(tracks: readonly Track[], seed = Date.now()): Promise<void> {
    if (tracks.length === 0) return;
    this.queue = enqueueAll(this.queue, tracks, seed);
    await this.#startCurrent(true);
  }

  /** 点队列里的某一首 */
  async playAt(index: number): Promise<void> {
    this.queue = selectAt(this.queue, index);
    await this.#startCurrent(true);
  }

  async toggle(): Promise<void> {
    const audio = this.#audio;
    if (audio === null) return;
    if (this.current === null) return;
    if (this.playing && !audio.paused) {
      audio.pause();
      this.playing = false;
      return;
    }
    if (this.#lastTrackId !== this.current.id) {
      await this.#startCurrent(true);
      return;
    }
    await this.#resume();
  }

  async next(): Promise<void> {
    await this.#advance(advanceOnNext(this.queue));
  }

  async previous(): Promise<void> {
    await this.#advance(advanceOnPrev(this.queue));
  }

  /** 自然播完：单曲循环重播，其余按顺序推进，末尾停下 */
  async onEnded(): Promise<void> {
    await this.#advance(advanceOnEnd(this.queue));
  }

  seekTo(ms: number): void {
    const audio = this.#audio;
    const target = clamp(ms, 0, this.durationMs > 0 ? this.durationMs : 0);
    this.positionMs = target;
    if (audio === null) return;
    audio.currentTime = target / 1000;
  }

  setVolume(volume: number): void {
    this.view = { ...this.view, volume: clamp(Math.round(volume), 0, 100) };
    this.applyVolume();
  }

  /** 换播放模式：进入随机时现洗一副（种子取当下时间） */
  cycleMode(): void {
    const order: PlayMode[] = ['list', 'one', 'shuffle'];
    const next = order[(order.indexOf(this.view.mode) + 1) % order.length] ?? 'list';
    this.view = { ...this.view, mode: next };
    this.queue = withMode(this.queue, next, Date.now());
  }

  removeFromQueue(index: number): void {
    const wasCurrent = index === this.queue.index;
    this.queue = removeAt(this.queue, index);
    if (wasCurrent) void this.#startCurrent(true);
  }

  clearQueue(): void {
    this.#audio?.pause();
    this.playing = false;
    this.positionMs = 0;
    this.durationMs = 0;
    this.lyrics = [];
    this.lyricsTrackId = -1;
    this.#lastTrackId = -1;
    this.queue = clearQueue(this.queue);
  }

  /* ---------- 拖动 ---------- */

  /** 拖动中：只改位置（越界夹回视口内） */
  dragTo(x: number, y: number, size: { width: number; height: number }): void {
    const next = clampPosition(x, y, size, {
      width: typeof window === 'undefined' ? 1280 : window.innerWidth,
      height: typeof window === 'undefined' ? 800 : window.innerHeight
    });
    this.view = { ...this.view, x: next.x, y: next.y };
  }

  toggleCollapsed(): void {
    this.view = { ...this.view, collapsed: !this.view.collapsed };
  }

  /* ---------- 搜索 ---------- */

  async search(keywords = this.searchQuery, kind = this.searchKind, offset = 0): Promise<void> {
    const text = keywords.trim();
    this.searchQuery = keywords;
    this.searchKind = kind;
    if (text === '') {
      this.results = [];
      this.resultPlaylists = [];
      this.resultTotal = 0;
      return;
    }
    this.searching = true;
    const result = await this.#client.search(text, kind satisfies SearchKind, offset);
    this.searching = false;
    if (!result.ok) {
      this.error = result.error;
      return;
    }
    this.error = null;
    // 换页时**追加**（「加载更多」），第一页替换
    if (kind === 'song') {
      this.results = offset === 0 ? result.data.tracks : [...this.results, ...result.data.tracks];
    } else {
      this.resultPlaylists =
        offset === 0 ? result.data.playlists : [...this.resultPlaylists, ...result.data.playlists];
      this.#remember(result.data.playlists);
    }
    this.resultTotal = result.data.total;
  }

  /** 搜索结果里的歌单：点开就把整张歌单铺进队列 */
  async playPlaylist(id: number): Promise<void> {
    this.buffering = true;
    const result = await this.#client.playlistTracks(id);
    this.buffering = false;
    if (!result.ok) {
      this.error = result.error;
      return;
    }
    await this.playAll(result.data);
  }

  /* ---------- 歌词 ---------- */

  async loadLyrics(): Promise<void> {
    const track = this.current;
    if (track === null) {
      this.lyrics = [];
      return;
    }
    const id = track.id;
    this.lyricsLoading = true;
    const result = await this.#client.lyric(id);
    this.lyricsLoading = false;
    // 请求飞在路上时用户可能已经换了歌：回来的旧歌词直接丢掉
    if (!result.ok || this.current?.id !== id) return;
    this.lyrics = result.data;
  }

  /* ---------- 登录 ---------- */

  async startLogin(): Promise<void> {
    this.error = null;
    const result = await this.#client.qrStart();
    if (!result.ok) {
      this.error = result.error;
      return;
    }
    this.#qrKey = result.data.key;
    this.qrImage = result.data.image;
    this.qrStatus = 'waiting';
    this.#pollQr();
  }

  #pollQr(): void {
    this.#stopPolling();
    this.#qrTimer = setTimeout(() => {
      void this.#pollQrOnce();
    }, 1200);
  }

  async #pollQrOnce(): Promise<void> {
    if (this.#qrKey === '') return;
    const result = await this.#client.qrPoll(this.#qrKey);
    if (!result.ok) {
      // 单次失败不打断轮询（网络抖一下很常见）；界面上的状态保持不动
      this.#pollQr();
      return;
    }
    this.qrStatus = result.data.status;
    if (result.data.status === 'confirmed' && result.data.session !== null) {
      this.session = result.data.session;
      this.#stopPolling();
      this.qrStatus = null;
      this.qrImage = '';
      this.#qrKey = '';
      return;
    }
    if (result.data.status === 'expired') {
      this.#stopPolling();
      return;
    }
    this.#pollQr();
  }

  #stopPolling(): void {
    if (this.#qrTimer !== null) clearTimeout(this.#qrTimer);
    this.#qrTimer = null;
  }

  async logout(): Promise<void> {
    await this.#client.logout();
    this.session = ANONYMOUS_SESSION;
    this.likedIds = new Set();
    this.likedTracks = [];
    this.playlists = [];
    this.recent = [];
    this.daily = [];
  }

  /* ---------- 我的（登录后才有内容） ---------- */

  async loadMine(tab: MineTab = this.mineTab): Promise<void> {
    this.mineTab = tab;
    const uid = this.session.userId;
    this.mineLoading = true;
    this.error = null;
    try {
      if (tab === 'liked') {
        this.likedIds = await this.#loadLiked(uid);
      } else if (tab === 'playlists') {
        const result = uid === null ? await this.#client.personalizedPlaylists() : await this.#client.userPlaylists(uid);
        if (result.ok) {
          this.playlists = result.data;
          this.#remember(result.data);
        } else {
          this.error = result.error;
        }
      } else if (tab === 'recent') {
        const result = await this.#client.recentSongs();
        if (result.ok) this.recent = result.data;
        else this.error = result.error;
      } else {
        const result = await this.#client.recommendSongs();
        if (result.ok) this.daily = result.data;
        else this.error = result.error;
      }
    } finally {
      this.mineLoading = false;
    }
  }

  /** 我的喜欢：`likelist` 只给 id，还要补一次详情才有名字与封面 */
  async #loadLiked(uid: number | null): Promise<ReadonlySet<number>> {
    if (uid === null) return new Set();
    const ids = await this.#client.likedIds(uid);
    if (!ids.ok) {
      this.error = ids.error;
      return new Set();
    }
    const tracks = await this.#client.songDetail(ids.data.slice(0, 200));
    if (tracks.ok) this.likedTracks = tracks.data;
    else this.error = tracks.error;
    return new Set(ids.data);
  }

  /** 喜欢 / 取消喜欢（写操作，客户端不重试） */
  async toggleLike(track: Track): Promise<void> {
    const uid = this.session.userId;
    if (uid === null) return;
    const liked = !this.likedIds.has(track.id);
    const result = await this.#client.setLiked(track.id, uid, liked);
    if (!result.ok) {
      this.error = result.error;
      return;
    }
    const next = new Set(this.likedIds);
    if (liked) next.add(track.id);
    else next.delete(track.id);
    this.likedIds = next;
    this.likedTracks = liked ? [track, ...this.likedTracks] : this.likedTracks.filter((item) => item.id !== track.id);
  }

  /** 音质档位（界面上显示当前在放什么音质时用） */
  get effectiveLevel(): string {
    return qualityTierOf(this.session.vipType, this.level);
  }

  /* ---------- 内部：起播与推进 ---------- */

  async #advance(step: Advance): Promise<void> {
    if (step.kind === 'stop') {
      this.playing = false;
      this.#audio?.pause();
      return;
    }
    if (step.kind === 'move') this.queue = selectAt(this.queue, step.index);
    await this.#startCurrent(true);
  }

  /**
   * 起播当前曲目：取 URL → 交给 audio。
   *
   * `Audio#play()` 返回的 Promise 必须接住：自动播放被拦时它会 reject，
   * 不接就是一条没人处理的 rejection，界面却什么都不显示。
   */
  async #startCurrent(countFailure: boolean): Promise<void> {
    const track = this.current;
    if (track === null) {
      this.playing = false;
      return;
    }
    this.buffering = true;
    this.error = null;
    this.blocked = false;
    this.positionMs = 0;
    this.durationMs = track.durationMs;
    this.#lastTrackId = track.id;
    if (this.lyricsTrackId !== track.id) {
      this.lyrics = [];
      this.lyricsTrackId = track.id;
      void this.loadLyrics();
    }

    const ticket = await this.#client.songUrl(track.id, playbackLevel(this.session.vipType, this.level));
    this.buffering = false;

    // 取 URL 期间用户可能又点了别的歌：这次的结果已经过期，直接丢掉
    if (this.current?.id !== track.id) return;

    if (!ticket.ok) {
      // 网络/上游的问题：报错但不连跳（连跳会把「服务坏了」伪装成「这些歌都没版权」）
      this.error = ticket.error;
      this.playing = false;
      return;
    }
    if (ticket.data.kind === 'unplayable') {
      if (countFailure) this.#markFailed(track.id);
      await this.#advance(advanceOnFailure(this.queue, this.#tried));
      return;
    }
    this.#tried.clear();
    this.failedIds = new Set();

    const audio = this.#audio;
    if (audio === null) return;
    audio.src = ticket.data.url;
    this.applyVolume();
    await this.#resume();
  }

  #markFailed(id: number): void {
    const next = new Set(this.#tried);
    next.add(id);
    this.#tried = next;
    this.failedIds = next;
    this.error = null;
  }

  /** 记住这批 id 是歌单（点它要「铺开」而不是「当一首歌播」） */
  #remember(items: readonly PlaylistBrief[]): void {
    for (const item of items) this.#playlists.add(item.id);
  }

  async #resume(): Promise<void> {
    const audio = this.#audio;
    if (audio === null) return;
    try {
      await audio.play();
      this.playing = true;
      this.blocked = false;
    } catch {
      // 自动播放策略：等一次用户手势（界面提示「点一下播放」）
      this.playing = false;
      this.blocked = true;
    }
  }
}
