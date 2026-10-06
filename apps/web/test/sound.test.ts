/**
 * 声音反馈的三层测试（见 `src/lib/sound/`）。
 *
 * 分工与仓库里其它守卫一致：
 * ① **纯函数**（`settings.ts` 的存取、`events.ts` 的帧差判据）—— 逐条断言，含反例；
 * ② **SSR 安全**——不是扫源码，而是真的在 node 里 `import` 一次 `board.svelte.ts`：
 *    只要模块顶层碰了 `AudioContext`，这个 import 就会当场抛（这比断言「源码里没有某字符串」硬）；
 * ③ **资产与落点**——五个 mp3 必须在、且代码里引用的正是这几个名字；声音只在牌桌页出现
 *    （音乐「仅牌桌页」是靠这件事成立的，不是靠一句注释）。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import type { PublicView } from '@sixty/engine';
import type { PlayerHand } from '../src/lib/shared.ts';
import {
  DEFAULT_SOUND_SETTINGS,
  SOUND_STORAGE_KEYS,
  VOLUME_MAX,
  clampVolume,
  readSoundSettings,
  readSoundVolume,
  readVibration,
  volumeGain,
  writeSoundVolume,
  writeVibration
} from '../src/lib/sound/settings.ts';
import {
  isMyTurn,
  soundEvents,
  soundSnapshot,
  type SoundSnapshot
} from '../src/lib/sound/events.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/* ---------------- 纯函数：本机记忆 ---------------- */

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

/** 只描述我们要挂上去的那一个可选属性：与 `typeof globalThis` 求交会让它变成必需，`delete` 就不合法了 */
type GlobalWithStorage = { localStorage?: Storage };

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

test('出厂默认：两条通道静音（0）、震动开', () => {
  assert.deepEqual(DEFAULT_SOUND_SETTINGS, { music: 0, sfx: 0, vibration: true });
});

test('没设置过（或没有 storage）时读到默认值', () => {
  withStorage(null, () => {
    assert.deepEqual(readSoundSettings(), DEFAULT_SOUND_SETTINGS);
  });
  withStorage(new MemoryStorage(), () => {
    assert.deepEqual(readSoundSettings(), DEFAULT_SOUND_SETTINGS);
  });
});

test('storage 取用抛错时退回默认值，不把页面带崩', () => {
  withStorage('throwing', () => {
    assert.deepEqual(readSoundSettings(), DEFAULT_SOUND_SETTINGS);
    assert.doesNotThrow(() => writeSoundVolume('sfx', 60));
    assert.doesNotThrow(() => writeVibration(false));
  });
});

test('音量往返：写进去读得回来，且两条通道各存各的键', () => {
  const store = new MemoryStorage();
  withStorage(store, () => {
    writeSoundVolume('music', 30);
    writeSoundVolume('sfx', 65);
    writeVibration(false);
    assert.deepEqual(readSoundSettings(), { music: 30, sfx: 65, vibration: false });
    assert.equal(store.getItem(SOUND_STORAGE_KEYS.music), '30');
    assert.equal(store.getItem(SOUND_STORAGE_KEYS.sfx), '65');
  });
});

test('音量被夹到 0~100 的整数：越界、小数、空白、脏值各有归宿', () => {
  assert.equal(clampVolume(150), VOLUME_MAX);
  assert.equal(clampVolume(-20), 0);
  assert.equal(clampVolume(30.7), 31);
  assert.equal(clampVolume(Number.NaN), 0);
  const store = new MemoryStorage();
  withStorage(store, () => {
    store.setItem(SOUND_STORAGE_KEYS.music, '150');
    store.setItem(SOUND_STORAGE_KEYS.sfx, 'abc');
    assert.equal(readSoundVolume('music'), VOLUME_MAX, '越界值要夹到上限，而不是把滑块顶出范围');
    assert.equal(readSoundVolume('sfx'), 0, '脏值退回默认（默认就是 0）');
    store.setItem(SOUND_STORAGE_KEYS.sfx, '  40  ');
    assert.equal(readSoundVolume('sfx'), 40, '带空白的数字仍然算数');
    store.setItem(SOUND_STORAGE_KEYS.sfx, '');
    assert.equal(readSoundVolume('sfx'), 0, '空串按没设置过处理');
  });
});

