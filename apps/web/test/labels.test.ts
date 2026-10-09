/**
 * 叫品显示单测：界面上叫品一律写「分数 + 花色字形」，无主写 `NT`。
 *
 * 被修掉的缺陷：叫牌历史走引擎的 `bidLabel`，页面上打着 `40 梅花`、`45 梅花`……
 * 而同一屏的候选按钮用的是 `strainGlyph`（♣）—— 同一种东西两种写法。
 * 这里把「四门花色不许出现裸字母 C/D/H/S」钉成回归；无主从「无主」改成 `NT`
 * （与 MCP 工具面的合法叫品串 `55NT` 同一套写法，也是叫牌面板固定五槽能等宽的前提）。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRAINS,
  type Bid,
  type BidEntry,
  type Card,
  type CompletedTrick,
  type DealSummary,
  type Level,
  type PersonalView,
  type Strain
} from '@sixty/engine';

import {
  BID_GLYPH,
  BID_TIER_LIMIT,
  bidText,
  bidTiers,
  callText,
  changedLevelRows,
  contractText,
  followSuitCards,
  formatElapsed,
  highestCall,
  isRedStrain,
  kittyHandDelta,
  kittySign,
  lastCall,
  lastCompletedTrick,
  levelProgression,
  levelRows,
  scoreLineText,
  trickSideBadge,
  type BidTier,
  type BidTrigger
} from '../src/lib/labels.ts';

/** 四门花色（不含无主）：裸字母回归只针对它们 —— 无主的字形本来就是 `NT` */
const SUIT_STRAINS = STRAINS.filter((strain) => strain !== 'NT');

/** 只关心叫牌历史的个人视图；其余字段填最小可用值 */
function viewWithAuction(auction: readonly BidEntry[]): PersonalView {
  return {
    version: 1,
    status: 'playing',
    dealerSeat: 0,
    dealNo: 1,
    levels: [],
    progress: [],
    result: null,
    history: [],
    deal: {
      phase: 'auction',
      dealNo: 1,
      dealerSeat: 0,
      auction,
      highestBid: null,
      auctionTurn: 0,
      contract: null,
      trump: null,
      trick: null,
      playTurn: null,
      trickHistory: [],
      captured: [],
      handCounts: [17, 17, 17],
      declarerSeat: null,
      summary: null
    },
    // 两批底牌都属于玩家私有，挂在 you 上（`deal` 是观战者也拿得到的公共投影）
    you: { seat: 0, hand: [], isDeclarer: false, originalKitty: null, buriedKitty: null }
  };
}

/** 最高叫品已知的视图：`bidTiers` 读的是引擎侧的 `deal.highestBid`，不是历史末项 */
function viewWithHighest(highest: Bid | null): PersonalView {
  const base = viewWithAuction(highest === null ? [] : [{ seat: 0, call: highest }]);
  return { ...base, deal: { ...base.deal!, highestBid: highest } };
}

test('bidText：不叫用文字，叫品用「分数 + 花色字形」', () => {
  assert.equal(bidText('pass'), '不叫');
  assert.equal(bidText({ points: 40, strain: 'C' }), '40♣');
  assert.equal(bidText({ points: 45, strain: 'D' }), '45♦');
  assert.equal(bidText({ points: 80, strain: 'H' }), '80♥');
  assert.equal(bidText({ points: 100, strain: 'S' }), '100♠');
  assert.equal(bidText({ points: 60, strain: 'NT' }), '60NT');
});

test('回归：叫品文本里花色只出字形（不许裸字母 C/D/H/S）；无主写 NT', () => {
  for (const strain of SUIT_STRAINS) {
    const text = bidText({ points: 40, strain });
    assert.equal(
      /[CDHS]/.test(text),
      false,
      `${strain} 的叫品文本里还有裸花色字母：${text}（应走 strainGlyph）`
    );
  }
  assert.equal(
    bidText({ points: 60, strain: 'NT' }),
    '60NT',
    '无主写 NT：与 MCP 工具面的合法叫品串同一套写法'
  );
});

