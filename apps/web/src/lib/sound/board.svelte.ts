/**
 * 声音面板：三条通道（背景音乐 / 音效 / 震动）的唯一执行者。
 *
 * 形状上的四个约束,每一条都对应一个会真实出问题的地方:
 *
 * ① **AudioContext 懒创建、绝不在模块顶层创建**。服务端渲染与 node 里没有
 *    `AudioContext`,顶层 `new` 会让整个页面（以及任何 import 它的测试）当场崩掉;
 *    这里是「第一次真要出声时」才建,且 `typeof window` 先挡一道。
 * ② **本文件里不许出现 `$effect`**。Svelte 5 只允许在 `.svelte` 组件里用 effect,
 *    `.svelte.ts` 里用了会在编译期被拒。触发时机因此由页面那边的 effect 调 `cue()`。
 * ③ **音乐用 AudioBufferSourceNode 循环,不用 `<audio loop>`**:一个 AudioContext 既管音效
 *    又管音乐,少一套生命周期;淡入淡出也能在这里一次做完。
 * ④ **该不该响由 `#musicWanted` 决定,不看音量一次了事**:音量是否大于 0、页面可见性、
 *    浏览器自动播放解锁三件事都会影响「现在该不该响」,集中到一个布尔上才不会互相打架。
 *
 * 增益分两层,别混:
 * **文件里那层是相对配比**（该你了最亮、落牌压成底色,见 `docs/audio-sources.md`）,
 * **代码里这层是总电平** —— 两条通道各自的音量经 `volumeGain` 的二次曲线作用在整条通道上,
 * 所以整体调小而不会出现「某一声突然盖过另一声」。音乐另有淡入淡出与拖动时的短过渡。
 */
import type { SoundCue } from './events';
import { clampVolume, readSoundSettings, volumeGain, writeSoundVolume, writeVibration } from './settings';

const CUE_URL: Record<SoundCue, string> = {
  turn: '/sounds/turn.mp3',
  card: '/sounds/card.mp3',
  trick: '/sounds/trick.mp3',
  settle: '/sounds/settle.mp3'
};

const MUSIC_URL = '/sounds/bgm.mp3';

/**
 * 点播播放器（牌桌页的音乐悬浮窗，见 ADR-0019）在 `document` 上派发的自定义事件名，
 * detail 是 `{ playing: boolean }`。
 *
 * 这里刻意**不 import** `$lib/music/`：两个模块互不认识，唯一契约就是这个字符串。
 * 悬浮窗那边（`$lib/music/bus.ts` 的 `MUSIC_EVENT`）写的是同一个名字，
 * `apps/web/test/sound.test.ts` 有一条守卫钉住两边不许写岔。
 */
const MUSIC_DOCK_EVENT = 'sixty:music';

/** 「该你了」的震动花样:两下轻震,手机在兜里也分得出是「该你了」而不是普通通知 */
const VIBRATION_PATTERN: readonly number[] = [30, 50, 30];

const MUSIC_FADE_IN = 0.6;
const MUSIC_FADE_OUT = 0.25;
/** 拖动音量滑块时的增益过渡：太短会有「咔」的阶跃声，太长会觉得滑块不跟手 */
const VOLUME_RAMP = 0.08;

export class SoundBoard {
  /**
   * 两条音频通道的音量（0~100，0 = 静音）+ 震动开关。
   * 弹层直接绑定这一份状态，别处（页面脚本、localStorage）不再各存一份。
   */
  music = $state(0);
  sfx = $state(0);
  vibration = $state(false);

  #context: AudioContext | null = null;
  /** url → 解码结果（`null` = 取不到/解不开；失败不进缓存，下次还会再试） */
  #buffers = new Map<string, Promise<AudioBuffer | null>>();
  #music: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** 现在**应该**在响吗（音量大于 0 且 页面可见 且 已解锁） */
  #musicWanted = false;
  /** 每次起停自增：异步解码期间被切过就作废这一次，避免连点/快拖留下两条音轨 */
  #musicToken = 0;
  #disposeUnlock: (() => void) | null = null;
  /** 点播播放器正在出声（见 `yieldToPlayer`）：让位期间背景音乐不起播 */
  #yieldToPlayer = false;