test('旧布尔值的兼容方向是「变轻」：`1` 读成音量 1（几乎无声），绝不会突然变响', () => {
  const store = new MemoryStorage();
  withStorage(store, () => {
    // 本功能上线前这两个键存的是「开 / 关」
    store.setItem(SOUND_STORAGE_KEYS.music, '1');
    store.setItem(SOUND_STORAGE_KEYS.sfx, '0');
    assert.equal(readSoundVolume('music'), 1);
    assert.equal(readSoundVolume('sfx'), 0);
  });
});

test('震动仍是开关：只有 `1`／`0` 被采信，其余退回默认（默认是开）', () => {
  const store = new MemoryStorage();
  withStorage(store, () => {
    store.setItem(SOUND_STORAGE_KEYS.vibration, 'yes');
    assert.equal(readVibration(), true);
    writeVibration(false);
    assert.equal(readVibration(), false);
    writeVibration(true);
    assert.equal(readVibration(), true);
  });
});

test('音量曲线：0 静音、100 满增益、二次（30 约 −21 dB），且单调不减', () => {
  assert.equal(volumeGain(0), 0, '0 必须是**真的**静音，不能留一点底噪');
  assert.equal(volumeGain(VOLUME_MAX), 1);
  assert.ok(Math.abs(volumeGain(30) - 0.09) < 1e-9, `30 应当约 0.09，实际 ${volumeGain(30)}`);
  assert.ok(Math.abs(volumeGain(50) - 0.25) < 1e-9, '50 应当约 0.25（−12 dB）');
  let last = -1;
  for (let v = 0; v <= VOLUME_MAX; v += 5) {
    const gain = volumeGain(v);
    assert.ok(gain >= last, `音量 ${v} 的增益比上一档还小：曲线必须单调不减`);
    assert.ok(gain >= 0 && gain <= 1, `音量 ${v} 的增益 ${gain} 超出了 0~1`);
    last = gain;
  }
  // 低段比线性更细：这正是「太大」那条反馈要的分辨率
  assert.ok(volumeGain(30) < 30 / VOLUME_MAX, '30 这一档应当明显低于线性（否则低段等于没得调）');
});

/* ---------------- 纯函数：帧差判据 ---------------- */

/** 一帧快照，默认值 = 出牌阶段、第一副、轮到座位 0 的我 */
function snap(over: Partial<SoundSnapshot> = {}): SoundSnapshot {
  return {
    phase: 'play',
    dealNo: 1,
    mySeat: 0,
    isDeclarer: false,
    auctionTurn: 0,
    playTurn: 0,
    trickPlays: 0,
    tricksDone: 0,
    settledDealNo: null,
    ...over
  };
}

function view(deal: Partial<NonNullable<PublicView['deal']>> | null): PublicView {
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
            phase: 'play',
            dealNo: 1,
            dealerSeat: 0,
            auction: [],
            highestBid: null,
            auctionTurn: 0,
            contract: null,
            trump: null,
            trick: null,
            playTurn: 0,
            trickHistory: [],
            captured: [],
            handCounts: [17, 17, 17],
            declarerSeat: null,
            summary: null,
            ...deal
          }
  };
}

const hand = (over: Partial<PlayerHand> = {}): PlayerHand => ({
  seat: 0,
  hand: [],
  isDeclarer: false,
  originalKitty: null,
  buriedKitty: null,
  ...over
});

test('快照从视图取值：手牌 / 座位 / 计数 / 结算副号都跟着视图走', () => {
  const s = soundSnapshot(
    view({
      trick: { leaderSeat: 0, plays: [{ seat: 0, cards: [] }, { seat: 1, cards: [] }] },
      trickHistory: [],
      summary: null
    }),
    hand({ seat: 2, isDeclarer: true })
  );
  assert.equal(s.mySeat, 2);
  assert.equal(s.isDeclarer, true);
  assert.equal(s.trickPlays, 2);
  assert.equal(s.tricksDone, 0);
  assert.equal(s.settledDealNo, null);
  // 大厅（还没发牌）：一切为空，但也不该抛
  const lobby = soundSnapshot(view(null), null);
  assert.equal(lobby.phase, null);
  assert.equal(lobby.mySeat, null);
  assert.equal(lobby.trickPlays, 0);
});

