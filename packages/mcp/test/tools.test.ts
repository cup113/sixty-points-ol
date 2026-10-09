/**
 * 工具层单测：纯逻辑，零网络、零 SDK。
 *
 * 快照用自己的 FakeApi（内存版服务器，见 fake-api.ts）产出，
 * 但规则判定一律由引擎给出 —— 所以这里断言的是「工具面有没有如实转达规则」，
 * 而不是「规则对不对」（后者是 packages/engine 的事）。
 *
 * 出参是**紧凑投影**（牌是 `"S14"` 这样的字符串），`verbose: true` 那条路才是引擎类型逐字；
 * 动作默认**自带等待**，所以不想等的用例要显式传 `wait: false`，否则会真的等 30 秒。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cardClass,
  checkPlay as engineCheckPlay,
  HELP_KEYS,
  validateCall,
  type Bid,
  type Card,
  type TrumpModel
} from '@sixty/engine';
import { ApiError } from '../src/api.ts';
import { decodeCall, decodeCard, encodeCard } from '../src/codec.ts';
import { decodePlay } from '../src/project.ts';
import {
  callTool,
  ToolError,
  toolByName,
  TOOLS,
  type RawTableState,
  type TableState,
  type ToolRuntime,
  type TurnSummary
} from '../src/tools.ts';
import type { TableSummary } from '../src/wire.ts';
import { advanceUntilMyTurn, contractState, dealtState, FakeApi, playingState, scoredState } from './fake-api.ts';

function runtime(api: FakeApi, extra: Partial<ToolRuntime> = {}): ToolRuntime {
  return { api, pollMs: 1000, defaultWaitSeconds: 30, ...extra };
}

/**
 * 「这张桌会自己往前走」的运行时：注入的 sleep 让其它座位走一手。
 *
 * 「动作自带等待」只有这样才能测 —— 否则等的是一个永远不变的 FakeApi。
 */
function liveRuntime(api: FakeApi, extra: Partial<ToolRuntime> = {}): ToolRuntime {
  return runtime(api, {
    pollMs: 1,
    sleep: async () => {
      advanceUntilMyTurn(api);
    },
    ...extra
  });
}

async function call<T = unknown>(
  name: string,
  api: FakeApi,
  args: unknown = {},
  extra: Partial<ToolRuntime> = {}
): Promise<T> {
  const spec = toolByName(name);
  assert.ok(spec !== undefined, `工具表里没有 ${name}`);
  return (await callTool(spec, runtime(api, extra), args)) as T;
}

function cardsOf(codes: readonly string[]): Card[] {
  return codes.map((code) => {
    const card = decodeCard(code);
    assert.ok(card !== null, `工具面吐出了认不出的牌码：${code}`);
    return card;
  });
}

function handOf(state: TableState): Card[] {
  return cardsOf(state.you?.hand ?? []);
}

function trumpOf(state: TableState): TrumpModel {
  const trump = state.view?.deal?.trump;
  assert.ok(trump !== null && trump !== undefined, '这个用例应当已经进入打牌阶段');
  return trump;
}

function leadOf(state: TableState): Card[] | null {
  const trick = state.view?.deal?.trick ?? null;
  return trick === null || trick.plays.length === 0 ? null : cardsOf(decodePlay(trick.plays[0]!).cards);
}

/** 手里第一张合法的单张（牌码形式，可以直接喂给 play） */
function firstLegalSingle(state: TableState): string {
  const hand = handOf(state);
  const lead = leadOf(state);
  const trump = trumpOf(state);
  const card = hand.find((candidate) => engineCheckPlay(hand, [candidate], trump, lead) === null);
  assert.ok(card !== undefined, '手里连一张合法的单张都没有');
  return encodeCard(card);
}

/** 深度收集所有键名：用来证明「公共视图里没有 hand」而不只是顶层没有 */
function keysDeep(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, acc);
    return acc;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      acc.push(key);
      keysDeep(inner, acc);
    }
  }
  return acc;
}

// ---------------------------------------------------------------- 工具表与投影

