import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, playTurn, type Action, type GameState } from '../src/state.ts';
import { publicView } from '../src/view.ts';
import { longestRun } from '../src/order.ts';
import { canWinTrickNow } from '../src/trick.ts';
import { claimLastTrickRange } from '../src/validate.ts';
import { cardKey } from '../src/cards.ts';
import { c, mulberry32, rigPlayDeal } from './helpers.ts';

const rng = mulberry32(7);
const KITTY_25 = [c('S', 5), c('S', 10), c('S', 13)];

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

const declare = (seat: 0 | 1 | 2, lastTrick = 1): Action => ({
  type: 'claim',
  seat,
  lastTrick,
  expiresAt: 1
});

/** 两家各两张、底牌 25 分：庄家（座位 0）领出，随时可以认赢 */
function twoCardsEach(): GameState {
  return rigPlayDeal(
    [[c('C', 5), c('C', 10)], [c('C', 6), c('C', 4)], [c('D', 3), c('D', 4)]],
    KITTY_25
  );
}

describe('认赢：发起', () => {
  it('只有轮到出牌的人能发起；一副至多一次；待表决时没有人轮到出牌', () => {
    const base = twoCardsEach();
    assert.equal(rejectedCode(base, declare(1)), 'not_your_turn');

    const declared = apply(base, declare(0));
    const claim = declared.deal!.claim!;
    assert.equal(claim.status, 'pending');
    assert.equal(claim.claimant, 0);
    assert.equal(claim.lastTrick, 1);
    assert.equal(claim.revealed.length, 2);
    assert.equal(playTurn(declared.deal!), null);

    // 牌局冻结：出牌与第二次认赢都被拒
    assert.equal(rejectedCode(declared, { type: 'play', seat: 0, cards: [c('C', 5)] }), 'claim_pending');
    assert.equal(rejectedCode(declared, declare(1)), 'already_claimed');
  });

  it('末轮张数落在 1..手上最长顺子：单张牌手只能报 1，三连可以报 3', () => {
    const base = twoCardsEach();
    assert.equal(rejectedCode(base, declare(0, 0)), 'bad_last_trick');
    assert.equal(rejectedCode(base, declare(0, 2)), 'bad_last_trick');

    const runHand = rigPlayDeal(
      [[c('C', 2), c('C', 3), c('C', 4)], [c('D', 9), c('D', 10)], [c('S', 2), c('S', 3)]],
      KITTY_25
    );
    assert.equal(longestRun(runHand.deal!.hands[0]!, runHand.deal!.trump!), 3);
    assert.equal(apply(runHand, declare(0, 3)).deal!.claim!.lastTrick, 3);
    assert.equal(rejectedCode(runHand, declare(0, 4)), 'bad_last_trick');
  });

  it('跟牌时也能发起（这一墩也算进去）', () => {
    const afterLead = apply(twoCardsEach(), { type: 'play', seat: 0, cards: [c('C', 5)] });
    const declared = apply(afterLead, declare(1));
    assert.equal(declared.deal!.claim!.claimant, 1);
    assert.equal(declared.deal!.claim!.revealed.length, 2);
    assert.equal(playTurn(declared.deal!), null);
  });
});

describe('认赢：这一墩赢不赢得了', () => {
  it('跟牌时这一墩已经赢不了：引擎直接拒，不交给两张票', () => {
    // 座位 0 领 ♣5，座位 1 只有 ♣3♣4：跟 ♣5 压不过（也没主牌），这一墩必归座位 0。
    // 认赢把当前这一墩一起收走，所以这种认领在发起那一刻就不成立。
    const base = rigPlayDeal(
      [[c('C', 5), c('C', 10)], [c('C', 3), c('C', 4)], [c('D', 3), c('D', 4)]],
      KITTY_25
    );
    const afterLead = apply(base, { type: 'play', seat: 0, cards: [c('C', 5)] });
    assert.equal(rejectedCode(afterLead, declare(1)), 'claim_unwinnable');
  });

  it('桌上已经有人杀着：本门顺子压不过，要更高的主牌连才救得回来', () => {
    const trump = { strain: 'H', rank: 7 } as const;
    const plays = [
      { seat: 0 as const, cards: [c('C', 9), c('C', 8)] },
      { seat: 1 as const, cards: [c('H', 2), c('H', 3)] }
    ];
    // 他是第三家：手里有更高的 ♣ 顺子也没用（副牌压不过杀牌）
    assert.equal(canWinTrickNow([c('C', 13), c('C', 12)], plays, trump), false);
    // 缺门、两张更高的连主：才能反杀
    assert.equal(canWinTrickNow([c('H', 5), c('H', 6)], plays, trump), true);
  });

  it('缺门杀牌算赢；半跟 + 垫牌不算；空墩恒算', () => {
    const trump = { strain: 'H', rank: 7 } as const;
    const lead = [{ seat: 0 as const, cards: [c('C', 13), c('C', 12)] }];
    // 缺门、两张连主：一杀就赢
    assert.equal(canWinTrickNow([c('H', 2), c('H', 3)], lead, trump), true);
    // 有 ♣2 就得先跟一张 ♣，剩下那张垫 —— 结构性跟牌赢不了
    assert.equal(canWinTrickNow([c('C', 2), c('H', 3)], lead, trump), false);
    // 轮我领出：还没有人压我
    assert.equal(canWinTrickNow([c('C', 2)], [], trump), true);
  });
});

