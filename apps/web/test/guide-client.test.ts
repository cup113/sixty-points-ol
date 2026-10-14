/**
 * 引导页的两条**客户端**纪律 —— SSR（ui-check）与纯函数单测都够不到的那一层。
 *
 * 两条都是线上真踩出来的，症状都不是「少个按钮」而是**整页卡死**：
 * 1. 答完「♥5 是分牌」点「继续」再往下走 → `Cannot read properties of undefined (reading 'cards')`，
 *    页面停在第 2 步不再刷新；
 * 2. 走到「叫牌：从 40 分开始」跟着教练叫牌 → `DataCloneError`，画面停在「0 手已叫」不动。
 *
 * 病根两条，都在**接线层**：
 * 1. **一步 = 一屏 = 一份新状态**。Svelte 会在**同一条 `{#if}` 链的同一分支上复用组件实例**，
 *    于是连着两步都是测验时，`QuizCard` 的题号会从上一屏漏过来：第二屏只有 1 题，题号还是 4，
 *    `questions[4]` 越界 → 取 `question.cards` 当场抛错，而抛在渲染刷新里会让这一整批更新作废，
 *    页面从此不再响应。`learn/+page.svelte` 用 `{#key step.id}` 把这一步的内容整个换新。
 * 2. **引擎快照不许进响应式代理**。`dispatch` 开头就是 `structuredClone(prev)`，而 `$state` 是**深**代理
 *    （连 `snapshot.state` 都是代理）—— 代理一被结构化克隆就抛 `DataCloneError`，
 *    对手自动出牌与「跳过等待」于是当场全挂。所以 `GuideBoard` 的快照只能 `$state.raw`：
 *    它本来就是整体替换、从不就地改，换掉的只有代理，响应性一点没少。
 *
 * 行为本身要浏览器（仓库里的 CDP 只给截图脚本用），所以这里与 `page-source.test.ts`
 * 「观战者不许被当成你」同一套路：守**形状**。第 2 条另配一条**机制**测试 ——
 * 代理态进 `stepOnce` 真的会炸、普通对象真的不会，于是「为什么必须 raw」由事实说话，不靠注释自证。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { startSession, stepOnce } from '../src/lib/guide/session.ts';
import { fixtureDeal } from './guide-fixture.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** 剥掉注释再断言：注释里提到旧写法（比如解释「这里曾经没有 {#key}」）不构成引用 */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const page = code(read('../src/routes/learn/+page.svelte'));
const board = code(read('../src/lib/components/guide/GuideBoard.svelte'));

test('一步 = 一屏：每一步的内容整个落在 {#key step.id} 里', () => {
  const open = page.indexOf('{#key step.id}');
  assert.notEqual(open, -1, '课程壳没按 step.id 换新组件实例：同类两步会复用实例（测验题号会漏到下一屏）');
  const close = page.indexOf('{/key}', open);
  assert.notEqual(close, -1, '{#key step.id} 没有闭合');
  const keyed = page.slice(open, close);
  // guide-v2 起讲解与测验同屏：`quiz` 不再是独立步种，测验组渲染在 brief 分支里
  for (const kind of ['brief', 'deal', 'review'] as const) {
    assert.ok(
      keyed.includes(`step.kind === '${kind}'`),
      `「${kind}」这一步不在 {#key step.id} 里：它的组件实例会被下一步复用`
    );
  }
  assert.ok(keyed.includes('<BriefCard'), 'BriefCard 不在 {#key step.id} 里');
  assert.ok(keyed.includes('<QuizCard'), 'QuizCard 不在 {#key step.id} 里：题号会从上一屏漏过来');
  assert.ok(keyed.includes('<GuideBoard'), 'GuideBoard 不在 {#key step.id} 里：快照会从上一屏漏过来');
  assert.ok(keyed.includes('<GuideReview'), 'GuideReview 不在 {#key step.id} 里');
});