test('工具表：16 个工具且名字不重复', () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length, '工具名有重复');
  assert.deepEqual([...names].sort(), [
    'bid',
    'bury',
    'check_play',
    'claim',
    'create_table',
    'deal',
    'get_state',
    'join_table',
    'leave_seat',
    'legal_bids',
    'list_my_tables',
    'new_game',
    'play',
    'read_rules',
    'take_seat',
    'wait_for_turn'
  ]);
  for (const tool of TOOLS) {
    assert.ok(tool.description.length > 10, `${tool.name} 缺少能看懂的描述`);
  }
});

/**
 * 安全边界：**无身份也能用的工具恰好只有两个**。
 *
 * `requiresIdentity` 省略即「要身份」（默认拒绝），所以这条断言是「有人把某个工具标成不需要身份」
 * 的唯一警报 —— 那是本次改动里唯一会让未鉴权会话多做一件事的编辑（见 ADR-0014）。
 * 这里写死字面量而不是从表里推导：从表里推导就变成同义反复，抓不住任何东西。
 */
test('无身份白名单：恰好是 read_rules 与 claim（默认拒绝，新工具漏写标志也不会漏出去）', () => {
  const open = TOOLS.filter((tool) => tool.requiresIdentity === false).map((tool) => tool.name).sort();
  assert.deepEqual(open, ['claim', 'read_rules'], '未鉴权的工具集合变了：这是一条安全边界，改它要改 ADR-0014');
  assert.equal(toolByName('get_state')?.requiresIdentity, undefined, '需要身份的工具不该显式写 requiresIdentity');
});

test('get_state：紧凑投影 + you 分开给，并说清现在轮到谁', async () => {
  const api = new FakeApi(); // dealer 0、座位 0 → 开叫的正是自己
  const state = await call<TableState>('get_state', api);

  assert.equal(state.code, 'ABC123');
  assert.equal(state.role, 'player');
  assert.equal(state.you?.hand.length, 17);
  assert.equal(state.you?.seat, 0);
  assert.equal(typeof state.you?.hand[0], 'string', '默认出参是紧凑投影：牌是字符串，不是对象');
  assert.equal(state.view?.deal?.phase, 'auction');
  assert.equal(state.turn.canAct, true);
  // turn 不再重复 phase / isYourTurn（前者看 view.deal.phase，后者与 canAct 同值）——见 turnOf 的注释
  assert.equal('phase' in state.turn, false, 'turn 不该重复 deal.phase');
  assert.equal('isYourTurn' in state.turn, false, 'turn 不该重复 canAct 的同值字段');
});

test('get_state：不是自己的回合时 canAct 为假，也不给合法集', async () => {
  const api = new FakeApi({ seat: 1 }); // 首副由座位 0 先叫
  const state = await call<TableState>('get_state', api);
  assert.equal(state.turn.canAct, false);
  assert.equal(state.turn.legalBids, undefined);
  assert.match(state.turn.hint, /wait_for_turn/);
});

test('隐藏信息不出门：公共视图里不含手牌与底牌，只有各家张数', async () => {
  const api = new FakeApi({ state: playingState(), seat: 0 });
  const state = await call<TableState>('get_state', api);

  const keys = keysDeep(state.view);
  for (const forbidden of ['hand', 'hands', 'kitty', 'originalKitty', 'you']) {
    assert.equal(keys.includes(forbidden), false, `公共视图里出现了 ${forbidden}`);
  }
  assert.ok(keys.includes('handCounts'), '公开信息里应该只有各家的张数');
  // 自己那一份照旧给足，否则玩家没法出牌
  assert.equal(state.you?.hand.length, 17);
});

test('verbose: true 拿回引擎类型逐字的那一份（ADR-0010 的路仍在）', async () => {
  const api = new FakeApi({ state: playingState(), seat: 0 });
  const compact = await call<TableState>('get_state', api);
  const raw = await call<RawTableState>('get_state', api, { verbose: true });

  assert.equal(typeof compact.you?.hand[0], 'string');
  assert.equal(typeof raw.you?.hand[0], 'object');
  assert.deepEqual(raw.you?.hand[0], decodeCard(compact.you!.hand[0]!));
  assert.equal('you' in (raw.view as object), false, '原样负载里 view 与 you 照旧分开');
  assert.ok(
    JSON.stringify(raw).length > JSON.stringify(compact).length,
    'verbose 那一份不该比投影更小'
  );
  assert.deepEqual(raw.turn, compact.turn, '两条路的 turn 必须一致');
});