test('callText 是 bidText 的别名，两处不会再各写一份', () => {
  assert.equal(callText({ points: 40, strain: 'C' }), bidText({ points: 40, strain: 'C' }));
  assert.equal(callText('pass'), '不叫');
});

test('BID_GLYPH：五个花色都有字形，无主写 NT，红色只给 ♦♥', () => {
  for (const strain of STRAINS) {
    assert.equal(typeof BID_GLYPH[strain], 'string');
    assert.ok(BID_GLYPH[strain].length > 0, `${strain} 没有字形`);
  }
  assert.deepEqual(
    STRAINS.map((s) => BID_GLYPH[s]),
    ['♣', '♦', '♥', '♠', 'NT']
  );
  // 四门花色不许出现裸字母；无主那一槽恰好就是 NT（它是**字形**，不是被禁的「40 C」那种拼法）
  for (const strain of SUIT_STRAINS) {
    assert.equal(/[CDHS]/.test(BID_GLYPH[strain]), false, `${strain} 的字形里有裸字母`);
  }
  assert.equal(BID_GLYPH.NT, 'NT');
  assert.deepEqual(
    STRAINS.map((s) => isRedStrain(s)),
    [false, true, true, false, false]
  );
});

/**
 * 一档的速记：可叫的花色写字形、不可叫的写 `·` —— 一眼看出**有没有补位**。
 * 固定五槽是「· ♦ ♥ ♠ NT」；补位后的旧形状是「♦ ♥ ♠ NT」（少一格、整排左移）。
 */
function slotSketch(tier: BidTier): string {
  return tier.slots.map((slot) => (slot.legal ? BID_GLYPH[slot.strain] : '·')).join(' ');
}

test('bidTiers：每档永远五个槽、序恒为 ♣ ♦ ♥ ♠ NT（不可叫的花色留占位，绝不补位）', () => {
  const highests: readonly (Bid | null)[] = [
    null,
    { points: 40, strain: 'C' },
    { points: 40, strain: 'H' },
    { points: 40, strain: 'S' },
    { points: 40, strain: 'NT' },
    { points: 55, strain: 'NT' }
  ];
  for (const highest of highests) {
    for (const expanded of [false, true]) {
      const { tiers } = bidTiers(viewWithHighest(highest), expanded);
      assert.ok(tiers.length > 0, '任何最高叫品下都至少要给一档');
      for (const tier of tiers) {
        assert.deepEqual(
          tier.slots.map((slot) => slot.strain),
          ['C', 'D', 'H', 'S', 'NT'],
          `${tier.points} 档的槽序不是 ♣♦♥♠NT：补位就是这么来的`
        );
      }
    }
  }
});

test('bidTiers：四场景的档位与触发形态（判定基准 = 当前最高叫品，pass 不进判定）', () => {
  const cases: readonly {
    readonly name: string;
    readonly highest: Bid | null;
    readonly trigger: BidTrigger;
    readonly tiers: readonly string[];
  }[] = [
    { name: '没人叫', highest: null, trigger: 'line', tiers: ['40: ♣ ♦ ♥ ♠ NT'] },
    {
      name: '最高 40♣',
      highest: { points: 40, strain: 'C' },
      trigger: 'line',
      tiers: ['40: · ♦ ♥ ♠ NT', '45: ♣ ♦ ♥ ♠ NT']
    },
    {
      name: '最高 40♠',
      highest: { points: 40, strain: 'S' },
      trigger: 'line',
      tiers: ['40: · · · · NT', '45: ♣ ♦ ♥ ♠ NT']
    },
    { name: '最高 40NT', highest: { points: 40, strain: 'NT' }, trigger: 'line', tiers: ['45: ♣ ♦ ♥ ♠ NT'] }
  ];
  for (const item of cases) {
    const layout = bidTiers(viewWithHighest(item.highest), false);
    assert.equal(layout.trigger, item.trigger, `${item.name} 的触发形态不对`);
    assert.deepEqual(
      layout.tiers.map((tier) => `${tier.points}: ${slotSketch(tier)}`),
      [...item.tiers],
      `${item.name} 的档位不对`
    );
  }
});

