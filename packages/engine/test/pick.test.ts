/**
 * 必出牌与可点牌（`forcedPlay` / `pickableCards`，ADR-0030）。
 *
 * 这两条是同一个问题的两半：**跟牌时哪几张根本不用挑**（自动选中），以及
 * **点了也出不成的那几张**（拒绝那一下点击）。判据必须与裁判（`validateFollow`）同源，
 * 所以除了逐例断言，最后一条是穷举交叉校验：把该门的每个 n 元子集分别交给
 * `checkPlay` 与「一步一步点得动吗」，两者必须逐一对上。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Card } from '../src/cards.ts';
import { cardKey } from '../src/cards.ts';
import { cardClass, type TrumpModel } from '../src/order.ts';
import { checkPlay, forcedPlay, pickableCards } from '../src/validate.ts';
import { c, combinations, keys } from './helpers.ts';

const T: TrumpModel = { strain: 'H', rank: 7 };

function pick(hand: readonly Card[], lead: readonly Card[] | null, selection: readonly Card[]): string[] {
  return [...pickableCards(hand, T, lead, selection)].sort();
}

/** 该门（按领出的门）在手牌里的那些牌 */
function holdingOf(hand: readonly Card[], lead: readonly Card[]): Card[] {
  const cls = cardClass(lead[0]!, T);
  return hand.filter((card) => cardClass(card, T) === cls);
}

/**
 * 「从空选择开始，按这个顺序一张张点，点得动吗」—— 界面那条路径的模拟。
 * 每一步都问一次 `pickableCards`，所以它回答的正是「玩家能不能凑出这一手」。
 */
function reachable(hand: readonly Card[], lead: readonly Card[], target: readonly Card[]): boolean {
  const sel: Card[] = [];
  for (const card of target) {
    if (!pickableCards(hand, T, lead, sel).has(cardKey(card))) return false;
    sel.push(card);
  }
  return true;
}

describe('领出：没有必出牌，整手都能点', () => {
  it('领出恒为空，且每一张都可点', () => {
    const hand = [c('C', 5), c('D', 2), c('S', 9)];
    assert.deepEqual(forcedPlay(hand, T, null), []);
    assert.deepEqual(forcedPlay(hand, T, []), []);
    assert.deepEqual(pick(hand, null, []), keys(hand));
  });
});

describe('该门够张数：结构钉死时自动选中，有第二种结构时把选择权留给玩家', () => {
  const lead = [c('C', 2), c('C', 3)]; // 副牌 2 顺（层号 1,2）

  it('只有一种合法组合 → 那几张就是必出牌', () => {
    const hand = [c('C', 5), c('C', 6)];
    assert.deepEqual(keys(forcedPlay(hand, T, lead)), keys(hand));
    // 必出的那两张不能取消：取消就没有合法解了
    assert.deepEqual(pick(hand, lead, hand), []);
  });

  it('持 3 顺 + 2 张跟 4 张：必出为空，二选一留给玩家', () => {
    const hand = [c('C', 14), c('C', 13), c('C', 12), c('C', 9), c('C', 8)];
    const four = [c('C', 2), c('C', 3), c('C', 4), c('C', 5)];
    assert.deepEqual(forcedPlay(hand, T, four), [], '两种合法结构都摆得出来，不该替玩家挑');

    const [A, K, Q, nine, eight] = hand as [Card, Card, Card, Card, Card];
    // 空手：五张都可能成为合法那一手的一部分
    assert.deepEqual(pick(hand, four, []), keys(hand));
    // A K 已选：Q / 9 / 8 都还能补成 3+1（8 的第四张只要挑 Q 就仍是 3+1）—— 这里不拦
    assert.deepEqual(pick(hand, four, [A, K]), keys(hand));
    // 只选了 8：**9 立刻被拒** —— 8 9 是一条 2 连，把它俩一起带上就只能排成 2+2
    assert.deepEqual(
      pick(hand, four, [eight]),
      keys(hand).filter((key) => key !== cardKey(nine))
    );
    // 8 9 已选：这一组已经凑不出 3+1，只能把它们撤回来
    assert.deepEqual(pick(hand, four, [nine, eight]), [cardKey(nine), cardKey(eight)].sort());
  });

  it('张数满了就不再收：已选的还能撤，没选的点不动', () => {
    const hand = [c('C', 14), c('C', 13), c('C', 12), c('C', 9), c('C', 8)];
    const four = [c('C', 2), c('C', 3), c('C', 4), c('C', 5)];
    const [A, K, Q, nine] = hand as [Card, Card, Card, Card, Card];
    assert.deepEqual(pick(hand, four, [A, K, Q, nine]), [cardKey(A), cardKey(K), cardKey(Q), cardKey(nine)].sort());
  });

  it('该门够时别的门一张都不许点', () => {
    const leadTrump = [c('H', 4)]; // 主牌单张领出
    const hand = [c('H', 2), c('H', 3), c('D', 2)];
    assert.deepEqual(forcedPlay(hand, T, leadTrump), [], '主牌两张任出一张，没有必出');
    assert.deepEqual(pick(hand, leadTrump, []), [cardKey(c('H', 2)), cardKey(c('H', 3))].sort());
  });
});