  constructor() {
    const saved = readSoundSettings();
    this.music = saved.music;
    this.sfx = saved.sfx;
    this.vibration = saved.vibration;
  }

  /** 页面挂载时调用：按已存音量起播，并接管「切到别的标签页就暂停」与「点播让位」。返回解绑函数 */
  attach(): () => void {
    this.#musicWanted = this.#musicShouldPlay();
    void this.#syncMusic();
    const onVisibility = (): void => {
      this.#musicWanted = this.#musicShouldPlay();
      void this.#syncMusic();
    };
    /**
     * 点播播放器（音乐悬浮窗）在 `document` 上派发 `sixty:music`，detail 是 `{ playing }`。
     * 事件名是两边唯一的契约：本模块不 import 悬浮窗的任何东西（见 `yieldToPlayer`）。
     */
    const onMusicDock = (event: Event): void => {
      const detail = (event as CustomEvent<{ playing?: unknown }>).detail;
      this.yieldToPlayer(detail?.playing === true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener(MUSIC_DOCK_EVENT, onMusicDock);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener(MUSIC_DOCK_EVENT, onMusicDock);
      this.dispose();
    };
  }

  dispose(): void {
    this.#musicWanted = false;
    this.#musicToken += 1;
    this.#stopMusic(0);
    this.#disposeUnlock?.();
    this.#disposeUnlock = null;
    const ctx = this.#context;
    this.#context = null;
    this.#buffers.clear();
    if (ctx !== null) void ctx.close().catch(() => undefined);
  }

  /**
   * 调背景音乐音量。**拖动时不重启动音轨**：音轨在响就只改增益（`VOLUME_RAMP` 过渡），
   * 从 0 拉起来才建音轨、拉回 0 才淡出停掉 —— 否则一次拖动会起停几十次。
   */
  setMusic(percent: number): void {
    const value = clampVolume(percent);
    this.music = value;
    writeSoundVolume('music', value);
    this.#musicWanted = this.#musicShouldPlay();
    if (this.#music !== null) {
      if (value > 0) this.#applyMusicGain();
      else this.#stopMusic(MUSIC_FADE_OUT);
      return;
    }
    void this.#syncMusic();
  }

  setSfx(percent: number): void {
    const value = clampVolume(percent);
    this.sfx = value;
    writeSoundVolume('sfx', value);
  }

  setVibration(on: boolean): void {
    this.vibration = on;
    writeVibration(on);
  }

  /** 放一声提示音。音量为 0、或浏览器还不许出声时静默放弃（不抛错、不打断牌局） */
  async cue(name: SoundCue): Promise<void> {
    if (this.sfx <= 0) return;
    const ctx = this.#ensureContext();
    if (ctx === null) return;
    if (!(await this.#resume(ctx))) return;
    const buffer = await this.#load(ctx, CUE_URL[name]);
    // 等解码这段时间里可能已经被拉回 0：再确认一次，别在静音之后还响一声
    if (buffer === null || this.sfx <= 0) return;
    const gain = ctx.createGain();
    gain.gain.value = volumeGain(this.sfx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  /** 「该你了」轻震一下。iOS 没有这个 API，静默降级；Chrome 在用户首次触碰前会忽略它 */
  buzz(): void {
    if (!this.vibration) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate([...VIBRATION_PATTERN]);
    } catch {
      // 被策略拦下或设备不支持：震动是加成，不该因此报错
    }
  }

  /** 音乐该不该在响：音量大于 0、标签页可见、且没在给点播让位 */
  #musicShouldPlay(): boolean {
    return this.music > 0 && !hidden() && !this.#yieldToPlayer;
  }

  /**
   * 点播播放器（牌桌页的**音乐悬浮窗**，见 ADR-0019）开始／停止出声时调用。
   *
   * 为什么要让位：这是**两条独立**的音频通道（背景音乐是本地 CC0 循环，悬浮窗放的是网易云点播），
   * 同时响会互相盖住，而用户在悬浮窗里按下播放这个动作，意思就是「我现在要听这首」。
   * 音量**不动**（滑块还停在原处）：让位只是暂停，悬浮窗一停就按原音量接回来。
   *
   * 接口是 `document` 上的一个 DOM 事件（`sixty:music`，见 `$lib/music/bus.ts`），
   * 而不是两个模块互相 import —— 悬浮窗既不知道也不关心谁在听它。
   */
  yieldToPlayer(yielding: boolean): void {
    if (this.#yieldToPlayer === yielding) return;
    this.#yieldToPlayer = yielding;
    this.#musicWanted = this.#musicShouldPlay();
    void this.#syncMusic();
  }

  /** 音轨已在响时改增益（滑块拖动走这条） */
  #applyMusicGain(): void {
    const playing = this.#music;
    const ctx = this.#context;
    if (playing === null || ctx === null) return;
    const now = ctx.currentTime;
    const target = volumeGain(this.music);
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(target, now + VOLUME_RAMP);
  }

  #ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.#context === null) {
      if (window.AudioContext === undefined) return null;
      this.#context = new window.AudioContext();
    }
    return this.#context;
  }

  /**
   * 尝试让 AudioContext 进入 running。成功返回 true；仍被自动播放策略压着则返回 false，
   * 并挂一次性手势监听（**只能**在用户手势里恢复，冷加载时没有手势可用）。
   */
  async #resume(ctx: AudioContext): Promise<boolean> {
    if (isRunning(ctx)) return true;
    try {
      await ctx.resume();
    } catch {
      // 下面的判断统一处理
    }
    if (isRunning(ctx)) return true;
    this.#armUnlock();
    return false;
  }

