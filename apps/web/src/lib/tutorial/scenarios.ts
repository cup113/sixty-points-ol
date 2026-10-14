/**
 * 新手教程的示例牌面与示例数值（纯数据）。
 *
 * 关键约束：这里所有示例的「正确性」都由引擎自己的纯函数在 test/tutorial.test.ts 里验证
 * （validateLead / validateFollow / trickWinner / classOfSet / cardsPoints / madeLevels），
 * 所以规则引擎改动后教程不会悄悄变成错的。
 *
 * 两条额外的自我约束：
 * - 主牌分组、副牌整门这些清单**从 fullDeck() 现场分类算出来**，不手写牌面清单 ——
 *   手写的清单改了引擎也不会报错，而「18 张主牌」这种数字必须永远等于引擎的口径。
 * - 示例数值只留一份：叫牌示例的定约、结算示例的定约、门槛示例的定约都来自
 *   DEMO_CONTRACT.points，避免出现「叫牌说 45、结算说 70」这种两副牌。
 */

import {
  cardClass,
  cardKey,
  fullDeck,
  isJoker,
  SUIT_LABEL,
  sortHand,
  type BidCall,
  type Card,
  type Contract,
  type Level,
  type Seat,
  type Suit,
  type TrumpModel
} from '@sixty/engine';

/** 示例统一用「本副级牌 = 5」 */
export const LEVEL = 5;
/** 有主：主打 ♥ */
export const TRUMP_HEARTS: TrumpModel = { strain: 'H', rank: LEVEL };
/** 无主：四张级牌与双王是主牌 */
export const TRUMP_NT: TrumpModel = { strain: 'NT', rank: LEVEL };
/** 有主：主打 ♣（用于对照「主花色」换一个门） */
export const TRUMP_CLUBS: TrumpModel = { strain: 'C', rank: LEVEL };

/** 教程里出现的示例都在这个将牌环境下：文案里的「本副：…」直接渲染它 */
export const DEMO_TRUMP = TRUMP_HEARTS;

/** 教程里三个座位的代称；座位号与真实牌局一致（0/1/2） */
export const TUTORIAL_NAMES = ['你', '阿豪', '小美'] as const;

/** 一副牌的四步。阶段条按这个顺序渲染，并链到对应小节 */
export const PHASES: readonly { readonly id: string; readonly label: string; readonly blurb: string }[] = [
  { id: 'auction', label: '叫牌', blurb: '定庄、定主、定要抓多少分' },
  { id: 'bury', label: '埋底', blurb: '庄家从 20 张里扣 3 张回去' },
  { id: 'play', label: '打牌', blurb: '17 轮，赢的人领下一轮' },
  { id: 'scoring', label: '结算', blurb: '算最终得分，据此升级' }
];

const DECK: ReadonlyMap<string, Card> = new Map(fullDeck().map((card) => [cardKey(card), card]));

/** 写教程时用 J/Q/K/A 比 11/12/13/14 可读；`cardKey` 本身用数字 */
const RANK_ALIAS: Readonly<Record<string, number>> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

function normalizeKey(key: string): string {
  if (key.startsWith('j')) return key.toLowerCase();
  const suit = key.slice(0, 1).toUpperCase();
  const rest = key.slice(1).toUpperCase();
  return `${suit}${RANK_ALIAS[rest] ?? Number(rest)}`;
}

function lookup(key: string): Card {
  const card = DECK.get(normalizeKey(key));
  if (card === undefined) throw new Error(`教程牌面键不存在：${key}`);
  return card;
}

/** `handOf('H5', 'C10', 'SK', 'j1')` → 四张牌；键写错直接抛错，避免示例里混进不存在的牌 */
export function handOf(...keys: string[]): Card[] {
  return keys.map(lookup);
}

/** 把一组键换成牌（给测试核对反例用） */
export function cardsOf(keys: readonly string[]): Card[] {
  return handOf(...keys);
}

/* ---------- 1. 分值 ---------- */

