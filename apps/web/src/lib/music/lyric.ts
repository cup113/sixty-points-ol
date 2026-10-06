/**
 * 歌词解析：LRC 文本 → 带时间戳的行（原歌词与翻译各一份，再按时间戳合并）。
 *
 * 上游 `/lyric` 回的是 `{ lrc: { lyric }, tlyric: { lyric } }` 两份**同格式**的 LRC 文本，
 * 所以翻译这一路不需要第二套解析器 —— 同一段代码跑两遍再按时间戳对齐。
 *
 * 上游真实数据里有三种脏东西，解析器必须吃掉而不是抛错：
 *   - 一行挂多个时间戳（`[00:10.00][01:20.00]副歌`）—— 要展开成两行；
 *   - `[ti:歌名]`、`[offset:0]` 这类元信息行 —— 不是歌词，丢掉；
 *   - 空行与纯空白行 —— 丢掉（否则界面上会有一段空档）。
 */
import type { LyricLine } from './types.ts';

/** 一行里的**每个** `[mm:ss]` / `[mm:ss.xx]` / `[mm:ss.xxx]`；`g` 标志靠 `matchAll` 每次新建 */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** 解析一段 LRC 文本 → 按时间升序的行（`translated` 留给合并那一步填） */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const sourceLine of raw.split(/\r?\n/)) {
    const tags = [...sourceLine.matchAll(TIME_TAG)];
    if (tags.length === 0) continue; // 元信息行 / 空行
    const text = sourceLine.replace(TIME_TAG, '').trim();
    if (text === '') continue;
    for (const tag of tags) {
      const minutes = Number(tag[1]);
      const seconds = Number(tag[2]);
      const fractionRaw = tag[3] ?? '';
      // `.5` 是 500ms、`.50` 是 500ms、`.500` 才是 500ms —— 按位数补零，别看小数点的字面值
      const fraction = fractionRaw === '' ? 0 : Number(fractionRaw.padEnd(3, '0'));
      lines.push({
        timeMs: minutes * 60_000 + seconds * 1000 + fraction,
        text,
        translated: null
      });
    }
  }
  // 上游偶尔乱序（多时间戳展开后更是如此）；同时间戳时按写入顺序稳定排
  return lines
    .map((line, order) => ({ line, order }))
    .sort((a, b) => a.line.timeMs - b.line.timeMs || a.order - b.order)
    .map((item) => item.line);
}

/**
 * 把翻译按**时间戳**贴到原歌词上。
 *
 * 不用下标对齐：两份 LRC 的行数经常不等（纯音乐行只有一份），下标一错整篇翻译就串行。
 * 时间戳完全相等才贴 —— 网易云的翻译行本来就是按原时间戳生成的。
 * 翻译里多出来的时间戳（原歌词没有）不补行：那多半是另一份文本，宁缺勿错。
 */
export function mergeTranslation(
  original: readonly LyricLine[],
  translation: readonly LyricLine[]
): LyricLine[] {
  if (translation.length === 0) return original.map((line) => ({ ...line, translated: null }));
  const byTime = new Map<number, string>();
  for (const line of translation) byTime.set(line.timeMs, line.text);
  return original.map((line) => ({ ...line, translated: byTime.get(line.timeMs) ?? null }));
}

/** 一键：两块 LRC 文本 → 合并后的行 */
export function lyricsFrom(raw: string, translatedRaw: string): LyricLine[] {
  return mergeTranslation(parseLrc(raw), parseLrc(translatedRaw));
}

/**
 * 当前该高亮哪一行：`timeMs <= 当前播放位置` 的**最后**一行。
 *
 * 返回 `-1` 表示还没到第一句（前奏）。二分查找，把每帧都跑的这步压成 log n。
 */
export function activeLineIndex(lines: readonly LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid]!.timeMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
