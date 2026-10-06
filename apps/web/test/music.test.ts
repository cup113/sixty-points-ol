/**
 * 音乐悬浮窗的**纯函数**测试：歌词解析、队列、播放决策、适配层、配置、客户端、存储。
 *
 * 为什么只测这些：`.svelte.ts`（播放器与组件）用 rune，`node:test` 直接 import 时
 * `$state is not defined`（实测），所以「能在这里跑的」必然是无 rune 的那些文件 ——
 * 决策被刻意抽到 `playback.ts` / `queue.ts` 正是为了这一刻。
 * 浏览器里真正出声的那部分只能人工试听（与 `$lib/sound` 的取舍一致）。
 *
 * 沙箱内按包运行：node --import ./test/loader.mjs --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artistsText,
  clamp,
  clampPosition,
  durationText,
  formatTime,
  qualityTierOf,
  trackBadge
} from '../src/lib/music/format.ts';
import { activeLineIndex, lyricsFrom, mergeTranslation, parseLrc } from '../src/lib/music/lyric.ts';
import {
  EMPTY_QUEUE,
  clearQueue,
  enqueue,
  enqueueAll,
  nextIndex,
  orderOf,
  prevIndex,
  removeAt,
  restoreQueue,
  selectAt,
  shuffleOrder,
  snapshotOf,
  withMode,
  type Queue
} from '../src/lib/music/queue.ts';
import {
  MODE_LABEL,
  advanceOnEnd,
  advanceOnFailure,
  advanceOnNext,
  advanceOnPrev,
  fromPlaylist,
  highlightLine,
  nextMode,
  playbackLevel,
  positionInOrder,
  progressPermille,
  seekFromPermille
} from '../src/lib/music/playback.ts';
import {
  MUSIC_OPS,
  MUSIC_OP_NAMES,
  buildUpstreamRequest,
  isMusicOp,
  searchTypeOf
} from '../src/lib/music-adapters.ts';
import { musicConfig } from '../src/lib/music-config.ts';
import { createMusicClient } from '../src/lib/music/client.ts';
import {
  MAX_SESSION_CHARS,
  capSession,
  forwardMusic,
  readSession,
  writeSession,
  type SessionJar
} from '../src/lib/server/music.ts';
import { VIEW_KEY, loadQueue, loadView, readJson, saveView, storageOf, writeJson } from '../src/lib/music/store.ts';
import { ANONYMOUS_SESSION, type SessionInfo, type Track } from '../src/lib/music/types.ts';

/* ---------- 造数据的小工具 ---------- */

function track(id: number, extra: Partial<Track> = {}): Track {
  return {
    id,
    name: `曲目 ${id}`,
    artists: '某歌手',
    album: '某专辑',
    cover: null,
    durationMs: 200_000,
    vipOnly: false,
    trialOnly: false,
    unplayable: false,
    ...extra
  };
}

/** 内存里的 `StorageLike` 桩（含「写就抛」的坏盘版本） */
function jar(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key)
  };
}

/** `fetch` 桩：按调用次数依次回不同结果，并记下每次的 URL 与方法 */
function fetchStub(
  responses: readonly (Response | (() => Promise<Response>))[]
): { fetch: typeof globalThis.fetch; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  let index = 0;
  const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    const timer = setTimeout(() => {}, 0);
    clearTimeout(timer);
    return typeof next === 'function' ? next() : next;
  };
  return { fetch: stub as unknown as typeof globalThis.fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/* ---------- format.ts ---------- */

test('formatTime：毫秒 → m:ss，坏值不产出 NaN', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(1_000), '0:01');
  assert.equal(formatTime(59_999), '0:59');
  assert.equal(formatTime(60_000), '1:00');
  assert.equal(formatTime(204_000), '3:24');
  assert.equal(formatTime(3_600_000), '60:00');
  assert.equal(formatTime(-5), '0:00');
  assert.equal(formatTime(Number.NaN), '0:00');
  assert.equal(formatTime(Number.POSITIVE_INFINITY), '0:00');
});

test('clamp：夹取、反向区间、NaN 都给左手边', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(Number.NaN, 3, 10), 3);
  assert.equal(clamp(5, 10, 0), 10); // min > max：给 min，不返回反向区间里的怪值
});

test('clampPosition：四边越界都拉回来，窗口比视口大时允许贴左上', () => {
  const size = { width: 300, height: 200 };
  const viewport = { width: 1000, height: 800 };
  assert.deepEqual(clampPosition(100, 100, size, viewport), { x: 100, y: 100 });
  assert.deepEqual(clampPosition(-999, -999, size, viewport), { x: 8, y: 8 });
  assert.deepEqual(clampPosition(9999, 9999, size, viewport), { x: 992, y: 792 });
  // 展开的窗口比手机屏还高：只保证右下角边缘可见（y 允许为负）
  const phone = { width: 375, height: 320 };
  const tall = { width: 336, height: 700 };
  const clamped = clampPosition(0, 0, tall, phone);
  assert.ok(clamped.y <= 8 && clamped.y >= 8 - tall.height, `y=${clamped.y} 越出可用范围`);
  assert.deepEqual(clampPosition(10.6, 20.4, size, viewport), { x: 11, y: 20 });
});