/**
 * 引导屏的「分值六例」：每一格是**一张牌 + 它值多少分**（单元内上下布局）。
 *
 * 刻意混进 ♣6、♠A 与大王：新手容易以为「大牌就值钱」，这三张正是反例 ——
 * 上排三张全是分牌、下排三张全是 0 分，规则由版式讲出来，不必再写一句说明。
 * （`/rules` 那一节仍用 `POINT_CARDS` 的牌面图与 `POINT_ROWS` 的速查行：
 * 那边要的是「一类牌一行」，与引导屏的「一张牌一格」粒度不同，各留一份。）
 */
export const POINT_UNITS: readonly { readonly card: Card; readonly points: number }[] = [
  { card: lookup('H5'), points: 5 },
  { card: lookup('S10'), points: 10 },
  { card: lookup('DK'), points: 10 },
  { card: lookup('C6'), points: 0 },
  { card: lookup('j1'), points: 0 },
  { card: lookup('SA'), points: 0 }
];

/** `/rules` 的牌面图：三种分牌各一张 + 两张王（王在图上，但一行速查里写着 0 分） */
export const POINT_CARDS = handOf('H5', 'D10', 'SK', 'j0', 'j1');

export const POINT_ROWS: readonly { readonly label: string; readonly points: number }[] = [
  { label: '5', points: 5 },
  { label: '10', points: 10 },
  { label: 'K', points: 10 },
  { label: '其余（含双王）', points: 0 }
];

/** 一墩牌的样子：这一轮的分记给赢家 */
export const TRICK_DEMO = handOf('CK', 'H5', 'S7');

/* ---------- 2. 级牌与主牌 ---------- */

export interface TrumpGroup {
  readonly title: string;
  readonly hint: string;
  readonly cards: readonly Card[];
}

/**
 * 主牌的三部分（无主时只有两部分）。整副牌现场分类，所以
 * 「2 张王 + 4 张级牌 + 12 张主花色 = 18」这个口径不可能与引擎漂移。
 */
export function trumpGroups(trump: TrumpModel): readonly TrumpGroup[] {
  const deck = fullDeck();
  const groups: TrumpGroup[] = [
    { title: '王', hint: '永远算主牌，也永远最大', cards: sortHand(deck.filter(isJoker), trump) },
    {
      title: '级牌',
      hint: '点数等于庄家级别的那四张，什么花色都算',
      cards: sortHand(deck.filter((c) => !isJoker(c) && c.rank === trump.rank), trump)
    }
  ];
  if (trump.strain !== 'NT') {
    const strain: Suit = trump.strain;
    groups.push({
      title: `${SUIT_LABEL[strain]} 整门`,
      hint: '叫牌叫到的那个花色，整门都是主牌',
      cards: sortHand(deck.filter((c) => !isJoker(c) && c.suit === strain && c.rank !== trump.rank), trump)
    });
  }
  return groups;
}

/** 某将牌模型下主牌的总张数（有主 18 / 无主 6） */
export function trumpCount(trump: TrumpModel): number {
  return trumpGroups(trump).reduce((sum, group) => sum + group.cards.length, 0);
}

/** 副牌某一门的整门：例级牌 5 时 ♣ 门是 ♣2 ♣3 ♣4 ♣6 … ♣A，**没有 ♣5** */
export function sideSuitCards(trump: TrumpModel, suit: Suit): readonly Card[] {
  return sortHand(fullDeck().filter((c) => cardClass(c, trump) === suit), trump);
}

/**
 * 主牌内部的大小顺序（从大到小）。这是**唯一一份**顺序数据：页面既用它渲染
 * 「大王 → 小王 → ♥5 → ♠5 ♦5 ♣5 → ♥A」那一条，也用它生成下面的表格。
 *
 * 副级三张完全相等，所以这里给的是**分组**而不是一条严格递减的序列：
 * 页面上把这三张并排渲染，读者才不会以为 ♠5 > ♦5。
 * （原来这里是手写的升序数组，页面却标着「从大到小」，左右正好读反。）
 */
