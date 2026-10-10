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

/**
 * 出牌堆里每张牌**露出的比例**（与手牌扇面同一套纪律：只收不放）。
 *
 * 0.6 = 相邻两张牌左缘相距 0.6 × 牌宽、叠掉 40%，两张牌的角标（点数 + 花色）都完整可读。
 * 为什么不是「牌宽 + 空隙」那种摊开排法：同门的多张牌（顺子/连对）是**一个**组合，
 * 摊开会被读成 N 张各自独立的牌；而己方出牌点跨整行宽，摊开时 5 张就横贯大半行 ——
 * 宽度够用不等于该铺开。放不下时再由 `computeClusterStep` 一路收紧（只收，不放）。
 */
export const CLUSTER_STRIP_RATIO = 0.6;

/**
 * 一簇**出牌堆**在给定宽度预算里的步距（相邻两张牌左边缘的间距）。
 *
 * 与手牌扇面共用同一套宽度口径（`rowWidth` / `minStrip`），但契约不同：手牌放不下时**切行**，
 * 而出牌堆不切行（一墩就是一排），所以它一路收到放得下为止 —— 真到了角标可读下限还放不下，
 * 就允许再挤下去。取舍是明确的：**两簇相撞比一簇略挤更糟**（相撞时「谁出了什么」
 * 直接读不出来，而略挤只是角标变小）。
 *
 * **上限是紧凑步距（0.6 × 牌宽），不是「牌宽 + 空隙」**：早先这里返回 `牌宽 + CLUSTER_GAP`
 * （放得下就摊开），实测下来是错的 —— 己方出牌点跨整行，5 张顺子于是摊满大半行（读起来像
 * 5 张互不相干的牌），而对方出牌点只有 38% 宽。现在只有两个去向：**放得下 = 紧凑**，
 * **放不下 = 收得更紧**。
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
  const natural = cardWidth * CLUSTER_STRIP_RATIO;
  if (fits(count, cardWidth, natural, budget)) return natural;
  return Math.max(0, (budget - cardWidth) / (count - 1));
}

/* ---------- 出牌点的宽度预算 ---------- */

/**
 * 左右两个**出牌点**（两翼）的宽度预算：**按这一侧要放几张牌给**（内容槽宽度的百分比）。
 *
 * 为什么不再写死 38%（那是上一版）：宽度预算是这一簇牌唯一的可支配资源，而「够不够」
 * 只由张数决定 —— 一张牌要一张牌宽，五张牌要 `牌宽 × (0.6 × 4 + 1)`：
 *
 *     needed(count) = 牌宽 × (CLUSTER_STRIP_RATIO × (count − 1) + 1)
 *
 * 这条式子对张数是**线性**的，所以这里也按线性给：每多一张牌多 `SPOT_WIDTH_STEP` 个百分点，
 * 一颗牌 30%、五张 38%、八张及以上给到上限 44%。
 *
 * - **五张 = 38% 是量出来的锚点**：5 张顺子那一档实测在 38% 的盒子里刚好维持紧凑叠排
 *   （`pnpm shot` 的场景 11 / 12），所以这条曲线**穿过**它，而不是另起一个数；
 * - **少牌时收窄**：牌少时盒子窄一点，这一簇在盒内居中，于是整体更靠中间
 *   （一张牌时盒子中心在 33%，38% 时是 29%）—— 少牌的空桌面不再把两家推到两边；
 * - **上限 44% 是结构性的**：两翼内侧边缘钉在 48% / 52%（中间留 4% 空带），
 *   于是 `2 × inset + 2 × width + 4 = 100`（见 `spotBox`）。44% 时两侧各留 4% 外缘，
 *   再宽就会顶到毡面内缘与右边缘那条活页签条。
 *
 * 两侧**共用同一个宽度**（取两家张数的较大者）：宽度不等就会让两翼的中点偏出中线
 * （`shot-auction.ts` 的 ⑨ 量的正是这个），而跟牌时两家张数本来就常常不等。
 */
export const SPOT_WIDTH_MIN = 30;
export const SPOT_WIDTH_MAX = 44;
/** 每多一张牌多给几个百分点（1 张 30 ⇒ 5 张 38 ⇒ 8 张 44） */
const SPOT_WIDTH_STEP = 2;
/** 两翼之间留的空带（%）：它保证两簇的**内侧边缘**不接触 */
const SPOT_CENTER_GAP = 4;
/** 两翼内侧边缘的位置（左 48% / 右 52%）—— 盒子的内侧边不动，宽度只向外长 */
const SPOT_INNER_EDGE = (100 - SPOT_CENTER_GAP) / 2;

export interface SpotBox {
  /** 这一个出牌点的宽度（内容槽宽度的百分比） */
  readonly widthPct: number;
  /** 它离那一侧外缘的内缩（百分比）；`宽度只向外长`，所以内侧边缘恒在 48% / 52% */
  readonly insetPct: number;
}

export function spotWidthPct(count: number): number {
  const n = Math.max(1, Math.floor(count));
  return Math.min(SPOT_WIDTH_MAX, SPOT_WIDTH_MIN + SPOT_WIDTH_STEP * (n - 1));
}

/**
 * 一侧出牌点的宽度与外缩：`insetPct + widthPct = 48`（内侧边缘固定）。
 * 于是 `2 × inset + 2 × width + 4 = 100` 对任何张数都成立 —— 这就是两翼「互不相交」的
 * 结构性保证（`TrickArea` 早先写死 `10 + 38 + 4 + 38 + 10 = 100`，同一套加法，只是宽度可变了）。
 */
export function spotBox(count: number): SpotBox {
  const widthPct = spotWidthPct(count);
  return { widthPct, insetPct: SPOT_INNER_EDGE - widthPct };
}