// ---------------------------------------------------------------- 观战者

test('观战者拿不到 you：只有公共视图，且不能动手', async () => {
  const api = new FakeApi({ state: playingState(), seat: null });
  const state = await call<TableState>('get_state', api);

  assert.equal(state.role, 'spectator');
  assert.equal(state.you, null, '观战者不该拿到手牌');
  assert.equal(JSON.stringify(state).includes('"hand"'), false, '观战者的负载里出现了手牌');
  assert.ok(state.view?.deal !== null, '观战者仍应看到公共局面');
  assert.equal(state.turn.canAct, false);
  assert.match(state.turn.hint, /观战/);

  // check_play 也不能替观战者猜牌
  const verdict = await call<{ results: { ok: boolean; error: string }[] }>('check_play', api, {
    candidates: [['C5']]
  });
  assert.equal(verdict.results.length, 1);
  assert.equal(verdict.results[0]!.ok, false);
  assert.match(verdict.results[0]!.error, /观战/);

  // 动作会被服务端按「观战者」拒绝（这一层只负责原话转达）
  await assert.rejects(() => call('play', api, { cards: ['C5'] }), /服务器拒绝：你在观战/);
});

test('wait_for_turn：观战者不该空转到超时，立刻说清楚', async () => {
  const api = new FakeApi({ state: playingState(), seat: null });
  let slept = 0;
  const out = await call<{ role: string; timedOut: boolean; turn: TurnSummary }>('wait_for_turn', api, {}, {
    sleep: async () => {
      slept += 1;
    }
  });
  assert.equal(out.role, 'spectator');
  assert.equal(slept, 0, '观战者没有座位，等多久都不会轮到，不该轮询');
  assert.equal(out.turn.canAct, false);
});

// ---------------------------------------------------------------- legal_bids

/** 紧凑叫品 → 引擎叫品（断言它认得出、且不是 pass）；顺带把类型收窄给调用方用 */
function bidOf(code: string): Bid {
  const call = decodeCall(code);
  assert.ok(call !== null && call !== 'pass', `${code} 不是能叫出去的紧凑叫品`);
  return call;
}

test('legal_bids：每个候选都用引擎 validateCall 反查为合法（紧凑串，可直接喂回 bid）', async () => {
  const api = new FakeApi();
  const out = await call<{ options: string[] }>('legal_bids', api);

  assert.ok(out.options.length > 0, '开局至少要有 40 分的候选');
  for (const code of out.options) {
    assert.equal(validateCall(bidOf(code), null), null, `${code} 其实不合法`);
  }
  // 分数升序、同分按 C < D < H < S < NT —— 第一项就是最低叫品，模型抄一下即可
  assert.deepEqual(out.options.slice(0, 5), ['40C', '40D', '40H', '40S', '40NT']);
});

test('legal_bids：有人叫了 45♥ 之后，同分只剩更高的花色、低分全部消失', async () => {
  const api = new FakeApi();
  await call('bid', api, { call: '45H', wait: false });
  const out = await call<{ options: string[]; highestBid: string | null }>('legal_bids', api);

  assert.equal(out.highestBid, '45H', '叫品出参是紧凑码（40C / 45H / 45NT）');
  assert.deepEqual(out.options.slice(0, 2), ['45S', '45NT'], '同分只剩更高的花色');
  assert.equal(out.options.filter((code) => bidOf(code).points < 45).length, 0, '低于 45 的候选都该消失');
});

test('legal_bids 的阶段门：埋底 / 出牌 / 结算之后一律空表（不再说谎）', async () => {
  for (const [label, state] of [
    ['埋底', contractState()],
    ['出牌', playingState()],
    ['结算', scoredState()]
  ] as const) {
    const api = new FakeApi({ state, seat: 0 });
    const out = await call<{ options: unknown[]; phase: string; note: string }>('legal_bids', api);
    assert.deepEqual(out.options, [], `${label}阶段不该给出任何叫品`);
    assert.notEqual(out.phase, 'auction');
    assert.match(out.note, /不是叫牌阶段/);
    const full = await call<TableState>('get_state', api);
    assert.equal(full.turn.legalBids, undefined, `${label}阶段的 turn 里不该有合法叫品`);
  }
});