export const TRUMP_LADDER_GROUPS: readonly {
  readonly title: string;
  readonly note: string;
  readonly cards: readonly Card[];
}[] = [
  { title: '大王', note: '最大的一张', cards: handOf('j1') },
  { title: '小王', note: '仅次于大王', cards: handOf('j0') },
  { title: '主级', note: '主花色里的那张级牌（示例 ♥5）', cards: handOf('H5') },
  { title: '副级（三张相等）', note: '三门副牌里的级牌（示例 ♠5 ♦5 ♣5），三张完全一样大，平张时先出的赢', cards: handOf('S5', 'D5', 'C5') },
  { title: '主花色普通牌', note: '♥2 到 ♥A（跳过 ♥5，它是主级）', cards: handOf('HA') }
];

/** 顺子可以跨过「主花色 → 级牌 → 王」的边界：♥A → ♠5 → ♥5 在主牌全序里相邻 */
export const TRUMP_RUN_CROSS = handOf('HQ', 'HK', 'HA', 'S5', 'H5');

/* ---------- 3. 叫牌 ---------- */

/** 一段完整成交的叫牌：你 40♣ → 阿豪 45♥ → 小美不叫 → 你不叫 ⇒ 阿豪坐庄、主打 ♥ */
export const DEMO_AUCTION: readonly { readonly seat: Seat; readonly call: BidCall }[] = [
  { seat: 0, call: { points: 40, strain: 'C' } },
  { seat: 1, call: { points: 45, strain: 'H' } },
  { seat: 2, call: 'pass' },
  { seat: 0, call: 'pass' }
];

/** 上面这段叫牌的结论，用于文案与测试对齐。显式标 Contract 类型，否则 strain 会退化成 string */
export const DEMO_CONTRACT: Contract = { points: 45, strain: 'H', declarerSeat: 1 as Seat };

/**
 * 定约 45♥、示例暗底 10 分、末轮每人 2 张时，闲家到底要抓多少分。
 * 数值由 settle.ts 算出来，页面直接渲染——教程里不再手写「100 − 45 = 55」这种漏掉底牌的算式。
 */
export const DEMO_SETTLE_INPUT = { contract: DEMO_CONTRACT.points, kittyPoints: 10, multiplier: 2 } as const;

/** 「叫法的意图」表已删除：原表写「40 起步叫…代价是收益也小」，而收益并不随叫分变化（见 KITTY_EQUATION 上方的说明）。 */

/* ---------- 4. 埋底与结算 ---------- */

/** 庄家手牌示意（真实为 20 张，这里取 12 张展示扇形） */
export const BURY_HAND = handOf('H2', 'H3', 'H4', 'H6', 'H10', 'HK', 'S9', 'SJ', 'SQ', 'C8', 'C9', 'C10');

/** 示例暗底：♥5 + ♦5 + ♠7 = 10 分 */
export const DEMO_KITTY = handOf('H5', 'D5', 'S7');

/** 埋分能撬动多大：末轮 3 张顺子 × 20 分底牌。乘积由页面算，别手写 60 */
export const KITTY_SWING = { multiplier: 3, kittyPoints: 20 } as const;

/**
 * 一条算式的示例数值，与叫牌示例**同一副牌**（定约 45♥，见 DEMO_CONTRACT）：
 * 墩分 55 + 底牌 10 × 末轮 2 张 = 75 ≥ 45 ⇒ 打成 3 级；
 * 同一边被抠底则是 55 − 20 = 35 < 45 ⇒ 打输，差 10 ⇒ 两家闲家各升 1 级。
 *
 * 注意 `contract` 只参与「打成/打输」与闲家差额，**不参与庄家升几级**：
 * 庄家升级是 madeLevels(finalScore) 的单参数函数（engine/state.ts）。
 * 所以「叫高一点能多升级」是错的 —— 叫高只是把及格线抬高。
 */
export const KITTY_EQUATION = {
  contract: 45,
  trickPoints: 55,
  kittyPoints: 10,
  multiplier: 2,
  madeFinal: 75,
  setFinal: 35
} as const;

export const MULTIPLIER_ROWS: readonly { readonly lastTrick: string; readonly multiplier: number }[] = [
  { lastTrick: '末轮每家 1 张', multiplier: 1 },
  { lastTrick: '末轮每家 2 张', multiplier: 2 },
  { lastTrick: '末轮每家 3 张', multiplier: 3 }
];

/* ---------- 5. 打牌：练手示例 ---------- */