test('artistsText / durationText / qualityTierOf / trackBadge', () => {
  assert.equal(artistsText(['周杰伦']), '周杰伦');
  assert.equal(artistsText(['A', 'B']), 'A / B');
  assert.equal(artistsText([]), '未知歌手');
  assert.equal(artistsText(['  ']), '未知歌手');
  assert.equal(durationText({ durationMs: 204_000 }), '3:24');
  assert.equal(durationText({ durationMs: 0 }), '');
  // 匿名恒 standard：配了 lossless 也不能让匿名用户每次都拿到空 URL
  assert.equal(qualityTierOf(0, 'lossless'), 'standard');
  assert.equal(qualityTierOf(11, 'lossless'), 'lossless');
  assert.equal(qualityTierOf(11, ''), 'exhigh');
  // 标注按严重程度只出一条
  assert.equal(trackBadge({ unplayable: true, vipOnly: true, trialOnly: true }), '无播放权限');
  assert.equal(trackBadge({ unplayable: false, vipOnly: true, trialOnly: true }), '试听');
  assert.equal(trackBadge({ unplayable: false, vipOnly: true, trialOnly: false }), 'VIP');
  assert.equal(trackBadge({ unplayable: false, vipOnly: false, trialOnly: false }), null);
});

/* ---------- lyric.ts ---------- */

test('parseLrc：一行多时间戳展开、元信息行与空行丢掉、乱序按时间排好', () => {
  const raw = ['[ti:歌名]', '[ar:歌手]', '[00:02.00]第二句', '[00:01.50]第一句', '[00:10.00][01:20.00]副歌', '', '   '].join(
    '\n'
  );
  const lines = parseLrc(raw);
  assert.deepEqual(
    lines.map((line) => [line.timeMs, line.text]),
    [
      [1500, '第一句'],
      [2000, '第二句'],
      [10_000, '副歌'],
      [80_000, '副歌']
    ]
  );
});

test('parseLrc：小数位按位数补零（.5 是 500ms，不是 5ms）', () => {
  assert.deepEqual(parseLrc('[00:00.5]a').map((l) => l.timeMs), [500]);
  assert.deepEqual(parseLrc('[00:00.05]a').map((l) => l.timeMs), [50]);
  assert.deepEqual(parseLrc('[00:00.500]a').map((l) => l.timeMs), [500]);
  assert.deepEqual(parseLrc('[00:00]a').map((l) => l.timeMs), [0]);
  assert.deepEqual(parseLrc('[120:00]a').map((l) => l.timeMs), [7_200_000]);
  // 没有时间戳的整段（纯文本歌词）不会变成空行堆
  assert.deepEqual(parseLrc('没有时间戳'), []);
});

test('mergeTranslation：按时间戳贴翻译，行数不等也不串行', () => {
  const original = parseLrc('[00:01.00]a\n[00:02.00]b\n[00:03.00]c');
  const translated = parseLrc('[00:02.00]B\n[00:03.00]C');
  const merged = mergeTranslation(original, translated);
  assert.deepEqual(
    merged.map((line) => [line.text, line.translated]),
    [
      ['a', null],
      ['b', 'B'],
      ['c', 'C']
    ]
  );
  // 没有翻译：每行的 translated 都是 null（不是 undefined）
  assert.deepEqual(mergeTranslation(original, []).map((l) => l.translated), [null, null, null]);
  // 翻译里多出来的时间戳不补行
  assert.equal(mergeTranslation(original, parseLrc('[00:09.00]X')).length, 3);
});

test('activeLineIndex：取「已经唱到」的最后一行，前奏返回 -1', () => {
  const lines = parseLrc('[00:01.00]a\n[00:02.00]b\n[00:03.00]c');
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 1_000), 0);
  assert.equal(activeLineIndex(lines, 1_999), 0);
  assert.equal(activeLineIndex(lines, 2_000), 1);
  assert.equal(activeLineIndex(lines, 999_999), 2);
  assert.equal(activeLineIndex([], 5_000), -1);
  assert.equal(highlightLine(lines, 2_500), 1);
});

test('lyricsFrom：两块 LRC 文本一键合并', () => {
  const merged = lyricsFrom('[00:01.00]a\n[00:02.00]b', '[00:01.00]A');
  assert.deepEqual(merged.map((l) => l.translated), ['A', null]);
});

/* ---------- queue.ts ---------- */

