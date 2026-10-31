import { isJoker, SUITS, type Card, type Rank, type Suit, type Strain } from './cards.ts';

/** 本副的将牌模型：叫到的花色 + 庄家级别点数（级牌） */
export interface TrumpModel {
  readonly strain: Strain;
  readonly rank: Rank;
}

/** 牌在打牌中的“门”：'T' 表示主牌门，其余为副牌门 */
export type CardClass = 'T' | Suit;

export const TRUMP_OFF_RANK_LEVEL = 13;
export const TRUMP_MAIN_RANK_LEVEL = 14;
export const TRUMP_SMALL_JOKER_LEVEL = 15;
export const TRUMP_BIG_JOKER_LEVEL = 16;
export const TRUMP_TOP_LEVEL = TRUMP_BIG_JOKER_LEVEL;

export function cardClass(c: Card, t: TrumpModel): CardClass {
  if (isJoker(c)) return 'T';
  if (c.rank === t.rank) return 'T';
  if (t.strain !== 'NT' && c.suit === t.strain) return 'T';
  return c.suit;
}

/** 副牌/主花色内按“跳过级牌”连续编号：2→1 … 去掉级牌后 A→12 */
function skipLevel(rank: Rank, removed: Rank): number {
  return rank < removed ? rank - 1 : rank - 2;
}

/**
 * 同门内大小层号，数值越大越强。
 * 主牌：主花色 1..12 < 副级(13，三张相等) < 主级(14) < 小王(15) < 大王(16)
 * 无主：级牌(1，四张相等) < 小王(2) < 大王(3)
 * 副牌：1..12（跳过级牌）
 */
export function cardLevel(c: Card, t: TrumpModel): number {
  if (t.strain === 'NT') {
    // 无主：四张级牌相等（层号 1）< 小王(2) < 大王(3)
    if (isJoker(c)) return c.joker === 'small' ? 2 : 3;
    return c.rank === t.rank ? 1 : skipLevel(c.rank, t.rank);
  }
  if (isJoker(c)) return c.joker === 'small' ? TRUMP_SMALL_JOKER_LEVEL : TRUMP_BIG_JOKER_LEVEL;
  if (c.suit === t.strain) {
    return c.rank === t.rank ? TRUMP_MAIN_RANK_LEVEL : skipLevel(c.rank, t.rank);
  }
  return c.rank === t.rank ? TRUMP_OFF_RANK_LEVEL : skipLevel(c.rank, t.rank);
}

/** 一组同门牌按大小升序；用于比较与拆分 */
export function sortByLevel<T extends Card>(cards: readonly T[], t: TrumpModel): T[] {
  return [...cards].sort((a, b) => cardLevel(a, t) - cardLevel(b, t));
}

/**
 * 一组同门牌的连续段长度（降序）。
 * 采用「每次抽取最长连续链」的贪心分解：每层号取一张，长度按层号严格 +1 递增。
 * 层号相等的牌（副级、无主级牌）不能同链，但可以被不同链分别使用——
 * 例：持 A + 两张副级 + 主级（层号 12,13,13,14）分解为 [3,1]，
 * 因此 3 张即可取出 A-副级-主级 三连。
 */
export function segments(cards: readonly Card[], t: TrumpModel): number[] {
  const counts = new Map<number, number>();
  for (const card of cards) {
    const lv = cardLevel(card, t);
    counts.set(lv, (counts.get(lv) ?? 0) + 1);
  }
  const out: number[] = [];
  let remaining = cards.length;
  while (remaining > 0) {
    const levels = [...counts.entries()]
      .filter(([, n]) => n > 0)
      .map(([lv]) => lv)
      .sort((a, b) => a - b);
    let bestStart = 0;
    let bestLen = 0;
    let i = 0;
    while (i < levels.length) {
      let j = i;
      while (j + 1 < levels.length && levels[j + 1] === levels[j]! + 1) j += 1;
      const len = j - i + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = i;
      }
      i = j + 1;
    }
    for (let k = bestStart; k < bestStart + bestLen; k++) {
      const lv = levels[k]!;
      counts.set(lv, counts.get(lv)! - 1);
    }
    out.push(bestLen);
    remaining -= bestLen;
  }
  return out.sort((a, b) => b - a);
}

