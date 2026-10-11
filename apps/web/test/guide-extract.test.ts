/**
 * 提取管线：**已结算状态 → 引导局草稿 → 校验通过**。
 *
 * 这条链就是真实数据进来时走的那条（`guide:extract` → 人工补引导词 → `guide`），
 * 所以这里用引擎合成的整副牌把它整条跑一遍：还原的三家手牌必须等于发牌时的那三手，
 * 动作序列必须能重放出同一个结算。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { cardKey, createGame, removeCards, type GameState, type Seat } from '@sixty/engine';
import { extractDeal } from '../src/lib/guide/extract.ts';
import { parseGuideDeal, validateGuideDeal } from '../src/lib/guide/validate.ts';
import type { GuideDealData } from '../src/lib/guide/types.ts';
import { playDeal } from './guide-fixture.ts';

/** 把草稿补成一整份引导数据（引导词按座位自动铺满占位文本 + 合乎口径的代称） */
function finishDraft(draft: ReturnType<typeof extractDeal>, learnerSeat: Seat): GuideDealData {
  assert.equal(draft.ok, true);
  if (!draft.ok) throw new Error('unreachable');
  const guides: Record<string, { readonly text: string }> = {};
  draft.draft.actions.forEach((action, index) => {
    if (action.seat === learnerSeat) guides[String(index)] = { text: `引导词 #${index}` };
  });
  const aliases = ['甲', '乙', '丙'].map((alias, seat) => (seat === learnerSeat ? '你' : alias));
  return {
    ...draft.draft,
    title: '提取出来的这一副',
    learnerSeat,
    role: learnerSeat === draft.features.declarerSeat ? 'declarer' : 'defender',
    aliases: aliases as unknown as [string, string, string],
    guides,
    review: { intro: '开篇', outro: '收尾' }
  };
}

test('提取：还原的三家手牌与发牌时一模一样，动作序列重放出同一个结算', () => {
  for (const seed of [3, 7, 11]) {
    const played = playDeal(seed);
    const result = extractDeal(played.finalState, { table: 'TEST01', date: '2025-01-01' }, `test-${String(seed)}`);
    assert.equal(result.ok, true, `种子 ${seed} 提取失败`);
    if (!result.ok) continue;

    assert.deepEqual(
      result.draft.facts.hands.map((hand) => [...hand].sort()),
      played.hands.map((hand) => hand.map(cardKey).sort()),
      `种子 ${seed}：还原的手牌与发牌时不一致`
    );
    assert.deepEqual(result.draft.facts.originalKitty, played.kitty.map(cardKey));
    assert.equal(result.draft.expect.finalScore, played.finalState.deal!.summary!.finalScore);

    // 叫牌条数 = 记录里的叫牌；埋底 1 条；出牌的**张数**合计 51（一条动作可以是一条顺子，所以看张数）
    const bids = result.draft.actions.filter((action) => action.type === 'bid').length;
    const buries = result.draft.actions.filter((action) => action.type === 'bury').length;
    const plays = result.draft.actions.filter((action) => action.type === 'play');
    assert.equal(bids, played.finalState.deal!.auction.length);
    assert.equal(buries, 1);
    assert.deepEqual(
      [0, 1, 2].map((seat) =>
        plays.filter((action) => action.seat === seat).reduce((sum, action) => sum + action.cards.length, 0)
      ),
      [17, 17, 17],
      '三家打出的张数各 17'
    );
  }
});

test('草稿补完引导词后过校验：结构 + 语义（重放合法性、存证、引导词覆盖）', () => {
  const played = playDeal(7);
  const result = extractDeal(played.finalState, { table: 'TEST01', date: '2025-01-01' }, 'test-07');
  assert.equal(result.ok, true);
  if (!result.ok) return;

  for (const learnerSeat of [0, 1, 2] as Seat[]) {
    const deal = finishDraft(result, learnerSeat);
    const parsed = parseGuideDeal(JSON.parse(JSON.stringify(deal)) as unknown, 'test-07');
    assert.equal(parsed.ok, true, `座位 ${learnerSeat} 的草稿结构校验失败`);
    if (!parsed.ok) continue;
    assert.deepEqual(validateGuideDeal(parsed.deal), [], `座位 ${learnerSeat} 的草稿语义校验失败`);
  }
});

