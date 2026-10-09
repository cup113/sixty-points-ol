/**
 * 一副牌的 **token 预算**：把「模型一共要读多少字」变成会红的断言。
 *
 * 为什么这件事需要一个测试：工具面的出参是每个回合都要重发一遍的（宿主每个请求都带着整段会话
 * 与工具面 schema），所以一次多余往返、一个多余的字段都是乘在回合数上的。实测（座位 0 打完一副）：
 *
 *   - 逐字负载 + 每回合 wait/act 两次调用：累计读入 **1,845,222**；
 *   - 每回合多探 3 次 `check_play` → 2.85 倍，多探 17 次 → 16.2 倍（探测才是最大的出血点）；
 *   - 紧凑投影（ADR-0011）：一副实收 **35,636**、累计 **401,156**、结算单帧约 **2,760**；
 *   - **行动投影（ADR-0019，现状）**：一副实收 **18,453**、累计 **288,904**、结算单帧 **1,355**；
 *     整局实收 **139,207**、整局累计 **11,333,093**，而整局最大单帧只有 **1,393** ——
 *     跨副不再累积（战报与旧墩都不再每帧重发），这是这一版最要紧的形状。
 *
 * 这里模拟的就是「每回合一次调用」的那条路：动作自带等待（`wait` 默认 true），
 * 注入的 sleep 让另外两个座位往前走 —— 于是每一回合恰好只有一份局面被投喂。
 *
 * 预算是**上界**而不是等号：改了文案、加了个别字段不该立刻红，但多一份负载、多一轮探测、
 * 或者负载又开始随副数涨，必须红。上限贴着实测值留一点余量（约 5-10%），
 * 而「多一次调用」由 `CALLS_LIMIT` 单独把守 —— 那一条才是往返数的守卫。
 *
 * 「非空转」由最后一个用例证明：同一条路上 `verbose: true` 的那份逐字负载必然超预算 ——
 * 也就是说预算真正卡住的是投影，而不是别的什么。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { checkPlay, type Card } from '@sixty/engine';
import { decodeCard, encodeCard } from '../src/codec.ts';
import { decodePlay } from '../src/project.ts';
import { createMcpServer } from '../src/server.ts';
import { callTool, toolByName, type TableState, type ToolRuntime } from '../src/tools.ts';
import { advanceUntilMyTurn, FakeApi, scoredState } from './fake-api.ts';

/** 每次工具调用/结果的框架开销（tool_use 名称、参数、外壳），与负载无关的那部分 */
const FRAME = 160;

/**
 * schema 上限：16 个工具实测 5,418（ADR-0011 记录的 5,511 是同一批工具的旧读数），留的余量
 * 仍**小于**一个最便宜的工具（零参数约 211）—— 也就是「再加一个工具」照样必须先算这笔账
 * （工具数是**永久税**：它乘在每一次调用上，见 ADR-0011/0014）。
 */
const SCHEMA_LIMIT = 5_650;
/** 一副牌的实收上界（实测 18,453）；「多一次调用」由 CALLS_LIMIT 把守，这里管的是每帧的大小 */
const DELIVERED_LIMIT = 19_500;
/** 累计读入的上界（实测 288,904）：它随回合数二次增长，一个多余的字段也会被放大 */
const CUMULATIVE_LIMIT = 300_000;
/** 结算单帧（实测 1,355）：整副牌里最大的一份 */
const END_STATE_LIMIT = 1_500;
const CALLS_LIMIT = 22;
/** 第二副的最大单帧（实测 1,359）：跨副**不再**累积，所以它只该比第一副多几个字符 */
const GROWTH_LIMIT = 1_500;
/** 整局里最大的一份负载（实测 1,393）：它曾随副数线性上涨（4,402），现在必须基本不动 */
const GAME_MESSAGE_LIMIT = 1_500;
/** 一整局的实收（实测 139,207） */
const GAME_DELIVERED_LIMIT = 150_000;
/** 一整局的累计读入：它是二次的（每个请求重发全文），这条卡住的是**回合数** */
const GAME_CUMULATIVE_LIMIT = 12_000_000;

async function schemaSize(): Promise<number> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    api: new FakeApi(),
    pollMs: 1
  });
  const client = new Client({ name: 'budget-probe', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return JSON.stringify((await client.listTools()).tools).length;
  } finally {
    await client.close();
  }
}

function cardsOf(codes: readonly string[]): Card[] {
  return codes.map((code) => {
    const card = decodeCard(code);
    assert.ok(card !== null, `工具面吐出了认不出的牌码：${code}`);
    return card;
  });
}

/** 手里第一张合法的单张 —— 模型该做的事，测试里用引擎直算（不占一次工具调用） */
function legalSingle(state: TableState): string {
  const hand = cardsOf(state.you!.hand);
  const deal = state.view!.deal!;
  const trump = deal.trump!;
  const trick = deal.trick;
  const lead = trick === null || trick.plays.length === 0 ? null : cardsOf(decodePlay(trick.plays[0]!).cards);
  const card = hand.find((candidate) => checkPlay(hand, [candidate], trump, lead) === null);
  assert.ok(card !== undefined, '手里连一张合法的单张都没有');
  return encodeCard(card);
}

