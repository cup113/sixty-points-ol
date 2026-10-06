/**
 * 音乐悬浮窗的纯工具：时间、序号、位置、文案。
 *
 * 全部无 IO、无随机、无隐藏状态 —— 所以能在 `node:test` 里逐条断言，
 * 不需要浏览器（播放与解码在 `player.svelte.ts` 里，那部分只能人工试听）。
 */

/** 毫秒 → `m:ss`（负数与 NaN 一律当 0：上游偶尔给 0 或很大值，别让界面出现 `NaN:NaN`） */
export function formatTime(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.floor(safe / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 数值夹取（音量、下标都用它；`min > max` 时给 min，避免出现反向区间） */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/** 浮窗尺寸与视口：拖动与恢复位置都走这一条 */
export interface Rect {
  readonly width: number;
  readonly height: number;
}

/**
 * 把浮窗位置夹回视口内 —— 保证**右下角边缘仍然可见**（留 `MARGIN` 像素手感），
 * 而不是要求整窗都在视口里：手机上展开的窗口本来就比屏幕高。
 *
 * 屏幕旋转、F5 前拖到屏幕外、插拔外接显示器都会让存档位置失效，
 * 所以每次拖动、每次 resize 都过一遍这里，界面上永远不会出现「拖不回来」的窗口。
 */
export const MARGIN = 8;

export function clampPosition(
  x: number,
  y: number,
  size: Rect,
  viewport: Rect
): { x: number; y: number } {
  // 视口比窗口还小时，允许负坐标（左上角贴边），只保证不跑到右边/下边之外
  const maxX = Math.max(MARGIN - size.width, viewport.width - MARGIN);
  const minX = Math.min(MARGIN, maxX);
  const maxY = Math.max(MARGIN - size.height, viewport.height - MARGIN);
  const minY = Math.min(MARGIN, maxY);
  return {
    x: clamp(Math.round(x), minX, maxX),
    y: clamp(Math.round(y), minY, maxY)
  };
}

/** 歌手串：上游给的是数组，空数组时用「未知歌手」 */
export function artistsText(names: readonly string[]): string {
  const filled = names.filter((name) => name.trim() !== '');
  return filled.length === 0 ? '未知歌手' : filled.join(' / ');
}

/**
 * 音质档位：登录用户按会员等级给，匿名一律 `standard`。
 *
 * 依据：`standard` 匿名可播；`lossless` / `hires` 等要会员，给匿名用户配上去只会
 * 每次都拿到 `url: null`（听起来像「这歌没版权」）。所以档位**由登录态推出**，
 * 不写死在配置里等着用户配错。
 */
export function qualityTierOf(vipType: number, preferred: string): string {
  if (vipType <= 0) return 'standard';
  // 黑胶 VIP=11、音乐包=10 之类；有会员就允许配置里更高的档位
  return preferred === '' ? 'exhigh' : preferred;
}

/** 时长文案：`3:24` 或（上游没给时长时）空串 —— 界面据此不画那一段 */
export function durationText(track: { durationMs: number }): string {
  return track.durationMs > 0 ? formatTime(track.durationMs) : '';
}

/** 界面上对一首歌的注释（按严重程度排序，只出一条） */
export function trackBadge(track: {
  unplayable: boolean;
  vipOnly: boolean;
  trialOnly: boolean;
}): '无播放权限' | 'VIP' | '试听' | null {
  if (track.unplayable) return '无播放权限';
  if (track.trialOnly) return '试听';
  if (track.vipOnly) return 'VIP';
  return null;
}
