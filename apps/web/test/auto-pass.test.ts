/**
 * 委托不叫（ADR-0029）的纯函数层：延迟、记账键、该不该代按、本机存储。
 *
 * 调度那一半（`setTimeout` 与发请求）住在 `client/table.svelte.ts`，node 里 import 不了
 * （`.svelte.ts` 带 runes）。所以这里把**判据**全部逐条钉住，客户端那边只负责「按判据做」——
 * 与 `selection.ts` / `sound/events.ts` 同一个分工。
 *
 * 每条关键判据都配一条反证：守卫要能证明自己不是空转，这是本仓库的既有规矩。
 *
 * 沙箱内按包运行：node --import ./test/loader.mjs --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { PublicView } from '@sixty/engine';
import {
  AUTO_PASS_BACKOFF_MAX_MS,
  AUTO_PASS_KEY_PREFIX,
  AUTO_PASS_TRIES,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  armedAfter,
  autoPassBeat,
  autoPassDelay,
  autoPassKey,
  autoPassRetryDelay,
  beatKey,
  isArmedFor,
  readArmedDealNo,
  writeArmedDealNo
} from '../src/lib/auto-pass.ts';
import type { PlayerHand } from '../src/lib/shared.ts';

/* ---------------- 夹具 ---------------- */

type DealShape = NonNullable<PublicView['deal']>;

function view(deal: Partial<DealShape> | null): PublicView {
  return {
    version: 1,
    status: 'playing',
    dealerSeat: 0,
    dealNo: 1,
    levels: [],
    progress: [],
    result: null,
    history: [],
    deal:
      deal === null
        ? null
        : {
            phase: 'auction',
            dealNo: 1,
            dealerSeat: 0,
            auction: [],
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
            summary: null,
            claim: null,
            ...deal
          }
  };
}

function hand(over: Partial<PlayerHand> = {}): PlayerHand {
  return { seat: 0, hand: [], isDeclarer: false, originalKitty: null, buriedKitty: null, ...over };
}

/** 与 `sound.test.ts` 同形的最小 storage 替身：node 里没有 localStorage */
class MemoryStorage {
  #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  clear(): void {
    this.#map.clear();
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }
}

type GlobalWithStorage = { localStorage?: Storage };

/** 临时挂一个 storage（`null` = 没有，`'throwing'` = 一读就抛），跑完恢复原样 */
function withStorage<T>(store: MemoryStorage | 'throwing' | null, body: () => T): T {
  const globals = globalThis as unknown as GlobalWithStorage;
  const had = 'localStorage' in globals;
  const before = globals.localStorage;
  if (store === null) {
    delete globals.localStorage;
  } else if (store === 'throwing') {
    Object.defineProperty(globals, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage 被策略禁用');
      }
    });
  } else {
    globals.localStorage = store as unknown as Storage;
  }
  try {
    return body();
  } finally {
    delete globals.localStorage;
    if (had && before !== undefined) globals.localStorage = before;
  }
}

/* ---------------- 延迟 ---------------- */

test('代按延迟恒在 500~1500ms：两端取到、中间铺满，且不随脏值越界', () => {
  const samples = [0, 0.0001, 0.25, 0.5, 0.75, 0.9999].map((unit) => autoPassDelay(() => unit));
  for (const delay of samples) {
    assert.ok(
      delay >= MIN_DELAY_MS && delay <= MAX_DELAY_MS,
      `延迟 ${delay} 越出 ${MIN_DELAY_MS}~${MAX_DELAY_MS}：太短像脚本抢答，太长让整桌真的变慢`
    );
  }
  assert.equal(autoPassDelay(() => 0), MIN_DELAY_MS, 'rng 取 0 时应落在区间下限');
  assert.equal(autoPassDelay(() => 0.9999), MAX_DELAY_MS, 'rng 逼近 1 时应落在区间上限');
  // 脏值：`NaN` 传进 setTimeout 会退化成「立刻触发」，正好是最不该发生的形状
  for (const dirty of [Number.NaN, Number.POSITIVE_INFINITY, -3, 2]) {
    const delay = autoPassDelay(() => dirty);
    assert.ok(
      Number.isInteger(delay) && delay >= MIN_DELAY_MS && delay <= MAX_DELAY_MS,
      `rng 返回 ${String(dirty)} 时延迟成了 ${delay}：脏值必须夹回区间内`
    );
  }
  // 整数毫秒：小数进度不能让 setTimeout 收到 812.7
  assert.ok(samples.every((delay) => Number.isInteger(delay)), '延迟不是整数毫秒');
});