export interface TryPlayDemo {
  readonly id: string;
  readonly title: string;
  readonly task: string;
  readonly trump: TrumpModel;
  readonly hand: readonly Card[];
  /** null = 由你领出 */
  readonly lead: readonly Card[] | null;
  /** 文档化的正例/反例（牌面键），仅测试使用；组件本身只调用引擎校验 */
  readonly legal: readonly (readonly string[])[];
  readonly illegal: readonly (readonly string[])[];
}

/**
 * 领出那一节现在是静态的 ✓/✗ 对照（不再做成练手题），但每一条仍要过引擎：
 * `ok` 必须与 validateLead 的结论一致，否则教程就在教一条不存在的规则。
 */
export interface LeadCase {
  readonly ok: boolean;
  readonly keys: readonly string[];
  readonly note: string;
}

/** 领出示例所用的手牌（上面的每一条 case 都必须取自这手牌） */
export const LEAD_HAND = handOf('S9', 'S10', 'SJ', 'SQ', 'H2', 'H3', 'C6', 'D8');

export const LEAD_CASES: readonly LeadCase[] = [
  { ok: true, keys: ['S9'], note: '单张，怎么出都行' },
  { ok: true, keys: ['S9', 'S10', 'SJ', 'SQ'], note: '同门 4 连' },
  { ok: true, keys: ['H2', 'H3'], note: '♥ 是主牌门，2-3 在主牌里也连着' },
  { ok: false, keys: ['S9', 'SJ'], note: '中间缺 ♠10，不相邻' },
  { ok: false, keys: ['S9', 'S10', 'SJ', 'SQ', 'H2'], note: '混门（不允许甩牌）' },
  { ok: false, keys: ['C6', 'D8'], note: '混门' }
];

/** 跟牌一节的反面教材：这一门只有 1 张，凑不满 3 张，剩下的随便垫 */
export const FOLLOW_SHORT_HAND = handOf('CQ', 'S9', 'S10', 'H2', 'D8');
export const FOLLOW_SHORT_LEAD = handOf('C3', 'C4', 'C6');

/** 练手 2 的正确答案的牌面（页面照这个渲染对照图，不用对 hand 取切片） */
export const FOLLOW_ANSWER = handOf('C3', 'C4', 'C6', 'CQ');

/** 练手 2：跟牌——该门够张数时必须全出该门，且结构优先（3 顺 + 1 > 2 顺 + 2） */
export const TRY_FOLLOW: TryPlayDemo = {
  id: 'follow',
  title: '练手 1 · 跟牌（结构优先）',
  task: '上家领出 ♣8-9-10-J 四张顺子。你手里 ♣ 有 3 顺（3-4-6，级牌 5 不在这一门）+ 2 顺（Q-K），该怎么跟？',
  trump: TRUMP_HEARTS,
  hand: handOf('C3', 'C4', 'C6', 'CQ', 'CK', 'S9', 'H2'),
  lead: handOf('C8', 'C9', 'C10', 'CJ'),
  legal: [
    ['C3', 'C4', 'C6', 'CQ'],
    ['C3', 'C4', 'C6', 'CK']
  ],
  illegal: [
    ['CQ', 'CK', 'C3', 'C4'],
    ['C3', 'C4', 'C6', 'S9']
  ]
};

/** 练手 3：缺门——可以杀牌（能赢）也可以垫牌（不能赢） */
export const TRY_RUFF: TryPlayDemo = {
  id: 'ruff',
  title: '练手 2 · 缺门杀牌',
  task: '上家领出 ♠7-8-9 三张顺子，你手里一张 ♠ 都没有。出主牌顺子能赢下这轮，垫牌不能。',
  trump: TRUMP_HEARTS,
  hand: handOf('H3', 'H4', 'H6', 'C2', 'C3', 'D4'),
  lead: handOf('S7', 'S8', 'S9'),
  legal: [
    ['H3', 'H4', 'H6'],
    ['C2', 'C3', 'D4']
  ],
  illegal: [['H3', 'H4']]
};