/**
 * 触发形态**只有两种取值**，而且未展开时恒为 `line`（跳叫独立成行）。
 *
 * 为什么单列一条：`row-end`（触发钮吊在第二档行末）看起来只是「少占一行」，但它会让那一行
 * 比别的行宽 —— 槽位没有 shrink-0 时 flex 把该行五个槽一起压窄，两行的 NT 就不在同一条
 * 竖线上（360px 视口实测右缘相差 18.3px）。所以「触发器不进档位行」是**形状**判据，
 * 不是排版偏好：这条测试钉住枚举，源码守卫钉住它不在行内，`shot-auction.ts` 钉住真实像素。
 */
test('bidTiers：未展开时触发形态恒为 line（触发钮不进档位行），展开后没有触发钮', () => {
  for (const highest of [null, { points: 40, strain: 'C' } as const, { points: 40, strain: 'NT' } as const]) {
    assert.equal(
      bidTiers(viewWithHighest(highest), false).trigger,
      'line',
      `最高叫品 ${JSON.stringify(highest)}：未展开时触发形态必须是 line（跳叫独立成行）`
    );
  }
  assert.equal(bidTiers(viewWithHighest(null), true).trigger, 'none', '展开后不该再有触发钮');
});

test('bidTiers：最便宜档满五格（NT / 没人叫）时只给这一档 —— 再上一档就已经是跳叫', () => {
  // 最高 40NT：同分没有可压的花色，45 是「照旧抬 5 分」，50 才是跳叫
  const afterNT = bidTiers(viewWithHighest({ points: 40, strain: 'NT' }), false);
  assert.deepEqual(afterNT.tiers.map((tier) => tier.points), [45], '40NT 之后未展开时只该有一档（45）');
  // 没人叫：40 是标准开叫，45 起就是跳叫
  const opening = bidTiers(viewWithHighest(null), false);
  assert.deepEqual(opening.tiers.map((tier) => tier.points), [40], '没人叫时未展开只该摆 40 一档');
});

test('bidTiers：展开后共五档、触发钮消失（没有收回按钮）；前两档与展开前逐字相同', () => {
  const collapsed = bidTiers(viewWithHighest({ points: 40, strain: 'H' }), false);
  const expanded = bidTiers(viewWithHighest({ points: 40, strain: 'H' }), true);
  assert.equal(expanded.trigger, 'none', '展开后不该再有触发钮');
  assert.equal(expanded.tiers.length, BID_TIER_LIMIT, `展开后应恰好 ${BID_TIER_LIMIT} 档`);
  assert.deepEqual(expanded.tiers.map((tier) => tier.points), [40, 45, 50, 55, 60]);
  assert.deepEqual(expanded.tiers.slice(0, collapsed.tiers.length), collapsed.tiers, '展开只加档，不改前面几档');
});

test('反证：旧的「只摆合法花色」形状与固定五槽必须判得出不同（否则上面几条守卫是空转的）', () => {
  const oldShape = (points: number, strains: readonly Strain[]): string =>
    `${points}: ${strains.map((strain) => BID_GLYPH[strain]).join(' ')}`;
  const tier = bidTiers(viewWithHighest({ points: 40, strain: 'H' }), false).tiers[0]!;
  assert.equal(oldShape(40, ['S', 'NT']), '40: ♠ NT', '旧形状就是这个：后面的花色往前补位');
  assert.notEqual(
    oldShape(40, ['S', 'NT']),
    slotSketch(tier),
    '固定五槽的速记与补位形状相同 —— 这条守卫没有分辨力'
  );
});

test('lastCall / highestCall：大字要的是最高叫品，「不叫」只进历史', () => {
  const empty = viewWithAuction([]);
  assert.equal(lastCall(empty), null);
  assert.equal(highestCall(empty), null);

  const onlyPass = viewWithAuction([{ seat: 0, call: 'pass' }]);
  assert.equal(lastCall(onlyPass), 'pass');
  assert.equal(highestCall(onlyPass), null, '全是 pass 时没有最高叫品');

  const mixed = viewWithAuction([
    { seat: 0, call: { points: 40, strain: 'C' } },
    { seat: 1, call: { points: 50, strain: 'H' } },
    { seat: 2, call: 'pass' },
    { seat: 0, call: 'pass' }
  ]);
  assert.equal(lastCall(mixed), 'pass', '最后一次出手是「不叫」');
  assert.deepEqual(highestCall(mixed), { points: 50, strain: 'H' }, '最高叫品要跳过末尾的 pass');
});

