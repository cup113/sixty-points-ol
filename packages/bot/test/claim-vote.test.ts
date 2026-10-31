/**
 * 认赢投票（ADR-0028）：机器人只会投「认输 / 不认」这一票，判据是
 * **我还能不能从他亮出来的这手牌里拿下一墩**。固定局面 → 固定结论，所以直接钉死到牌。
 *
 * 两组断言方向相反，缺一不可：
 * - 能拿下一墩时必须投「不认」（否则把不该给的墩送给认赢者、算错分）；
 * - 拿不下时必须投「认输」（否则机器人桌上这条机制根本不存在，白白打完剩下的牌）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGame,
  dealWith,
  personalView,
  type Card,
  type DealState,
  type PersonalView,
  type Rank,
  type Seat,
  type Suit,
  type TrumpModel
} from '@sixty/engine';
import { claimVote, moveFor } from '../src/policy.ts';

const c = (suit: Suit, rank: Rank): Card => ({ suit, rank });
const TRUMP: TrumpModel = { strain: 'H', rank: 7 };

interface ViewOptions {
  /** 我的手牌 */
  readonly hand: readonly Card[];
  /** 认赢者亮出来的牌 */
  readonly revealed: readonly Card[];
  readonly trump?: TrumpModel;
  readonly seat?: Seat;
  readonly claimant?: Seat;
  /** 当前这一墩已经出的牌（为空＝认赢者领出） */
  readonly plays?: readonly { readonly seat: Seat; readonly cards: readonly Card[] }[];
  readonly leader?: Seat;
}

/** 一副只有出牌阶段的局面：我的座位、我手里的牌、认赢者亮出来的牌、当前墩 */
function claimView(options: ViewOptions): PersonalView {
  const seat = options.seat ?? 0;
  const claimant = options.claimant ?? 1;
  const trump = options.trump ?? TRUMP;
  const plays = options.plays ?? [];
  const hands: Card[][] = [[], [], []];
  hands[seat] = [...options.hand];
  hands[claimant] = [...options.revealed];
  const other = ([0, 1, 2] as Seat[]).find((s) => s !== seat && s !== claimant)!;
  hands[other] = [c('D', 4), c('D', 3)];

  const game = createGame(0);
  const deal: DealState = dealWith(hands, [], 0, 1);
  deal.phase = 'play';
  deal.contract = { points: 40, strain: trump.strain, declarerSeat: claimant };
  deal.trump = trump;
  deal.trick = {
    leaderSeat: options.leader ?? plays[0]?.seat ?? claimant,
    plays: plays.map((play) => ({ ...play }))
  };
  deal.claim = {
    claimant,
    lastTrick: 1,
    revealed: [...options.revealed],
    answers: [null, null, null],
    status: 'pending',
    rejectedBy: null,
    expiresAt: 1,
    swept: 0
  };
  game.deal = deal;
  return personalView(game, seat);
}

test('同门压顶：我这一门顶张比他大、且凑得出他那一门的长度 → 不认', () => {
  const view = claimView({ hand: [c('S', 14)], revealed: [c('S', 13)] });
  assert.equal(claimVote(view, view.you), false);
});

test('同门压顶要凑得出长度：他领两张顺子，我只有一张更大的单张 → 认输', () => {
  const view = claimView({ hand: [c('S', 14), c('D', 2)], revealed: [c('S', 13), c('S', 12)] });
  // 他领 ♠K-Q 两张时我只有一张 ♠A：跟牌是结构性的，赢不了 —— 光有一张大牌不够
  assert.equal(claimVote(view, view.you), true);
});

test('他这一门比我大 → 认输', () => {
  const view = claimView({ hand: [c('C', 2)], revealed: [c('C', 14), c('C', 13)] });
  assert.equal(claimVote(view, view.you), true);
});

test('缺门杀牌：我的主牌顺子不短于他那一门 → 不认', () => {
  const view = claimView({ hand: [c('H', 2), c('H', 3), c('D', 2)], revealed: [c('C', 14), c('C', 13)] });
  // 他迟早得领 ♣，我缺门 → 两张连主杀下去
  assert.equal(claimVote(view, view.you), false);
});

