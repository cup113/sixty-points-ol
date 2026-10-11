/**
 * 新手引导的数据形状（ADR-0025）。
 *
 * 三层，边界很硬：
 * - **引导局数据**（`GuideDealData`）是**生成物**：真实牌局的烘焙事实 + 引导词，来自 `docs/guide/<slug>.json`，
 *   由 `scripts/build-guide.ts` 校验并生成 `guide/deals/<slug>.ts`。页面只读，不猜、不补。
 * - **课程**（`GuideCourse`）是手写的目录：章 → 步（简述 / 测验 / 引导局 / 复盘 / 结尾），
 *   引导局步只引用 slug，本身不含牌面。
 * - **牌面事实**一律存**牌键**（`H5` / `j1`），与引擎对象分开：生成物因此可 diff、可手查，
 *   渲染时用 `handFromKeys` 还原（键写错立刻抛错，而不是悄悄出一张不存在的牌）。
 */
import type { BidCall, DealSummary, Level, Seat } from '@sixty/engine';

/** 引导局里的一条动作：只可能是真实牌局记下来的那三种（发牌由 `dealWith` 构造，不是动作） */
export type GuideAction =
  | { readonly type: 'bid'; readonly seat: Seat; readonly call: BidCall }
  | { readonly type: 'bury'; readonly seat: Seat; readonly cards: readonly string[] }
  | { readonly type: 'play'; readonly seat: Seat; readonly cards: readonly string[] };

/** 教练栏的一条引导词：用户座位每个动作恰好一条 */
export interface GuideWord {
  /** 教练栏那句正文（说「为什么这么打」） */
  readonly text: string;
  /** 事实依据（可选）：几张主、外面还剩什么 —— 补写时对回引擎事实的那半句 */
  readonly why?: string;
}

/** 复盘屏的一段：整副的要点 + 逐墩要点 */
export interface GuideReview {
  readonly intro: string;
  /** 键 = 墩序号（0 起，与 `trickHistory` 同序） */
  readonly tricks?: Readonly<Record<string, string>>;
  readonly outro: string;
}

/** 引导局的来源：桌码 / 副号 / 日期。**不含真实用户名** —— 页面一律用 `aliases` 的代称 */
export interface GuideSource {
  readonly table: string;
  readonly dealNo: number;
  readonly date: string;
}

/** 一副引导局的全部事实（生成物的形状） */
export interface GuideDealData {
  /** 数据格式版本：与 `docs/guide/<slug>.json` 的 `version` 一致，`guide:check` 会核 */
  readonly version: 1;
  readonly slug: string;
  readonly title: string;
  /** 用户在这副里坐哪一边：庄家一个人，闲家两个人之一 */
  readonly role: 'declarer' | 'defender';
  readonly learnerSeat: Seat;
  /** 座位 → 代称；用户所在那一席写作「你」。三名固定，与方位无关 */
  readonly aliases: readonly [string, string, string];
  readonly source: GuideSource;
  readonly facts: {
    /** 发牌那一刻三家各 17 张 */
    readonly hands: readonly (readonly string[])[];
    /** 发牌留下的 3 张暗牌 */
    readonly originalKitty: readonly string[];
    readonly dealerSeat: Seat;
    /** 这一副**开打前**的三家级别（级牌点数取自庄家级别） */
    readonly levels: readonly Level[];
    readonly dealNo: number;
  };
  /** 真实牌局的动作序列，按序回放即得这副牌 */
  readonly actions: readonly GuideAction[];
  /** 引导词：键 = `actions` 下标；**用户座位的每个动作都必须有** */
  readonly guides: Readonly<Record<string, GuideWord>>;
  /** 对手动作的一句话解说（可选，键 = `actions` 下标） */
  readonly notes?: Readonly<Record<string, string>>;
  readonly review: GuideReview;
  /**
   * 结算存证：从真实那副抄下来的摘要。校验脚本把「现场重放的结算」与它逐项核对，
   * 于是引擎或结算规则将来变了会报红（ADR-0025 的「已发布的引导局不会变味」）。
   */
  readonly expect: DealSummary;
}