test('turn：轮到你叫牌时直接给合法集（不让模型逐个试探）', async () => {
  const mine = await call<TableState>('get_state', new FakeApi({ state: dealtState(), seat: 0 }));
  assert.deepEqual(mine.turn.legalBids?.slice(0, 5), ['40C', '40D', '40H', '40S', '40NT']);

  const theirs = await call<TableState>('get_state', new FakeApi({ state: dealtState(), seat: 1 }));
  assert.equal(theirs.turn.legalBids, undefined, '不是自己的回合不该给「你可以叫」的错觉');
});

test('turn：轮到你在出牌时给跟牌约束（领出 / 跟牌两种）', async () => {
  // 领出：座位 0 是庄家兼首攻
  const leading = await call<TableState>('get_state', new FakeApi({ state: playingState(), seat: 0 }));
  assert.deepEqual(leading.turn.legalPlay, {
    lead: null,
    holdingCount: 17,
    rule: 'lead-run-or-single'
  });

  // 跟牌：把我挪到座位 1，让座位 0 的首攻由测试代打 —— 轮到 1 时必然是跟牌
  const api = new FakeApi({ state: playingState(), seat: 1 });
  const steps = advanceUntilMyTurn(api, 1);
  assert.equal(steps, 1, '座位 0 应当刚好走了一手（首攻）');

  const following = await call<TableState>('get_state', api);
  const hint = following.turn.legalPlay;
  const trick = following.view?.deal?.trick ?? null;
  assert.ok(hint !== undefined && hint.lead !== null, '跟牌时必须给出领出门与张数');
  assert.equal(hint.lead.size, decodePlay(trick!.plays[0]!).cards.length);
  assert.ok(hint.rule === 'must-follow-class' || hint.rule === 'must-empty-class');
  assert.equal(
    hint.holdingCount,
    handOf(following).filter((card) => cardClass(card, trumpOf(following)) === hint.lead!.cardClass).length,
    'holdingCount 必须就是「同门张数」'
  );
});

// ---------------------------------------------------------------- check_play

test('check_play：把引擎的裁决原话转达，且一次可以验多组', async () => {
  const api = new FakeApi({ state: playingState(), seat: 0 });
  const payload = await call<TableState>('get_state', api);
  const trump = trumpOf(payload);
  const hand = handOf(payload);

  // 领出多张必须同门：挑两张门类不同的牌，这个选择一定非法。
  // 门类要用引擎的 cardClass 判（级牌与王都是主牌），不能只看 suit ——
  // ♣2 与 ♦2 花色不同却是同一门，这种选择错在「不成顺子」而不是「不同门」。
  const first = hand[0]!;
  const other = hand.find((card) => cardClass(card, trump) !== cardClass(first, trump));
  assert.ok(other !== undefined, '17 张牌不可能全是一个门类');

  const expected = engineCheckPlay(hand, [first, other], trump, null);
  assert.notEqual(expected, null, '两张不同门类的牌不该构成合法领出');

  const out = await call<{ results: { ok: boolean; error: string | null }[] }>('check_play', api, {
    candidates: [[encodeCard(first), encodeCard(other)], [encodeCard(first)]]
  });
  assert.equal(out.results.length, 2, '一次调用应当同时回答两组候选');
  assert.equal(out.results[0]!.ok, false);
  assert.equal(out.results[0]!.error, expected, '工具面必须原话转达引擎的裁决');
  assert.deepEqual(out.results[1], { ok: true, error: null });
});

test('check_play：不是出牌阶段时明说，而不是假装合法', async () => {
  const api = new FakeApi(); // 叫牌阶段
  const out = await call<{ results: { ok: boolean; error: string }[] }>('check_play', api, {
    candidates: [['C5']]
  });
  assert.equal(out.results[0]!.ok, false);
  assert.equal(out.results[0]!.error, '现在不是出牌阶段');
});

// ---------------------------------------------------------------- 动作