describe('认赢：末轮张数的区间', () => {
  it('跟牌要扣掉这一墩：三家三张、他领一张 → 最多 2（手上最长顺子正好 2）', () => {
    const base = rigPlayDeal(
      [[c('C', 2), c('D', 2), c('S', 2)], [c('C', 4), c('C', 5), c('C', 9)], [c('D', 3), c('D', 4), c('D', 5)]],
      KITTY_25
    );
    const afterLead = apply(base, { type: 'play', seat: 0, cards: [c('C', 2)] });
    const plays = afterLead.deal!.trick!.plays;
    assert.deepEqual(claimLastTrickRange(afterLead.deal!.hands[1]!, plays, afterLead.deal!.trump!), {
      min: 1,
      max: 2
    });
    assert.equal(apply(afterLead, declare(1, 2)).deal!.claim!.lastTrick, 2);
    assert.equal(rejectedCode(afterLead, declare(1, 3)), 'bad_last_trick');
  });

  it('三家等长时这一墩就是末墩：x 只能等于它', () => {
    // 三家各两张、座位 0 领两张顺子 → 座位 1 打完这一墩，三家同时空手
    const base = rigPlayDeal(
      [[c('C', 2), c('C', 3)], [c('C', 4), c('C', 5)], [c('D', 3), c('D', 4)]],
      KITTY_25
    );
    const afterLead = apply(base, { type: 'play', seat: 0, cards: [c('C', 2), c('C', 3)] });
    const plays = afterLead.deal!.trick!.plays;
    assert.deepEqual(claimLastTrickRange(afterLead.deal!.hands[1]!, plays, afterLead.deal!.trump!), {
      min: 2,
      max: 2
    });
    assert.equal(rejectedCode(afterLead, declare(1, 1)), 'bad_last_trick');
    assert.equal(apply(afterLead, declare(1, 2)).deal!.claim!.lastTrick, 2);
  });
});

describe('认赢：两张票', () => {
  it('认赢者本人不投票，同一个人不能投两次', () => {
    const declared = apply(twoCardsEach(), declare(0));
    assert.equal(rejectedCode(declared, { type: 'claimAnswer', seat: 0, agree: true }), 'claimant_votes');
    const voted = apply(declared, { type: 'claimAnswer', seat: 1, agree: true });
    assert.equal(rejectedCode(voted, { type: 'claimAnswer', seat: 1, agree: true }), 'already_voted');
    assert.equal(rejectedCode(twoCardsEach(), { type: 'claimAnswer', seat: 1, agree: true }), 'no_claim');
  });

  it('一票不同意：立即失败，牌局从原处继续，亮牌留着', () => {
    const declared = apply(twoCardsEach(), declare(0));
    const failed = apply(declared, { type: 'claimAnswer', seat: 2, agree: false });
    const claim = failed.deal!.claim!;
    assert.equal(claim.status, 'rejected');
    assert.equal(claim.rejectedBy, 2);
    assert.deepEqual(claim.revealed.map(cardKey), declared.deal!.claim!.revealed.map(cardKey));
    assert.equal(playTurn(failed.deal!), 0);
    // 牌局真的继续：领出照旧合法
    assert.equal(apply(failed, { type: 'play', seat: 0, cards: [c('C', 5)] }).deal!.phase, 'play');
  });

  it('超时等于一票否决（fail-closed），且幂等', () => {
    const declared = apply(twoCardsEach(), declare(0));
    const timedOut = apply(declared, { type: 'claimTimeout' });
    assert.equal(timedOut.deal!.claim!.status, 'rejected');
    assert.equal(timedOut.deal!.claim!.rejectedBy, null);
    assert.equal(playTurn(timedOut.deal!), 0);
    // 晚到的定时器再来一次也不会改任何东西
    const again = apply(timedOut, { type: 'claimTimeout' });
    assert.equal(again.deal!.claim!.status, 'rejected');
  });
});