test('shuffleOrder：同一颗种子同一份顺序、且永远是全排列', () => {
  const first = shuffleOrder(8, 42);
  assert.deepEqual(first, shuffleOrder(8, 42));
  assert.deepEqual([...first].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.notDeepEqual(first, shuffleOrder(8, 43));
  assert.deepEqual(shuffleOrder(0, 1), []);
  assert.deepEqual(shuffleOrder(1, 1), [0]);
});

test('enqueue：新歌追加并成为当前；已在队列里的只切过去不重复插入', () => {
  let queue = enqueue(EMPTY_QUEUE, track(1), 7);
  assert.equal(queue.tracks.length, 1);
  assert.equal(queue.index, 0);
  queue = enqueue(queue, track(2), 7);
  assert.equal(queue.tracks.length, 2);
  assert.equal(queue.index, 1);
  // 再点第一首：不新增、切回去
  queue = enqueue(queue, track(1), 7);
  assert.equal(queue.tracks.length, 2);
  assert.equal(queue.index, 0);
  assert.deepEqual(queue.tracks.map((t) => t.id), [1, 2]);
});

test('enqueueAll：已在队列里的跳过；队列原本为空时播这一批的第一首', () => {
  const batch = enqueueAll(EMPTY_QUEUE, [track(1), track(2), track(3)], 7);
  assert.deepEqual(batch.tracks.map((t) => t.id), [1, 2, 3]);
  assert.equal(batch.index, 0);
  // 再来一批：1、4 新，其余跳过；当前曲目不变（别把正在听的那首掐掉）
  const current = selectAt(batch, 2);
  const grown = enqueueAll(current, [track(1), track(4), track(5)], 7);
  assert.deepEqual(grown.tracks.map((t) => t.id), [1, 2, 3, 4, 5]);
  assert.equal(grown.index, 2);
  assert.equal(enqueueAll(current, [track(1), track(2)], 7), current);
});

test('removeAt：删当前接后一首、删末尾退前一首、删别的曲目当前跟着左移', () => {
  const base: Queue = { ...EMPTY_QUEUE, tracks: [track(1), track(2), track(3)], index: 1 };
  // 删当前（下标 1）→ 接上原来的第 3 首，它现在在下标 1
  const removedCurrent = removeAt(base, 1);
  assert.deepEqual(removedCurrent.tracks.map((t) => t.id), [1, 3]);
  assert.equal(removedCurrent.index, 1);
  assert.equal(removedCurrent.tracks[removedCurrent.index]?.id, 3);
  // 删当前且它是末尾 → 退到前一首
  const atEnd = removeAt({ ...base, index: 2 }, 2);
  assert.equal(atEnd.tracks.length, 2);
  assert.equal(atEnd.index, 1);
  assert.equal(atEnd.tracks[atEnd.index]?.id, 2);
  // 删当前之前的曲目 → 当前左移一位，还是同一首歌
  const before = removeAt(base, 0);
  assert.equal(before.tracks[before.index]?.id, 2);
  // 删当前之后的曲目 → 当前不动
  const after = removeAt(base, 2);
  assert.equal(after.index, 1);
  assert.equal(after.tracks[after.index]?.id, 2);
  // 删空
  const emptied = removeAt({ ...EMPTY_QUEUE, tracks: [track(1)], index: 0 }, 0);
  assert.deepEqual(emptied.tracks, []);
  assert.equal(emptied.index, -1);
  // 越界不动
  assert.equal(removeAt(base, 9), base);
  assert.equal(removeAt(base, -1), base);
});

test('nextIndex / prevIndex：顺序到头停下、单曲默认绕回同一首、随机绕圈', () => {
  const list: Queue = { ...EMPTY_QUEUE, tracks: [track(1), track(2)], index: 0 };
  assert.equal(nextIndex(list), 1);
  assert.equal(nextIndex({ ...list, index: 1 }), null); // 顺序播放到末尾停下
  assert.equal(prevIndex({ ...list, index: 1 }), 0);
  assert.equal(prevIndex(list), null);
  // 单曲循环：自然播完回自己，手动点下一首要真的换歌
  const one: Queue = { ...list, mode: 'one' };
  assert.equal(nextIndex(one), 0);
  assert.equal(nextIndex(one, true), 1);
  assert.equal(advanceOnNext(one).kind, 'move');
  // 随机：绕圈，且顺序来自洗牌排列
  const shuffled = withMode({ ...EMPTY_QUEUE, tracks: [track(1), track(2), track(3)], index: 0 }, 'shuffle', 9);
  assert.equal(orderOf(shuffled).length, 3);
  assert.equal(shuffled.shuffle[0], 0); // 当前曲目永远排在游标位
  assert.equal(prevIndex(shuffled), orderOf(shuffled)[2]);
  assert.equal(nextIndex(shuffled), orderOf(shuffled)[1]);
  // 空队列谁都不动
  assert.equal(nextIndex(EMPTY_QUEUE), null);
  assert.equal(prevIndex(EMPTY_QUEUE), null);
});

test('withMode / clearQueue / positionInOrder', () => {
  const queue: Queue = { ...EMPTY_QUEUE, tracks: [track(1), track(2)], index: 1 };
  assert.equal(withMode(queue, 'one', 1).mode, 'one');
  assert.equal(withMode(queue, 'one', 1).shuffle.length, 0);
  assert.equal(withMode(queue, 'shuffle', 1).shuffle.length, 2);
  assert.equal(withMode(queue, 'shuffle', 1).shuffle[0], 1);
  assert.equal(withMode(queue, queue.mode, 1), queue); // 同一种模式原样返回
  assert.equal(positionInOrder(queue), 2);
  const cleared = clearQueue(queue);
  assert.deepEqual(cleared.tracks, []);
  assert.equal(cleared.index, -1);
});

test('snapshotOf / restoreQueue：截断到上限，坏存档当空队列', () => {
  const queue: Queue = {
    ...EMPTY_QUEUE,
    tracks: [track(1), track(2), track(3)],
    index: 2
  };
  const snapshot = snapshotOf(queue, 2);
  assert.deepEqual(snapshot.tracks.map((t) => t.id), [1, 2]);
  assert.equal(snapshot.index, 0); // 3 号被截掉，退到 0 而不是留一个越界下标
  assert.deepEqual(snapshotOf(EMPTY_QUEUE, 10), { tracks: [], index: 0 });

  assert.deepEqual(restoreQueue(null, 'list'), { ...EMPTY_QUEUE, mode: 'list' });
  assert.deepEqual(restoreQueue({ tracks: 'nope' }, 'list').tracks, []);
  // 缺字段的一条会被丢掉（只留下 id 与 name 都对的）
  const restored = restoreQueue({ tracks: [{ id: 5, name: 'a' }, { id: 6 }, null, 'x'], index: 9 }, 'one');
  assert.deepEqual(restored.tracks.map((t) => t.id), [5]);
  assert.equal(restored.index, 0);
  assert.equal(restored.mode, 'one');
});

/* ---------- playback.ts ---------- */

test('advanceOnEnd / advanceOnNext / advanceOnPrev：末尾停下与手动换歌', () => {
  const queue: Queue = { ...EMPTY_QUEUE, tracks: [track(1), track(2)], index: 0 };
  assert.deepEqual(advanceOnEnd(queue), { kind: 'move', index: 1 });
  assert.deepEqual(advanceOnEnd({ ...queue, index: 1 }), { kind: 'stop', reason: 'end' });
  assert.deepEqual(advanceOnEnd(EMPTY_QUEUE), { kind: 'stop', reason: 'empty' });
  assert.deepEqual(advanceOnEnd({ ...queue, mode: 'one' }), { kind: 'same' });
  assert.deepEqual(advanceOnNext({ ...queue, mode: 'one' }), { kind: 'move', index: 1 });
  assert.deepEqual(advanceOnPrev({ ...queue, index: 1 }), { kind: 'move', index: 0 });
  assert.deepEqual(advanceOnPrev(queue), { kind: 'stop', reason: 'end' });
});

test('advanceOnFailure：跳过播不了的，试过一轮就停下（不许死循环）', () => {
  const queue: Queue = { ...EMPTY_QUEUE, tracks: [track(1), track(2), track(3)], index: 0 };
  assert.deepEqual(advanceOnFailure(queue, new Set()), { kind: 'move', index: 1 });
  // 1、2 都试过：跳到 3
  assert.deepEqual(advanceOnFailure(queue, new Set([1, 2])), { kind: 'move', index: 2 });
  // 全都试过：停下，别在队列里空转
  assert.deepEqual(advanceOnFailure(queue, new Set([1, 2, 3])), { kind: 'stop', reason: 'end' });
  assert.deepEqual(advanceOnFailure(EMPTY_QUEUE, new Set()), { kind: 'stop', reason: 'empty' });
});

test('progressPermille / seekFromPermille：进度换算与坏时长', () => {
  assert.equal(progressPermille(0, 100_000), 0);
  assert.equal(progressPermille(50_000, 100_000), 500);
  assert.equal(progressPermille(100_000, 100_000), 1000);
  assert.equal(progressPermille(200_000, 100_000), 1000);
  assert.equal(progressPermille(50_000, 0), 0);
  assert.equal(progressPermille(50_000, Number.NaN), 0);
  assert.equal(seekFromPermille(500, 100_000), 50_000);
  assert.equal(seekFromPermille(2000, 100_000), 100_000);
  assert.equal(seekFromPermille(-10, 100_000), 0);
  assert.equal(seekFromPermille(500, 0), 0);
});

test('nextMode / MODE_LABEL：三档循环且每档都有中文名', () => {
  assert.equal(nextMode('list'), 'one');
  assert.equal(nextMode('one'), 'shuffle');
  assert.equal(nextMode('shuffle'), 'list');
  for (const mode of ['list', 'one', 'shuffle'] as const) {
    assert.ok(MODE_LABEL[mode].length > 0);
  }
  assert.equal(playbackLevel(0, 'lossless'), 'standard');
  assert.equal(playbackLevel(11, 'lossless'), 'lossless');
});

test('fromPlaylist：歌单伪装成一首曲目，时长栏写的是曲目数', () => {
  const fused = fromPlaylist({ id: 999, name: '我喜欢的音乐', cover: 'http://x/y.jpg', trackCount: 12, creator: '小六' });
  assert.equal(fused.id, 999);
  assert.equal(fused.name, '我喜欢的音乐');
  assert.equal(fused.artists, '歌单 · 小六');
  assert.equal(fused.album, '12 首');
  assert.equal(fused.durationMs, 12_000);
  assert.equal(fused.unplayable, false);
  assert.equal(fromPlaylist({ id: 1, name: 'x', cover: null, trackCount: 0, creator: null }).artists, '歌单');
});

/* ---------- music-adapters.ts ---------- */

test('白名单：18 个 op，未知 op 一律 404（不是开放代理）', () => {
  assert.equal(MUSIC_OP_NAMES.length, 18);
  assert.ok(isMusicOp('search'));
  assert.ok(!isMusicOp('user/account'));
  assert.ok(!isMusicOp(''));
  const rejected = buildUpstreamRequest('playlist/update', { name: 'x' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok === false ? rejected.status : 0, 404);
});

test('buildUpstreamRequest：必填缺失 400、非法参数 400、未知参数丢掉', () => {
  const missing = buildUpstreamRequest('search', {});
  assert.equal(missing.ok === false ? missing.status : 0, 400);
  assert.match(missing.ok === false ? missing.message : '', /keywords/);

  for (const bad of [
    { op: 'songUrl', params: { id: 'abc' } },
    { op: 'songUrl', params: { id: '-1' } },
    { op: 'songUrl', params: { id: '1.5' } },
    { op: 'search', params: { keywords: 'x', type: '2' } },
    { op: 'search', params: { keywords: 'x'.repeat(101) } },
    { op: 'search', params: { keywords: 'x\u0000y' } },
    { op: 'search', params: { keywords: 'x', limit: '0' } },
    { op: 'search', params: { keywords: 'x', offset: '-1' } },
    { op: 'songDetail', params: { ids: '1,2,x' } },
    { op: 'likelist', params: {} },
    { op: 'songLike', params: { id: '1', uid: '2', like: '也许' } }
  ]) {
    const built = buildUpstreamRequest(bad.op, bad.params);
    assert.equal(built.ok, false, `${bad.op} ${JSON.stringify(bad.params)} 应该被拒`);
    assert.equal(built.ok === false ? built.status : 0, 400);
  }
});

test('buildUpstreamRequest：默认值、上限、未知参数丢弃、写操作标记', () => {
  const search = buildUpstreamRequest('search', { keywords: '  周杰伦  ', type: '1', extra: '丢掉', limit: '99999' });
  assert.ok(search.ok);
  assert.equal(search.path, 'cloudsearch');
  assert.equal(search.write, false);
  assert.deepEqual(search.params, { keywords: '周杰伦', type: '1', limit: '1000', offset: '0' });

  const like = buildUpstreamRequest('songLike', { id: '123', uid: '456' });
  assert.ok(like.ok);
  assert.equal(like.write, true); // 会改账号数据：客户端据此不重试、代理据此用 POST
  assert.deepEqual(like.params, { id: '123', uid: '456', like: 'true' });
  // `like: false` 的原生布尔也要认
  const unlike = buildUpstreamRequest('songLike', { id: '1', uid: '2', like: false });
  assert.ok(unlike.ok);
  assert.equal(unlike.params['like'], 'false');

  // 白名单表里不许出现音质（它由登录态推出）
  for (const name of MUSIC_OP_NAMES) {
    assert.ok(!Object.hasOwn(MUSIC_OPS[name].params, 'level'), `${name} 不该能传 level`);
    assert.ok(!Object.hasOwn(MUSIC_OPS[name].params, 'cookie'), `${name} 不该能传 cookie`);
  }
});

test('searchTypeOf：三种视图 → 上游 type', () => {
  assert.equal(searchTypeOf('song'), 1);
  assert.equal(searchTypeOf('playlist'), 1000);
  assert.equal(searchTypeOf('artist'), 100);
});

/* ---------- music-config.ts ---------- */

test('musicConfig：默认值、off 开关、地址归一、超时夹取', () => {
  const defaults = musicConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.apiBase, 'http://127.0.0.1:4000');
  assert.equal(defaults.timeoutMs, 5000);
  assert.equal(defaults.level, 'exhigh');

  assert.equal(musicConfig({ SIXTY_MUSIC: 'off' }).enabled, false);
  assert.equal(musicConfig({ SIXTY_MUSIC: 'on' }).enabled, true);
  assert.equal(musicConfig({ SIXTY_MUSIC_API: 'http://ncm:4000/' }).apiBase, 'http://ncm:4000');
  assert.equal(musicConfig({ SIXTY_MUSIC_API: 'http://ncm:4000///' }).apiBase, 'http://ncm:4000');
  assert.equal(musicConfig({ SIXTY_MUSIC_API: '   ' }).apiBase, 'http://127.0.0.1:4000');
  assert.equal(musicConfig({ SIXTY_MUSIC_TIMEOUT_MS: '100' }).timeoutMs, 500);
  assert.equal(musicConfig({ SIXTY_MUSIC_TIMEOUT_MS: '999999' }).timeoutMs, 30_000);
  assert.equal(musicConfig({ SIXTY_MUSIC_TIMEOUT_MS: '不是数字' }).timeoutMs, 5000);
  assert.equal(musicConfig({ SIXTY_MUSIC_LEVEL: '  ' }).level, 'exhigh');
  assert.equal(musicConfig({ SIXTY_MUSIC_LEVEL: 'lossless' }).level, 'lossless');
});

/* ---------- client.ts ---------- */

test('客户端：读用 GET、只重试一次；5xx 重试后仍失败就报可重试的错', async () => {
  const { fetch: fetchImpl, calls } = fetchStub([
    jsonResponse({ ok: false, error: { message: '边车没起来' } }, 503),
    jsonResponse({ ok: false, error: { message: '边车没起来' } }, 503)
  ]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const result = await client.lyric(123);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error.code : '', 'upstream');
  assert.equal(result.ok === false ? result.error.retryable : false, true);
  assert.equal(calls.length, 2, '读应该重试一次');
  assert.ok(calls[0]!.url.includes('/api/music/lyric'));
  assert.ok(calls[0]!.url.includes('id=123'));
  assert.equal(calls[0]!.method, 'GET');
});

test('客户端：4xx 不重试（参数错、功能关着重试没意义）', async () => {
  const { fetch: fetchImpl, calls } = fetchStub([jsonResponse({ ok: false, error: { message: '没有这个音乐操作' } }, 404)]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const result = await client.session();
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error.code : '', 'disabled');
  assert.equal(result.ok === false ? result.error.retryable : true, false);
  assert.equal(calls.length, 1);
});

test('客户端：500 之后的第一次成功算成功（重试真的救了回来）', async () => {
  const { fetch: fetchImpl, calls } = fetchStub([
    jsonResponse({ ok: false, error: { message: '炸了' } }, 500),
    jsonResponse({ ok: true, data: { lrc: { lyric: '[00:01.00]回来了' } } })
  ]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const result = await client.lyric(1);
  assert.ok(result.ok);
  assert.deepEqual(result.data.map((line) => line.text), ['回来了']);
  assert.equal(calls.length, 2);
});

test('客户端：写操作一次都不重发（喜欢重发会多喜欢一次）', async () => {
  const { fetch: fetchImpl, calls } = fetchStub([jsonResponse({ ok: false, error: { message: '炸了' } }, 503)]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const result = await client.setLiked(1, 2, true);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1, '写操作不许重试');
  assert.equal(calls[0]!.method, 'POST');
});

test('客户端：不是 JSON 的响应（反代错误页）也归成一条人话', async () => {
  const { fetch: fetchImpl } = fetchStub([() => Promise.resolve(new Response('<html>502</html>', { status: 200 }))]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const result = await client.session();
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error.message : '', /看不懂/);
});

test('客户端：超时是「没拿到响应」，仍算可重试', async () => {
  const { fetch: fetchImpl } = fetchStub([
    () => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 5))
  ]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch, timeoutMs: 5 });
  const result = await client.session();
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.error.code : '', 'timeout');
  assert.equal(result.ok === false ? result.error.retryable : false, true);
});