test('kittyHandDelta：只取手牌里来自底牌的牌，张数按多重集合算', () => {
  const kitty: Card[] = [
    { suit: 'S', rank: 5 },
    { suit: 'H', rank: 10 },
    { suit: 'C', rank: 2 }
  ];
  const hand: Card[] = [
    { suit: 'S', rank: 5 },
    { suit: 'H', rank: 10 },
    { suit: 'C', rank: 2 },
    { suit: 'D', rank: 7 }
  ];

  assert.deepEqual(
    kittyHandDelta(hand, kitty).map((c) => JSON.stringify(c)),
    kitty.map((c) => JSON.stringify(c)),
    '三张底牌都应在手牌里被标出'
  );
  assert.deepEqual(kittyHandDelta(hand, null), [], '闲家（originalKitty 为 null）不标任何牌');
  assert.deepEqual(kittyHandDelta(hand, []), []);
});

test('kittyHandDelta：同点同花的重牌不会多标（多重集合语义）', () => {
  const kitty: Card[] = [{ suit: 'S', rank: 5 }];
  const hand: Card[] = [{ suit: 'S', rank: 5 }];
  assert.equal(kittyHandDelta(hand, kitty).length, 1);
  // 手牌里没有底牌时返回空
  assert.deepEqual(kittyHandDelta([{ suit: 'D', rank: 3 }], kitty), []);
});

test('formatElapsed：秒 / 分秒 / 小时分三档，坏输入一律当 0', () => {
  // 秒档：不足一分钟只写秒
  assert.equal(formatElapsed(0), '0 秒');
  assert.equal(formatElapsed(999), '0 秒', '不足一秒向下取整，不显示小数');
  assert.equal(formatElapsed(1_000), '1 秒');
  assert.equal(formatElapsed(59_999), '59 秒', '59.999 秒还不满一分钟，不许进位成「1 分」');
  // 分秒档：秒补零，走字时宽度不跳
  assert.equal(formatElapsed(60_000), '1 分 00 秒');
  assert.equal(formatElapsed(65_400), '1 分 05 秒');
  assert.equal(formatElapsed(3_599_000), '59 分 59 秒');
  // 小时档：到小时就不再写秒（牌桌上没人读「1 小时 02 分 03 秒」）
  assert.equal(formatElapsed(3_600_000), '1 小时 00 分');
  assert.equal(formatElapsed(7_380_000), '2 小时 03 分');
  assert.equal(formatElapsed(90_000_000), '25 小时 00 分');
  // 坏输入：牌面上绝不出现负数或 NaN
  assert.equal(formatElapsed(-1), '0 秒');
  assert.equal(formatElapsed(Number.NaN), '0 秒');
  assert.equal(formatElapsed(Number.POSITIVE_INFINITY), '0 秒');
});

test('trickSideBadge：只说这 N 分归庄方还是闲方', () => {  // 庄家座位 2 赢了这一墩 → 庄；其余两个座位都是闲家一方 → 闲
  assert.equal(trickSideBadge(2, 2, 20), '庄 +20 分');
  assert.equal(trickSideBadge(2, 0, 5), '闲 +5 分');
  assert.equal(trickSideBadge(2, 1, 0), '闲 +0 分', '0 分的墩也要如实报（不写成「赢墩 +0」）');
  assert.equal(
    trickSideBadge(null, 1, 10),
    '闲 +10 分',
    '定约未定时不该抛错：没有庄家就没有庄方'
  );
});