test('反证：若延迟实现漏了夹取，脏值那条断言确实会红', () => {
  // 与 `autoPassDelay` 同形但**不夹取**的实现：NaN 会一路传出去
  const naive = (rng: () => number): number => MIN_DELAY_MS + Math.floor(rng() * (MAX_DELAY_MS - MIN_DELAY_MS));
  const leaked = naive(() => Number.NaN);
  assert.ok(Number.isNaN(leaked), '这条反证本身失效了：naive 实现应当放出 NaN');
});

test('重试退避：500 → 1000 → 2000 → 4000 后封顶，脏值按第一次算', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 9].map(autoPassRetryDelay),
    [500, 1000, 2000, AUTO_PASS_BACKOFF_MAX_MS, AUTO_PASS_BACKOFF_MAX_MS, AUTO_PASS_BACKOFF_MAX_MS],
    '退避必须翻倍到封顶为止：不翻倍就等于没退避，不封顶就会退到几分钟一次'
  );
  for (const dirty of [Number.NaN, Number.NEGATIVE_INFINITY, -3, 0.7]) {
    const delay = autoPassRetryDelay(dirty);
    assert.ok(
      Number.isInteger(delay) && delay >= MIN_DELAY_MS && delay <= AUTO_PASS_BACKOFF_MAX_MS,
      `tries = ${String(dirty)} 时退避成了 ${delay}：脏值必须夹到第一次那一档`
    );
  }
});

test('重试预算是个小数字：烧完要停手，别把「网断了」当成「每次都要再试一下」', () => {
  assert.ok(AUTO_PASS_TRIES >= 2 && AUTO_PASS_TRIES <= 10, `预算 ${AUTO_PASS_TRIES} 次不合理`);
  // 预算内的总等待：抖一下就恢复的情况要在一两拍内发出，断网时要很快停下
  const total = Array.from({ length: AUTO_PASS_TRIES }, (_, i) => MAX_DELAY_MS + autoPassRetryDelay(i)).reduce(
    (sum, ms) => sum + ms,
    0
  );
  assert.ok(total <= 60_000, `预算内的总等待 ${total}ms 超过一分钟，等于一直重试`);
});

/* ---------------- 记账键 ---------------- */

test('记账键 = 副号:叫牌史长度（同一副里的第二次出手是另一拍）', () => {
  assert.equal(beatKey(3, 2), '3:2');
  assert.notEqual(beatKey(3, 2), beatKey(3, 5), '同一副的第 2 拍与第 5 拍必须是两个键');
  assert.notEqual(beatKey(3, 2), beatKey(4, 2), '换副之后即使长度相同也必须是另一拍');
});

/* ---------------- 该不该代按 ---------------- */

const mine = (over: Partial<DealShape> = {}): PublicView =>
  view({ phase: 'auction', auctionTurn: 0, auction: [{ seat: 2, call: { points: 40, strain: 'C' } }], ...over });

test('正例：轮到我、已委托、这一拍还没按过 ⇒ 该代按', () => {
  assert.equal(autoPassBeat(mine(), hand({ seat: 0 }), true, null), beatKey(1, 1));
});

test('没委托、或已撤掉委托 ⇒ 什么都不做', () => {
  assert.equal(autoPassBeat(mine(), hand({ seat: 0 }), false, null), null);
});

test('不是我的轮次 ⇒ 不代按（轮次只认引擎的 auctionTurn）', () => {
  assert.equal(autoPassBeat(mine({ auctionTurn: 1 }), hand({ seat: 0 }), true, null), null);
});

test('只覆盖叫牌阶段：埋底、出牌、结算一律不代劳', () => {
  for (const phase of ['bury', 'play', 'scored'] as const) {
    assert.equal(
      autoPassBeat(mine({ phase }), hand({ seat: 0 }), true, null),
      null,
      `${phase} 阶段也代按了：那是托管，不在这一版的范围里`
    );
  }
});

test('观战者（没有 you）与还没发牌（deal 为 null）都不代按', () => {
  assert.equal(autoPassBeat(mine(), null, true, null), null);
  assert.equal(autoPassBeat(view(null), hand(), true, null), null);
  assert.equal(autoPassBeat(null, hand(), true, null), null);
});