test('客户端：曲目归一化两种字段名都认，坏条目丢掉', async () => {
  const { fetch: fetchImpl } = fetchStub([
    jsonResponse({
      ok: true,
      data: {
        result: {
          songCount: 3,
          songs: [
            {
              id: 11,
              name: '晴天',
              ar: [{ name: '周杰伦' }],
              al: { name: '叶惠美', picUrl: 'http://x/c.jpg' },
              dt: 269_000,
              fee: 1,
              privilege: { st: 0, freeTrialInfo: null, vip: false }
            },
            { id: 12, name: '另一种字段', artists: [{ name: 'A' }, { name: 'B' }], album: { name: '专辑' }, duration: 1000 },
            { id: 0, name: '没有 id 的坏条目' },
            null
          ]
        }
      }
    })
  ]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const result = await client.search('晴天', 'song', 0);
  assert.ok(result.ok);
  assert.equal(result.data.tracks.length, 2);
  assert.equal(result.data.total, 3);
  // 只有两条、上游说共 3 条 —— 但这一页的窗口（30 条）还没翻完，所以「还有更多」是 false：
  // 多出来那条是上游计数与过滤后的结果不一致，不该诱使界面再点一次「加载更多」
  assert.equal(result.data.hasMore, false);
  const first = result.data.tracks[0]!;
  assert.deepEqual(
    [first.id, first.name, first.artists, first.album, first.cover, first.durationMs, first.vipOnly, first.unplayable],
    [11, '晴天', '周杰伦', '叶惠美', 'http://x/c.jpg', 269_000, true, true]
  );
  assert.equal(result.data.tracks[1]!.artists, 'A / B');
});

test('客户端：搜索结果还有下一页时 hasMore 为真', async () => {
  const songs = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `第 ${index + 1} 首`, ar: [], al: {} }));
  const { fetch: fetchImpl } = fetchStub([
    jsonResponse({ ok: true, data: { result: { songCount: 120, songs } } })
  ]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const first = await client.search('周杰伦', 'song', 0);
  assert.ok(first.ok);
  assert.equal(first.data.tracks.length, 30);
  assert.equal(first.data.total, 120);
  assert.equal(first.data.hasMore, true);
});