  #armUnlock(): void {
    if (typeof window === 'undefined' || this.#disposeUnlock !== null) return;
    const unlock = (): void => {
      this.#disposeUnlock?.();
      this.#disposeUnlock = null;
      void this.#syncMusic();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.#disposeUnlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }

  #load(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    const cached = this.#buffers.get(url);
    if (cached !== undefined) return cached;
    const pending = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await ctx.decodeAudioData(await response.arrayBuffer());
      } catch {
        return null;
      }
    })().then((buffer) => {
      // 失败不进缓存：网络抖一下不该让这个音效整场哑掉
      if (buffer === null) this.#buffers.delete(url);
      return buffer;
    });
    this.#buffers.set(url, pending);
    return pending;
  }

  async #syncMusic(): Promise<void> {
    const token = (this.#musicToken += 1);
    if (!this.#musicWanted) {
      this.#stopMusic(MUSIC_FADE_OUT);
      return;
    }
    const ctx = this.#ensureContext();
    if (ctx === null) return;
    if (!(await this.#resume(ctx))) return;
    if (token !== this.#musicToken) return;
    if (this.#music !== null) return;
    const buffer = await this.#load(ctx, MUSIC_URL);
    if (token !== this.#musicToken || !this.#musicWanted || this.#music !== null) return;
    if (buffer === null) {
      // 音乐文件取不到：不再重复尝试，也别把音效一起拖住
      this.#musicWanted = false;
      return;
    }
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    // 淡入到**当前音量**（不是固定 1）：冷加载时音量可能已经是 60，直接满增益起播会「先炸一下再落回来」
    const target = volumeGain(this.music);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(target, now + MUSIC_FADE_IN);
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.#music = { source, gain };
  }

  #stopMusic(fade: number): void {
    const playing = this.#music;
    if (playing === null) return;
    this.#music = null;
    const ctx = this.#context;
    if (ctx === null || fade <= 0) {
      this.#cut(playing);
      return;
    }
    const now = ctx.currentTime;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + fade);
    try {
      playing.source.stop(now + fade + 0.05);
    } catch {
      this.#cut(playing);
    }
  }

  #cut(playing: { source: AudioBufferSourceNode; gain: GainNode }): void {
    try {
      playing.source.stop();
    } catch {
      // 已经停过
    }
    playing.source.disconnect();
    playing.gain.disconnect();
  }
}

function hidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/**
 * 单独一个函数而不是原地写 `ctx.state === 'running'`：`#resume` 里第一句就是这个判断，
 * TypeScript 会把 `ctx.state` 收窄掉 `'running'`，等到 `await` 之后再判一次就会报
 * 「两个类型没有重叠」（它不认为 await 会改变属性）。收在函数里就没有这层收窄。
 */
function isRunning(ctx: AudioContext): boolean {
  return ctx.state === 'running';
}
