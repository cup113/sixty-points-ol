/**
 * **行动投影**（ADR-0019）：形状清单按帧核对、末墩规则、阶段门控、观战者不泄漏、
 * 编码无损，以及「投影只能从服务器的负载里派生」这条机械证据（静态守卫）。
 *
 * 这一层是 ADR-0010「引擎类型逐字」被收窄的地方（ADR-0011 先收窄成紧凑投影，
 * ADR-0019 再收窄成「此刻行动所需」），所以它必须自己证明自己没有变成第二个来源：
 * 不 import 任何能碰到牌局的东西，只做**单向**的翻译。
 *
 * 「少给了什么」也是本文件要钉住的：牌史只留末墩、跨副战报与级别不再每帧重复 ——
 * 这些是**有意的**（它们是记忆考题，verbose 可取回），不是投影漏了字段。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isJoker, personalView, publicView, type Card, type GameState, type PlayerSeat } from '@sixty/engine';
import { decodeCard, encodeCard } from '../src/codec.ts';
import {
  COMPACT_DEAL_AUCTION_FIELDS,
  COMPACT_DEAL_FIELDS,
  COMPACT_SUMMARY_FIELDS,
  COMPACT_TRICK_FIELDS,
  COMPACT_VIEW_FIELDS,
  COMPACT_VIEW_LEVEL_FIELD,
  COMPACT_YOU_FIELDS,
  TRICK_TAIL,
  decodePlay,
  project,
  type CompactPayload
} from '../src/project.ts';
import { contractState, dealtState, fakeTableView, playingState, scoredState } from './fake-api.ts';

const keysOf = (value: object): string => Object.keys(value).sort().join(',');
const expected = (fields: readonly string[]): string => [...fields].sort().join(',');

/** 三种帧：叫牌（还没成交）、出牌（已成交）、结算（信息最多的一帧） */
const AUCTION_STATE = dealtState();
const PLAY_STATE = playingState();
const SCORED_STATE = scoredState();

function compactOfState(state: GameState, youSeat: PlayerSeat['seat'] | null = 0): CompactPayload {
  return project(
    {
      role: youSeat === null ? 'spectator' : 'player',
      view: publicView(state),
      you: youSeat === null ? null : personalView(state, youSeat).you,
      table: fakeTableView('ABC123')
    },
    'ABC123'
  );
}

/** 把一侧的牌都掏出来（紧凑侧先解码），用于「编码无损」的多重集比较 */
function codesOf(cards: readonly Card[]): string[] {
  return cards.map((card) => (isJoker(card) ? `joker-${card.joker}` : `${card.suit}-${card.rank}`)).sort();
}
function multisetFrom(list: readonly (readonly Card[])[]): string[] {
  return codesOf(list.flat());
}

test('投影后的字段清单与声明逐字一致（多一个少一个都算漂移）', () => {
  // 叫牌帧：三个「正在叫牌」的字段在，levels 不在（副内它是静态的）
  const auction = compactOfState(AUCTION_STATE);
  assert.equal(keysOf(auction.view!), expected(COMPACT_VIEW_FIELDS), 'CompactView（叫牌帧）');
  assert.equal(
    keysOf(auction.view!.deal!),
    expected([...COMPACT_DEAL_FIELDS, ...COMPACT_DEAL_AUCTION_FIELDS]),
    'CompactDeal（叫牌帧）'
  );
  assert.equal(auction.view!.deal!.phase, 'auction');
  assert.equal(auction.view!.deal!.auction!.length, 0, '刚发牌时叫牌历史是空表（不是 undefined）');

  // 出牌帧：门控的三个字段消失，结论由 contract / declarerSeat 带走
  const play = compactOfState(PLAY_STATE);
  assert.equal(keysOf(play.view!), expected(COMPACT_VIEW_FIELDS), 'CompactView（出牌帧）');
  assert.equal(keysOf(play.view!.deal!), expected(COMPACT_DEAL_FIELDS), 'CompactDeal（出牌帧）');
  for (const gated of COMPACT_DEAL_AUCTION_FIELDS) {
    assert.equal(gated in play.view!.deal!, false, `出牌帧不该再给 ${gated}（成交后它是记忆）`);
  }
  assert.ok(play.view!.deal!.contract !== null, '成交后定约必须给');
  assert.ok(play.view!.deal!.declarerSeat !== null, '成交后庄家必须给');

  // 结算帧：多出 levels（级别正是这一刻变的）
  const scored = compactOfState(SCORED_STATE);
  assert.equal(
    keysOf(scored.view!),
    expected([...COMPACT_VIEW_FIELDS, COMPACT_VIEW_LEVEL_FIELD]),
    'CompactView（结算帧）'
  );
  assert.equal(keysOf(scored.view!.deal!), expected(COMPACT_DEAL_FIELDS), 'CompactDeal（结算帧）');
  assert.equal(keysOf(scored.view!.deal!.summary!), expected(COMPACT_SUMMARY_FIELDS), 'CompactSummary');
  assert.equal(keysOf(scored.you!), expected(COMPACT_YOU_FIELDS), 'CompactYou');
});