describe('该门不够：该门那几张必出，其余是自由垫牌', () => {
  const lead = [c('C', 2), c('C', 3)];
  const hand = [c('C', 5), c('D', 2), c('D', 3), c('S', 4)];
  const [five, d2, d3] = hand as [Card, Card, Card, Card];

  it('必出 = 手上的该门牌', () => {
    assert.deepEqual(keys(forcedPlay(hand, T, lead)), [cardKey(five)]);
  });

  it('垫牌随便点，必出的那张撤不掉', () => {
    assert.deepEqual(pick(hand, lead, []), keys(hand));
    // 必出已选：它不在可点集合里（撤不掉），其余还能补一张
    assert.deepEqual(pick(hand, lead, [five]), keys(hand.filter((card) => card !== five)));
    // 张数已满：只剩「撤掉自己垫的那张」
    assert.deepEqual(pick(hand, lead, [five, d2]), [cardKey(d2)]);
    // 缺门时没有必出牌，任意 n 张都合法
    const void_ = [c('D', 2), c('D', 3), c('S', 4)];
    assert.deepEqual(forcedPlay(void_, T, lead), []);
    assert.deepEqual(pick(void_, lead, []), keys(void_));
    assert.deepEqual(pick(void_, lead, [d2, d3]), [cardKey(d2), cardKey(d3)]);
  });
});

/* ---------------------------------------------------------------------- */
/* 穷举交叉校验：点得动 ≡ 裁判说合法                                       */
/* ---------------------------------------------------------------------- */

const HANDS: readonly (readonly Card[])[] = [
  [c('C', 14), c('C', 13), c('C', 12), c('C', 9), c('C', 8)],
  [c('C', 5), c('C', 6), c('C', 9), c('D', 2), c('D', 3)],
  [c('C', 5), c('D', 2), c('D', 3), c('S', 4), c('S', 5)],
  [c('H', 2), c('H', 3), c('H', 4), c('D', 2), c('S', 9)],
  [c('H', 7), c('D', 7), c('S', 7), c('C', 6), c('C', 9)],
  [c('H', 9), c('C', 5), c('C', 12), c('H', 10), c('D', 4)]
];

const LEADS: readonly Card[][] = [
  [c('C', 2)],
  [c('C', 2), c('C', 3)],
  [c('C', 2), c('C', 3), c('C', 4)],
  [c('C', 2), c('C', 3), c('C', 4), c('C', 5)],
  [c('H', 5)],
  [c('H', 5), c('H', 6)],
  [c('H', 5), c('H', 6), c('H', 8)]
];

describe('穷举校验：点得动的那一手，正是裁判认的那一手', () => {
  it('每个 n 元子集：checkPlay 说合法 ⇔ 界面点得出来', () => {
    let checked = 0;
    for (const hand of HANDS) {
      for (const lead of LEADS) {
        const n = lead.length;
        const holding = holdingOf(hand, lead);
        // 该门够：候选是该门的 n 元子集；不够：候选是「该门全出 + 任意垫满」
        const others = hand.filter((card) => !holding.includes(card));
        const candidates =
          holding.length >= n
            ? combinations(holding, n)
            : combinations(others, n - holding.length).map((extra) => [...holding, ...extra]);

        for (const cards of candidates) {
          const legal = checkPlay(hand, cards, T, lead) === null;
          const pointable = reachable(hand, lead, cards);
          assert.equal(
            pointable,
            legal,
            `手牌 ${keys(hand).join(' ')} 跟 ${keys(lead).join(' ')} 出 ${keys(cards).join(' ')}：` +
              `界面说${pointable ? '能点' : '点不动'}，裁判说${legal ? '合法' : '非法'}`
          );
          if (!legal) break; // 非法组合不必逐一复述，找到一个就够（下面还有合法性断言）
          checked += 1;
        }
      }
    }
    assert.ok(checked > 40, `合法组合样本太少（${checked}），这条断言等于没跑`);
  });

  it('必出的那几张恒在每一手合法牌里', () => {
    for (const hand of HANDS) {
      for (const lead of LEADS) {
        const forced = forcedPlay(hand, T, lead).map(cardKey);
        if (forced.length === 0) continue;
        const n = lead.length;
        const holding = holdingOf(hand, lead);
        const others = hand.filter((card) => !holding.includes(card));
        const candidates =
          holding.length >= n
            ? combinations(holding, n)
            : combinations(others, n - holding.length).map((extra) => [...holding, ...extra]);
        const legal = candidates.filter((cards) => checkPlay(hand, cards, T, lead) === null);
        assert.ok(legal.length > 0, '一手合法牌都摆不出来，牌局状态本身就错了');
        for (const cards of legal) {
          const have = new Set(cards.map(cardKey));
          for (const key of forced) {
            assert.ok(have.has(key), `必出牌 ${key} 不在这手合法牌 ${keys(cards).join(' ')} 里`);
          }
        }
      }
    }
  });
});