test('动作永不带 seat：座位一律由服务端推导', async () => {
  const auction = new FakeApi();
  await call('bid', auction, { call: 'pass', wait: false });
  assert.deepEqual(auction.actions[0], { type: 'bid', call: 'pass' });
  assert.equal(Object.hasOwn(auction.actions[0] as object, 'seat'), false);

  const bury = new FakeApi({ state: contractState(), seat: 0 });
  const buryYou = (await call<TableState>('get_state', bury)).you!;
  const three = buryYou.hand.slice(0, 3);
  await call('bury', bury, { cards: three, wait: false });
  assert.deepEqual(bury.actions[0], { type: 'bury', cards: cardsOf(three) });

  const play = new FakeApi({ state: playingState(), seat: 0 });
  const playYou = (await call<TableState>('get_state', play)).you!;
  await call('play', play, { cards: [playYou.hand[0]!], wait: false });
  assert.deepEqual(play.actions[0], { type: 'play', cards: cardsOf([playYou.hand[0]!]) });
});

test('牌码同形：get_state 给的 you.hand 元素可以原样喂回 play', async () => {
  const api = new FakeApi({ state: playingState(), seat: 0 });
  const state = await call<TableState>('get_state', api);
  const code = firstLegalSingle(state);
  assert.ok(state.you!.hand.includes(code), '选的牌应当就在 hand 里');
  await call('play', api, { cards: [code], wait: false });
  assert.deepEqual(api.actions[0], { type: 'play', cards: [decodeCard(code)] });
});

/**
 * **叫品必须能叫出去**（回归守卫）：`call` 曾经是 `z.union(['pass', {points, strain}])`，SDK 把
 * union 播报成 `anyOf`，而宿主在把工具 schema 交给模型前会清洗它 —— Cuplivo 把 `anyOf` 拍平成
 * **第一个分支**（`"pass"`），对象分支整个消失，于是真叫牌一律失败、只有 pass 成功。
 * 所以入参是扁平字符串：这里从「出参里抄下来的写法」一路验到服务端收到的引擎叫品。
 */
test('叫品同形：legal_bids 给的紧凑串可以原样喂回 bid（大小写与空格宽容）', async () => {
  const api = new FakeApi();
  const listed = await call<{ options: string[] }>('legal_bids', api);
  const first = listed.options[0]!;
  assert.equal(first, '40C');

  await call('bid', api, { call: first, wait: false });
  assert.deepEqual(api.actions[0], { type: 'bid', call: { points: 40, strain: 'C' } });

  // 宿主/模型给的大小写与空格不该白费一个回合
  const second = new FakeApi();
  await call('bid', second, { call: ' 45h ', wait: false });
  assert.deepEqual(second.actions[0], { type: 'bid', call: { points: 45, strain: 'H' } });

  const third = new FakeApi();
  await call('bid', third, { call: '40 NT', wait: false });
  assert.deepEqual(third.actions[0], { type: 'bid', call: { points: 40, strain: 'NT' } });
});

test('叫品认不出来时点名是哪一个，并说清格式（形状错不打到服务端）', async () => {
  const api = new FakeApi();
  for (const [bad, hint] of [
    ['41C', /call「41C」/],
    ['39C', /认不出来/],
    ['40N', /认不出来/],
    ['S40', /认不出来/]
  ] as const) {
    await assert.rejects(() => call('bid', api, { call: bad }), hint, `${bad} 应当被参数层挡下`);
  }
  // 旧的对象写法也一并说清楚：现在只收紧凑叫品
  await assert.rejects(() => call('bid', api, { call: { points: 40, strain: 'C' } }), /参数格式不正确：call/);
  assert.deepEqual(api.actions, [], '形状错的叫品不该打到服务端');
});

test('动作自带等待：成功之后直接给「下一次轮到你能动」的局面', async () => {
  const api = new FakeApi({ state: dealtState(), seat: 0 });
  const out = await call<TableState & { timedOut?: boolean }>(
    'bid',
    api,
    { call: '40C' },
    liveRuntime(api)
  );

  assert.equal(out.timedOut, false);
  assert.equal(out.view?.deal?.phase, 'bury', '另外两家 pass 之后应当已经成交、进入埋底，而且庄家是我');
  assert.equal(out.turn.canAct, true);
  assert.equal(api.actions.length, 1, '只该发生我自己那一个动作');
  assert.ok(api.reads >= 2, `等待期间应当至少读两次局面，实际 ${api.reads}`);
});