test('lastCompletedTrick：「上一轮」= trickHistory 末项，没打过牌就是 null', () => {
  // 还没收过墩（发牌、叫牌、埋底、刚换副）：没有「上一轮」可说
  assert.equal(lastCompletedTrick(null), null, '没有牌局时不该编出一墩来');
  assert.equal(lastCompletedTrick({ trickHistory: [] }), null, '还没收过墩');

  const first: CompletedTrick = {
    leaderSeat: 0,
    plays: [
      { seat: 0, cards: [{ suit: 'S', rank: 3 }] },
      { seat: 1, cards: [{ suit: 'S', rank: 9 }] },
      { seat: 2, cards: [{ suit: 'S', rank: 14 }] }
    ],
    winnerSeat: 2,
    points: 10
  };
  const second: CompletedTrick = {
    leaderSeat: 2,
    plays: [
      { seat: 2, cards: [{ suit: 'C', rank: 5 }] },
      { seat: 0, cards: [{ suit: 'C', rank: 7 }] },
      { seat: 1, cards: [{ suit: 'C', rank: 13 }] }
    ],
    winnerSeat: 1,
    points: 15
  };
  // 两处消费者（毡面出牌区的回显、回看浮层）读的必须是**同一份**：末项，不是首项也不是全部
  assert.deepEqual(lastCompletedTrick({ trickHistory: [first, second] }), second);
  assert.deepEqual(lastCompletedTrick({ trickHistory: [second, first] }), first);
});

test('followSuitCards：只标领出那一门，领出与缺门都是空集', () => {
  const trump = { strain: 'H', rank: 5 } as const;
  const hand: Card[] = [
    { suit: 'S', rank: 3 },
    { suit: 'C', rank: 9 },
    { suit: 'S', rank: 14 },
    { suit: 'D', rank: 2 }
  ];

  // 领出 ♠3：手上两张 ♠ 都该标（跟牌必须先跟这一门）
  assert.deepEqual(
    followSuitCards(hand, trump, { plays: [{ cards: [{ suit: 'S', rank: 3 }] }] }).map((c) =>
      JSON.stringify(c)
    ),
    [JSON.stringify({ suit: 'S', rank: 3 }), JSON.stringify({ suit: 'S', rank: 14 })],
    '领出 ♠ 时应标出手上所有 ♠'
  );

  // 领出（还没人出牌）：没有「同一门」可跟
  assert.deepEqual(followSuitCards(hand, trump, { plays: [] }), [], '领出时不该有标记');
  assert.deepEqual(followSuitCards(hand, trump, null), [], '没有墩信息时不该有标记');

  // 缺门：手上这一门只剩一张 → 只标那一张
  assert.deepEqual(
    followSuitCards(hand, trump, { plays: [{ cards: [{ suit: 'D', rank: 9 }] }] }).map((c) =>
      JSON.stringify(c)
    ),
    [JSON.stringify({ suit: 'D', rank: 2 })],
    '手上只有一张 ♦ 时只标那一张'
  );
  assert.deepEqual(
    followSuitCards([{ suit: 'C', rank: 3 }], trump, { plays: [{ cards: [{ suit: 'D', rank: 9 }] }] }),
    [],
    '完全缺门时是空集'
  );

  // 将牌未定：没有「门」的概念，不猜
  assert.deepEqual(
    followSuitCards(hand, null, { plays: [{ cards: [{ suit: 'S', rank: 3 }] }] }),
    [],
    '将牌未知时不该标牌'
  );
});

test('followSuitCards：领出主牌时标的是整手主牌（主花色 + 级牌 + 王同属一门）', () => {
  const trump = { strain: 'H', rank: 5 } as const;
  const hand: Card[] = [
    { suit: 'H', rank: 3 }, // 主花色
    { suit: 'S', rank: 5 }, // 副级：算主牌
    { suit: 'H', rank: 5 }, // 主级
    { joker: 'small' } as Card, // 王：恒主牌
    { suit: 'C', rank: 9 } // 真副牌，不该标
  ];
  const marked = followSuitCards(hand, trump, { plays: [{ cards: [{ joker: 'big' } as Card] }] });
  assert.equal(marked.length, 4, `领主牌时应标出 4 张主牌，实际 ${marked.length}`);
  assert.ok(
    marked.every((c) => !('suit' in c) || c.suit === 'H' || c.rank === 5),
    '被标的只能是主牌门里的牌'
  );
});