test('isMyTurn：叫牌看 auctionTurn、埋底看「我是不是庄家」、出牌看 playTurn，观战者恒假', () => {
  assert.equal(isMyTurn(snap({ phase: 'auction', auctionTurn: 1, mySeat: 1 })), true);
  assert.equal(isMyTurn(snap({ phase: 'auction', auctionTurn: 1, mySeat: 0 })), false);
  assert.equal(isMyTurn(snap({ phase: 'bury', isDeclarer: true })), true);
  assert.equal(isMyTurn(snap({ phase: 'bury', isDeclarer: false })), false);
  assert.equal(isMyTurn(snap({ phase: 'play', playTurn: 0, mySeat: 0 })), true);
  assert.equal(isMyTurn(snap({ phase: 'play', playTurn: 2, mySeat: 0 })), false);
  assert.equal(isMyTurn(snap({ phase: 'auction', auctionTurn: 0, mySeat: null })), false);
  assert.equal(isMyTurn(snap({ phase: 'bury', isDeclarer: true, mySeat: null })), false);
});

test('「该你了」：由不是变是才响；同一帧重放不重复响', () => {
  const mine = snap({ phase: 'auction', auctionTurn: 0, mySeat: 0 });
  const theirs = snap({ phase: 'auction', auctionTurn: 1, mySeat: 0 });
  assert.deepEqual(soundEvents(theirs, mine), ['turn']);
  assert.deepEqual(soundEvents(mine, mine), [], '同一帧算两次：不该连响两声');
  assert.deepEqual(soundEvents(mine, theirs), []);
});

test('「该你了」：首帧若正轮到我，也响一声（刷新后正轮到你，那一下正是提醒）', () => {
  assert.deepEqual(soundEvents(null, snap({ phase: 'play', playTurn: 0, mySeat: 0 })), ['turn']);
  assert.deepEqual(soundEvents(null, snap({ phase: 'play', playTurn: 1, mySeat: 0 })), []);
});

test('「该你了」：叫牌最后一人成交后接着埋底，只响一声（布尔判据，不是「阶段 + 座位」）', () => {
  const lastBid = snap({ phase: 'auction', auctionTurn: 0, mySeat: 0, isDeclarer: false });
  const nowBury = snap({ phase: 'bury', isDeclarer: true, mySeat: 0 });
  assert.deepEqual(soundEvents(lastBid, nowBury), []);
});

test('「该你了」：观战者永远听不到（出牌 / 收墩 / 结算照响）', () => {
  const before = snap({ mySeat: null, playTurn: 0, trickPlays: 1, tricksDone: 0 });
  const after = snap({ mySeat: null, playTurn: 0, trickPlays: 2, tricksDone: 1 });
  assert.deepEqual(soundEvents(before, after), ['card', 'trick']);
});

test('出牌落牌：同一副里当前墩的牌数增加就响一声（顺子一把多张仍只一声）', () => {
  assert.deepEqual(soundEvents(snap({ trickPlays: 0 }), snap({ trickPlays: 1 })), ['card']);
  assert.deepEqual(soundEvents(snap({ trickPlays: 1 }), snap({ trickPlays: 3 })), ['card']);
  assert.deepEqual(soundEvents(snap({ trickPlays: 2 }), snap({ trickPlays: 2 })), []);
});

test('赢墩收墩：已完成墩数增加就响；末墩与结算同帧时先墩后结算', () => {
  assert.deepEqual(soundEvents(snap({ tricksDone: 0 }), snap({ tricksDone: 1 })), ['trick']);
  const lastFrame = snap({ trickPlays: 3, tricksDone: 4 });
  const scored = snap({ phase: 'scored', trickPlays: 0, tricksDone: 5, settledDealNo: 1 });
  assert.deepEqual(soundEvents(lastFrame, scored), ['trick', 'settle']);
});