test('客户端：拿不到播放地址不是错误，而是 unplayable（界面据此跳过）', async () => {
  const { fetch: fetchImpl } = fetchStub([
    jsonResponse({ ok: true, data: { data: [{ id: 1, url: null, freeTrialInfo: null, fee: 1 }] } })
  ]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const ticket = await client.songUrl(1, 'standard');
  assert.ok(ticket.ok);
  assert.deepEqual(ticket.data, { kind: 'unplayable', reason: 'rights' });
  // 有 url 时把试听标记带出来
  const { fetch: trial } = fetchStub([
    jsonResponse({ ok: true, data: { data: [{ url: 'http://x/y.mp3', freeTrialInfo: { start: 0, end: 30 } }] } })
  ]);
  const paid = await createMusicClient({ fetch: trial as unknown as typeof fetch }).songUrl(1, 'standard');
  assert.ok(paid.ok);
  assert.deepEqual(paid.data, { kind: 'url', url: 'http://x/y.mp3', trial: true });
});

test('客户端：登录态归一化（`data.profile` 与 `profile` 两种形状）', async () => {
  const logged = jsonResponse({
    ok: true,
    data: { data: { account: { id: 42 }, profile: { userId: 42, nickname: '小六', vipType: 11 } } }
  });
  const { fetch: fetchImpl } = fetchStub([logged]);
  const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
  const session = await client.session();
  assert.ok(session.ok);
  assert.deepEqual(session.data, { loggedIn: true, userId: 42, nickname: '小六', vipType: 11 });

  // 没登录：上游给 code 200 但没有 profile
  const { fetch: anonymous } = fetchStub([jsonResponse({ ok: true, data: { data: { account: null, profile: null } } })]);
  const anon = await createMusicClient({ fetch: anonymous as unknown as typeof fetch }).session();
  assert.ok(anon.ok);
  assert.deepEqual(anon.data, ANONYMOUS_SESSION);
});

test('客户端：扫码状态映射成四档，未知值当「已确认」而不是卡住轮询', async () => {
  for (const [code, expected] of [
    [800, 'expired'],
    [801, 'waiting'],
    [802, 'scanned'],
    [803, 'confirmed']
  ] as const) {
    const { fetch: fetchImpl } = fetchStub([
      jsonResponse({ ok: true, data: { code } }),
      // 803 之后还会再问一次登录态
      jsonResponse({ ok: true, data: { data: { profile: { userId: 7, nickname: '六', vipType: 0 } } } })
    ]);
    const client = createMusicClient({ fetch: fetchImpl as unknown as typeof fetch });
    const polled = await client.qrPoll('key');
    assert.ok(polled.ok);
    assert.equal(polled.data.status, expected);
    if (expected !== 'confirmed') assert.equal(polled.data.session, null);
    else assert.equal(polled.data.session?.nickname, '六');
  }
});

/* ---------- server/music.ts：代理这一半 ---------- */

test('forwardMusic：SIXTY_MUSIC=off 时连功能都不暴露（404）', async () => {
  const result = await forwardMusic({
    op: 'search',
    params: { keywords: 'x' },
    session: null,
    loggedIn: false,
    config: musicConfig({ SIXTY_MUSIC: 'off' }),
    fetch: (() => Promise.reject(new Error('不该发出请求'))) as unknown as typeof fetch
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.status : 0, 404);
  assert.equal(result.ok === false ? result.code : '', 'disabled');
});

test('forwardMusic：白名单外的 op 与非法参数一律挡在本地（不发出去）', async () => {
  let called = 0;
  const spy = (() => {
    called += 1;
    return Promise.resolve(jsonResponse({}));
  }) as unknown as typeof fetch;
  const base = { session: null, loggedIn: false, config: musicConfig({}), fetch: spy };

  const unknown = await forwardMusic({ ...base, op: 'user/playlist/update', params: {} });
  assert.equal(unknown.ok === false ? unknown.status : 0, 404);
  const bad = await forwardMusic({ ...base, op: 'songUrl', params: {} });
  assert.equal(bad.ok === false ? bad.status : 0, 400);
  assert.equal(called, 0, '被挡下的请求不该打到边车');
});

test('forwardMusic：拼出上游 URL（音质、noCookie、尾斜杠归一）', async () => {
  const seen: string[] = [];
  const spy = ((input: string | URL) => {
    seen.push(String(input));
    return Promise.resolve(jsonResponse({ ok: true }));
  }) as unknown as typeof fetch;

  // 匿名：音质必须是 standard，即使配置写的是 lossless
  await forwardMusic({
    op: 'songUrl',
    params: { id: '123' },
    session: null,
    loggedIn: false,
    config: musicConfig({ SIXTY_MUSIC_API: 'http://ncm:4000///', SIXTY_MUSIC_LEVEL: 'lossless' }),
    fetch: spy
  });
  assert.equal(seen[0], 'http://ncm:4000/song/url/v1?id=123&level=standard&noCookie=true');

  // 登录用户：用配置里的档位
  await forwardMusic({
    op: 'songUrl',
    params: { id: '123' },
    session: 'MUSIC_U=abc',
    loggedIn: true,
    config: musicConfig({ SIXTY_MUSIC_LEVEL: 'lossless' }),
    fetch: spy
  });
  assert.equal(seen[1], 'http://127.0.0.1:4000/song/url/v1?id=123&level=lossless&noCookie=true');
});

test('forwardMusic：会话与请求方法 —— 读带 cookie 且要 noCookie，写不带 noCookie', async () => {
  const calls: { url: string; method: string; cookie: string | null }[] = [];
  const spy = ((input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      cookie: new Headers(init?.headers).get('cookie')
    });
    return Promise.resolve(jsonResponse({ ok: true }));
  }) as unknown as typeof fetch;
  const base = { loggedIn: true, config: musicConfig({}), fetch: spy };

  await forwardMusic({ ...base, op: 'likelist', params: { uid: '42' }, session: 'MUSIC_U=abc' });
  await forwardMusic({ ...base, op: 'songLike', params: { id: '1', uid: '42', like: 'true' }, session: 'MUSIC_U=abc' });

  assert.equal(calls[0]!.method, 'GET');
  assert.equal(calls[0]!.cookie, 'MUSIC_U=abc');
  assert.ok(calls[0]!.url.endsWith('/likelist?uid=42&noCookie=true'));
  // 写操作要留下上游的 Set-Cookie（那正是登录本身），所以不带 noCookie
  assert.equal(calls[1]!.method, 'POST');
  assert.ok(calls[1]!.url.endsWith('/song/like?id=1&uid=42&like=true'));
  assert.equal(calls[1]!.cookie, 'MUSIC_U=abc');
});

