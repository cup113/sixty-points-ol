/**
 * 播放队列：**纯函数**（不可变、无 IO、随机由调用方给种子）。
 *
 * 为什么连随机都要给种子：随机顺序一旦不能复现，「上一首」就说不清是哪一首，
 * 也没法在 `node:test` 里断言。所以 `shuffleOrder` 自带一个线性同余发生器，
 * 调用方传种子（浏览器里用 `Date.now()`），同一份种子永远同一份顺序。
 *
 * 队列的形状只有几个字段（`tracks` 插入序 / `index` 当前 / `mode` 播放模式 / `shuffle` 洗牌排列），
 * 界面只读它、只经这几个函数改它。
 */
import type { PlayMode, QueueSnapshot, Track } from './types.ts';

export interface Queue {
  /** 插入序，永远不变（界面「队列」页照这个顺序列） */
  readonly tracks: readonly Track[];
  /** 当前曲目在 `tracks` 里的下标；-1 = 空队列 */
  readonly index: number;
  readonly mode: PlayMode;
  /** 随机排列：`tracks` 的下标序列；`index` 永远排在 `cursor` 位 */
  readonly shuffle: readonly number[];
  /** `shuffle` 里的游标（只有 `mode === 'shuffle'` 时有意义） */
  readonly cursor: number;
}

export const EMPTY_QUEUE: Queue = { tracks: [], index: -1, mode: 'list', shuffle: [], cursor: 0 };

/**
 * 线性同余洗牌（Fisher–Yates）。
 *
 * 不用 `Math.random`：种子由调用方给，顺序就可复现，测试与「上一首」才有确定答案。
 * 数值用 `>>> 0` 夹在 32 位内 —— 不这么做，几次乘法之后就会溢出成浮点，`%` 的结果不再均匀。
 */
export function shuffleOrder(length: number, seed: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  let state = (Math.floor(seed) || 1) >>> 0;
  for (let i = length - 1; i > 0; i -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const j = state % (i + 1);
    const left = order[i]!;
    order[i] = order[j]!;
    order[j] = left;
  }
  return order;
}

/** 把当前曲目挪到随机排列的最前面，其余保持洗好的相对顺序 */
function shuffleAround(tracks: readonly Track[], index: number, seed: number): number[] {
  const rest = shuffleOrder(tracks.length, seed).filter((position) => position !== index);
  return index >= 0 ? [index, ...rest] : rest;
}

/** 换播放模式：进入随机时现洗一副（种子由调用方给），离开随机时丢掉排列 */
export function withMode(queue: Queue, mode: PlayMode, seed: number): Queue {
  if (mode === queue.mode) return queue;
  if (mode !== 'shuffle') return { ...queue, mode, shuffle: [], cursor: 0 };
  return { ...queue, mode, shuffle: shuffleAround(queue.tracks, queue.index, seed), cursor: 0 };
}

/** 切到 `tracks` 里的第 `index` 首 */
export function selectAt(queue: Queue, index: number): Queue {
  if (index < 0 || index >= queue.tracks.length) return queue;
  if (queue.mode === 'shuffle') {
    const rest = queue.shuffle.filter((position) => position !== index);
    return { ...queue, index, shuffle: [index, ...rest], cursor: 0 };
  }
  return { ...queue, index };
}

/**
 * 入队并播放：曲目已在队列里就**只切过去**（不重复插入、不重排）。
 *
 * 这是「搜索结果点第二次」的正确行为 —— 用户要的是「放这首」，
 * 而不是把同一首歌在队列里堆两遍。
 */
export function enqueue(queue: Queue, track: Track, seed: number): Queue {
  const existing = queue.tracks.findIndex((item) => item.id === track.id);
  if (existing >= 0) return selectAt(queue, existing);
  const tracks = [...queue.tracks, track];
  const at = tracks.length - 1;
  const appended: Queue = {
    ...queue,
    tracks,
    index: at,
    shuffle: queue.mode === 'shuffle' ? shuffleAround(tracks, at, seed) : [],
    cursor: 0
  };
  return selectAt(appended, at);
}

/**
 * 整批入队（「播放全部」/ 点歌单）：
 * 已经在队列里的跳过；队列原本是空的就播这批的第一首，否则不动当前曲目（别把正在听的那首掐掉）。
 */