/* ---------- 本副结算弹窗：算式的符号、一行的结论、升级表 ---------- */

/** 只关心结论与升级表的结算摘要；其余字段填最小可用值 */
function summaryOf(overrides: Partial<DealSummary> = {}): DealSummary {
  return {
    dealNo: 1,
    contract: { points: 55, strain: 'S', declarerSeat: 0 },
    trump: { strain: 'S', rank: 2 },
    declarerTrickPoints: 60,
    defenderTrickPoints: 30,
    originalKitty: [],
    kitty: [],
    lastTrickSize: 1,
    protectedBottom: false,
    multiplier: 1,
    kittyPoints: 10,
    finalScore: 50,
    made: false,
    shortfall: 5,
    levelChanges: [],
    ...overrides
  };
}

/** 两名闲家各升 N 级（座位 1、2；庄家是 0） */
function defendersUp(levels: number): DealSummary['levelChanges'] {
  return ([1, 2] as const).map((seat) => ({
    seat,
    from: { rank: 2, cycle: 0 } as Level,
    to: { rank: 3, cycle: 0 } as Level,
    levels
  }));
}

test('kittySign：抠底是减号，保底是加号 —— 而且是 U+2212，不是 ASCII 连字符', () => {
  assert.equal(kittySign(true), '+');
  assert.equal(kittySign(false), '−');
  assert.equal(
    kittySign(false).codePointAt(0),
    0x2212,
    '抠底的减号必须是 U+2212：与 /rules 教程、编排台是同一个字形，同一条算式里不许混两种破折号'
  );
  assert.notEqual(kittySign(false), '-', '出现了 ASCII 连字符');
});

test('scoreLineText：打输写「差 N 分」、打成保留「打成」二字', () => {
  // 打输：截图里那一副 —— 墩分 60、底牌 10 × 1 被抠底 ⇒ 50 分对 55 的定约
  assert.equal(
    scoreLineText(summaryOf({ levelChanges: defendersUp(1) })),
    '50/55（差 5 分）· 闲家升 1 级'
  );
  // 打成：不再报「超出多少分」（恰好打平时「超 0 分」是句怪话），所以保留「打成」
  assert.equal(
    scoreLineText(
      summaryOf({
        made: true,
        shortfall: 0,
        finalScore: 65,
        contract: { points: 60, strain: 'S', declarerSeat: 0 },
        levelChanges: [{ seat: 0, from: { rank: 5, cycle: 0 }, to: { rank: 8, cycle: 0 }, levels: 2 }]
      })
    ),
    '打成 65/60 · 庄家升 2 级'
  );
  // 恰好打平（finalScore === 定约）也是常态，不许出现「差 0 分 / 超 0 分」
  assert.equal(
    scoreLineText(
      summaryOf({
        made: true,
        shortfall: 0,
        finalScore: 55,
        levelChanges: [{ seat: 0, from: { rank: 2, cycle: 0 }, to: { rank: 3, cycle: 0 }, levels: 1 }]
      })
    ),
    '打成 55/55 · 庄家升 1 级'
  );
});

test('scoreLineText：抠底扣成负分也照实写，且用同一个减号', () => {
  // 底牌分可以大到把庄家扣成负数（/rules 明写「扣成负数也可以」）：定约 40、最终 −5 ⇒ 差 45 ⇒ 各升 5 级
  const line = scoreLineText(
    summaryOf({
      finalScore: -5,
      shortfall: 45,
      contract: { points: 40, strain: 'C', declarerSeat: 0 },
      levelChanges: defendersUp(5)
    })
  );
  assert.equal(line, '−5/40（差 45 分）· 闲家升 5 级');
  assert.equal(line.includes('-'), false, `负分不许用 ASCII 连字符：${line}`);
});

test('scoreLineText：升级表缺失时不抛错（写成 0 级）', () => {
  assert.equal(scoreLineText(summaryOf()), '50/55（差 5 分）· 闲家升 0 级');
  assert.equal(
    scoreLineText(summaryOf({ made: true, shortfall: 0, finalScore: 60 })),
    '打成 60/55 · 庄家升 0 级'
  );
});