test('forwardMusic：上游的坏法一律收敛成 503（连不上 / 超时 / 非 JSON / 非 2xx）', async () => {
  const config = musicConfig({});
  const base = { op: 'search', params: { keywords: 'x' }, session: null, loggedIn: false, config };

  const offline = await forwardMusic({ ...base, fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch });
  assert.equal(offline.ok === false ? offline.status : 0, 503);
  assert.equal(offline.ok === false ? offline.code : '', 'upstream');
  assert.match(offline.ok === false ? offline.message : '', /连不上/);

  const timeout = await forwardMusic({
    ...base,
    fetch: (() =>
      Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))) as unknown as typeof fetch
  });
  assert.equal(timeout.ok === false ? timeout.code : '', 'timeout');
  assert.equal(timeout.ok === false ? timeout.status : 0, 503);

  const notJson = await forwardMusic({
    ...base,
    fetch: (() => Promise.resolve(new Response('<html>bad gateway</html>'))) as unknown as typeof fetch
  });
  assert.equal(notJson.ok === false ? notJson.status : 0, 503);
  assert.match(notJson.ok === false ? notJson.message : '', /看不懂/);

  const upstreamError = await forwardMusic({
    ...base,
    fetch: (() => Promise.resolve(jsonResponse({ code: 500 }, 500))) as unknown as typeof fetch
  });
  assert.equal(upstreamError.ok === false ? upstreamError.status : 0, 503);
  assert.match(upstreamError.ok === false ? upstreamError.message : '', /上游 500/);
});