/** 同一门内按层号的极大连续段；`length` 是**层数**（同层多张只占段里的一个位置） */
export interface LevelRun {
  readonly top: number;
  readonly length: number;
}

/**
 * 同一门内所有极大连续段（只接受**同一门**的牌，与 `bestProfile` 同一条约定）。
 *
 * 与 `segments` 的区别：`segments` 是「每次抽最长链」的**贪心分解**（用于跟牌结构），
 * 这里要的是**有哪几条段、各到哪**（用于「我凑不凑得出 n 张、顶张多大」）。
 * 例：持 A + 两张副级 + 主级（层号 12,13,13,14）→ `[{top:14,length:3}]`，段长仍是 3。
 */
export function levelRuns(cards: readonly Card[], t: TrumpModel): LevelRun[] {
  const levels = [...new Set(cards.map((card) => cardLevel(card, t)))].sort((a, b) => a - b);
  const out: LevelRun[] = [];
  let start = 0;
  for (let i = 1; i <= levels.length; i++) {
    if (i < levels.length && levels[i] === levels[i - 1]! + 1) continue;
    out.push({ top: levels[i - 1]!, length: i - start });
    start = i;
  }
  return out;
}

/**
 * 同一门里「凑得出 n 张连续段」的最强顶张；凑不出为 -1。
 * n = 1 时就是这一门的最大层号（认赢投票里「我的顶张比他大」那一支）。
 */
export function bestRunTop(cards: readonly Card[], n: number, t: TrumpModel): number {
  if (n < 1) return -1;
  let best = -1;
  for (const run of levelRuns(cards, t)) {
    if (run.length >= n && run.top > best) best = run.top;
  }
  return best;
}

/** 把那 n 张牌取出来（顶张往下、每层一张）；凑不出为 null（用于「他最好也只能这样出」） */
export function topRunCards(cards: readonly Card[], n: number, t: TrumpModel): Card[] | null {
  const top = bestRunTop(cards, n, t);
  if (top < 0) return null;
  const byLevel = new Map<number, Card[]>();
  for (const card of cards) {
    const level = cardLevel(card, t);
    const bucket = byLevel.get(level);
    if (bucket) bucket.push(card);
    else byLevel.set(level, [card]);
  }
  const out: Card[] = [];
  for (let level = top; level > top - n; level--) {
    const bucket = byLevel.get(level);
    if (bucket === undefined || bucket.length === 0) return null;
    out.push(bucket[0]!);
  }
  return out;
}