test('提取的负例：没结算、底牌对不上、三家全不叫做发（都如实拒绝）', () => {
  const played = playDeal(7);

  const notScored: GameState = { ...played.finalState, deal: { ...played.finalState.deal!, phase: 'play', summary: null } };
  const early = extractDeal(notScored, { table: 'TEST01', date: '2025-01-01' }, 'x');
  assert.equal(early.ok, false);
  if (!early.ok) assert.match(early.reasons.join('；'), /还没结算/);

  // 换掉一张「拿上来的底牌」，庄家的原始 17 张就反推不出来（removeCards 会失败）
  const swapped = removeCards(played.kitty, [played.kitty[0]!])!;
  const brokenKitty: GameState = {
    ...played.finalState,
    deal: { ...played.finalState.deal!, originalKitty: [...swapped, ...played.hands[2]!.slice(0, 1)] }
  };
  const broken = extractDeal(brokenKitty, { table: 'TEST01', date: '2025-01-01' }, 'x');
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.match(broken.reasons.join('；'), /还原不出来|不是 3 张/);

  // 全 pass 的副（作废重发）不能当引导局
  const allPass: GameState = {
    ...played.finalState,
    deal: {
      ...played.finalState.deal!,
      auction: [
        { seat: 0, call: 'pass' },
        { seat: 1, call: 'pass' },
        { seat: 2, call: 'pass' }
      ]
    }
  };
  const passed = extractDeal(allPass, { table: 'TEST01', date: '2025-01-01' }, 'x');
  assert.equal(passed.ok, false);
  if (!passed.ok) assert.match(passed.reasons.join('；'), /全不叫/);

  // 还没发过牌的空桌
  const empty = extractDeal(createGame(0), { table: 'TEST01', date: '2025-01-01' }, 'x');
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.reasons.join('；'), /还没发过牌/);
});

test('校验负例：缺引导词、给对手写引导词、存证被改，都必须报出来', () => {
  const played = playDeal(7);
  const result = extractDeal(played.finalState, { table: 'TEST01', date: '2025-01-01' }, 'test-07');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const deal = finishDraft(result, 0);

  const learnerIndex = deal.actions.findIndex((action) => action.seat === deal.learnerSeat);
  const opponentIndex = deal.actions.findIndex((action) => action.seat !== deal.learnerSeat);

  const missing = { ...deal, guides: Object.fromEntries(Object.entries(deal.guides).filter(([key]) => key !== String(learnerIndex))) };
  assert.ok(validateGuideDeal(missing).some((problem) => /缺引导词/.test(problem.message)));

  const opponentGuide = { ...deal, guides: { ...deal.guides, [String(opponentIndex)]: { text: '不该有' } } };
  assert.ok(validateGuideDeal(opponentGuide).some((problem) => /对手的动作|不属于用户座位/.test(problem.message)));

  const badExpect = { ...deal, expect: { ...deal.expect, finalScore: deal.expect.finalScore + 5 } };
  assert.ok(validateGuideDeal(badExpect).some((problem) => /存证不一致/.test(problem.message)));

  const wrongRole = { ...deal, role: 'defender' as const };
  assert.ok(validateGuideDeal(wrongRole).some((problem) => /与庄家座位/.test(problem.message)));
});

test('结构负例：版本、slug、牌键、底牌张数、日期格式', () => {
  const played = playDeal(7);
  const result = extractDeal(played.finalState, { table: 'TEST01', date: '2025-01-01' }, 'test-07');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const deal = finishDraft(result, 0);
  const mutate = (patch: Record<string, unknown>): unknown => JSON.parse(JSON.stringify({ ...deal, ...patch }));

  assert.equal(parseGuideDeal(mutate({ version: 2 })).ok, false);
  assert.equal(parseGuideDeal(mutate({ slug: 'Bad Slug' })).ok, false);
  assert.equal(parseGuideDeal(mutate({ slug: 'other-01' }), 'test-07').ok, false);
  assert.equal(parseGuideDeal(mutate({ source: { table: 'T', dealNo: 1, date: '2025/01/01' } })).ok, false);
  assert.equal(
    parseGuideDeal(mutate({ facts: { ...deal.facts, originalKitty: deal.facts.originalKitty.slice(0, 2) } })).ok,
    false
  );
  assert.equal(
    parseGuideDeal(mutate({ facts: { ...deal.facts, hands: [deal.facts.hands[0]!.slice(0, 16), deal.facts.hands[1], deal.facts.hands[2]] } })).ok,
    false
  );
  const badKey = JSON.parse(JSON.stringify(deal)) as { facts: { hands: string[][] } };
  badKey.facts.hands[0]![0] = 'Z9';
  assert.equal(parseGuideDeal(badKey).ok, false, '不存在的牌键必须被挡住');
  // 非规范写法（可读别名）在**生成物**里也不许出现：把一张已有的规范键改写成别名写法，
  // 牌面集合不变（回放照样过），只有「写法」这一条能抓它
  const alias = JSON.parse(JSON.stringify(deal)) as { facts: { hands: string[][] } };
  const LETTER: Record<string, string> = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const key = alias.facts.hands.flat().find((item) => /^[CDHS]1[0-4]$/.test(item));
  assert.ok(key !== undefined, '这一副里应当有 10/J/Q/K/A 中的某一张');
  const readable = `${key!.slice(0, 1)}${LETTER[key!.slice(1)]!}`;
  alias.facts.hands[0] = alias.facts.hands[0]!.map((item) => (item === key ? readable : item));
  const parsedAlias = parseGuideDeal(alias);
  assert.equal(parsedAlias.ok, true, '结构层认可读写法');
  if (parsedAlias.ok) {
    assert.ok(
      validateGuideDeal(parsedAlias.deal).some((problem) => /规范写法/.test(problem.message)),
      `生成物里出现可读别名（${readable}）必须被挡下`
    );
  }
});