describe('认赢：剩余全收的结算', () => {
  it('庄家认赢：剩下的牌全进他的墩，保底按他报的 x 计', () => {
    const declared = apply(twoCardsEach(), declare(0));
    const voted = apply(
      apply(declared, { type: 'claimAnswer', seat: 1, agree: true }),
      { type: 'claimAnswer', seat: 2, agree: true }
    );
    const deal = voted.deal!;
    assert.equal(deal.phase, 'scored');
    assert.deepEqual(deal.hands, [[], [], []]);
    assert.equal(deal.trick, null);

    const summary = deal.summary!;
    assert.deepEqual(summary.claim, { seat: 0, lastTrick: 1, cards: 6 });
    assert.equal(summary.declarerTrickPoints, 15);
    assert.equal(summary.protectedBottom, true);
    assert.equal(summary.multiplier, 1);
    assert.equal(summary.kittyPoints, 25);
    assert.equal(summary.finalScore, 40);
    assert.equal(summary.made, true);
    assert.deepEqual(summary.levelChanges.map((change) => [change.seat, change.levels]), [[0, 1]]);
  });

  it('闲家认赢：庄家这一副不再抓分，底牌按抠底计', () => {
    const afterLead = apply(twoCardsEach(), { type: 'play', seat: 0, cards: [c('C', 5)] });
    const declared = apply(afterLead, declare(1));
    const voted = apply(
      apply(declared, { type: 'claimAnswer', seat: 0, agree: true }),
      { type: 'claimAnswer', seat: 2, agree: true }
    );
    const summary = voted.deal!.summary!;
    assert.deepEqual(summary.claim, { seat: 1, lastTrick: 1, cards: 6 });
    assert.equal(summary.declarerTrickPoints, 0);
    assert.equal(summary.protectedBottom, false);
    assert.equal(summary.finalScore, -25);
    assert.equal(summary.made, false);
    // 差 65 分 → 两名闲家各升 ceil(65/10) = 7 级
    assert.deepEqual(summary.levelChanges.map((change) => [change.seat, change.levels]), [
      [1, 7],
      [2, 7]
    ]);
  });

  it('被拒的认赢不劫持正常结算：那一副仍按真打完的末墩计', () => {
    const declared = apply(twoCardsEach(), declare(0));
    const failed = apply(declared, { type: 'claimAnswer', seat: 1, agree: false });
    const played = apply(
      apply(
        apply(apply(failed, { type: 'play', seat: 0, cards: [c('C', 5)] }), { type: 'play', seat: 1, cards: [c('C', 4)] }),
        { type: 'play', seat: 2, cards: [c('D', 3)] }
      ),
      { type: 'play', seat: 0, cards: [c('C', 10)] }
    );
    const scored = apply(apply(played, { type: 'play', seat: 1, cards: [c('C', 6)] }), {
      type: 'play',
      seat: 2,
      cards: [c('D', 4)]
    });
    const summary = scored.deal!.summary!;
    assert.equal(summary.claim, null);
    assert.equal(summary.multiplier, 1);
    assert.equal(summary.finalScore, 40);
    assert.equal(scored.deal!.claim!.status, 'rejected');
  });
});

describe('认赢：公共视图', () => {
  it('亮牌进公共视图（观战者同款），截止时刻不出服务端', () => {
    const declared = apply(twoCardsEach(), declare(0));
    const view = publicView(declared);
    const claim = view.deal!.claim!;
    assert.equal(claim.claimant, 0);
    assert.equal(claim.status, 'pending');
    assert.deepEqual(claim.answers, [null, null, null]);
    assert.deepEqual(claim.revealed.map(cardKey).sort(), [c('C', 5), c('C', 10)].map(cardKey).sort());
    assert.equal('expiresAt' in claim, false);
    assert.equal('swept' in claim, false);
    // 被拒之后仍然公开
    const failed = apply(declared, { type: 'claimAnswer', seat: 1, agree: false });
    assert.deepEqual(publicView(failed).deal!.claim!.revealed.map(cardKey), claim.revealed.map(cardKey));
  });
});