test('末墩规则：trickHistory 恰好留一项，且就是服务器那份的最后一项', () => {
  const raw = publicView(SCORED_STATE).deal!;
  const compact = compactOfState(SCORED_STATE).view!.deal!;
  assert.ok(raw.trickHistory.length > TRICK_TAIL, '这副牌应当已经打完不止一墩');
  assert.equal(compact.trickHistory.length, TRICK_TAIL);
  assert.equal(keysOf(compact.trickHistory[0]!), expected(COMPACT_TRICK_FIELDS), 'CompactCompletedTrick');

  // 逐字段对上「最后那一墩」—— 少给了更早的墩是有意的，给错墩就是缺陷
  const last = raw.trickHistory[raw.trickHistory.length - 1]!;
  const kept = compact.trickHistory[0]!;
  assert.equal(kept.winner, last.winnerSeat);
  assert.equal(kept.points, last.points);
  assert.equal(kept.plays.length, last.plays.length);
  for (const [index, line] of kept.plays.entries()) {
    const parsed = decodePlay(line);
    assert.equal(parsed.seat, last.plays[index]!.seat);
    assert.deepEqual([...parsed.cards], last.plays[index]!.cards.map(encodeCard));
  }
});

test('完整牌史仍在服务器负载里：裁到末墩是**投影**的决定，不是数据没了', () => {
  // 这条是上一测试的对照：它证明「少给」只发生在 MCP 这一侧（verbose / 浏览器照旧拿全）
  const raw = publicView(SCORED_STATE).deal!;
  const played = multisetFrom(raw.trickHistory.map((trick) => trick.plays.flatMap((play) => play.cards)));
  assert.equal(played.length, 51, '一副牌打出的牌应当是 51 张');
  // captured[].cards 与 trickHistory 是同一批牌：所以「删掉一份」在服务端那一侧仍然有依据
  assert.deepEqual(multisetFrom(raw.captured.map((entry) => entry.cards)), played, 'captured 与 trickHistory 不是同一批牌');

  const compact = compactOfState(SCORED_STATE).view!.deal!;
  const keptCards = compact.trickHistory.flatMap((trick) => trick.plays).length;
  assert.ok(keptCards <= 3, `末墩之外还给着 ${keptCards} 手牌：投影没有裁到末墩`);
});

test('可推的字段不重复给：已完成的墩不带 leaderSeat（第一墩庄家领出，之后上墩赢家领出）', () => {
  const raw = publicView(SCORED_STATE).deal!;
  const kept = compactOfState(SCORED_STATE).view!.deal!.trickHistory[0]!;
  assert.equal('leaderSeat' in kept, false, '已完成的墩不该再重复给 leaderSeat');
  // 这个字段之所以可推，靠的是引擎的约定：把它验一遍，免得「已推得的」变成「猜的」
  const last = raw.trickHistory[raw.trickHistory.length - 1]!;
  const expectedLeader = raw.trickHistory[raw.trickHistory.length - 2]!.winnerSeat;
  assert.equal(last.leaderSeat, expectedLeader, '末墩的领出者应当就是上一墩的赢家');
  // 当前这一墩仍要给出领出者（它是出牌的直接约束来源）
  assert.ok(kept !== null);
  const playing = compactOfState(PLAY_STATE).view!.deal!;
  assert.ok(playing.trick === null || typeof playing.trick.leaderSeat === 'number');
});

test('只减不增：重复、私有与界面字段都不出现在投影里', () => {
  const compact = compactOfState(SCORED_STATE);
  const deal = compact.view!.deal!;
  assert.equal('captured' in deal, false, 'captured[].cards 与 trickHistory 逐张重复，不该再给一份');
  assert.equal('kitty' in deal, false);
  assert.equal('table' in compact, false, '整块座位卡不给：名字挂在 names 上，在线状态是界面的事');
  assert.equal('version' in compact.view!, false, 'version 是浏览器管道字段');
  assert.equal('progress' in compact.view!, false, 'progress 可由 levels 推出（13 × 轮数 + 档位）');
  assert.equal('history' in compact.view!, false, '跨副战报是记忆考题');
  assert.equal('historyOmitted' in compact.view!, false);

  const raw = publicView(SCORED_STATE).deal!;
  assert.deepEqual(deal.capturedPoints, raw.captured.map((entry) => entry.points));
  assert.deepEqual(deal.handCounts, [...raw.handCounts]);
});

test('紧凑编码无损：末墩解码回来的牌与服务器给的逐张一致', () => {
  const raw = publicView(SCORED_STATE).deal!.trickHistory.at(-1)!.plays.flatMap((play) => play.cards);
  const lines = compactOfState(SCORED_STATE).view!.deal!.trickHistory.flatMap((trick) => trick.plays);
  const decoded = lines.flatMap((line) =>
    decodePlay(line).cards.map((code) => {
      const card = decodeCard(code);
      assert.ok(card !== null, `投影吐出了认不出的牌码：${code}`);
      return card;
    })
  );
  assert.deepEqual(codesOf(decoded), codesOf(raw));
});