test('levelRows：三家都出现，升级的排前面，没升级的 from = to = 当前级别', () => {
  // 打输：两名闲家各升 1 级（座位 1、2），庄家（座位 0）不动
  const lost = levelRows(
    summaryOf({ levelChanges: defendersUp(1) }),
    [{ rank: 11, cycle: 1 }, { rank: 3, cycle: 0 }, { rank: 3, cycle: 0 }]
  );
  assert.equal(lost.length, 3, `三家都要出现，实际 ${lost.length} 行`);
  assert.deepEqual(
    lost.map((row) => row.seat),
    [1, 2, 0],
    '升级的两家排前面，没升级的庄家排在最后（组内仍按座位序）'
  );
  assert.deepEqual(
    lost.map((row) => row.changed),
    [true, true, false]
  );
  assert.deepEqual(lost[0], { seat: 1, from: { rank: 2, cycle: 0 }, to: { rank: 3, cycle: 0 }, changed: true });
  // 没升级那行：from 与 to 都是它当前的级别（这一个座位是 11(+1)，不是起始的 2）
  assert.deepEqual(lost[2], {
    seat: 0,
    from: { rank: 11, cycle: 1 },
    to: { rank: 11, cycle: 1 },
    changed: false
  });
});

test('levelRows：打成时庄家排第一，两名闲家都是「不变」', () => {
  const made = levelRows(
    summaryOf({
      made: true,
      finalScore: 65,
      levelChanges: [{ seat: 0, from: { rank: 5, cycle: 0 }, to: { rank: 8, cycle: 0 }, levels: 3 }]
    }),
    [{ rank: 8, cycle: 0 }, { rank: 2, cycle: 0 }, { rank: 2, cycle: 0 }]
  );
  assert.deepEqual(
    made.map((row) => [row.seat, row.changed]),
    [
      [0, true],
      [1, false],
      [2, false]
    ]
  );
  // 没升级的两家：from 与 to 相等，且没有被写成起始级别
  for (const row of made.slice(1)) assert.deepEqual(row.from, row.to);
});

test('levelRows：座位不重不漏 —— 升级表永远恰好三行', () => {
  const rows = levelRows(summaryOf({ levelChanges: defendersUp(2) }), []);
  assert.deepEqual(
    [...rows.map((row) => row.seat)].sort(),
    [0, 1, 2]
  );
  // levels 给空数组时（不该发生）回落到起始级别，而不是 undefined
  const fallback = rows.find((row) => row.seat === 0);
  assert.deepEqual(fallback?.from, { rank: 2, cycle: 0 });
});

/* ---------- 战报：定约+级牌、升级表 ---------- */

test('contractText：定约 + 级牌，花色走字形、A 不写成 14', () => {
  assert.equal(contractText(summaryOf()), '55♠ · 级 2');
  assert.equal(
    contractText(summaryOf({ contract: { points: 45, strain: 'C', declarerSeat: 0 } })),
    '45♣ · 级 2',
    '花色必须出字形：战报里不许出现「45C · 级 2」'
  );
  assert.equal(
    contractText(
      summaryOf({
        contract: { points: 40, strain: 'NT', declarerSeat: 1 },
        trump: { strain: 'NT', rank: 14 }
      })
    ),
    '40NT · 级 A',
    '无主写 NT、级牌 A 写 A'
  );
  // 裸花色字母回归：四门不许漏出 C/D/H/S；无主写的就是 NT（与 strainGlyph 同一份来源）
  for (const strain of SUIT_STRAINS) {
    const text = contractText(summaryOf({ contract: { points: 40, strain, declarerSeat: 0 } }));
    assert.equal(/[CDHS]/.test(text), false, `${strain} 的定约文本里还有裸字母：${text}`);
  }
  assert.equal(
    contractText(summaryOf({ contract: { points: 55, strain: 'NT', declarerSeat: 0 } })),
    '55NT · 级 2',
    '无主定约走 strainGlyph：与候选按钮、叫牌历史同一套写法'
  );
});