test('动作超时：timedOut 为 true，并明说动作已生效、不要重复', async () => {
  const api = new FakeApi({ state: playingState(), seat: 0 });
  const state = await call<TableState>('get_state', api);
  const out = await call<TableState & { timedOut?: boolean; note?: string }>(
    'play',
    api,
    { cards: [firstLegalSingle(state)] },
    { sleep: async () => {}, defaultWaitSeconds: 0 }
  );

  assert.equal(out.timedOut, true);
  assert.match(out.note ?? '', /已经生效/);
  assert.match(out.note ?? '', /不要重复/);
  assert.equal(api.actions.length, 1);
  assert.equal(out.view?.deal?.phase, 'play', '超时也要把当前局面原样给回来');
});

test('wait: false：动作只回执当前局面，一次都不等', async () => {
  const api = new FakeApi({ state: playingState(), seat: 0 });
  const state = await call<TableState>('get_state', api);
  let slept = 0;
  const out = await call<TableState & { timedOut?: boolean }>(
    'play',
    api,
    { cards: [firstLegalSingle(state)], wait: false },
    {
      sleep: async () => {
        slept += 1;
      }
    }
  );
  assert.equal(slept, 0, 'wait:false 不该睡哪怕一次');
  assert.equal(out.timedOut, undefined, 'wait:false 不该报「等待超时」');
  assert.equal(out.view?.deal?.phase, 'play');
  assert.equal(api.actions.length, 1);
});

test('服务端拒绝原样转成人话，且拒绝时不等待（形状由传输层转成 isError）', async () => {
  const api = new FakeApi({ failWith: new ApiError('还没轮到你叫牌', 400) });
  await assert.rejects(
    () => call('bid', api, { call: 'pass' }),
    (error: unknown) => error instanceof ToolError && error.message === '服务器拒绝：还没轮到你叫牌'
  );
});

test('没拿到响应（status 0）不算「服务器拒绝」：写路径可能已经生效，得先核对', async () => {
  // 连不上/超时/响应读到一半断了都没有服务端的判定，套上「服务器拒绝」会把人引向错误的下一步
  const api = new FakeApi({
    failWith: new ApiError('无法确认这次请求是否已经生效（terminated）：先用 get_state / list_my_tables 核对现状', 0)
  });
  await assert.rejects(
    () => call('play', api, { cards: ['C5'] }),
    (error: unknown) =>
      error instanceof ToolError &&
      error.message.startsWith('无法确认这次请求是否已经生效') &&
      !error.message.includes('服务器拒绝')
  );
});

test('参数格式不正确时点名是哪个字段（含认不出的牌码）', async () => {
  const api = new FakeApi();
  await assert.rejects(() => call('play', api, { cards: [] }), /参数格式不正确：cards/);
  await assert.rejects(() => call('bury', api, { cards: ['C5'] }), /参数格式不正确：cards/);
  await assert.rejects(() => call('play', api, { cards: ['X5'] }), /认不出的牌码「X5」/);
  await assert.rejects(() => call('check_play', api, { candidates: [] }), /参数格式不正确：candidates/);
  await assert.rejects(
    () => call('check_play', api, { candidates: [['C5', 'S99']] }),
    /candidates\[0\] 里有认不出的牌码/
  );
});

// ---------------------------------------------------------------- 等待

test('wait_for_turn：轮到自己就立刻返回，不睡', async () => {
  const api = new FakeApi();
  let slept = 0;
  const out = await call<{ timedOut: boolean }>('wait_for_turn', api, {}, {
    sleep: async () => {
      slept += 1;
    }
  });
  assert.equal(out.timedOut, false);
  assert.equal(slept, 0, '已经轮到自己了还睡了一次');
});

test('wait_for_turn：timeout_seconds=0 时不睡也不挂住，并说明下一步', async () => {
  const api = new FakeApi({ seat: 1 });
  let slept = 0;
  const out = await call<{ timedOut: boolean; turn: TurnSummary; note?: string }>(
    'wait_for_turn',
    api,
    { timeout_seconds: 0 },
    {
      sleep: async () => {
        slept += 1;
      }
    }
  );
  assert.equal(out.timedOut, true);
  assert.equal(out.turn.canAct, false);
  assert.equal(slept, 0);
  assert.match(out.note ?? '', /再调一次/);
});