test('跨副不误报：开新一副时计数从 0 重来，不算「出牌」或「收墩」', () => {
  const endOfDeal = snap({ phase: 'scored', dealNo: 1, trickPlays: 3, tricksDone: 8 });
  // 新一副的开叫轮到**别人**：这一条只问「计数重来」会不会被误读成出牌/收墩
  const newDeal = snap({
    dealNo: 2,
    phase: 'auction',
    auctionTurn: 1,
    trickPlays: 0,
    tricksDone: 0,
    settledDealNo: null
  });
  assert.deepEqual(soundEvents(endOfDeal, newDeal), []);
  // 同一帧若新一副的开叫正好轮到我：只响「该你了」，仍然不该混进出牌/收墩
  const meFirst = snap({ ...newDeal, auctionTurn: 0 });
  assert.deepEqual(soundEvents(endOfDeal, meFirst), ['turn']);
});

test('本副结算：只在「新出现一个结算」时响一次', () => {
  const playing = snap({ phase: 'play', trickPlays: 3 });
  const settled = snap({ phase: 'scored', settledDealNo: 3, trickPlays: 0 });
  assert.deepEqual(soundEvents(playing, settled), ['settle']);
  assert.deepEqual(soundEvents(settled, settled), [], '结算帧重放：不该再响');
  // 下一副的结算（副号变了）照响
  const nextSettled = snap({ phase: 'scored', dealNo: 4, settledDealNo: 4, trickPlays: 0 });
  assert.deepEqual(soundEvents(settled, nextSettled), ['settle']);
});

/* ---------------- SSR 安全：node 里 import 得动 ---------------- */

test('声音面板的模块顶层不碰音频设备：在 node（无 AudioContext）里 import 不抛错', async () => {
  await assert.doesNotReject(
    () => import('../src/lib/sound/board.svelte.ts'),
    '模块顶层创建了 AudioContext 之类的浏览器对象：服务端渲染会当场崩'
  );
});

test('反证：把「顶层建 AudioContext」注入一个同形状的模块，上面那条判据确实会失败', async () => {
  // 这条反证不写文件，直接用 data: URL 造一个「顶层就 new AudioContext」的模块 ——
  // node 里没有这个全局，import 必然抛，正是上面那条守卫要拦的事。
  // 拼进变量里是为了让 tsc 不去静态解析这个说明符（它不是一个真模块路径）。
  const specifier = `data:text/javascript,${'new AudioContext()'}`;
  await assert.rejects(() => import(specifier));
});

/* ---------------- 与音乐悬浮窗（ADR-0019）的接缝 ---------------- */

/**
 * 两条音频通道（本地背景音乐 与 网易云点播悬浮窗）之间**只有一个字符串**当契约：
 * `document` 上的自定义事件名。两边各写一份常量、谁也不 import 谁 —— 好处是彻底解耦，
 * 代价是这个名字可能被改岔（改一端就静默失联：BGM 不再让位，但还是会响，不报任何错）。
 * 所以这里从**两边各自的源码**里把那个名字抠出来比对，而不是从某一端 import 之后再断言。
 */
test('让位事件的契约：两端写的是同一个名字（写岔了就静默失联）', () => {
  const board = read('../src/lib/sound/board.svelte.ts');
  const bus = read('../src/lib/music/bus.ts');
  const soundSide = /const MUSIC_DOCK_EVENT = '([^']+)'/.exec(board)?.[1] ?? '';
  const musicSide = /export const MUSIC_EVENT = '([^']+)'/.exec(bus)?.[1] ?? '';
  assert.equal(soundSide, 'sixty:music', '声音面板那边的常量名被改了（或没写）');
  assert.equal(musicSide, 'sixty:music', '音乐悬浮窗那边的常量名被改了（或没写）');
  assert.equal(soundSide, musicSide, `两端的事件名不一致：sound=${soundSide} music=${musicSide}`);
});