test('forwardMusic：登录成功后把上游的 Set-Cookie 交回来（只交变化过的）', async () => {
  const withCookie = (value: string): typeof fetch =>
    (() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'set-cookie': `${value}; Path=/; HttpOnly; Max-Age=2592000` }
        })
      )) as unknown as typeof fetch;
  const base = { op: 'loginQrCheck', params: { key: 'k' }, loggedIn: false, config: musicConfig({}) };

  const fresh = await forwardMusic({ ...base, session: null, fetch: withCookie('MUSIC_U=abc') });
  assert.equal(fresh.session, 'MUSIC_U=abc');
  // 与当前会话一样就不重复写（否则每次调用都冒一条 Set-Cookie）
  const same = await forwardMusic({ ...base, session: 'MUSIC_U=abc', fetch: withCookie('MUSIC_U=abc') });
  assert.equal(same.session, null);

  // 一个响应里有两条 Set-Cookie：真服务端走 undici 的 `getSetCookie()`（能拿到两条），
  // 而 `Headers.get()` 兜底只能拿到合并值的第一条 —— 两种都不许把 `; Path=/` 之类的属性写进 cookie
  const multi = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'set-cookie': 'MUSIC_U=abc; Path=/, __csrf=xyz; Path=/' }
      })
    )) as unknown as typeof fetch;
  const updated = await forwardMusic({ ...base, session: 'MUSIC_U=old', fetch: multi });
  assert.equal(updated.session, 'MUSIC_U=abc');
  assert.ok(!(updated.session ?? '').includes('Path'), 'cookie 属性被写进了会话串');
});