/** 概念简述屏要摆的挂件：每种都只渲染 `scenarios.ts` 里被引擎核对过的示例 */
export type ConceptWidget =
  | { readonly kind: 'point-values' }
  | { readonly kind: 'point-places' }
  | { readonly kind: 'trump-groups' }
  | { readonly kind: 'trump-ladder' }
  | { readonly kind: 'side-suit' }
  | { readonly kind: 'trump-run-cross' }
  | { readonly kind: 'bid-demo' }
  | { readonly kind: 'bury-demo' }
  | { readonly kind: 'multiplier' }
  | { readonly kind: 'lead-cases' }
  | { readonly kind: 'follow-answer' }
  | { readonly kind: 'ruff-contrast' }
  | { readonly kind: 'settle-equation' }
  | { readonly kind: 'upgrade-table' };

/** 测验的三种题型（大纲口径）：判断 / 单选 / 多选 */
export type QuizKind = 'truefalse' | 'single' | 'multi';

export interface QuizOption {
  readonly id: string;
  readonly text: string;
  readonly correct: boolean;
  /** 这一项「为什么对 / 为什么不对」——答错时逐项给出来，答对时当确认解释 */
  readonly why: string;
}

export interface QuizQuestion {
  readonly id: string;
  readonly kind: QuizKind;
  readonly prompt: string;
  readonly options: readonly QuizOption[];
  /** 题面里要摆出来的牌（可选，牌键）：数分数、比较叫品这类题就地摆牌 */
  readonly cards?: readonly string[];
  /** 答对之后的一句总结（可选；缺省时用所选项的 `why`） */
  readonly note?: string;
}

/** 课程里的一步 */
export type CourseStep =
  | {
      readonly kind: 'brief';
      readonly id: string;
      readonly title: string;
      readonly points: readonly string[];
      readonly widget?: ConceptWidget;
    }
  | {
      readonly kind: 'quiz';
      readonly id: string;
      readonly title: string;
      readonly questions: readonly QuizQuestion[];
    }
  | {
      readonly kind: 'deal';
      readonly id: string;
      readonly title: string;
      /** 引导局 slug；`pending` 为真时这副还没接上数据（见下面的说明） */
      readonly slug: string;
      /**
       * 这一屏打在引导局的哪一段：
       * - `auction` 只打叫牌（大纲 1.1.4：引导叫牌）；
       * - `play` 从埋底/出牌打起（大纲 1.2）；
       * - `all` 整副一气打完（当庄家章与最后一副）。
       * 分段由 `dealSpans` 从数据现算（叫牌段结束于定约成立那一步），不在课程里写死下标。
       */
      readonly segment: DealSegment;
      /**
       * 还没接上真实牌局的占位：写一句为什么（找不到合适的副就降级为纯概念+测验，见 ADR-0025）。
       * 有它时页面渲染一条说明并允许跳过，而不是假装这里有副牌。
       */
      readonly pending?: string;
    }
  | {
      readonly kind: 'review';
      readonly id: string;
      readonly title: string;
      readonly slug: string;
      readonly pending?: string;
    }
  | { readonly kind: 'end'; readonly id: string; readonly title: string };

export type DealSegment = 'auction' | 'play' | 'all';

export interface CourseChapter {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly steps: readonly CourseStep[];
}

export interface GuideCourse {
  readonly id: string;
  readonly title: string;
  readonly chapters: readonly CourseChapter[];
}

/** 课程里所有步的扁平索引（深链与进度都认它） */
export interface CourseIndex {
  readonly steps: readonly CourseStep[];
  readonly chapterOf: ReadonlyMap<string, CourseChapter>;
  readonly indexOf: ReadonlyMap<string, number>;
}

export const MIN_QUIZ_OPTIONS = 2;

/** 只读一遍课程，把「第几步 / 属于哪一章」算成表 —— 深链、进度与导航共用这一份 */
export function indexCourse(course: GuideCourse): CourseIndex {
  const steps: CourseStep[] = [];
  const chapterOf = new Map<string, CourseChapter>();
  for (const chapter of course.chapters) {
    for (const step of chapter.steps) {
      steps.push(step);
      chapterOf.set(step.id, chapter);
    }
  }
  const indexOf = new Map<string, number>();
  steps.forEach((step, index) => indexOf.set(step.id, index));
  return { steps, chapterOf, indexOf };
}