export function enqueueAll(queue: Queue, tracks: readonly Track[], seed: number): Queue {
  const known = new Set(queue.tracks.map((track) => track.id));
  const fresh = tracks.filter((track) => !known.has(track.id));
  if (fresh.length === 0) return queue;
  const merged = [...queue.tracks, ...fresh];
  const picked = queue.index >= 0 ? queue.index : queue.tracks.length;
  const grown: Queue = {
    ...queue,
    tracks: merged,
    index: picked,
    shuffle: queue.mode === 'shuffle' ? shuffleAround(merged, picked, seed) : [],
    cursor: 0
  };
  return selectAt(grown, picked);
}

/**
 * 删掉一首。
 *
 * 删的是**当前**曲目时接上原来排在它后面的那一首（末尾则退到前一首）；
 * 删的是别的曲目时当前曲目不变，只是下标整体左移 —— 这两种情况的移植都容易差一。
 */
export function removeAt(queue: Queue, index: number): Queue {
  if (index < 0 || index >= queue.tracks.length) return queue;
  const tracks = queue.tracks.filter((_, position) => position !== index);
  if (tracks.length === 0) return { ...EMPTY_QUEUE, mode: queue.mode };
  const picked =
    queue.index === index
      ? Math.min(index, tracks.length - 1) // 当前被删：原下标位置正好是「后一首」
      : queue.index > index
        ? queue.index - 1 // 前面少了一个，当前左移
        : queue.index;
  return selectAt({ ...queue, tracks, index: picked }, picked);
}

/** 清空队列（当前曲目一起停掉 —— 由调用方负责 `audio.pause()`） */
export function clearQueue(queue: Queue): Queue {
  return { ...EMPTY_QUEUE, mode: queue.mode };
}

/** 当前的播放顺序（随机模式下是洗牌排列，其余是插入序） */
export function orderOf(queue: Queue): readonly number[] {
  if (queue.mode !== 'shuffle' || queue.shuffle.length !== queue.tracks.length) {
    return queue.tracks.map((_, position) => position);
  }
  return queue.shuffle;
}

/**
 * 下一首的下标：`null` = 到头了。
 *
 * - `list`：最后一首之后停下（不绕回 —— 绕回是随机与单曲的事）；
 * - `one`：自然播完重播同一首，但**手动点下一首要真的换歌**（两种意图不同）；
 * - `shuffle`：走洗牌排列并绕圈。
 */
export function nextIndex(queue: Queue, force = false): number | null {
  if (queue.index < 0) return null;
  if (queue.mode === 'one' && !force) return queue.index;
  const order = orderOf(queue);
  const at = order.indexOf(queue.index);
  if (at < 0) return null;
  if (at + 1 < order.length) return order[at + 1]!;
  if (queue.mode === 'shuffle') return order[0] ?? null;
  return null;
}

/** 上一首的下标：`force` 同样给「手动点上一首」用（单曲循环下让人真的回到上一首） */
export function prevIndex(queue: Queue, force = false): number | null {
  if (queue.index < 0) return null;
  if (queue.mode === 'one' && !force) return queue.index;
  const order = orderOf(queue);
  const at = order.indexOf(queue.index);
  if (at < 0) return null;
  if (at > 0) return order[at - 1]!;
  if (queue.mode === 'shuffle') return order[order.length - 1] ?? null;
  return null;
}

/** 落盘用的一份快照（从**最前面**截 `limit` 首，避免存档无限长） */
export function snapshotOf(queue: Queue, limit: number): QueueSnapshot {
  const tracks = queue.tracks.slice(0, Math.max(0, limit));
  if (tracks.length === 0) return { tracks: [], index: 0 };
  const index = queue.index >= 0 && queue.index < tracks.length ? queue.index : 0;
  return { tracks, index };
}

/** 恢复队列：存档坏了就当空队列（缺字段、越界、不是数组都不抛错） */
export function restoreQueue(value: unknown, mode: PlayMode): Queue {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_QUEUE, mode };
  const raw = value as { tracks?: unknown; index?: unknown };
  if (!Array.isArray(raw.tracks)) return { ...EMPTY_QUEUE, mode };
  const tracks = raw.tracks.filter(isTrackLike);
  if (tracks.length === 0) return { ...EMPTY_QUEUE, mode };
  const wanted = typeof raw.index === 'number' ? Math.floor(raw.index) : 0;
  const index = Math.min(Math.max(0, wanted), tracks.length - 1);
  return { tracks, index, mode, shuffle: [], cursor: 0 };
}

/** 存档里的一条是不是能用的曲目（只查界面真会读的字段，缺一不可） */
function isTrackLike(value: unknown): value is Track {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as Partial<Track>;
  return (
    typeof track.id === 'number' && Number.isFinite(track.id) && typeof track.name === 'string' && track.name !== ''
  );
}
