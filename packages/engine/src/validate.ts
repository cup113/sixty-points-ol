import { cardKey, containsCard, removeCards, type Card } from './cards.ts';
import {
  bestProfile,
  cardClass,
  cardLevel,
  classOfSet,
  compareProfiles,
  isRun,
  longestRun,
  segments,
  type CardClass,
  type TrumpModel
} from './order.ts';
import type { TrickPlay } from './trick.ts';

export interface LeadInfo {
  readonly cardClass: CardClass;
  readonly cards: readonly Card[];
  readonly size: number;
}

export function leadInfo(cards: readonly Card[], t: TrumpModel): LeadInfo | null {
  const cls = classOfSet(cards, t);
  return cls === null ? null : { cardClass: cls, cards, size: cards.length };
}

/** 手牌里与 `cls` 同门的那些牌 */
export function holdingOf(hand: readonly Card[], t: TrumpModel, cls: CardClass): Card[] {
  return hand.filter((c) => cardClass(c, t) === cls);
}

/**
 * 跟牌的两种模式，**只由「该门够不够」决定**：
 * 够 → 必须全出该门（还受结构优先约束）；不够 → 必须出完该门，其余任意垫。
 *
 * 这是 `validateFollow` 与 `playHint` 共用的那一个判断 —— 阈值只有一处，
 * 否则「工具面说该怎么出、服务端说非法」迟早会漂移。
 */
export type FollowMode = 'must-follow-class' | 'must-empty-class';

export function followMode(holdingCount: number, leadSize: number): FollowMode {
  return holdingCount >= leadSize ? 'must-follow-class' : 'must-empty-class';
}

/**
 * 「现在该怎么出」的结构化摘要（`check_play` 的省钱版）：
 * 只给**约束**，不复述手牌 —— 模型自己手上有 `you.hand`。
 *
 * `lead` 为 null 表示你是领出（单张，或同门顺子）；`holdingCount` 是你在领出那一门里的张数。
 */
export interface PlayHint {
  readonly lead: { readonly cardClass: CardClass; readonly size: number } | null;
  readonly holdingCount: number;
  readonly rule: FollowMode | 'lead-run-or-single';
}

export function playHint(hand: readonly Card[], t: TrumpModel, lead: readonly Card[] | null): PlayHint {
  const info = lead === null || lead.length === 0 ? null : leadInfo(lead, t);
  if (info === null) return { lead: null, holdingCount: hand.length, rule: 'lead-run-or-single' };
  const holding = holdingOf(hand, t, info.cardClass);
  return {
    lead: { cardClass: info.cardClass, size: info.size },
    holdingCount: holding.length,
    rule: followMode(holding.length, info.size)
  };
}

/** 领出校验：非空、同门、多张必须是顺子（不允许甩牌） */
export function validateLead(hand: readonly Card[], cards: readonly Card[], t: TrumpModel): string | null {
  if (cards.length === 0) return '必须至少出一张牌';
  if (cards.length > hand.length) return '出牌数超过手牌数';
  if (removeCards(hand, cards) === null) return '手牌中没有这些牌';
  const cls = classOfSet(cards, t);
  if (cls === null) return '一次出的多张牌必须同门（不允许甩牌）';
  if (cards.length > 1 && !isRun(cards, t)) return '多张牌必须构成顺子';
  return null;
}

/**
 * 跟牌校验：
 * - 张数必须与领出一致
 * - 该门张数 ≥ n：必须全出该门 n 张，且连续段分解字典序最大（结构优先）
 * - 该门张数 < n：必须出完该门所有牌，其余任意（垫牌自由；不成结构则不能赢）
 */
export function validateFollow(
  hand: readonly Card[],
  cards: readonly Card[],
  lead: LeadInfo,
  t: TrumpModel
): string | null {
  const n = lead.size;
  if (cards.length !== n) return `必须出 ${n} 张牌`;
  if (removeCards(hand, cards) === null) return '手牌中没有这些牌';

  const holding = holdingOf(hand, t, lead.cardClass);
  if (followMode(holding.length, n) === 'must-follow-class') {
    if (!cards.every((c) => cardClass(c, t) === lead.cardClass)) return '该门牌够，必须全部跟该门';
    if (compareProfiles(segments(cards, t), bestProfile(holding, t, n)) !== 0) {
      return '跟牌结构不足：应按最长顺子优先出牌';
    }
    return null;
  }

  const missing = holding.filter((h) => !containsCard(cards, h));
  if (missing.length > 0) return '该门牌不足，必须先出完该门所有牌';
  return null;
}