test('wait_for_turn：真等一秒会轮询多次（不是空转）', async () => {
  const api = new FakeApi({ seat: 1 });
  const out = await call<{ timedOut: boolean }>('wait_for_turn', api, { timeout_seconds: 1 }, { pollMs: 500 });
  assert.equal(out.timedOut, true);
  assert.ok(api.reads >= 2, `至少应读两次局面，实际 ${api.reads}`);
});

// ---------------------------------------------------------------- 桌面与规则

test('还没发牌时 get_state 可用，deal 之后进入叫牌', async () => {
  const api = new FakeApi({ state: null });
  const before = await call<TableState>('get_state', api);
  assert.equal(before.view, null);
  assert.equal(before.you, null, '还没发牌时没有手牌可给');
  assert.equal(before.turn.canAct, true);
  assert.match(before.turn.hint, /deal/);

  const after = await call<TableState>('deal', api, { wait: false });
  assert.equal(after.view?.deal?.phase, 'auction');
  assert.equal(after.you?.hand.length, 17);
  assert.deepEqual(api.actions, [{ type: 'deal' }]);
});

test('code 可省略：只有一张桌时自动用它并把码归一成大写', async () => {
  const one = new FakeApi({ tables: [{ code: 'abc123', seated: 1, role: 'player' }] });
  const state = await call<TableState>('get_state', one, {});
  assert.equal(state.code, 'ABC123');
});

test('code 可省略：多张桌必须指名，一张都没有时指路 join_table', async () => {
  const many = new FakeApi({
    tables: [
      { code: 'AAA111', seated: 1, role: 'player' },
      { code: 'BBB222', seated: 3, role: 'spectator' }
    ]
  });
  await assert.rejects(() => call('get_state', many, {}), /AAA111、BBB222/);

  const none = new FakeApi({ tables: [] });
  await assert.rejects(() => call('get_state', none, {}), /join_table/);
});

test('read_rules：默认返回全部阶段（含观战）、指定 key 只回一段、key 写错点名合法值', async () => {
  const api = new FakeApi();
  const all = await call<{ entries: { key: string }[] }>('read_rules', api);
  assert.deepEqual(
    all.entries.map((e) => e.key),
    [...HELP_KEYS],
    'read_rules 的段列表必须与引擎的 HELP_KEYS 完全一致（不多不少、顺序相同）'
  );
  assert.ok(all.entries.length >= 9, '观战那段也要在');

  const one = await call<{ entries: { key: string; lines: string[] }[] }>('read_rules', api, { key: 'scored' });
  assert.equal(one.entries.length, 1);
  assert.equal(one.entries[0]!.key, 'scored');
  assert.ok(one.entries[0]!.lines.join('\n').includes('ceil'), '升级表那段必须讲到 ceil');

  await assert.rejects(() => call('read_rules', api, { key: 'nope' }), /key 只能是/);
});

test('桌面工具：查桌 / 建桌 / 入座', async () => {
  const api = new FakeApi();
  const list = await call<{ tables: readonly TableSummary[] }>('list_my_tables', api);
  assert.deepEqual(list.tables, [{ code: 'ABC123', seated: 3, role: 'player' }]);

  const created = await call<{ code: string }>('create_table', api);
  assert.equal(created.code, 'NEW111');

  const entered = await call<TableState>('join_table', api, { code: 'new111' });
  assert.deepEqual(api.entered, ['NEW111'], '邀请码应先归一大写再进桌');
  assert.equal(entered.code, 'NEW111');
});

// ---------------------------------------------------------------- 无身份会话（见 ADR-0014）