test('缺门但主牌不够长 → 认输', () => {
  const view = claimView({ hand: [c('H', 2), c('D', 2)], revealed: [c('C', 14), c('C', 13)] });
  // 只有一张主牌，杀不了两顺
  assert.equal(claimVote(view, view.you), true);
});

test('当前墩已经归别人：他压不过桌上最好的那手 → 不认（他连这一墩都收不下来）', () => {
  // 座位 0 领 ♣A、座位 1 跟 ♣3，认赢者（座位 2）跟牌前发起认赢：他亮的是两张 ♠，
  // 既跟不出 ♣、也没有主牌 —— 这一墩本来就归座位 0，认赢的「剩余全收」不成立。
  const view = claimView({
    seat: 0,
    claimant: 2,
    hand: [c('D', 2)],
    revealed: [c('S', 5), c('S', 6)],
    plays: [
      { seat: 0, cards: [c('C', 14)] },
      { seat: 1, cards: [c('C', 3)] }
    ]
  });
  assert.equal(claimVote(view, view.you), false);
});

test('排在他后面：我压得住他最好的一手 → 不认（这一墩的张数不是他能挑的）', () => {
  // 座位 0 领 ♣5，认赢者（座位 1）手里 ♣KQJ 最好也只能跟 ♣K，座位 2 的 ♣A 压得住。
  // 他那门最长的一条是 3，但这一墩只要 1 张 —— 拿「最长的一条」比会漏掉这张 ♣A。
  const view = claimView({
    seat: 2,
    claimant: 1,
    hand: [c('C', 14)],
    revealed: [c('C', 13), c('C', 12), c('C', 11)],
    plays: [{ seat: 0, cards: [c('C', 5)] }]
  });
  assert.equal(claimVote(view, view.you), false);
});

test('更低但压得过的段也算：大王之外还有一条更低的连主 → 不认', () => {
  // 主 ♥、级牌 7：他的 ♥A♥K 是两张连主（11、12）；我的 ♠7♥7 也是两张连主（13、14），压得过他。
  // 我另外还有一张大王（16）—— 它与 14 之间断了 15，所以只能数到那条更低的段。
  const view = claimView({
    hand: [c('S', 7), c('H', 7), { joker: 'big' } as Card],
    revealed: [c('H', 14), c('H', 13)]
  });
  assert.equal(claimVote(view, view.you), false);
});

test('已经出完牌：一张牌都没有 → 认输（不能把空手当成一张主牌）', () => {
  // 最后一墩：座位 2 领 ♠10，座位 0（我）跟 ♠3 后手牌已空，认赢者（座位 1）手里只剩 ♠A。
  // 空手既没有牌、也没有主牌；♠A 会压过 ♠10，这一墩归他 —— 认输。
  const view = claimView({
    seat: 0,
    claimant: 1,
    hand: [],
    revealed: [c('S', 14)],
    plays: [
      { seat: 2, cards: [c('S', 10)] },
      { seat: 0, cards: [c('S', 3)] }
    ],
    leader: 2
  });
  assert.equal(claimVote(view, view.you), true);
});

test('没有主牌的人不能「杀」他那一门 → 认输', () => {
  // 他只有一张 ♣A，我缺 ♣ 但也没有任何主牌：他领 ♣ 我压不住，认输。
  const view = claimView({ hand: [c('D', 2)], revealed: [c('C', 14)] });
  assert.equal(claimVote(view, view.you), true);
});

test('认赢待表决时：对手投一票，认赢者与已投票的人都不动', () => {
  const view = claimView({ hand: [c('S', 14)], revealed: [c('S', 13)], claimant: 1 });

  const mine = moveFor(view, view.you);
  assert.deepEqual(mine, { type: 'claimAnswer', agree: false });

  // 认赢者自己：没有动作可做
  assert.equal(moveFor(view, { ...view.you, seat: 1 }), null);

  // 已经投过票的对手：也不再来一次
  const voted: PersonalView = {
    ...view,
    deal: { ...view.deal!, claim: { ...view.deal!.claim!, answers: [true, null, null] } }
  };
  assert.equal(moveFor(voted, voted.you), null);
});
