/**
 * 悬浮窗的**本机**持久化：拖动位置、收起态、音量、播放模式、队列快照。
 *
 * 照 `src/lib/story/draft.ts` 立的三条规矩：
 * - **模块顶层不碰 `localStorage`**（SSR 时不存在），一律走 `defaultStorage()` 的 try/catch；
 * - **坏数据不许炸页面**：解析失败当没存过，读它的组件继续用默认值；
 * - **写失败也要说出来**（配额满 / 隐私模式），否则用户以为存下来了。
 *
 * 这里存的全是「界面习惯」，与**身份**、牌局、服务器都无关 —— 换台电脑就该重来一遍。
 */
import type { MusicView, PlayMode } from './types.ts';
import { restoreQueue, snapshotOf, type Queue } from './queue.ts';
import { clamp } from './format.ts';

/** 四个独立的键：坏一个不影响其余（比一个大 JSON 更耐脏） */
export const VIEW_KEY = 'sixty.music.view.v1';
export const QUEUE_KEY = 'sixty.music.queue.v1';
/** 队列快照最多存这么多首 —— 存档不该无限长 */
export const QUEUE_LIMIT = 200;

/** 只用到这三个方法，测试可以塞一个内存桩进来 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 默认位置：右下角、让开操作条与手牌（`y` 是从底边往上数的偏移） */
export const DEFAULT_VIEW: MusicView = { x: 16, y: 96, collapsed: true, volume: 60, mode: 'list' };

export function storageOf(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 隐私模式或被策略禁用时，访问 localStorage 会直接抛错
    return null;
  }
}

/**
 * 这个宿主持久化吗？——用来决定「写失败要不要提示」。
 *
 * 没有存储（SSR、隐私模式）时**不提示**：那不是失败，而是本来就不打算持久化
 * （第一次打开、刷新即忘）。只有「有存储却写不进去」才值得说一句。
 */
export function writeAllowed(storage: StorageLike | null): boolean {
  return storage !== null;
}

/** 读一份 JSON：没有 / 坏了 / 不是对象，一律回 null（调用方给默认值） */
export function readJson(storage: StorageLike | null, key: string): unknown {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === '') return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** 写一份 JSON：返回是否写成功（失败时界面说一句，不静默） */
export function writeJson(storage: StorageLike | null, key: string, value: unknown): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isPlayMode(value: unknown): value is PlayMode {
  return value === 'list' || value === 'one' || value === 'shuffle';
}

/** 读视野设置：逐字段校验，坏字段单独回默认值（不整份丢掉） */
export function loadView(storage: StorageLike | null): MusicView {
  const raw = readJson(storage, VIEW_KEY);
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_VIEW };
  const value = raw as Partial<MusicView>;
  return {
    x: typeof value.x === 'number' ? Math.round(value.x) : DEFAULT_VIEW.x,
    y: typeof value.y === 'number' ? Math.round(value.y) : DEFAULT_VIEW.y,
    collapsed: typeof value.collapsed === 'boolean' ? value.collapsed : DEFAULT_VIEW.collapsed,
    volume: typeof value.volume === 'number' ? clamp(Math.round(value.volume), 0, 100) : DEFAULT_VIEW.volume,
    mode: isPlayMode(value.mode) ? value.mode : DEFAULT_VIEW.mode
  };
}

export function saveView(storage: StorageLike | null, view: MusicView): boolean {
  return writeJson(storage, VIEW_KEY, view);
}

/** 读队列快照；`mode` 由视野设置给（队列本身不存播放模式，避免两处真相） */
export function loadQueue(storage: StorageLike | null, mode: PlayMode): Queue {
  return restoreQueue(readJson(storage, QUEUE_KEY), mode);
}

export function saveQueue(storage: StorageLike | null, queue: Queue): boolean {
  return writeJson(storage, QUEUE_KEY, snapshotOf(queue, QUEUE_LIMIT));
}

/** 清空存档（界面上的「清空队列」会用到；失败也不抛） */
export function dropSaved(storage: StorageLike | null, key: string): void {
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    // 隐私模式下 removeItem 也可能抛；存档清不掉不值得打断听歌
  }
}