test('changedLevelRows：战报每副卡只列升级者，全部按「升级行」渲染', () => {
  const lost = changedLevelRows(summaryOf({ levelChanges: defendersUp(1) }));
  assert.equal(lost.length, 2, '打输时只有两名闲家升级：庄家那一行不许出现（历史里没有它的级别）');
  assert.deepEqual(
    lost.map((row) => row.seat),
    [1, 2],
    '顺序就是 levelChanges 的顺序（不重排）'
  );
  for (const row of lost) {
    assert.equal(row.changed, true, '每一行都是升级行：LevelTable 才不会给它淡显 +「不变」');
    assert.deepEqual(row.from, { rank: 2, cycle: 0 });
    assert.deepEqual(row.to, { rank: 3, cycle: 0 });
  }
  assert.deepEqual(changedLevelRows(summaryOf()), [], '没人升级时是空集（那一块整个不渲染）');
});

test('levelProgression：空战报只有「开局」一行，三家都在起始级别', () => {
  const rows = levelProgression([]);
  assert.equal(rows.length, 1, '第 0 行就是开局');
  assert.equal(rows[0]!.dealNo, 0);
  assert.deepEqual(rows[0]!.levels, [
    { rank: 2, cycle: 0 },
    { rank: 2, cycle: 0 },
    { rank: 2, cycle: 0 }
  ]);
  assert.deepEqual(rows[0]!.changed, [false, false, false], '开局那一行没有人「动了」');
});

test('levelProgression：逐副累积，没动的座位沿用上一副的级别', () => {
  const rows = levelProgression([
    summaryOf({ dealNo: 1, levelChanges: defendersUp(1) }),
    summaryOf({
      dealNo: 2,
      made: true,
      levelChanges: [
        { seat: 0, from: { rank: 2, cycle: 0 }, to: { rank: 4, cycle: 0 }, levels: 2 }
      ]
    }),
    summaryOf({ dealNo: 3, levelChanges: [] })
  ]);
  assert.deepEqual(
    rows.map((row) => row.dealNo),
    [0, 1, 2, 3],
    '行序必须是 开局 → 第 1 副 → … （升序；与逐副卡的「新→旧」相反，表要从上往下读）'
  );
  // 第 1 副：两名闲家各升 1 级
  assert.deepEqual(rows[1]!.levels, [
    { rank: 2, cycle: 0 },
    { rank: 3, cycle: 0 },
    { rank: 3, cycle: 0 }
  ]);
  assert.deepEqual(rows[1]!.changed, [false, true, true]);
  // 第 2 副：庄家升到 4，两名闲家沿用第 1 副之后的 3
  assert.deepEqual(rows[2]!.levels, [
    { rank: 4, cycle: 0 },
    { rank: 3, cycle: 0 },
    { rank: 3, cycle: 0 }
  ]);
  assert.deepEqual(rows[2]!.changed, [true, false, false]);
  // 第 3 副没人升级：级别一行都不许回退
  assert.deepEqual(rows[3]!.levels, rows[2]!.levels);
  assert.deepEqual(rows[3]!.changed, [false, false, false]);
});

test('levelProgression：跨 A 的「+过次」原样带进后面的行', () => {
  const rows = levelProgression([
    summaryOf({
      dealNo: 1,
      made: true,
      levelChanges: [
        { seat: 0, from: { rank: 13, cycle: 0 }, to: { rank: 14, cycle: 0 }, levels: 1 }
      ]
    }),
    summaryOf({
      dealNo: 2,
      made: true,
      levelChanges: [
        { seat: 0, from: { rank: 14, cycle: 0 }, to: { rank: 3, cycle: 1 }, levels: 1 }
      ]
    }),
    summaryOf({ dealNo: 3, levelChanges: defendersUp(1) })
  ]);
  assert.deepEqual(rows[1]!.levels[0], { rank: 14, cycle: 0 });
  assert.deepEqual(rows[2]!.levels[0], { rank: 3, cycle: 1 }, '过 A 之后是 3(+1)，不是 15(+0)');
  assert.deepEqual(rows[3]!.levels[0], { rank: 3, cycle: 1 }, '这一副没动庄家，徽标要照旧带着 +1');
});