/**
 * 出牌的本地预判：`lead` 为 null 表示本轮还没人出牌（你是领出）。
 * 返回 null 表示合法，否则是给玩家看的中文原因。
 *
 * 界面（`$lib/labels` 的 checkPlay）与 MCP 工具面的 `check_play` 都走这一处 ——
 * 服务端始终是唯一裁判，这只是同一套规则的提前告知。
 */
export function checkPlay(
  hand: readonly Card[],
  cards: readonly Card[],
  t: TrumpModel,
  lead: readonly Card[] | null
): string | null {
  if (cards.length === 0) return null;
  if (lead === null) return validateLead(hand, cards, t);
  const info = leadInfo(lead, t);
  if (info === null) return '牌局状态异常';
  return validateFollow(hand, cards, info, t);
}

// ---------------------------------------------------------------------------
// 必出牌与可点牌（ADR-0030）：界面据此自动选中，并拒绝不合法的那一下点击
// ---------------------------------------------------------------------------

/**
 * 枚举搜索的上限（**检查过的** n 张组合数）。
 *
 * 可达的最坏在**主牌门**：一副 54 张里 18 张主牌，领出 5 张 ⇒ 我手上最多 13 张主牌
 * ⇒ C(13,5) = 1287 个子集（本机实测一次枚举几毫秒，见 ADR-0030）。上限留了一个数量级的余量；
 * 撞上时**两个消费者都放行**（见 `legalFollowSets`）—— 一次没算完的搜索不许把手牌锁死。
 */
export const PICK_SEARCH_LIMIT = 20000;

/**
 * 按「结构优先」判据枚举合法跟牌，逐个交给 `visit`。返回 `false` = **没跑完**（撞上
 * `PICK_SEARCH_LIMIT`），调用方必须按「不知道」处理。
 *
 * 判据与 `validateFollow` 是**同一句**：`compareProfiles(segments(cards), bestProfile(holding, n))`。
 * 这里不引入第二套规则 —— 界面的「可点 / 必出」必须与裁判说的是同一句话，否则
 * 「界面说能出、服务端说非法」迟早出现。
 *
 * 为什么是枚举而不是公式：合法性只由段长分解决定，而「这张牌能不能点」问的是
 * 「加了它之后**还凑不凑得出**合法的一手」—— 那是一个存在性判断，没有闭式答案。
 * 例如持 3 顺 + 2 张跟 4 张（结构优先要求 3 顺 + 任 1 张）：A K Q + 任一张都合法，
 * A K 9 + Q 也合法（A K Q 9 的分解仍是 3+1），而 A K 9 8 不合法（2+2）。
 *
 * `visit` 收到的 `cards` 是**内部复用**的数组，需要留存请自己拷贝。
 */
function eachLegalFollow(
  holding: readonly Card[],
  n: number,
  t: TrumpModel,
  visit: (cards: readonly Card[]) => void
): boolean {
  if (n <= 0 || holding.length < n) return true;
  const target = bestProfile(holding, t, n);
  const combo: Card[] = [];
  let leaves = 0;

  const walk = (start: number): boolean => {
    if (combo.length === n) {
      leaves += 1;
      if (leaves > PICK_SEARCH_LIMIT) return false;
      if (compareProfiles(segments(combo, t), target) === 0) visit(combo);
      return true;
    }
    const need = n - combo.length;
    for (let i = start; i + need <= holding.length; i += 1) {
      combo.push(holding[i]!);
      const keep = walk(i + 1);
      combo.pop();
      if (!keep) return false;
    }
    return true;
  };

  return walk(0);
}

/**
 * 跟牌的**全部合法组合** —— 一次枚举，两个消费者（`forcedPlay` / `pickableCards`）共用。
 *
 * 判据与 `validateFollow` 是**同一句**（`compareProfiles(segments(cards), bestProfile(holding, n))`），
 * 界面的「可点 / 必出」因此不可能与裁判分叉。
 *
 * **为什么只枚举一遍**：早先 `pickableCards` 对**每张候选牌**各枚举一遍，`forcedPlay` 自己再枚举
 * 一遍；在可达最坏的手牌（持 13 张主牌、领出 5 张主牌 = 1287 个子集）上实测**一次 24 ms**，
 * 而它挂在 `$derived` 上、每点一张牌就重算一次。现在枚举一遍，两个问题都从结果里读。
 *
 * 撞上限（`PICK_SEARCH_LIMIT`）时返回 `null` = **不知道**，两个消费者都必须放行：
 * 必出为空、整手可点 —— 宁可让服务端在出手那一刻拒一次，也不许把手牌锁成点不动。
 * （早先 `forcedPlay` 不看这个返回值，会把「只找到一种」当成「只有一种」，与它自己的注释相反。）
 */