test('让位真的接在「音乐该不该响」的判据上：不靠音量滑块，也不靠 visibility', () => {
  const board = read('../src/lib/sound/board.svelte.ts');
  // 判据里必须有让位这一项 —— 少了它，悬浮窗一放歌就会和 BGM 一起响
  assert.match(
    board,
    /#musicShouldPlay\(\): boolean \{\s*return this\.music > 0 && !hidden\(\) && !this\.#yieldToPlayer;/,
    '#musicShouldPlay 没把「给点播让位」算进去'
  );
  // 让位只改「想不想响」，不许动音量：滑块还停在原处，悬浮窗一停就按原音量接回来
  const yieldFn = /yieldToPlayer\(yielding: boolean\): void \{[\s\S]*?\n  \}/.exec(board)?.[0] ?? '';
  assert.ok(yieldFn !== '', '找不到 yieldToPlayer');
  assert.ok(!/this\.music =/.test(yieldFn), '让位里改了音量：那会把用户的滑块值吃掉');
  assert.ok(!/writeSoundVolume/.test(yieldFn), '让位里写了存档：让位是临时状态，不该落盘');
  // 挂载/卸载都要接上（不接 = 事件没人听；不解绑 = 页面卸载后旧实例还在被唤醒）
  assert.match(board, /addEventListener\(MUSIC_DOCK_EVENT, onMusicDock\)/, 'attach 里没监听让位事件');
  assert.match(board, /removeEventListener\(MUSIC_DOCK_EVENT, onMusicDock\)/, '卸载时没解绑让位事件');
});

test('反证：让位判据少一项、事件名写岔，都必须被判出来', () => {
  const board = read('../src/lib/sound/board.svelte.ts');
  const bus = read('../src/lib/music/bus.ts');
  const nameOf = (source: string, pattern: RegExp): string => pattern.exec(source)?.[1] ?? '';

  // ① 判据少了让位 → 上面那条正则不再匹配
  const withoutYield = board.replace('!hidden() && !this.#yieldToPlayer', '!hidden()');
  assert.equal(
    /#musicShouldPlay\(\): boolean \{\s*return this\.music > 0 && !hidden\(\) && !this\.#yieldToPlayer;/.test(withoutYield),
    false,
    '判据少了让位却仍然匹配（守卫空转）'
  );

  // ② 事件名写岔 → 两端比对必然不等
  const typo = nameOf(board.replace("'sixty:music'", "'sixty:bgm'"), /const MUSIC_DOCK_EVENT = '([^']+)'/);
  assert.notEqual(typo, nameOf(bus, /export const MUSIC_EVENT = '([^']+)'/), '写岔了却还是相等（守卫空转）');

  // ③ 让位里偷偷改音量 → 上面那条禁令能被触发
  const meddling = board.replace(
    'yieldToPlayer(yielding: boolean): void {\n    if (this.#yieldToPlayer === yielding) return;',
    'yieldToPlayer(yielding: boolean): void {\n    this.music = 0;\n    if (this.#yieldToPlayer === yielding) return;'
  );
  const meddlingFn = /yieldToPlayer\(yielding: boolean\): void \{[\s\S]*?\n  \}/.exec(meddling)?.[0] ?? '';
  assert.ok(/this\.music =/.test(meddlingFn), '让位改音量却没被判出来（守卫空转）');
});

/* ---------------- 资产与落点 ---------------- */

test('五个音频文件都在，且不是空文件', () => {
  for (const name of ['turn', 'card', 'trick', 'settle', 'bgm']) {
    const path = new URL(`../static/sounds/${name}.mp3`, import.meta.url);
    assert.ok(existsSync(path), `static/sounds/${name}.mp3 不存在：对应的那一声会静默哑掉`);
    assert.ok(statSync(path).size > 1024, `static/sounds/${name}.mp3 只有几字节，八成是个空壳`);
  }
});

