/**
 * 与「别的声音」打交道的一层：**只发事件，不 import 任何东西**。
 *
 * 背景：牌桌页还有另一条音频通道（PR #7 的 `SoundControl`：本地 CC0 背景音乐循环）。
 * 两条通道同时出声会互相盖住，而**全解耦**的要求又不允许我们 import 它。
 * 所以用 DOM 事件当接口：本模块播/停时在 `document` 上派发一个 CustomEvent，
 * 谁想联动谁自己监听 —— 对方不在（PR #7 没合并）也什么都不影响。
 *
 * 事件名与 detail 形状在这里定死，是唯一的契约：
 *   `sixty:music` detail `{ playing: boolean }`
 */
export const MUSIC_EVENT = 'sixty:music';

export function announceMusic(playing: boolean): void {
  if (typeof document === 'undefined') return;
  try {
    document.dispatchEvent(new CustomEvent(MUSIC_EVENT, { detail: { playing } }));
  } catch {
    // 极端环境（无 CustomEvent）下静默：这只是个「顺手联动」的通道，不该影响播放
  }
}