function legalFollowSets(holding: readonly Card[], n: number, t: TrumpModel): Card[][] | null {
  if (n <= 0 || holding.length < n) return [];
  const sets: Card[][] = [];
  const complete = eachLegalFollow(holding, n, t, (cards) => {
    sets.push([...cards]);
  });
  return complete ? sets : null;
}

/**
 * 跟牌时**不用挑**的那几张 —— 界面自动选中它们（「必出牌」）。
 *
 * 判据全在引擎里，两种情形：
 * - **该门不够 n 张**（`must-empty-class`）：手上的该门牌**必须全出**，其余若干张自由垫，
 *   所以那几张该门牌就是必出；
 * - **该门够 n 张**（`must-follow-class`）：只有**唯一**一种合法组合时才谈得上「必出」；
 *   有第二种组合时（持 3 顺 + 2 张跟 4 张）把选择权留给玩家 —— 替他挑一张，
 *   等于替他做了一个他未必想做的决定（垫哪张分、留哪张大）。
 *
 * 领出（`lead` 为空）恒为空：出什么、出几张全由玩家定。
 * 搜索没跑完（`null`）同样返回空 —— 不把「只找到一种」当成「只有一种」。
 */
export function forcedPlay(
  hand: readonly Card[],
  t: TrumpModel,
  lead: readonly Card[] | null
): readonly Card[] {
  const info = lead === null || lead.length === 0 ? null : leadInfo(lead, t);
  if (info === null) return [];
  const holding = holdingOf(hand, t, info.cardClass);
  if (followMode(holding.length, info.size) === 'must-empty-class') return holding;

  const sets = legalFollowSets(holding, info.size, t);
  return sets !== null && sets.length === 1 ? sets[0]! : [];
}

/**
 * 现在**点得动**的牌（返回 `cardKey` 集合）：点得动 = 加上去或取消之后，仍然凑得出合法的一手。
 *
 * 界面拿它做两件事：拒绝那一下点击（`TableClient.toggle` / `HandFan`），
 * 以及把其余的牌画成「点了没反应」。
 *
 * 四条口径：
 * 1. **必出的那几张不能取消**（只有唯一解时那几张才叫必出，见 `forcedPlay`）；
 * 2. **该门够张数时，别的门一张都不许点**；该门不够时其余牌是**垫牌**，点了就是垫；
 * 3. 该门够张数时，加进去之后必须**还凑得出**结构优先的那一手 —— 这条才是
 *    「禁止选中不合法牌」真正拦下来的东西，判据是「有哪几手合法」里还找得到包含它的一手；
 * 4. 张数满了就不再收（多一张恒非法）。
 *
 * 领出恒为整手牌：任意单张都合法，多张顺子由出手那一刻的 `checkPlay` 判。
 * 搜索撞上限时**整手放行**：宁可让服务端在出手那一刻拒一次，也不许因为一次没算完的搜索
 * 把整手牌锁成点不动 —— 拒绝是提示，锁死是故障。
 *
 * 「有哪几手合法」只枚举**一遍**（`legalFollowSets`），必出与可点都从这一份结果里读。
 */