test('会话 cookie 的读写：超长不收、空值不收、写的属性齐', () => {
  const store = new Map<string, string>();
  const written: Record<string, unknown>[] = [];
  const cookies: SessionJar = {
    get: (name) => store.get(name),
    set: (name, value, options) => {
      store.set(name, value);
      written.push({ name, value, ...options });
    }
  };

  assert.equal(readSession(cookies), null);
  assert.equal(writeSession(cookies, '   '), false);
  assert.equal(writeSession(cookies, 'x'.repeat(MAX_SESSION_CHARS + 1)), false);
  assert.equal(readSession(cookies), null, '超长的会话不该被读出来');
  assert.equal(writeSession(cookies, ' MUSIC_U=abc '), true);
  assert.equal(readSession(cookies), 'MUSIC_U=abc');
  assert.equal(written[0]?.['httpOnly'], true);
  assert.equal(written[0]?.['sameSite'], 'lax');
  assert.equal(written[0]?.['path'], '/');
  assert.equal(capSession('  '), null);
});

/* ---------- store.ts ---------- */

test('loadView / saveView：默认值、逐字段校验、坏数据整份当默认', () => {
  const defaults = loadView(null);
  assert.equal(defaults.collapsed, true);
  assert.equal(defaults.volume, 60);
  assert.equal(defaults.mode, 'list');

  const storage = jar();
  assert.equal(saveView(storage, { x: 10, y: 20, collapsed: false, volume: 130, mode: 'shuffle' }), true);
  // 130 在写入时就被夹成 100（音量永远不会有 130 这种值）
  assert.deepEqual(loadView(storage), { x: 10, y: 20, collapsed: false, volume: 100, mode: 'shuffle' });

  storage.setItem(VIEW_KEY, '{坏 JSON');
  assert.deepEqual(loadView(storage), defaults);
  storage.setItem(VIEW_KEY, JSON.stringify({ x: 'nope', y: 5.6, collapsed: 'yes', volume: -3, mode: '乱写' }));
  const partial = loadView(storage);
  assert.equal(partial.x, defaults.x); // 坏字段各自回默认值，不整份丢掉
  assert.equal(partial.y, 6);
  assert.equal(partial.collapsed, defaults.collapsed);
  assert.equal(partial.volume, 0);
  assert.equal(partial.mode, defaults.mode);
});

test('readJson / writeJson：没有存储、写失败都不抛', () => {
  assert.equal(readJson(null, 'k'), null);
  assert.equal(writeJson(null, 'k', 1), false);
  const throwing = {
    getItem: () => {
      throw new Error('隐私模式');
    },
    setItem: () => {
      throw new Error('配额满');
    },
    removeItem: () => {}
  };
  assert.equal(readJson(throwing, 'k'), null);
  assert.equal(writeJson(throwing, 'k', { a: 1 }), false);
  assert.equal(writeJson(jar(), 'k', { a: 1 }), true);
});

test('loadQueue：坏存档当空队列，能用的曲目留下', () => {
  const storage = jar();
  assert.deepEqual(loadQueue(storage, 'list').tracks, []);
  assert.deepEqual(loadQueue(null, 'one').mode, 'one');
  storage.setItem('sixty.music.queue.v1', JSON.stringify({ tracks: [{ id: 3, name: 'c' }], index: 0 }));
  const restored = loadQueue(storage, 'shuffle');
  assert.deepEqual(restored.tracks.map((t) => t.id), [3]);
  assert.equal(restored.mode, 'shuffle');
});

test('storageOf：没有 localStorage 的环境（SSR/隐私模式）返回 null', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('被策略禁用');
      }
    });
    assert.equal(storageOf(), null);
  } finally {
    if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', original);
  }
  // 会话类型里那几个字段都是给界面读的，这里顺手把形状钉一下
  const session: SessionInfo = ANONYMOUS_SESSION;
  assert.deepEqual(session, { loggedIn: false, userId: null, nickname: null, vipType: 0 });
});