test('一拍只按一次：这一拍已经记过账就不再来第二下', () => {
  const beat = beatKey(1, 1);
  assert.equal(autoPassBeat(mine(), hand({ seat: 0 }), true, beat), null);
  // 下一拍（我 pass 过、两家继续抬，又轮到我）照旧该按
  const secondTurn = mine({
    auction: [
      { seat: 0, call: 'pass' },
      { seat: 1, call: { points: 45, strain: 'D' } },
      { seat: 2, call: { points: 50, strain: 'H' } }
    ]
  });
  assert.equal(
    autoPassBeat(secondTurn, hand({ seat: 0 }), true, beat),
    beatKey(1, 3),
    '同一副里第二次轮到我时不再代按：那会让对家抬完价我一言不发地卡住'
  );
});

test('全 pass 重发不会自我循环：委托挂在上一副的副号上，新一副自然失效', () => {
  const store = new MemoryStorage();
  withStorage(store, () => {
    writeArmedDealNo('ABC123', 1);
    assert.equal(isArmedFor('ABC123', 1), true);
    // 引擎重发：副号 +1、叫牌史清空、发牌人轮转
    const redealt = view({ phase: 'auction', dealNo: 2, dealerSeat: 1, auctionTurn: 1, auction: [] });
    assert.equal(isArmedFor('ABC123', 2), false, '委托被带进了新一副：三个都委托过就会无限重发');
    assert.equal(autoPassBeat(redealt, hand({ seat: 1 }), isArmedFor('ABC123', 2), null), null);
  });
});

/* ---------------- 客户端那一半（源码守卫） ---------------- */

/**
 * 调度住在 `client/table.svelte.ts`：`node:test` import 不动 `.svelte.ts`（runes 要编译）。
 * 所以这里按本仓库的老套路做源码守卫 —— 关键不是「它写了什么」，而是
 * **判据只有一份**：轮到谁、延迟多少都来自 `auto-pass.ts`，客户端不许自己再算一遍。
 */
const clientSource = readFileSync(new URL('../src/lib/client/table.svelte.ts', import.meta.url), 'utf8');

function schedulerProblems(source: string): string[] {
  const problems: string[] = [];
  if (!source.includes('autoPassBeat(')) problems.push('没有用 autoPassBeat：判据跑出第二份实现');
  if (!source.includes('autoPassDelay(')) problems.push('没有用 autoPassDelay：延迟口径跑出第二份');
  if (/auctionTurn\s*===/.test(source)) problems.push('客户端自己又判了一遍轮次（应当只信 autoPassBeat）');
  if (!/bid\('pass',\s*\{\s*quiet:\s*true\s*\}\)/.test(source)) {
    problems.push('代按没有走 quiet 发送：失败会把「还没轮到你」写成页头红字');
  }
  if (!source.includes('clearTimeout(')) problems.push('在途定时器没有撤：换副/撤销之后还会发出一次');
  // 重试的退避与预算：少了任何一条，断网时的代按就是一条每秒一次的重发循环
  // （busy 每秒翻一次、手动「不叫」跟着灰、页头横幅每秒被抹），也是「一抖」与「真断了」分不开的原因。
  if (!source.includes('autoPassRetryDelay(')) {
    problems.push('重试没有退避（缺 autoPassRetryDelay）：断网时它会一秒重发一次');
  }
  if (!source.includes('AUTO_PASS_TRIES')) {
    problems.push('重试没有预算上限（缺 AUTO_PASS_TRIES）：断网时它会一直重发下去');
  }
  return problems;
}

test('客户端那一半只消费这里的判据，代按走 quiet 发送，且会撤掉在途定时器', () => {
  assert.deepEqual(schedulerProblems(clientSource), []);
});

test('反证：判据搬进客户端 / 代按不静默 / 不撤定时器，都必须被判出来', () => {
  assert.match(
    schedulerProblems(clientSource.replace("bid('pass', { quiet: true })", "bid('pass')")).join('；'),
    /quiet/,
    '去掉 quiet 没有被判出来'
  );
  assert.match(
    schedulerProblems(clientSource.replaceAll('autoPassBeat(', 'autoPassBeatX(')).join('；'),
    /autoPassBeat/,
    '判据被换成另一份实现没有被判出来'
  );
  assert.match(
    schedulerProblems(`${clientSource}\nconst t = deal.auctionTurn === 0;`).join('；'),
    /轮次/,
    '客户端自己判轮次没有被判出来'
  );
  assert.match(
    schedulerProblems(clientSource.replaceAll('autoPassRetryDelay(', 'autoPassRetryDelayX(')).join('；'),
    /退避/,
    '重试的退避被摘掉没有被判出来'
  );
  assert.match(
    schedulerProblems(clientSource.replaceAll('AUTO_PASS_TRIES', 'RETRY_BUDGET_X')).join('；'),
    /预算上限/,
    '重试的预算上限被摘掉没有被判出来'
  );
});