test('引擎快照不进代理：GuideBoard 的 snapshot 只能是 $state.raw', () => {
  assert.ok(
    board.includes('let snapshot = $state.raw<SessionSnapshot>('),
    '快照没有用 $state.raw 声明：深代理被 dispatch 的 structuredClone 一克隆就 DataCloneError'
  );
  assert.equal(
    /let snapshot = \$state[<(]/.test(board),
    false,
    '快照又回到 $state（代理态）了：对手自动出牌与「跳过等待」会当场全挂'
  );
});

test('代理态进引擎当场抛错、普通对象走得好 —— 这就是快照必须 raw 的原因', () => {
  const { deal } = fixtureDeal(7, 1);
  const snapshot = startSession(deal);

  // 基线：同一份快照、普通对象，推进一步没有任何问题（引导数据是好的，代理才是病根）
  const ok = stepOnce(snapshot, deal);
  assert.equal(ok.snapshot.index, 1, '普通对象快照推不动：会话状态机自己坏了');

  // $state 的代理是**深**的：快照上的 state 也是代理。这里用原生 Proxy 复现同一件事
  const state = new Proxy(snapshot.state, {});
  assert.throws(
    () => stepOnce({ ...snapshot, state }, deal),
    { name: 'DataCloneError' },
    '代理态没被挡住：dispatch 的 structuredClone 应当克隆不了它'
  );
});

// ── 交互重塑（guide-v2）：排序 / 节奏分档 / 导航提示的源码形状守卫 ─────────────
// 每条都带**就地反证**：同一个判定函数跑一遍已知的坏形状必须红 —— 守卫不空转这件事
// 由测试自己永久重证，不靠一次性注入实验（与 bid-panel.test.ts 的 panelOrder 同套路）。

/** 判定：手牌上屏前过了引擎的 sortHand（真桌个人视图同一份序，CONTEXT.md「副牌在手牌里的显示序」） */
function sortsHand(src: string): boolean {
  return /sortHand\(/.test(src);
}

test('引导局手牌用引擎的 sortHand 排序：发牌序不许直接上屏', () => {
  assert.ok(sortsHand(board), 'GuideBoard 没把手牌过 sortHand：用户看到的是发牌序，主牌不在前、花色不黑红交替');
  // 反证：把调用改名的同一份源码必须过不了这条判定
  const broken = board.replace(/sortHand\(/g, 'unsorted(');
  assert.ok(!sortsHand(broken), '改掉 sortHand 调用后判定仍通过：这条守卫是空转的');
});

/** 判定：对手节奏分档（叫/埋 vs 出）且收墩有停留 */
function pacedTiers(src: string): { tiers: boolean; hold: boolean; noFlatDelay: boolean } {
  return {
    tiers: /THINK_DELAY_MS\s*=/.test(src) && /PLAY_DELAY_MS\s*=/.test(src),
    hold: /TRICK_HOLD_MS\s*=/.test(src) && /trickWon/.test(src),
    noFlatDelay: !/OPPONENT_DELAY_MS/.test(src)
  };
}

test('对手节奏分档 + 收墩停留：700ms 一刀切与「收墩即清场」都不许回潮', () => {
  const pace = pacedTiers(board);
  assert.ok(pace.tiers, 'GuideBoard 没有按动作分档的延迟常量（叫牌 1.5s / 出牌 1.1s）');
  assert.ok(pace.hold, '收墩停留没了：events.trickWon 必须被消费（TRICK_HOLD_MS + trickWon 同时在）');
  assert.ok(pace.noFlatDelay, '单一 OPPONENT_DELAY_MS 又回来了：教程要按动作分档，不是一刀切');
  // 反证：抽掉分档常量与停留的坏形状必须被逐项判出来
  const bad = pacedTiers(board.replace(/THINK_DELAY_MS = 1500;/, 'DELAY = 700;').replace(/TRICK_HOLD_MS = 2000;/, ''));
  assert.equal(bad.tiers, false, '抽掉 THINK_DELAY_MS 后 tiers 判定仍通过：空转');
  assert.equal(bad.hold, false, '抽掉 TRICK_HOLD_MS 后 hold 判定仍通过：空转');
});

/** 判定：叫牌历史进了引导局（复用真桌那份三列表格，不是第二份真相） */
function showsAuctionHistory(src: string): boolean {
  return /<AuctionHistory/.test(src);
}

test('引导局有叫牌历史表（复用 AuctionHistory，与真桌同一份）', () => {
  assert.ok(showsAuctionHistory(board), 'GuideBoard 没挂 AuctionHistory：对手叫了什么只剩一句「N 手已叫」');
  assert.ok(!showsAuctionHistory(board.replace(/<AuctionHistory[^]*?\/>/g, '')), '删掉挂载后判定仍通过：空转');
});

// ── 桌面手感（guide-v3 追加）：座位气泡 / 两行式收墩 / 叫牌金框的轮次门 ──────────
const bidBoard = code(read('../src/lib/components/guide/GuideBidBoard.svelte'));
const coachBar = code(read('../src/lib/components/guide/CoachBar.svelte'));
const quizCard = code(read('../src/lib/components/guide/QuizCard.svelte'));

/** 判定：对手的解说挂在他那一席的气泡上（notes 被消费 + 气泡按座位分列） */
function saysAtSeats(src: string): boolean {
  return /deal\.notes/.test(src) && /data-say/.test(src);
}

test('解说从动作者那一席冒气泡，不再全挤在一条等待栏里', () => {
  assert.ok(saysAtSeats(board), 'notes 没挂到座位气泡上：一轮的解说还是挤在同一处');
  assert.ok(!saysAtSeats(board.replace(/data-say/g, 'data-note')), '换掉气泡锚点后判定仍通过：空转');
});

/** 判定：收墩是「整墩搬进上一行」不是「清场重画」—— key 不变的两行 + flip + 缩档类 */
function twoRowTricks(src: string): boolean {
  return /animate:flip/.test(src) && /data-trick-row/.test(src) && /trick-mini/.test(src);
}

test('出牌区两行式：这一墩 + 上一墩，收墩用 flip 搬家不跳变', () => {
  assert.ok(twoRowTricks(board), '收墩还在清场重画：没有 key 不变的两行式（flip + trick-mini + data-trick-row）');
  assert.ok(!twoRowTricks(board.replace(/animate:flip/g, 'animate:none')), '抽掉 flip 后判定仍通过：空转');
});

/** 判定：叫牌盘的引导金框被 active 拦住 —— 没轮到你，格子不先亮 */
function bidGoldGated(src: string): boolean {
  return /active && target/.test(src);
}

test('叫牌金框只在轮到你时亮：没轮到就先金，学员会以为该自己叫', () => {
  assert.ok(bidBoard.includes('active'), '叫牌盘没有 active 门：金框随时都可能亮');
  assert.ok(bidGoldGated(bidBoard), 'guided 金框没被 active 拦住（target 匹配前必须先过 active）');
  assert.ok(!bidGoldGated(bidBoard.replace(/active && /g, '')), '拆掉 active 门后判定仍通过：空转');
});

// ── 桌面手感第二轮（guide-v3.2）：粗体渲染 / 双气泡并存 / 教练栏贴手牌 / 桌面信息须 ──

/** 判定：文案里的 **粗体** 走同一份最小解析（RichText），不许把两个星号端上屏 */
function rendersBold(...sources: string[]): boolean {
  return sources.every((src) => /<RichText/.test(src));
}

test('**粗体** 要渲染不要留星号：气泡、教练栏、测验都过 RichText', () => {
  assert.ok(rendersBold(board, coachBar, quizCard), '引导文案没走 RichText：数据里的 **星号** 会原样端上屏');
  assert.ok(
    !rendersBold(board.replace(/<RichText/g, '<Plaintext')),
    '抽掉 RichText 后判定仍通过：空转'
  );
});

/** 判定：气泡巷是「最近 SAY_WINDOW 条并存」的窗口，不是只留最新一条的一冒就走 */
function twoBubblesAtOnce(src: string): boolean {
  return /SAY_WINDOW/.test(src) && /data-say/.test(src);
}

test('两个气泡可以同时显示：新的一条冒出来，前一条还在', () => {
  assert.ok(twoBubblesAtOnce(board), '没有 SAY_WINDOW 窗口：解说还是每来一条就顶走上一条');
  assert.ok(
    !twoBubblesAtOnce(board.replace(/SAY_WINDOW/g, 'WINDOW')),
    '收掉并存窗口后判定仍通过：空转'
  );
});

/** 判定：教练栏住在手牌正上方（讲解面不垫底 —— 建议得贴着它讲的那几颗牌） */
function coachAboveHand(src: string): boolean {
  const coach = src.indexOf('<CoachBar');
  const hand = src.indexOf('data-guide-hand');
  return coach >= 0 && hand >= 0 && coach < hand;
}

test('教练栏在手牌正上方，不再垫到桌面底端', () => {
  assert.ok(coachAboveHand(board), '教练栏不在手牌上方：<CoachBar 应排在 data-guide-hand 之前');
  assert.ok(
    !coachAboveHand(board.replace('data-guide-hand', 'data-hand')),
    '拿掉手牌锚点后判定仍通过：空转'
  );
});

/** 判定：定约 / 级牌 / 庄已抓 / 轮数住进桌面信息须（大号金字），不再缩成一行 10px 小字 */
function hasInfoRail(src: string): boolean {
  return /data-guide-rail/.test(src) && /rankLabel/.test(src);
}

test('级牌、庄分这些实时数摆成信息须的大号金字', () => {
  assert.ok(hasInfoRail(board), '引导桌面没有信息须：定约/级牌/庄分还是一行小字');
  assert.ok(
    !hasInfoRail(board.replace(/data-guide-rail/g, 'data-rail')),
    '换掉信息须锚点后判定仍通过：空转'
  );
});

/** 判定：页面没有开发者向的页脚提示，且有主 CTA 位 */
function hasUserNav(src: string): { clean: boolean; cta: boolean } {
  return {
    clean: !src.includes('深度链接') && !src.includes('翻步'),
    cta: src.includes('data-guide-cta')
  };
}

test('页脚不写开发者提示，「下一步」住进内容流的主 CTA 位', () => {
  const nav = hasUserNav(page);
  assert.ok(nav.clean, '页脚还在展示「← → 翻步 · 深度链接 ?s=…」：键盘与查询串是开发者的语言');
  assert.ok(nav.cta, '内容底部没有主 CTA 位（data-guide-cta）：下一步只剩右下角一枚小钮');
  // 反证：旧页脚那行字加回去，判定必须翻红
  const oldFooter = page.replace('</footer>', `<span>← → 翻步 · 深度链接 ?s=c8-end</span></footer>`);
  assert.equal(hasUserNav(oldFooter).clean, false, '旧页脚文案塞回去后判定仍通过：空转');
  const noCta = page.replace('data-guide-cta', 'data-guide-legacy');
  assert.equal(hasUserNav(noCta).cta, false, '换掉 CTA 钩子后判定仍通过：空转');
});