test('无身份会话：只有 read_rules 与 claim 调得动，其余一律指路且不碰取数出口', async () => {
  const api = new FakeApi({ authenticated: false });
  const rules = await call<{ entries: unknown[] }>('read_rules', api);
  assert.ok(rules.entries.length > 0, 'read_rules 是纯本地读，没有身份也该读得到');

  // 指路错误要把「怎么配 / 怎么自己建 / 哪些不用身份」都说清，否则模型只会一遍遍撞墙
  for (const [name, args] of [
    ['get_state', {}],
    ['play', { cards: ['C5'] }],
    ['create_table', {}]
  ] as const) {
    await assert.rejects(
      () => call(name, api, args),
      (error: unknown) => error instanceof ToolError && /还没有身份/.test(error.message) && /claim/.test(error.message),
      `${name} 在无身份会话里必须被挡下并指路 claim`
    );
  }
  assert.equal(api.reads, 0, '被挡下的调用不该碰到取数出口');
  assert.deepEqual(api.actions, []);
  assert.deepEqual(api.left, []);
  assert.deepEqual(api.created, []);
});

test('claim：未鉴权就能建身份，返回凭据串与交接说明；撞名一律失败', async () => {
  const api = new FakeApi({ authenticated: false, takenNames: ['小明'] });
  const claimed = await call<{ name: string; credential: string; note: string }>('claim', api, { name: '小六' });

  assert.equal(claimed.name, '小六');
  assert.deepEqual(api.claimed, ['小六']);
  assert.ok(claimed.credential.length > 10, '凭据串不该是空的');
  assert.match(claimed.note, /粘贴凭据串/, '交接说明要讲清人类怎么把它用起来');
  assert.match(claimed.note, /不会接管/, '必须写明本会话不接管这个身份');

  // 撞名：原话转达且**不能**带出任何凭据（否则等于返回了别人的身份，见 ADR-0009）
  await assert.rejects(
    () => call('claim', api, { name: '小明' }),
    (error: unknown) =>
      error instanceof ToolError && error.message === '服务器拒绝：这个名字已被使用，请换一个，或用凭据串导入你的身份'
  );
});

test('claim：名字的长度先由参数校验挡一道，非法参数不打到服务端', async () => {
  const api = new FakeApi({ authenticated: false });
  await assert.rejects(() => call('claim', api, { name: '' }), /参数格式不正确：name/);
  await assert.rejects(() => call('claim', api, { name: '一二三四五六七八九十十一十二十三' }), /参数格式不正确：name/);
  assert.deepEqual(api.claimed, []);
});

// ---------------------------------------------------------------- 座位双向

test('leave_seat：只回一句回执（不附局面）、不读局面、码归一成大写', async () => {
  const api = new FakeApi({ tables: [{ code: 'abc123', seated: 3, role: 'player' }] });
  const out = await call<{ ok: boolean; code: string; role: string; note: string }>('leave_seat', api, {});

  assert.equal(out.ok, true);
  assert.equal(out.code, 'ABC123');
  assert.equal(out.role, 'spectator');
  assert.equal('view' in out, false, '离座回执不该带局面：工具面出参每个回合都要重发');
  assert.equal('turn' in out, false);
  assert.match(out.note, /take_seat/, '要告诉它怎么坐回来');
  assert.deepEqual(api.left, ['ABC123']);
  assert.equal(api.reads, 0, '离座不需要读局面');
});

test('take_seat：回完整局面，补位时明说接下了这个座位的手牌', async () => {
  const api = new FakeApi({
    state: playingState(),
    seat: null,
    tables: [{ code: 'ABC123', seated: 2, role: 'spectator' }],
    inheritedOnTake: true
  });
  const out = await call<TableState & { note?: string }>('take_seat', api, {});

  assert.deepEqual(api.sat, ['ABC123']);
  assert.equal(out.role, 'player');
  assert.equal(out.you?.hand.length, 17, '补位者必须拿到这个座位的手牌，否则不知道该出什么');
  assert.match(out.note ?? '', /补进/, '补位要显式说明，免得拿着陌生手牌发愣');
  assert.match(out.note ?? '', /座位 0/);
});

test('take_seat：空座本来就空（不是补位）时不谎称接手了别人的牌', async () => {
  const api = new FakeApi({ state: null, seat: null, tables: [{ code: 'ABC123', seated: 1, role: 'spectator' }] });
  const out = await call<TableState & { note?: string }>('take_seat', api, {});

  assert.equal(out.role, 'player');
  assert.match(out.note ?? '', /座位 0/);
  assert.equal(/补进/.test(out.note ?? ''), false);
});