interface DealBudget {
  readonly calls: number;
  readonly messages: readonly number[];
  readonly delivered: number;
  readonly cumulative: number;
  readonly endState: number;
  readonly maxMessage: number;
  readonly schema: number;
  readonly last: TableState;
}

/**
 * 走 `deals` 副牌，按「每回合一次调用」记账。
 *
 * 记账方式就是真正的账：宿主每个请求都会重发**整段会话**与工具面 schema，
 * 所以第 i 份结果会在之后的每个请求里再出现一次 ——
 * `cumulative = Σ_i (schema + 前 i-1 份结果之和)`。
 *
 * `deals = 0` 表示一直打到整局结束（用来量跨副的增长）。
 */
async function measureDeals(schema: number, deals: number): Promise<DealBudget> {
  const api = new FakeApi({ state: null, seat: 0 });
  const rt: ToolRuntime = {
    api,
    pollMs: 1,
    defaultWaitSeconds: 5,
    // 「这张桌会自己往前走」：等待期间让另外两个座位出牌，否则等的是一个不变的 FakeApi
    sleep: async () => {
      advanceUntilMyTurn(api);
    }
  };

  const messages: number[] = [];
  const send = async (name: string, args: Record<string, unknown> = {}): Promise<TableState> => {
    const spec = toolByName(name);
    assert.ok(spec !== undefined, `工具表里没有 ${name}`);
    const value = await callTool(spec, rt, args);
    messages.push(JSON.stringify(value).length + FRAME);
    return value as TableState;
  };

  let state = await send('wait_for_turn', { timeout_seconds: 5 });
  const untilFinished = deals === 0;
  const target = untilFinished ? Number.POSITIVE_INFINITY : deals;
  let scored = 0;
  for (let step = 0; step < 2_000 && scored < target; step += 1) {
    const deal = state.view?.deal ?? null;
    if (deal !== null && deal.phase === 'scored') {
      scored += 1;
      if (scored >= target) break;
      if (untilFinished && state.view?.status === 'finished') break;
      state = await send('deal');
      continue;
    }
    if (deal === null) {
      state = await send('deal');
      continue;
    }
    if (deal.phase === 'auction') {
      // `auction` 只在叫牌阶段给（阶段门控，ADR-0019）
      state = await send('bid', { call: (deal.auction ?? []).length === 0 ? '40C' : 'pass' });
      continue;
    }
    if (deal.phase === 'bury') {
      state = await send('bury', { cards: state.you!.hand.slice(0, 3) });
      continue;
    }
    if (deal.phase === 'play') {
      state = await send('play', { cards: [legalSingle(state)] });
      continue;
    }
    assert.fail(`没见过的阶段：${deal.phase}`);
  }
  if (untilFinished) {
    assert.equal(state.view?.status, 'finished', 'deals=0 时应当打到整局结束');
  } else {
    assert.ok(scored >= target, `只打完了 ${scored} 副，目标是 ${String(target)}`);
  }

  const delivered = messages.reduce((sum, size) => sum + size, 0);
  let prefix = 0;
  let cumulative = 0;
  for (const size of messages) {
    cumulative += schema + prefix;
    prefix += size;
  }
  return {
    calls: messages.length,
    messages,
    delivered,
    cumulative,
    endState: messages[messages.length - 1]!,
    maxMessage: Math.max(...messages),
    schema,
    last: state
  };
}

const SCHEMA = await schemaSize();
const BUDGET = await measureDeals(SCHEMA, 1);
const TWO_DEALS = await measureDeals(SCHEMA, 2);
const FULL_GAME = await measureDeals(SCHEMA, 0);

test('工具面 schema 足够瘦（每个请求都要重发一遍）', () => {
  assert.ok(
    SCHEMA <= SCHEMA_LIMIT,
    `工具面 schema ${SCHEMA} 字符，超过预算 ${SCHEMA_LIMIT}（它乘在回合数上）`
  );
});

test('一副牌只需「每回合一次调用」（动作自带等待，不靠探测）', () => {
  assert.ok(
    BUDGET.calls <= CALLS_LIMIT,
    `一副牌用了 ${BUDGET.calls} 次调用，超过预算 ${CALLS_LIMIT}：每个回合应当只有一次（自己的动作 + 首次等待 + 发牌）`
  );
});

test('一副牌的实收负载在预算内', () => {
  assert.ok(
    BUDGET.delivered <= DELIVERED_LIMIT,
    `一副牌投喂了 ${BUDGET.delivered} 字符，超过预算 ${DELIVERED_LIMIT}（行动投影实测 18,453）`
  );
});

test('模型累计读入在预算内（这才是真正的账：每个请求都重发全文）', () => {
  assert.ok(
    BUDGET.cumulative <= CUMULATIVE_LIMIT,
    `累计读入 ${BUDGET.cumulative} 字符，超过预算 ${CUMULATIVE_LIMIT}（行动投影实测 288,904）`
  );
});