export function compareProfiles(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * 结构优先：从 holding 中取 n 张，使连续段分解字典序最大。
 * 贪心：先整段取最长，预算不足时从下一段取等长连续片。
 * 例：持 3+2 跟 4 张 → 3 顺 + 任意 1 张；持 2+2 跟 4 张 → 两顺跟完；
 *     持 3+3+2 跟 5 张 → 一个 3 顺 + 一个 2 顺段（原 2 顺或拆 3 顺）。
 */
export function bestProfile(holding: readonly Card[], t: TrumpModel, n: number): number[] {
  if (holding.length > 0 && classOfSet(holding, t) === null) {
    throw new Error('bestProfile 只接受同一门的牌');
  }
  const segs = segments(holding, t);
  const out: number[] = [];
  let budget = n;
  for (const len of segs) {
    if (budget <= 0) break;
    if (len <= budget) {
      out.push(len);
      budget -= len;
    } else {
      out.push(budget);
      budget = 0;
    }
  }
  return out;
}

/** 单段顺子判定：同门、无重复层号、严格相邻；单张也视为可领出 */
export function isRun(cards: readonly Card[], t: TrumpModel): boolean {
  if (cards.length < 2) return false;
  return segments(cards, t).length === 1;
}

/**
 * 手牌里最长的一条顺子（**空手为 0** —— 一张也领不出）。
 *
 * **认赢**（ADR-0028）用它当末轮张数的上限：领出多张必须是同门严格相邻的顺子
 * （`validateLead`），所以「末轮按 x 张收尾」在牌面上的硬约束就是「手上真有一条 x 张的顺子」。
 * 这是**必要条件**，不是充分条件 —— 那条顺子留不留得到末轮，只有牌手自己判断。
 * 必须**先按门分组**再取段：`levelRuns` 只看层号，跨门的两张牌（如 ♣2 与 ♦3）层号相邻，
 * 混在一起会被误判成顺子。
 *
 * 空手返回 0 而不是 1：调用方拿它当「我有几张主牌能杀」用（`claimVote` 的缺门分支），
 * 1 会让「一张牌都没有」等价于「有一张主牌」。
 */
export function longestRun(cards: readonly Card[], t: TrumpModel): number {
  let best = 0;
  const byClass = new Map<CardClass, Card[]>();
  for (const card of cards) {
    const cls = cardClass(card, t);
    const bucket = byClass.get(cls);
    if (bucket) bucket.push(card);
    else byClass.set(cls, [card]);
  }
  for (const holding of byClass.values()) {
    for (const run of levelRuns(holding, t)) best = Math.max(best, run.length);
  }
  return best;
}

/** 顶张层号（用于比较同长度单段顺子） */
export function topLevel(cards: readonly Card[], t: TrumpModel): number {
  return cards.reduce((max, c) => Math.max(max, cardLevel(c, t)), -1);
}

const SUIT_DISPLAY_ORDER: readonly Suit[] = ['S', 'H', 'C', 'D'];
const RED_SUITS: ReadonlySet<Suit> = new Set<Suit>(['H', 'D']);

/**
 * 副牌的显示序：**黑红交替**。
 *
 * 主牌花色被提到最前面之后，剩下三门里必有两门同色、一门异色（♠♣ 黑、♥♦ 红）——
 * 把同色那两门放两端、异色那门摆中间，相邻两门就必然异色：主打 ♣ 时 ♥ ♦ 不再挨着。
 * 同色两门内部沿用固定序 ♠♥♣♦，所以同一副牌每次渲染的顺序都是稳定的。
 * 无主与将牌未定时四门俱在，而 ♠♥♣♦ 本身就是黑红交替，直接返回固定序。
 */
export function suitDisplayOrder(t: TrumpModel | null): Suit[] {
  if (t === null || t.strain === 'NT') return [...SUIT_DISPLAY_ORDER];
  const off = SUIT_DISPLAY_ORDER.filter((suit) => suit !== t.strain);
  const reds = off.filter((suit) => RED_SUITS.has(suit));
  const blacks = off.filter((suit) => !RED_SUITS.has(suit));
  return reds.length === 2
    ? [reds[0]!, blacks[0]!, reds[1]!]
    : [blacks[0]!, reds[0]!, blacks[1]!];
}

/** 手牌排序：主牌在前，随后按 `suitDisplayOrder`（副牌黑红交替），同门内由大到小；无将牌信息时双王在前 */
export function sortHand(cards: readonly Card[], t: TrumpModel | null): Card[] {
  const order = suitDisplayOrder(t);
  const group = (c: Card): number => {
    if (isJoker(c)) return -1;
    if (t !== null && cardClass(c, t) === 'T') return -1;
    return order.indexOf(c.suit) + 1;
  };
  const level = (c: Card): number => {
    if (!t) return isJoker(c) ? (c.joker === 'big' ? 2 : 1) : c.rank;
    return cardLevel(c, t);
  };
  return [...cards].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    return level(b) - level(a);
  });
}

export function classOfSet(cards: readonly Card[], t: TrumpModel): CardClass | null {
  let cls: CardClass | null = null;
  for (const c of cards) {
    const cc = cardClass(c, t);
    if (cls === null) cls = cc;
    else if (cls !== cc) return null;
  }
  return cls;
}

/** 一副牌里某门的全部张数（用于校验牌集完整性） */
export function classSize(t: TrumpModel, cls: CardClass): number {
  if (cls === 'T') return t.strain === 'NT' ? 6 : 18;
  return 12;
}

export const ALL_CLASSES: readonly CardClass[] = ['T', ...SUITS];
