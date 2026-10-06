/**
 * 播放决策的**纯逻辑**：队列状态 + 一次事件 → 下一步做什么。
 *
 * 为什么不写在 `player.svelte.ts` 里：那个文件用的是 Svelte 的 rune（`$state`），
 * 而 `node:test` 直接 import 时 `$state` 不存在（实测 `ReferenceError: $state is not defined`），
 * 于是「跑得起来的那部分」必须在纯 `.ts` 里。播放器只做 IO（audio 元素、计时、存储），
 * 决策全在这里 —— 也正好是回归最容易出错的那些地方（末尾、越界、单曲循环、失败跳过）。
 */
import { nextIndex, orderOf, prevIndex, type Queue } from './queue.ts';
import type { LyricLine, MusicError, PlayMode, Track } from './types.ts';
import { activeLineIndex } from './lyric.ts';
import { qualityTierOf } from './format.ts';

/** 一次「该播下一首了」的判定结果 */
export type Advance =
  | { readonly kind: 'same' } // 单曲循环：自然播完重播同一首
  | { readonly kind: 'move'; readonly index: number }
  | { readonly kind: 'stop'; readonly reason: 'end' | 'empty' };

/** 自然播完（`ended`）之后去哪：末尾停在原地并停下，不绕回（绕回是随机与单曲的事） */
export function advanceOnEnd(queue: Queue): Advance {
  if (queue.index < 0 || queue.tracks.length === 0) return { kind: 'stop', reason: 'empty' };
  const next = nextIndex(queue, false);
  if (next === null) return { kind: 'stop', reason: 'end' };
  if (next === queue.index) return { kind: 'same' };
  return { kind: 'move', index: next };
}

/** 手动点「下一首」：单曲循环下也真的换歌（`force`） */
export function advanceOnNext(queue: Queue): Advance {
  if (queue.index < 0 || queue.tracks.length === 0) return { kind: 'stop', reason: 'empty' };
  const next = nextIndex(queue, true);
  if (next === null) return { kind: 'stop', reason: 'end' };
  if (next === queue.index) return { kind: 'same' };
  return { kind: 'move', index: next };
}

/** 手动点「上一首」 */
export function advanceOnPrev(queue: Queue): Advance {
  if (queue.index < 0 || queue.tracks.length === 0) return { kind: 'stop', reason: 'empty' };
  const prev = prevIndex(queue, true);
  if (prev === null) return { kind: 'stop', reason: 'end' };
  if (prev === queue.index) return { kind: 'same' };
  return { kind: 'move', index: prev };
}

/**
 * 播不出来（没版权 / VIP / 取 URL 失败）之后去哪。
 *
 * `tried` 是本次连跳里已经试过的曲目 id —— 全是无版权时不能无限跳，
 * 试完一轮就停下并如实报错（否则界面会卡在一个疯狂跳歌的死循环里）。
 */
export function advanceOnFailure(queue: Queue, tried: ReadonlySet<number>): Advance {
  if (queue.index < 0 || queue.tracks.length === 0) return { kind: 'stop', reason: 'empty' };
  const order = orderOf(queue);
  const at = order.indexOf(queue.index);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(at + step) % order.length];
    if (candidate === undefined) break;
    const track = queue.tracks[candidate];
    if (track === undefined || tried.has(track.id)) continue;
    return { kind: 'move', index: candidate };
  }
  return { kind: 'stop', reason: 'end' };
}

/** 当前播放顺序里的位置（`3 / 12` 那种计数用；不在队列里时返回 0） */
export function positionInOrder(queue: Queue): number {
  return orderOf(queue).indexOf(queue.index) + 1;
}

/** 播放器要发给 `/api/music/songUrl` 的音质档位：匿名一律 standard */
export function playbackLevel(vipType: number, preferred: string): string {
  return qualityTierOf(vipType, preferred);
}

/** 一行歌词的展示键：时间戳在 LRC 里可能重复（同句多时间戳），所以带上文本 */
export function lyricKey(line: LyricLine): string {
  return `${line.timeMs}|${line.text}`;
}

/** 高亮行号：没到第一句时 -1（界面据此不滚动到任何一行） */
export function highlightLine(lines: readonly LyricLine[], positionMs: number): number {
  return activeLineIndex(lines, positionMs);
}

/** 把毫秒位置换算成进度条的百分比（0~1000 的整数，避免每帧写一堆小数） */
export function progressPermille(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
  return Math.round(ratio * 1000);
}

/** 反解：进度条百分比 → 毫秒 */
export function seekFromPermille(permille: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, permille / 1000));
  return Math.round(ratio * durationMs);
}

/** 播放模式的中文名与图标字形（一处定义，按钮与无障碍标签共用） */
export const MODE_LABEL: Readonly<Record<PlayMode, string>> = {
  list: '顺序播放',
  one: '单曲循环',
  shuffle: '随机播放'
};

/**
 * 把「一个歌单」变成队列里的一首「曲目」——点它 = 把整张歌单铺进队列。
 *
 * 为什么复用 `Track` 而不新开一种队列项：队列只有一种东西要简单得多（上一首/下一首/
 * 随机/shuffle 全都不用分支）。代价是这里要把歌单伪装成一首歌，于是有两条纪律：
 * - `durationMs` 用**曲目数**（0:12 表示 12 首），界面上的时长栏因此不是时间而是数量；
 * - `playlists` 里记下这个 id，播放前先查它 —— 网易云的数字 id 全局唯一，这个查表比猜更可靠。
 */
export function fromPlaylist(item: {
  id: number;
  name: string;
  cover: string | null;
  trackCount: number;
  creator: string | null;
}): Track {
  return {
    id: item.id,
    name: item.name,
    artists: item.creator === null ? '歌单' : `歌单 · ${item.creator}`,
    album: `${item.trackCount} 首`,
    cover: item.cover,
    // 伪装出来的时长：显示成「0:12」，靠 album 里的「12 首」说清楚它不是时间
    durationMs: Math.max(0, item.trackCount) * 1000,
    vipOnly: false,
    trialOnly: false,
    unplayable: false
  };
}

/** 循环切换顺序：顺序 → 单曲 → 随机 → 顺序 */
export function nextMode(mode: PlayMode): PlayMode {
  if (mode === 'list') return 'one';
  if (mode === 'one') return 'shuffle';
  return 'list';
}

/**
 * 音乐错误的显示文案。
 *
 * 只读 `message`：它是人类可读的那一句（其余字段是给日志与判重试用的）。
 */
export function errorText(error: MusicError): string {
  return error.message;
}