/** /rules 里做成可点的练手题（领出那节改成了静态 ✓/✗ 对照，见 LEAD_CASES） */
export const TRY_DEMOS: readonly TryPlayDemo[] = [TRY_FOLLOW, TRY_RUFF];

/* ---------- 6. 打牌推论里的静态示例 ---------- */

/** 副牌顺子跳过级牌：级牌 5 归主牌，所以 ♣3-4-6 是连着的 */
export const RUN_SKIPS_LEVEL = handOf('C3', 'C4', 'C6');
/** 反例：同门但不相邻（♣3 与 ♣9） */
export const RUN_NOT_ADJACENT = handOf('C3', 'C9');
/** 主牌顺子按主牌全序相邻：♥3-4-6（级牌 ♥5 归主级，位于更高层） */
export const TRUMP_RUN = handOf('H3', 'H4', 'H6');
/** 副级三张完全相等，彼此不构成顺子相邻 */
export const OFF_RANK_EQUALS = handOf('S5', 'C5', 'D5');

/** 主牌顺子压过副牌顺子：♠A-K-Q 被最低的三张主牌顺子杀掉 */
export const RUFF_LEAD = handOf('SA', 'SK', 'SQ');
export const RUFF_WINNER = handOf('H2', 'H3', 'H4');

/* ---------- 7. 级别与升级表 ---------- */

export const LEVEL_DEMO: readonly Level[] = [
  { rank: 5, cycle: 0 },
  { rank: 14, cycle: 1 },
  { rank: 5, cycle: 2 }
];

/**
 * 庄家升级档。`max: null` 表示「下限起、每多 5 分再 1 级」。
 *
 * 只列**真实会出现的**区间：得分来自 5/10/K，永远是 5 的倍数，
 * 所以 59 / 69 / 79 / 89 这类边界不可达，写成 40-59 只是照抄引擎整数阈值、对玩家没有意义。
 * 用数值上下限而不是字符串，才能让测试遍历并和 madeLevels 对齐。
 */
export interface UpgradeBand {
  readonly min: number;
  readonly max: number | null;
  /** 该档的升级级数；`max: null` 的那档是下限，实际为 5 + (得分 − 90) / 5 */
  readonly levels: number;
  /** 表格里显示的文案 */
  readonly label: string;
}

export const UPGRADE_BANDS: readonly UpgradeBand[] = [
  { min: 40, max: 55, levels: 1, label: '1 级' },
  { min: 60, max: 65, levels: 2, label: '2 级' },
  { min: 70, max: 75, levels: 3, label: '3 级' },
  { min: 80, max: 85, levels: 4, label: '4 级' },
  { min: 90, max: null, levels: 5, label: '5 级起，每多 5 分再 1 级' }
];

/** 表格显示用：可达区间 + 该档实际会出现的分数 */
export const UPGRADE_ROWS: readonly { readonly range: string; readonly sample: number; readonly levels: string }[] =
  UPGRADE_BANDS.map((band) => ({
    range: band.max === null ? `≥ ${band.min}` : `${band.min} / ${band.max}`,
    sample: band.min,
    levels: band.label
  }));

/** 打输时闲家升级：差 = 定约 − 最终得分，各升 ceil(差 / 10) */
export const DEFENDER_STEPS: readonly { readonly shortfall: number; readonly levels: number }[] = [
  { shortfall: 5, levels: 1 },
  { shortfall: 10, levels: 1 },
  { shortfall: 15, levels: 2 },
  { shortfall: 20, levels: 2 },
  { shortfall: 25, levels: 3 },
  { shortfall: 30, levels: 3 },
  { shortfall: 35, levels: 4 },
  { shortfall: 50, levels: 5 }
];

/** 升级就是「从当前级别往前推进 N 级」：A 之后进 2(+1)，换档时轮数 +1 */
export const LEVEL_STEPS: readonly {
  readonly from: Level;
  readonly levels: number;
  readonly to: Level;
  readonly note: string;
}[] = [
  { from: { rank: 5, cycle: 0 }, levels: 3, to: { rank: 8, cycle: 0 }, note: '同档内推进' },
  { from: { rank: 14, cycle: 0 }, levels: 2, to: { rank: 3, cycle: 1 }, note: 'A 之后进 2(+1)' }
];
