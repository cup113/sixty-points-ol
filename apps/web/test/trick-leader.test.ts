/**
 * 「这一墩**现在**谁最大」（`trickLeader`，见 CONTEXT.md 的 **现在最大**）。
 *
 * 它只在**还没收墩**的墩上说话，所以判据的第一条是「一家出牌时不算」——
 * 只有一家时「谁大」是废话，标出来只是把一处已知信息再加一层颜色。
 * 之后的大小判断不另写一套：直接问引擎的 `trickWinner`（同一条全序、同一套杀牌与结构规则）。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { type Card, type TrickPlay } from '@sixty/engine';
import { trickLeader } from '../src/lib/labels.ts';

const NT2 = { strain: 'NT' as const, rank: 2 };
const HEARTS7 = { strain: 'H' as const, rank: 7 };

function c(suit: 'C' | 'D' | 'H' | 'S', rank: number): Card {
  return { suit, rank };
}

function play(seat: 0 | 1 | 2, cards: readonly Card[]): TrickPlay {
  return { seat, cards };
}

test('一家出牌时不标：那不是「谁大」，只是「谁先」', () => {
  assert.equal(trickLeader([], NT2), null);
  assert.equal(trickLeader([play(1, [c('S', 14)])], NT2), null);
});

test('没有将牌模型（还没成交）时不标', () => {
  assert.equal(trickLeader([play(1, [c('S', 14)]), play(2, [c('S', 3)])], null), null);
});

test('两家出完：同门更大的那家现在最大', () => {
  assert.equal(trickLeader([play(1, [c('C', 14)]), play(2, [c('C', 3)])], NT2), 1);
  // 反证：换个顺序，结论跟着牌走，不跟着出牌序走
  assert.equal(trickLeader([play(1, [c('C', 3)]), play(2, [c('C', 14)])], NT2), 2);
});

test('缺门用主牌杀：杀牌压过副牌领出（同一套引擎判据）', () => {
  const lead = play(0, [c('C', 14)]);
  const ruff = play(1, [c('H', 2)]); // ♥2 是主牌（主打 ♥）
  assert.equal(trickLeader([lead, ruff], HEARTS7), 1);
  // 副牌垫牌赢不了：♦A 只是垫牌，领出的 ♣A 仍然最大
  assert.equal(trickLeader([lead, play(1, [c('D', 14)])], HEARTS7), 0);
});

test('结构性跟牌（2+1）不能赢：与引擎「只有单段顺子能赢」是同一句话', () => {
  const lead = play(0, [c('C', 2), c('C', 3), c('C', 4)]); // 单段 3 顺
  // 张数相同、同门，但段长分解是 2+1 → 压不过领出
  const structural = play(1, [c('C', 14), c('C', 13), c('C', 5)]);
  assert.equal(trickLeader([lead, structural], HEARTS7), 0);
});