test('结算那一刻的单份局面也在预算内（它是整副牌里最大的一份）', () => {
  assert.ok(
    BUDGET.endState <= END_STATE_LIMIT,
    `结算时单份局面 ${BUDGET.endState} 字符，超过预算 ${END_STATE_LIMIT}（行动投影实测 1,355）`
  );
});

test('预算守卫非空转：verbose 那条逐字路必然超预算', async () => {
  const api = new FakeApi({ state: scoredState(), seat: 0 });
  const compact = await callTool(toolByName('get_state')!, { api }, {});
  const verbose = await callTool(toolByName('get_state')!, { api }, { verbose: true });
  const compactSize = JSON.stringify(compact).length;
  const verboseSize = JSON.stringify(verbose).length;

  assert.ok(
    compactSize <= END_STATE_LIMIT,
    `投影后的结算局面 ${compactSize} 字符就已经超预算了，说明预算没卡在投影上`
  );
  assert.ok(
    verboseSize > END_STATE_LIMIT,
    `逐字负载只有 ${verboseSize} 字符，没超过预算 —— 那这条预算就证明不了什么`
  );
  assert.ok(verboseSize > compactSize * 1.5, `投影只省了 ${compactSize}/${verboseSize}，不值得单开一层`);
});

test('账目本身自洽：实收 = 各份之和，最大一份出现在结算', () => {
  assert.equal(BUDGET.delivered, BUDGET.messages.reduce((sum, size) => sum + size, 0));
  assert.equal(BUDGET.endState, Math.max(...BUDGET.messages));
  assert.equal(BUDGET.schema, SCHEMA);
});

test('跨副不再累积：第二副只多一次发牌调用，单帧大小基本不变', () => {
  assert.equal(TWO_DEALS.calls % BUDGET.calls, 1, '第二副只多一次发牌调用');
  assert.ok(
    TWO_DEALS.maxMessage <= GROWTH_LIMIT,
    `第二副的最大负载 ${TWO_DEALS.maxMessage} 超过 ${GROWTH_LIMIT}`
  );
  // 这是 ADR-0019 最要紧的形状：战报与旧墩都不再每帧重发，所以「第几副」不影响单帧大小。
  // 相对断言比绝对上限更能说明这件事 —— 文案改了不该红，随副数涨起来必须红。
  assert.ok(
    TWO_DEALS.maxMessage <= BUDGET.maxMessage + 60,
    `第二副的最大负载 ${TWO_DEALS.maxMessage} 比第一副的 ${BUDGET.maxMessage} 大出一截：跨副又开始累积了`
  );
  assert.ok(
    TWO_DEALS.endState - BUDGET.endState < 100,
    `第二副的结算负载比第一副多了 ${TWO_DEALS.endState - BUDGET.endState} 字符 —— 跨副不该再涨`
  );
});

test('一整局（打到结束）也不失控：调用数、最大负载、整局实收', () => {
  assert.ok(
    FULL_GAME.calls <= 200,
    `一整局用了 ${FULL_GAME.calls} 次调用：每回合仍应当只有一次（探测会把这个数字翻好几倍）`
  );
  assert.ok(
    FULL_GAME.maxMessage <= GAME_MESSAGE_LIMIT,
    `整局里最大的一份负载 ${FULL_GAME.maxMessage} 超过 ${GAME_MESSAGE_LIMIT}：` +
      '它曾经随副数涨到 4,402（战报与旧墩每帧重发），行动投影下必须基本不动'
  );
  assert.ok(
    FULL_GAME.delivered <= GAME_DELIVERED_LIMIT,
    `一整局实收 ${FULL_GAME.delivered} 字符，超过 ${GAME_DELIVERED_LIMIT}`
  );
  assert.ok(
    FULL_GAME.cumulative <= GAME_CUMULATIVE_LIMIT,
    `一整局累计读入 ${FULL_GAME.cumulative} 字符，超过 ${GAME_CUMULATIVE_LIMIT}：` +
      '这一项对回合数最敏感（二次增长），翻倍就等于多打了一倍的往返'
  );
});

test('累计读入是二次的：这条账说明了「回合数」为什么比「每份大小」更要紧', () => {
  // 每个请求都重发整段会话 ⇒ 多一份结果、多一次往返，都要乘上后面所有回合。
  // 所以真正要守的是「每回合一次调用」，其次才是每份负载的大小。
  const ratio = FULL_GAME.cumulative / BUDGET.cumulative;
  assert.ok(ratio > 20, `整局的累计/单副累计只有 ${ratio.toFixed(1)} 倍，二次增长没体现出来？`);
  assert.equal(BUDGET.cumulative, BUDGET.messages.reduce((sum, size, index, all) => {
    const prefix = all.slice(0, index).reduce((a, b) => a + b, 0);
    return sum + SCHEMA + prefix;
  }, 0));
});
