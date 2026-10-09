/**
 * 手牌扇形布局：在保持设计稿「紧凑叠排」观感的前提下，
 * 保证任何机型上都不被裁切，且每张牌露出的宽度不低于角标（点数 + 花色）可读下限。
 *
 * 纯函数、无 DOM 依赖，便于单测；组件只负责测量宽度并把结果交给 CSS。
 */

export interface FanLayout {
  /** 相邻两张牌左边缘的间距（≤ cardWidth；负边距 = step - cardWidth） */
  readonly step: number;
  /** 每行张数（单行时等于总张数） */
  readonly perRow: number;
  /** 行数（单行放不下可读下限时切多行） */
  readonly rows: number;
  /** 是否需要写入内联 --step（未测量 / 单张时为 false，交给 CSS 回退值） */
  readonly override: boolean;
}

/** 设计稿的重叠比例：每张露出 40% 牌宽（等价于 margin-left: -0.6 × 牌宽） */
export const BASE_STRIP_RATIO = 0.4;
/** 窄到无法维持紧凑扇形时，允许收到的最小露出比例 / 绝对值（角标可读下限） */
const MIN_STRIP_RATIO = 0.3;
const MIN_STRIP_FLOOR = 14;

export function minStrip(cardWidth: number): number {
  return Math.min(cardWidth, Math.max(MIN_STRIP_FLOOR, cardWidth * MIN_STRIP_RATIO));
}

/** n 张牌排成一行所需的总宽度 */
export function rowWidth(n: number, cardWidth: number, step: number): number {
  return n <= 0 ? 0 : cardWidth + (n - 1) * step;
}

function fits(n: number, cardWidth: number, step: number, containerWidth: number): boolean {
  return rowWidth(n, cardWidth, step) <= containerWidth;
}

export function computeFanLayout(input: {
  count: number;
  cardWidth: number;
  containerWidth: number;
}): FanLayout {
  const count = Math.max(0, Math.floor(input.count));
  const cardWidth = Math.max(0, input.cardWidth);
  const containerWidth = Math.max(0, input.containerWidth);

  // 未测量（SSR / 首帧）或只有一张：不写内联值，交给 CSS 默认回退
  if (count <= 1 || cardWidth <= 0 || containerWidth <= 0) {
    return { step: cardWidth, perRow: Math.max(count, 1), rows: 1, override: false };
  }

  const base = cardWidth * BASE_STRIP_RATIO;
  const strip = minStrip(cardWidth);

  // 1) 紧凑扇形放得下 → 维持设计稿观感
  if (fits(count, cardWidth, base, containerWidth)) {
    return { step: base, perRow: count, rows: 1, override: true };
  }

  // 2) 收到可读下限后单行放得下 → 单行：用满可用宽度，但不超过设计比例
  if (fits(count, cardWidth, strip, containerWidth)) {
    const available = (containerWidth - cardWidth) / (count - 1);
    return { step: Math.min(base, available), perRow: count, rows: 1, override: true };
  }

  // 3) 单行已无法保证角标可读 → 切多行，行内张数均分使各行长度接近
  let maxFit = 1;
  for (let n = count; n >= 1; n--) {
    if (fits(n, cardWidth, strip, containerWidth)) {
      maxFit = n;
      break;
    }
  }
  const rows = Math.ceil(count / maxFit);
  const perRow = Math.max(1, Math.ceil(count / rows));
  return { step: strip, perRow, rows, override: true };
}

/** 出牌堆里相邻两张牌之间的空隙（与 `.cluster` 的 `gap: 6px` 同源） */
export const CLUSTER_GAP = 6;

/**
 * 一簇**出牌堆**在给定宽度预算里的步距（相邻两张牌左边缘的间距）。
 *
 * 与手牌扇面共用同一套宽度口径（`rowWidth` / `minStrip`），但契约不同：手牌放不下时**切行**，
 * 而出牌堆不切行（一墩就是一排），所以它一路收到放得下为止 —— 真到了 `minStrip` 的可读下限
 * 还放不下，就允许再挤下去。取舍是明确的：**两簇相撞比一簇略挤更糟**（相撞时「谁出了什么」
 * 直接读不出来，而略挤只是角标变小）。
 *
 * 为什么不写成 CSS 的百分比边距或 `clamp()`：绝对定位盒里 `width: auto` 是 shrink-to-fit，
 * 百分比边距会以**内容宽度**为包含块，于是标题与徽标会脱开牌堆、各处算各处的。这里由组件
 * 量一次预算、把结果写成内联 `--step`，与手牌扇面同一套做法。
 */
export function computeClusterStep(input: {
  count: number;
  cardWidth: number;
  /** 这一个出牌点可用的宽度（固定宽度预算，见 `TrickArea`） */
  budget: number;
}): number {
  const count = Math.max(0, Math.floor(input.count));
  const cardWidth = Math.max(0, input.cardWidth);
  const budget = Math.max(0, input.budget);
  // 0/1 张、或还没测量：没有「相邻间距」可言，交给 `.cluster` 的默认 gap
  if (count <= 1 || cardWidth <= 0 || budget <= 0) return cardWidth;
  const natural = cardWidth + CLUSTER_GAP;
  if (fits(count, cardWidth, natural, budget)) return natural;
  return Math.max(0, (budget - cardWidth) / (count - 1));
}