test('代码里引用的正是这几个文件名（改名漏一半会被抓出来）', () => {
  const board = read('../src/lib/sound/board.svelte.ts');
  for (const name of ['turn', 'card', 'trick', 'settle', 'bgm']) {
    assert.ok(board.includes(`/sounds/${name}.mp3`), `board.svelte.ts 没有引用 /sounds/${name}.mp3`);
  }
  // 四个音效事件与四条 URL 一一对应：`SoundCue` 的每个成员都得有落点
  for (const cue of ['turn', 'card', 'trick', 'settle']) {
    assert.match(board, new RegExp(`\\b${cue}: '/sounds/${cue}\\.mp3'`), `音效 ${cue} 没有对应的文件`);
  }
});

test('音乐只在牌桌页：其它页面不引用声音模块', () => {
  for (const page of ['+page.svelte', 'learn/+page.svelte', 'rules/+page.svelte', 'studio/+page.svelte']) {
    const source = read(`../src/routes/${page}`);
    for (const needle of ['SoundControl', 'lib/sound', 'SoundBoard']) {
      assert.equal(
        source.includes(needle),
        false,
        `${page} 引用了 ${needle}：背景音乐只在牌桌页，别处出声要另立需求`
      );
    }
  }
  const table = read('../src/routes/table/[code]/+page.svelte');
  assert.ok(table.includes('<SoundControl board={sound} />'), '牌桌页没有挂上声音弹层');
  assert.ok(table.includes('sound.attach()'), '牌桌页没有接管音乐生命周期（起播 / 切标签页暂停 / 卸载停止）');
});

/**
 * 弹层形状：**两条音量滑块 + 一个震动开关**。
 *
 * 这条守卫来自一次真实反馈：第一版是「音乐开/关、音效开/关」，第一次听到声音时的评价就是
 * 「太大」—— 布尔开关没有可调空间。判据抽成函数是为了能用反例钉住它不是空转。
 */
function soundControlCheck(source: string): string | null {
  const ranges = source.split('type="range"').length - 1;
  if (ranges !== 2) return `音量滑块应当恰好 2 条（背景音乐 / 音效），实际 ${ranges} 条`;
  const boxes = source.split('type="checkbox"').length - 1;
  if (boxes !== 1) return `复选框应当恰好 1 个（震动 —— 它没有音量可调），实际 ${boxes} 个`;
  // 量程/步长要**每一条滑块都有**，所以数出现次数而不是「至少出现一次」：
  // 后者在只坏了其中一条时仍然放行（这条守卫的第一版就是这么空转的，反证把它抓了出来）。
  for (const [needle, expected] of [
    ['max={VOLUME_MAX}', 2],
    ['step={VOLUME_STEP}', 2],
    ['value={board.music}', 1],
    ['value={board.sfx}', 1]
  ] as const) {
    const count = source.split(needle).length - 1;
    if (count !== expected) {
      return `${needle} 出现 ${count} 次（应为 ${expected} 次）：量程/步长/取值要每条滑块各自写全`;
    }
  }
  if (!source.includes('aria-label="背景音乐音量"') || !source.includes('aria-label="音效音量"')) {
    return '音量滑块缺少可读的名字（aria-label）：读屏只会念出「滑块」';
  }
  return null;
}

test('弹层：两条通道是 0~100 的音量滑块 + 一个震动开关（不许退回布尔开关）', () => {
  const problem = soundControlCheck(read('../src/lib/components/SoundControl.svelte'));
  assert.equal(problem, null, problem ?? '');
});

test('反证：把滑块换回开关、丢掉量程、去掉名字，都必须被判出来', () => {
  const control = read('../src/lib/components/SoundControl.svelte');
  assert.equal(soundControlCheck(control), null, '这条守卫对合规的弹层也报错（过宽）');
  assert.match(
    soundControlCheck(control.replace('type="range"', 'type="checkbox"')) ?? '',
    /滑块/,
    '把音量滑块换成开关（正是「太大」那次的老形状）没有被判出来'
  );
  assert.match(
    soundControlCheck(control.replace('max={VOLUME_MAX}', 'max="1"')) ?? '',
    /VOLUME_MAX/,
    '滑块丢掉量程（退回 0~1 的两档）没有被判出来'
  );
  assert.match(
    soundControlCheck(control.replace('aria-label="音效音量"', '')) ?? '',
    /aria-label/,
    '滑块丢掉名字没有被判出来'
  );
});
