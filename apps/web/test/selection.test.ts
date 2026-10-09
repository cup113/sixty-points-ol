/**
 * 选牌清空规则单测（见 `src/lib/selection.ts`）。
 *
 * 背景两条，方向相反：
 *
 * 1. 服务端在**任何人**连上或断开这条 SSE 时都会广播一帧（`stream/+server.ts`），
 *    客户端若无条件清空 `selected`，观战者反复连断就能把在座玩家正在选的牌刷掉 ——
 *    观战开放后这条路径人人为之，且一个脚本就能做成「群体骚扰」。
 * 2. 反过来，**牌局推进也不再清空**（早先的判据是 `view.version` 变了就清）：那是
 *    **拟选**（ADR-0021）的前提 —— 别人出牌、收墩、换轮次都不该把你正在拟的那几张牌丢掉。
 *    能丢掉它们的只有「这些牌已经不在我手上」。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Card, PublicView } from '@sixty/engine';
import { shouldResetSelection, type SelectionContext } from '../src/lib/selection.ts';

function view(version: number): PublicView {
  return {
    version,
    status: 'playing',
    dealerSeat: 0,
    dealNo: 1,
    levels: [],
    progress: [],
    result: null,
    history: [],
    deal: null
  };
}

/** 一张最小可用的牌（只关心它进不进指纹，牌面本身无关） */
function card(rank: string, suit: string): Card {
  return { kind: 'suit', suit, rank } as unknown as Card;
}

const THREE_CARDS = [card('A', 'S'), card('K', 'S'), card('3', 'C')] as const;

/** 一个「坐在座位上」的最小 you（两批底牌都只有庄家非 null，这里不关心） */
function hand(seat: number, cards: readonly Card[] = THREE_CARDS): SelectionContext['you'] {
  return { seat: seat as 0 | 1 | 2, hand: cards, isDeclarer: false, originalKitty: null, buriedKitty: null };
}

function player(seat: number, myHand: readonly Card[] = THREE_CARDS): SelectionContext {
  return { role: 'player', you: hand(seat, myHand) };
}

const spectator: SelectionContext = { role: 'spectator', you: null };

test('首帧（还没有上一帧）必须清空：初始化时不该留着任何选中态', () => {
  assert.equal(shouldResetSelection(null, player(0)), true);
});

test('无关帧不清空：角色、座位、手牌都没变（名单/在线点变化引起的广播）', () => {
  assert.equal(
    shouldResetSelection(player(0), player(0)),
    false,
    '同一局面的广播（观战者连上/断开）会清掉在座玩家正在选的牌'
  );
  assert.equal(shouldResetSelection(spectator, { ...spectator }), false, '观战者之间的无关帧也不该触发清空');
});

/**
 * **拟选的核心判据**：牌局推进（别人出牌 / 收墩 / 换轮次）不清空。
 *
 * 这条是 `view.version` 那条旧判据的反证：旧判据下「别人一出牌，我拟好的三张就被刷掉」，
 * 于是拟选根本活不过一帧。现在 `SelectionContext` 里**没有** view 了 —— 它结构上就做不到
 * 「因为版本变了而清空」。
 */
test('牌局推进不清空：别人出牌 / 收墩 / 换轮次都不该丢我正在拟的牌', () => {
  const before = player(0);
  // 手牌没变，只有局面变了（新的一帧负载里 view.version 会变、名单也可能变）
  assert.equal(
    shouldResetSelection(before, player(0)),
    false,
    '别人的动作把我拟好的牌刷掉了 —— 拟选就活不过一帧'
  );
  assert.equal(
    shouldResetSelection({ ...before }, { ...player(0) }),
    false,
    '同一手牌的新帧不该清空（拟选要能跨墩保留）'
  );
});

test('我的手牌变了必须清空：换副 / 全 pass 重发 / 补位接下别人的牌 / 我刚出手', () => {
  const before = player(0);
  const afterPlayingOne = [card('A', 'S'), card('K', 'S')] as const;
  assert.equal(
    shouldResetSelection(before, player(0, afterPlayingOne)),
    true,
    '手牌少了一张（我刚出手）却留着选中态：下一次出手会带上已经不存在的牌'
  );
  const otherHand = [card('4', 'D'), card('5', 'D'), card('6', 'D')] as const;
  assert.equal(
    shouldResetSelection(before, player(0, otherHand)),
    true,
    '补位接下了别人的手牌，但旧选择还在（那些牌根本不在手上）'
  );
  // 张数相同但牌不同，同样要清
  assert.equal(
    shouldResetSelection(player(0, otherHand), player(0, THREE_CARDS)),
    true,
    '手牌内容变了（张数一样）也要清空'
  );
});

test('角色与座位变化要清空：选择属于上一个座位', () => {
  assert.equal(shouldResetSelection(spectator, player(0)), true, '入座后旧选择必须丢掉');
  assert.equal(shouldResetSelection(player(0), spectator), true, '离座后旧选择必须丢掉');
  assert.equal(shouldResetSelection(player(0), player(1)), true, '换到别的座位必须丢掉');
});

test('未开局（还没有手牌）时，名单变化同样不清空', () => {
  const lobbyPlayer: SelectionContext = { role: 'player', you: hand(0, []) };
  assert.equal(shouldResetSelection(lobbyPlayer, { ...lobbyPlayer }), false);
});
