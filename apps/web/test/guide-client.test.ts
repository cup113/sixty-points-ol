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
  for (const kind of ['brief', 'quiz', 'deal', 'review'] as const) {
    assert.ok(
      keyed.includes(`step.kind === '${kind}'`),
      `「${kind}」这一步不在 {#key step.id} 里：它的组件实例会被下一步复用`
    );
  }
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