export function pickableCards(
  hand: readonly Card[],
  t: TrumpModel,
  lead: readonly Card[] | null,
  selection: readonly Card[]
): ReadonlySet<string> {
  const chosen = new Set(selection.map(cardKey));
  const out = new Set<string>();
  const info = lead === null || lead.length === 0 ? null : leadInfo(lead, t);
  if (info === null) {
    for (const card of hand) out.add(cardKey(card));
    return out;
  }

  const holding = holdingOf(hand, t, info.cardClass);

  if (followMode(holding.length, info.size) === 'must-empty-class') {
    // 该门不够：手上该门那几张必须全出（撤不掉），其余牌在张数未满时点了就是垫
    const forced = new Set(holding.map(cardKey));
    for (const card of hand) {
      const key = cardKey(card);
      if (chosen.has(key)) {
        if (!forced.has(key)) out.add(key);
        continue;
      }
      if (selection.length < info.size) out.add(key);
    }
    return out;
  }

  const sets = legalFollowSets(holding, info.size, t);
  if (sets === null) {
    for (const card of hand) out.add(cardKey(card));
    return out;
  }

  const keysOf = sets.map((cards) => new Set(cards.map(cardKey)));
  /** 唯一解 = 必出（与 `forcedPlay` 同一句话，只是不重算一遍） */
  const forced = new Set(sets.length === 1 ? [...keysOf[0]!] : []);
  /** 每一手合法牌都含已经选好的这几张（否则加进去也凑不出合法的一手） */
  const reachable = keysOf.map((keys) => [...chosen].every((key) => keys.has(key)));

  for (const card of hand) {
    const key = cardKey(card);
    if (chosen.has(key)) {
      if (!forced.has(key)) out.add(key);
      continue;
    }
    if (selection.length >= info.size) continue;
    if (cardClass(card, t) !== info.cardClass) continue;
    if (keysOf.some((keys, i) => reachable[i] && keys.has(key))) out.add(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 认赢（ADR-0028）：这一墩他这么快能不能赢、末轮能报多大
// ---------------------------------------------------------------------------

/**
 * 认赢报的**末轮张数**（底牌倍数 x）：能拿来收尾的最大张数；领不出为 null。
 *
 * x 是「收尾那一墩我领出几张」，所以它同时被三件事钳住：
 * - 手上真有一条 x 张的顺子（领出多张必须是顺子）；
 * - 这一墩我还得先打掉 `size` 张 —— 之后的墩才是我的「剩下」；
 * - 三家等长（`hand.length === size`）时这一墩**就是末墩**，x 只能等于这一墩的张数。
 *
 * 不让人挑：认领一旦成立，把最长那条顺子留到末轮总是摆得出来，而 x 越大底牌倍数越大 ——
 * 取上界恒不劣，于是这个数只有一个正确答案，由引擎算。
 */
export function claimLastTrickSize(
  hand: readonly Card[],
  plays: readonly TrickPlay[],
  t: TrumpModel
): number | null {
  const run = longestRun(hand, t);
  if (run < 1) return null; // 空手：一张也领不出
  if (plays.length === 0) return run; // 领出：这一墩的大小由我自己挑

  const size = plays[0]!.cards.length;
  if (hand.length < size) return null; // 出牌数超过手牌数：不是合法局面
  if (hand.length === size) return size; // 三家等长：这一墩就是末墩

  const max = Math.min(hand.length - size, run);
  return max < 1 ? null : max;
}

/**
 * 认赢**成不成立**（ADR-0028）：**他领出的每一墩都赢**，两条判据。
 *
 * 一、**主牌抽得干**：把他和对手的主牌各自从大到小排好，第 i 大的他要比第 i 大的对手大
 * （所以他也必须不比对手少）。于是他一张张领主牌，对手必须跟，每轮抽掉一张、并且每轮都是他赢；
 * 抽完之后对手一张主牌也没有了。
 *
 * 二、**副牌都是这一门剩下的最大几张**：每一门他最低的那张，也要比对手这门里最高的那张大。
 * 否则那张迟早要被他领出去（他会赢下每一墩，所以每一张牌最后都是他领），而对手一张更大的同门牌
 * 就把它压掉了。
 *
 * 为什么抽干主牌要放在副牌之前：对手只要还剩一张主牌，他领副牌时就能杀 —— 主牌不抽干，副牌
 * 再大也不安全。反过来两条都成立时，他从主牌往下领，谁也压不过、也没人杀得了（当前这一墩
 * 另由 `canWinTrickNow` 把守）。
 *
 * 偏严是刻意的：它也会误拒一些真认赢（比如某一门正好是一条对手跟不出的顺子）——
 * 误拒只丢一次快赢（牌局照常打完），误判会把不该给的墩判给他、算错分。
 */
export function claimUnbeatable(
  hand: readonly Card[],
  opponents: readonly Card[],
  t: TrumpModel
): boolean {
  const trumpsOf = (cards: readonly Card[]): number[] =>
    cards
      .filter((card) => cardClass(card, t) === 'T')
      .map((card) => cardLevel(card, t))
      .sort((a, b) => b - a);

  // 一、主牌逐张压过：第 i 大的都要比对手第 i 大的大（顺带也要求他不比对手少）
  const mine = trumpsOf(hand);
  const theirs = trumpsOf(opponents);
  if (theirs.length > mine.length) return false;
  for (let i = 0; i < theirs.length; i += 1) {
    if (mine[i]! <= theirs[i]!) return false;
  }

  // 二、副牌：我这一门最低的那张也要比对手这门最高的那张大
  const floor = new Map<CardClass, number>();
  for (const card of hand) {
    const cls = cardClass(card, t);
    if (cls === 'T') continue; // 主牌由上面那条管
    const level = cardLevel(card, t);
    const current = floor.get(cls);
    if (current === undefined || level < current) floor.set(cls, level);
  }
  for (const card of opponents) {
    const cls = cardClass(card, t);
    if (cls === 'T') continue; // 同上
    const mineLevel = floor.get(cls);
    if (mineLevel === undefined) continue; // 我这一门没有牌：他压不着我
    if (cardLevel(card, t) > mineLevel) return false;
  }
  return true;
}
