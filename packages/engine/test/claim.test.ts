/**
 * 认赢（ADR-0028）：**引擎当场判**，成立就立刻按「剩余全收」结算。
 *
 * 判据两条，都在 `validate.ts`：
 * - `canWinTrickNow`：这一墩他压得住（结算把当前这一墩整墩收走）；
 * - `claimUnbeatable`：他手上每门都是**这门剩下的最大几张**，而且**所有主牌**都在他手上。
 *
 * 没有 30 秒窗口、没有两票：引擎手里有另外两家剩下的牌，这件事是可判的。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, type Action, type GameState } from '../src/state.ts';
import { publicView } from '../src/view.ts';
import { claimLastTrickSize, claimUnbeatable } from '../src/validate.ts';
import { cardKey } from '../src/cards.ts';
import { BJ, SJ, c, mulberry32, rigPlayDeal } from './helpers.ts';

const rng = mulberry32(7);
/** 底牌 25 分，且不与下面任何场景的手牌重叠 */
const KITTY_25 = [c('D', 5), c('D', 10), c('D', 13)];
const TRUMP = { strain: 'H', rank: 7 } as const;

function apply(state: GameState, action: Action): GameState {
  const res = dispatch(state, action, rng);
  if (!res.ok) throw new Error(`动作被拒：${res.message}`);
  return res.state;
}

function rejectedCode(state: GameState, action: Action): string {
  const res = dispatch(state, action, rng);
  assert.equal(res.ok, false, '这一步本该被拒');
  return (res as { code: string }).code;
}

const claim = (seat: 0 | 1 | 2): Action => ({ type: 'claim', seat });

/** 三家各两张黑桃：座位 0 手上是 A K（两家那四张都在它下面） */
function endgame(): GameState {
  return rigPlayDeal(
    [[c('S', 14), c('S', 13)], [c('S', 12), c('S', 11)], [c('S', 10), c('S', 9)]],
    KITTY_25
  );
}

describe('认赢：成立就当场结算', () => {
  it('领出时：每门都是剩下的最大几张、且主牌全在手 → 立刻「剩余全收」', () => {
    const declared = apply(endgame(), claim(0));
    const deal = declared.deal!;
    assert.equal(deal.phase, 'scored', '认领成立的那一帧就已经结算了，没有「等两票」的中间态');
    assert.deepEqual(deal.hands, [[], [], []]);
    assert.equal(deal.trick, null);

    const summary = deal.summary!;
    // 末轮张数由引擎算：手上最长的一条顺子（♠A♠K）
    assert.deepEqual(summary.claim, { seat: 0, lastTrick: 2, cards: 6 });
    // ♠K 10 分 + ♠10 10 分 = 20；庄家认赢 → 保底按 2 倍底牌
    assert.equal(summary.declarerTrickPoints, 20);
    assert.equal(summary.protectedBottom, true);
    assert.equal(summary.multiplier, 2);
    assert.equal(summary.finalScore, 20 + 2 * 25);
    assert.equal(summary.made, true);
  });

  it('跟牌时也能认（这一墩也算进去），末轮张数扣掉这一墩要打出的张数', () => {
    // 座位 0 领 ♠2；座位 1 手上 ♠A♠K —— 但要先跟掉这一墩一张，末轮最多只剩 1 张
    const base = rigPlayDeal(
      [[c('S', 2), c('S', 3)], [c('S', 14), c('S', 13)], [c('S', 4), c('S', 5)]],
      KITTY_25
    );
    const afterLead = apply(base, { type: 'play', seat: 0, cards: [c('S', 2)] });
    const declared = apply(afterLead, claim(1));
    const summary = declared.deal!.summary!;
    // 剩下的 = 这一墩已经打出的 ♠2 + 三家手牌 5 张
    assert.deepEqual(summary.claim, { seat: 1, lastTrick: 1, cards: 6 });
    assert.equal(summary.multiplier, 1, '末轮张数扣掉了当前这一墩的那一张');
  });

  it('三家等长时这一墩就是末墩，末轮张数只能是它', () => {
    const base = rigPlayDeal(
      [[c('S', 2), c('S', 3)], [c('S', 14), c('S', 13)], [c('S', 4), c('S', 5)]],
      KITTY_25
    );
    const afterLead = apply(base, { type: 'play', seat: 0, cards: [c('S', 2), c('S', 3)] });
    const declared = apply(afterLead, claim(1));
    assert.equal(declared.deal!.summary!.claim!.lastTrick, 2);
    assert.equal(declared.deal!.summary!.multiplier, 2);
  });

  it('闲家认赢：庄家这一副不再抓分，底牌按抠底计', () => {
    // 庄家是座位 2，他领 ♠4；座位 0 手上 ♠A♠K 压得住，而且对面谁也没它大
    const base = rigPlayDeal(
      [[c('S', 14), c('S', 13)], [c('S', 2), c('S', 3)], [c('S', 4), c('S', 5)]],
      KITTY_25,
      { declarerSeat: 2 }
    );
    const afterLead = apply(base, { type: 'play', seat: 2, cards: [c('S', 4)] });
    const declared = apply(afterLead, claim(0));
    const summary = declared.deal!.summary!;
    assert.equal(summary.protectedBottom, false);
    assert.equal(summary.declarerTrickPoints, 0);
    assert.equal(summary.finalScore, -1 * 25);
    assert.equal(summary.made, false);
  });
});