test('级别只在「正在变」的帧给：叫牌与出牌帧都不给，结算帧给', () => {
  assert.equal('levels' in compactOfState(AUCTION_STATE).view!, false);
  assert.equal('levels' in compactOfState(PLAY_STATE).view!, false);
  const scored = compactOfState(SCORED_STATE).view!;
  assert.deepEqual(scored.levels, publicView(SCORED_STATE).levels, '结算帧的级别必须与服务器一致');
});

test('结算信息一次性给足，只是牌面换成紧凑码', () => {
  const summary = compactOfState(SCORED_STATE).view!.deal!.summary!;
  const raw = publicView(SCORED_STATE).deal!.summary!;
  assert.equal(summary.finalScore, raw.finalScore);
  assert.equal(summary.made, raw.made);
  assert.equal(summary.shortfall, raw.shortfall);
  assert.deepEqual(summary.contract, raw.contract);
  assert.deepEqual(summary.levelChanges, raw.levelChanges);
  assert.deepEqual(summary.kitty, raw.kitty.map(encodeCard));
  assert.deepEqual(summary.originalKitty, raw.originalKitty.map(encodeCard));
});

test('名字挂在座位下标上：座位 2 是「丙」，且不带在线/满座这类界面字段', () => {
  const compact = compactOfState(PLAY_STATE);
  assert.deepEqual(compact.names, ['甲', '乙', '丙']);
  const raw = JSON.stringify(compact);
  for (const forbidden of ['online', 'seatedCount', 'ready', 'spectatorCount', 'userId']) {
    assert.equal(raw.includes(`"${forbidden}"`), false, `投影里出现了界面字段 ${forbidden}`);
  }
});

test('观战者：投影里没有 you，也就没有任何手牌', () => {
  const spectator = compactOfState(PLAY_STATE, null);
  assert.equal(spectator.role, 'spectator');
  assert.equal(spectator.you, null);
  const raw = JSON.stringify(spectator);
  assert.equal(raw.includes('"hand"'), false, '观战者的负载里出现了手牌');
  assert.ok(raw.includes('"handCounts"'), '公开信息里应该只剩各家张数');
  assert.deepEqual(spectator.names, ['甲', '乙', '丙'], '名字是公开信息，观战者也有');
});

test('体积：结算时投影至少省掉七成（行动投影比紧凑投影再省一截）', () => {
  const raw = JSON.stringify({
    code: 'ABC123',
    role: 'player',
    table: fakeTableView('ABC123'),
    view: publicView(SCORED_STATE),
    you: personalView(SCORED_STATE, 0).you
  });
  const compact = JSON.stringify(compactOfState(SCORED_STATE));
  assert.ok(
    compact.length * 3.3 < raw.length,
    `投影没省下多少：${compact.length} vs ${raw.length}（结算时）`
  );
});

test('不许有第二个来源：project.ts 只 import 引擎类型与本包编解码', () => {
  const source = readFileSync(new URL('../src/project.ts', import.meta.url), 'utf8');
  const modules = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
  assert.deepEqual(
    [...new Set(modules)].sort(),
    ['./codec.ts', './wire.ts', '@sixty/engine'],
    'project.ts 引入了别的模块：投影必须只从服务器负载单向派生'
  );
  for (const forbidden of ['dispatch', 'personalView', 'publicView', 'createGame', 'structuredClone']) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`).test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
      false,
      `project.ts 里出现了 ${forbidden}：投影不该有能力自己造局面`
    );
  }
});

test('阶段门控是负载自身的纯函数：同一份负载永远同一形状（/api/mcp 无状态）', () => {
  // 同一次投影跑两遍必须逐字节一样 —— 没有「这是第几条消息」这类隐藏状态
  const once = JSON.stringify(compactOfState(AUCTION_STATE));
  const twice = JSON.stringify(compactOfState(AUCTION_STATE));
  assert.equal(once, twice);
  // 出牌帧与叫牌帧的字段差恰好是那三个门控字段（不是随机的差）
  const auctionDeal = compactOfState(AUCTION_STATE).view!.deal!;
  const playDeal = compactOfState(PLAY_STATE).view!.deal!;
  const extra = Object.keys(auctionDeal).filter((key) => !(key in playDeal)).sort();
  assert.deepEqual(extra, [...COMPACT_DEAL_AUCTION_FIELDS].sort());
});

test('contractState 的成交结论确实由 contract/declarerSeat 带走（门控的安全前提）', () => {
  // 这一条钉住「砍掉 auction 之后不丢结论」：成交帧里最高叫品与庄家都还在
  const raw = publicView(contractState()).deal!;
  const compact = compactOfState(contractState()).view!.deal!;
  assert.equal('auction' in compact, false);
  assert.equal(compact.declarerSeat, raw.declarerSeat);
  assert.deepEqual(compact.contract, raw.contract);
  assert.equal(compact.trump === null, raw.trump === null);
  assert.ok(compact.contract !== null && compact.declarerSeat !== null, '成交帧必须给出定约与庄家');
});