/* ---------------- 台账该留到什么时候 ---------------- */

test('委托只在「正在叫牌的那一副」有效：叫牌一结束就清账', () => {
  const armed: number | null = 1;
  assert.equal(armedAfter(view({ phase: 'auction', dealNo: 1 }), armed), 1, '叫牌中途（同副）必须留着');
  for (const phase of ['bury', 'play', 'scored'] as const) {
    assert.equal(
      armedAfter(view({ phase, dealNo: 1 }), armed),
      null,
      `${phase} 阶段仍留着委托：它已经在叫牌结束那一刻失去意义了`
    );
  }
  assert.equal(armedAfter(view(null), armed), null, '没有牌局时不该留着');
  assert.equal(
    armedAfter(view({ phase: 'auction', dealNo: 2 }), armed),
    null,
    '副号对不上却留着：换副之后不能拿上一副的委托'
  );
});

/**
 * 这条序列守的是一个只有「存副号」才会有的窟窿：`开新对局` 把副号从 1 重新数起，
 * 若第 1 副勾过委托就再没动过，那条 `1` 会在新对局的第 1 副重新生效 —— 等于「我明明没委托，
 * 却被自动 pass 了一副」。按「叫牌结束就清」的规则，那一副的叫牌早就结束、账早就空了。
 */
test('开新对局不会让上一局的委托复活（副号归零也不再命中）', () => {
  const store = new MemoryStorage();
  withStorage(store, () => {
    // 第 1 副：勾上 → 一路叫完（每帧都走一遍 armedAfter）
    writeArmedDealNo('ABCDEF', 1);
    assert.equal(armedAfter(view({ phase: 'auction', dealNo: 1 }), readArmedDealNo('ABCDEF')), 1);
    assert.equal(armedAfter(view({ phase: 'bury', dealNo: 1 }), readArmedDealNo('ABCDEF')), null);
    writeArmedDealNo('ABCDEF', null); // 客户端在上一行返回 null 时清账
    // 开新对局：副号重新从 1 数起
    assert.equal(
      armedAfter(view({ phase: 'auction', dealNo: 1 }), readArmedDealNo('ABCDEF')),
      null,
      '上一局的委托在新对局第 1 副又生效了：会被自动 pass 一整副'
    );
  });
});

/* ---------------- 本机存储 ---------------- */

test('存储键一张桌一个，且与其它本机设置不撞', () => {
  assert.equal(autoPassKey('abc123'), `${AUTO_PASS_KEY_PREFIX}ABC123`);
  assert.notEqual(autoPassKey('abc123'), autoPassKey('zzz999'));
  assert.ok(!autoPassKey('abc123').startsWith('sixty.sound'), '委托与声音共用前缀会互相踩');
});

test('委托往返：写进去读得回来，撤回即清空', () => {
  const store = new MemoryStorage();
  withStorage(store, () => {
    assert.equal(readArmedDealNo('ABCDEF'), null, '没设置过时应是「没委托」');
    writeArmedDealNo('ABCDEF', 2);
    assert.equal(readArmedDealNo('ABCDEF'), 2);
    assert.equal(store.getItem(autoPassKey('ABCDEF')), '2');
    writeArmedDealNo('ABCDEF', null);
    assert.equal(readArmedDealNo('ABCDEF'), null);
    assert.equal(store.getItem(autoPassKey('ABCDEF')), null, '撤回时应当删键，而不是写一个假值');
  });
});

test('脏值与坏 storage 一律当作「没委托」，且不把页面带崩', () => {
  const store = new MemoryStorage();
  withStorage(store, () => {
    for (const dirty of ['abc', '', '  ', '0', '-1', '2.5', 'NaN']) {
      store.setItem(autoPassKey('ABCDEF'), dirty);
      assert.equal(readArmedDealNo('ABCDEF'), null, `脏值 ${JSON.stringify(dirty)} 被当成了有效委托`);
    }
  });
  withStorage(null, () => {
    assert.equal(readArmedDealNo('ABCDEF'), null);
    assert.doesNotThrow(() => writeArmedDealNo('ABCDEF', 3));
  });
  withStorage('throwing', () => {
    assert.equal(readArmedDealNo('ABCDEF'), null, 'storage 抛错时不该把牌桌页带崩');
    assert.doesNotThrow(() => writeArmedDealNo('ABCDEF', 3));
  });
});