describe('认赢：不成立就当场拒', () => {
  it('上一局那手：小王在手，但大王与 ♣A 都在对面 → 不成立', () => {
    // 将牌 ♣、级牌 2 —— 与 `claim-check.db` 里那一副同型
    const trump = { strain: 'C', rank: 2 } as const;
    const hand = [
      SJ,
      c('C', 2),
      c('C', 12),
      c('C', 7),
      c('C', 5),
      c('C', 4),
      c('H', 14),
      c('H', 13),
      c('H', 2),
      c('D', 14),
      c('D', 13),
      c('D', 12),
      c('D', 10),
      c('D', 7),
      c('D', 6),
      c('D', 5),
      c('D', 3)
    ];
    assert.equal(claimUnbeatable(hand, [BJ, c('C', 14), c('C', 13)], trump), false, '大王在对手手里');
    assert.equal(claimUnbeatable(hand, [], trump), true, '对手两手空空时才成立');
  });

  it('对手还捏着主牌 → claim_refuted', () => {
    const base = rigPlayDeal(
      [[c('S', 14), c('S', 13)], [c('H', 2), c('C', 5)], [c('S', 10), c('S', 9)]],
      KITTY_25
    );
    assert.equal(claimUnbeatable([c('S', 14), c('S', 13)], [c('H', 2), c('C', 5)], TRUMP), false);
    assert.equal(rejectedCode(base, claim(0)), 'claim_refuted');
  });

  it('对手只捏着更小的主牌：一轮一轮抽干就赢了 → 成立（实测里被误拒的那一手）', () => {
    // 将牌 ♦、级牌 2：四张 2 全是主牌，而对手只剩 ♦A ♦K 两张小主牌 —— 他从 2 领起，
    // 对手必须跟，每轮抽掉一张、且每轮都是他赢；抽完对手一张主牌也没有了。
    const trump = { strain: 'D', rank: 2 } as const;
    assert.equal(
      claimUnbeatable([c('D', 2), c('H', 2), c('S', 2), c('C', 2)], [c('D', 14), c('D', 13), c('C', 14)], trump),
      true
    );
    // 对手的主牌比他多一张 → 抽不干，仍要拒
    assert.equal(claimUnbeatable([c('D', 2)], [c('D', 14), c('D', 13)], trump), false);
    // 对手有一张比天还大的主牌（大王）→ 拒
    assert.equal(claimUnbeatable([c('D', 2), c('H', 2)], [BJ], trump), false);
    // 副牌那一条照旧：他这条顺子之外，对手还有更大的同门牌就拒
    assert.equal(claimUnbeatable([c('D', 2), c('H', 2), c('S', 3)], [c('S', 4)], trump), false);
  });

  it('抽干主牌之后领副牌：同门最大几张 → 当场结算', () => {
    const base = rigPlayDeal(
      [
        [c('D', 2), c('H', 2), c('S', 2), c('C', 2)],
        [c('D', 14), c('D', 13), c('C', 14), c('C', 13)],
        [c('H', 11), c('H', 8), c('H', 7), c('H', 6)]
      ],
      KITTY_25,
      { trump: { strain: 'D', rank: 2 } }
    );
    const declared = apply(base, claim(0));
    const summary = declared.deal!.summary!;
    assert.equal(summary.claim!.cards, 12, '剩余全收：三家手上那 12 张');
    // 四张 2 里只有两张是「不同层」（将牌自己那张 14，其余三张同为 13），所以末轮能领 2 张
    assert.equal(summary.claim!.lastTrick, 2);
  });

  it('他的门里有对手更大的牌 → claim_refuted', () => {
    const base = rigPlayDeal(
      [[c('S', 13), c('S', 12)], [c('S', 14), c('S', 2)], [c('S', 4), c('S', 5)]],
      KITTY_25
    );
    // 我最小是 ♠Q，座位 1 有 ♠A
    assert.equal(claimUnbeatable([c('S', 13), c('S', 12)], [c('S', 14), c('S', 2)], TRUMP), false);
    assert.equal(rejectedCode(base, claim(0)), 'claim_refuted');
  });

  it('这一墩已经赢不了 → claim_unwinnable（先出一手压得住的牌）', () => {
    const base = rigPlayDeal(
      [[c('S', 14), c('S', 13)], [c('S', 12), c('S', 11)], [c('S', 10), c('S', 9)]],
      KITTY_25
    );
    const afterLead = apply(base, { type: 'play', seat: 0, cards: [c('S', 14)] });
    // 座位 1 手上最大的 ♠Q 压不过 ♠A
    assert.equal(rejectedCode(afterLead, claim(1)), 'claim_unwinnable');
  });

  it('不是你的回合 / 不在出牌阶段', () => {
    assert.equal(rejectedCode(endgame(), claim(1)), 'not_your_turn');
    const scored = apply(endgame(), claim(0));
    assert.equal(rejectedCode(scored, claim(0)), 'not_play');
  });
});

describe('认赢：末轮张数的算法', () => {
  it('领出取最长顺子；跟牌扣掉这一墩；三家等长时等于这一墩', () => {
    assert.equal(claimLastTrickSize([c('S', 2), c('S', 3), c('S', 4)], [], TRUMP), 3);
    assert.equal(claimLastTrickSize([c('S', 2), c('D', 3)], [], TRUMP), 1);
    assert.equal(claimLastTrickSize([], [], TRUMP), null);

    const plays = [{ seat: 0 as const, cards: [c('S', 2)] }];
    assert.equal(claimLastTrickSize([c('S', 14), c('S', 13), c('S', 12)], plays, TRUMP), 2);
    assert.equal(claimLastTrickSize([c('S', 14)], plays, TRUMP), 1, '三家等长：这一墩就是末墩');
  });
});

describe('认赢：公共视图', () => {
  it('亮牌进公共视图（观战者同款），没有票也没有时间戳', () => {
    const declared = apply(endgame(), claim(0));
    const claimView = publicView(declared).deal!.claim!;
    assert.equal(claimView.claimant, 0);
    assert.equal(claimView.lastTrick, 2);
    assert.deepEqual(claimView.revealed.map(cardKey).sort(), [c('S', 14), c('S', 13)].map(cardKey).sort());
    for (const gone of ['answers', 'status', 'rejectedBy', 'expiresAt']) {
      assert.equal(gone in claimView, false, `公共视图里不该再有 ${gone}：认赢当场就给结果`);
    }
  });
});
