/**
 * 课程结构守卫：幕次顺序、步 id 唯一、深链可定位、测验完整性、文案禁忌。
 *
 * 分工（与旧 `deck.test.ts` 同一条纪律）：
 * - **内容正确性**由 `tutorial.test.ts` 盯着（概念挂件的示例都被引擎核对过）与 `guide-*.test.ts`（引导局机制）；
 * - 这里只守**结构**与**口径**：漏一屏、id 撞车、深链定位不到、测验少解释、文案里冒出方位词或裸花色字母。
 *
 * guide-v3 起课程是**五幕剧**（概念跟着牌走、每道门一口气过完），两条新纪律也在这里守：
 * - **首副三屏内开打**（第一副引导局之前的纯概念屏至多两屏）；
 * - **一屏至多一组测验、每组至多四题**（判断墙不许回潮）。
 * 两代重组吸收的全部旧步 id（v2 并屏 + v3 分幕）由 `GUIDE_ALIASES` 接住 —— 那张账本在这里对
 * v2 的完整 id 清单核完整性：漏登记一个就是红。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { COURSE, GUIDE_ALIASES } from '../src/lib/guide/course.ts';
import { dealOf } from '../src/lib/guide/deals/index.ts';
import { gradeQuiz, validateQuestion } from '../src/lib/guide/quiz.ts';
import { isCardKey } from '../src/lib/guide/replay.ts';
import { indexCourse, type CourseStep, type QuizGroup } from '../src/lib/guide/types.ts';

const course = COURSE;
const index = indexCourse(course);
const allSteps: readonly CourseStep[] = index.steps;

function textOf(step: CourseStep): string {
  switch (step.kind) {
    case 'brief':
      return [
        step.title,
        ...step.points,
        ...(step.quiz ?? []).flatMap((group) => quizGroupText(group))
      ].join('\n');
    case 'deal':
    case 'review':
      return step.title;
    case 'end':
      return step.title;
  }
}

function quizGroupText(group: QuizGroup): string[] {
  return [
    group.title,
    ...group.questions.flatMap((question) => [
      question.prompt,
      ...question.options.flatMap((option) => [option.text, option.why]),
      question.note ?? ''
    ])
  ];
}

/** 全课程的测验组（guide-v3 起：一屏至多一组，组挂在 brief 步上） */
function quizGroupsOf(): readonly QuizGroup[] {
  return allSteps.flatMap((step) => (step.kind === 'brief' ? (step.quiz ?? []) : []));
}

test('幕次：五幕从上桌排到毕业，每幕都有标题与说明', () => {
  assert.deepEqual(
    course.chapters.map((chapter) => chapter.id),
    ['act-1', 'act-2', 'act-3', 'act-4', 'act-5']
  );
  assert.deepEqual(
    course.chapters.map((chapter) => chapter.title),
    ['上桌', '坐庄', '底细', '直觉', '毕业']
  );
  for (const chapter of course.chapters) {
    assert.ok(chapter.title.trim().length > 0, `${chapter.id} 缺标题`);
    assert.ok(chapter.blurb.trim().length > 0, `${chapter.id} 缺说明`);
    assert.ok(chapter.steps.length > 0, `${chapter.id} 是空幕`);
  }
  // 状态机与页面共用的扁平索引必须与幕内步数完全对上
  assert.equal(allSteps.length, course.chapters.reduce((sum, chapter) => sum + chapter.steps.length, 0));
});

test('步 id 全局唯一，深链（?s=<step-id>）都能定位回来', () => {
  const seen = new Set<string>();
  for (const step of allSteps) {
    assert.ok(step.id.trim().length > 0, '有步缺 id');
    assert.equal(seen.has(step.id), false, `步 id 重复：${step.id}`);
    seen.add(step.id);
    assert.equal(index.indexOf.get(step.id), allSteps.indexOf(step), `${step.id} 定位错了`);
    assert.ok(index.chapterOf.get(step.id) !== undefined, `${step.id} 不属于任何幕`);
  }
  assert.equal(index.indexOf.get('不存在的步'), undefined);
});

test('首副三屏内开打：纯概念屏至多两屏，然后手就摸到牌了', () => {
  const firstDeal = allSteps.findIndex((step) => step.kind === 'deal');
  assert.ok(firstDeal >= 0, '课程里没有引导局');
  assert.ok(firstDeal <= 2, `第一副引导局排在第 ${firstDeal + 1} 屏：读概念读得太久才摸到牌`);
});

test('四副引导局按序就位：闲家 → 庄家 → 庄家 → 闲家，各自都有复盘屏', () => {
  const deals = allSteps.filter((step) => step.kind === 'deal');
  assert.deepEqual(
    deals.map((step) => step.slug),
    ['defender-01', 'defender-01', 'declarer-01', 'declarer-02', 'defender-02'],
    '第一副拆成叫牌段与出牌段两屏，所以它出现两次'
  );
  assert.deepEqual(
    [...new Set(deals.map((step) => step.slug))],
    ['defender-01', 'declarer-01', 'declarer-02', 'defender-02'],
    '四副的角色顺序应当是 闲家 → 庄家 → 庄家 → 闲家'
  );
  for (const step of deals) {
    if (step.kind !== 'deal') continue;
    const review = allSteps.find((item) => item.kind === 'review' && item.slug === step.slug);
    assert.ok(review !== undefined, `${step.slug} 没有复盘屏`);
    // 还没接上数据时必须写明原因；接上了就不能再挂占位
    if (step.pending === undefined) {
      assert.ok(dealOf(step.slug) !== null, `${step.slug} 既没有数据也没有 pending 说明`);
    } else {
      assert.ok(step.pending.trim().length > 0, `${step.slug} 的 pending 说明是空的`);
    }
  }
  // 第一副拆成「叫牌段 + 出牌段」两屏；其余整副一气打完
  assert.deepEqual(
    deals.filter((step) => step.slug === 'defender-01').map((step) => (step.kind === 'deal' ? step.segment : '')),
    ['auction', 'play']
  );
  assert.ok(
    deals.filter((step) => step.slug !== 'defender-01').every((step) => step.kind === 'deal' && step.segment === 'all')
  );
});

test('简述屏：要点非空、挂件是允许的那些', () => {
  const briefs = allSteps.filter((step) => step.kind === 'brief');
  assert.ok(briefs.length >= 12, '概念简述太少，故事被删掉之后不该只剩几屏');
  for (const step of briefs) {
    if (step.kind !== 'brief') continue;
    assert.ok(step.points.length >= 2, `${step.id} 的要点少于 2 条`);
    for (const point of step.points) assert.ok(point.trim().length > 0, `${step.id} 有空要点`);
    assert.ok(step.title.trim().length > 0);
  }
});

test('测验：一屏至多一组、每组至多四题（判断墙不许回潮）', () => {
  for (const step of allSteps) {
    if (step.kind !== 'brief') continue;
    assert.ok(
      (step.quiz ?? []).length <= 1,
      `${step.id} 挂了 ${(step.quiz ?? []).length} 组测验：一屏一组，多了就成了考试`
    );
    for (const group of step.quiz ?? []) {
      assert.ok(
        group.questions.length <= 4,
        `${step.id} 的测验组「${group.title}」有 ${group.questions.length} 题：每组至多四题，一口气要能过完`
      );
    }
  }
});

test('测验组：每组有标题、每题都过题面校验，题目 id 全局唯一，选项里的牌面都能还原', () => {
  const groups = quizGroupsOf();
  assert.ok(groups.length >= 10, '测验太少：叫牌、主牌、赢墩、跟牌、顺子、无主、算账、直觉都得有小题');
  const ids = new Set<string>();
  for (const group of groups) {
    assert.ok(group.title.trim().length > 0, '有测验组缺标题（组标题是「这是在考什么」的路标）');
    assert.ok(group.questions.length > 0, `${group.title} 没有题目`);
    for (const question of group.questions) {
      assert.equal(validateQuestion(question), null, `${question.id} 题面不合法`);
      assert.equal(ids.has(question.id), false, `题目 id 重复：${question.id}`);
      ids.add(question.id);
      for (const key of question.cards ?? []) {
        assert.ok(isCardKey(key), `${question.id} 的牌面键不存在：${key}`);
      }
      // 判分门禁的最低要求：正确集合必须让 gradeQuiz 放行，任一错项都要被拒
      const correct = question.options.filter((option) => option.correct).map((option) => option.id);
      assert.equal(gradeQuiz(question, correct).ok, true, `${question.id} 的标准答案被判错`);
      for (const option of question.options.filter((item) => !item.correct)) {
        assert.equal(gradeQuiz(question, [option.id]).ok, false, `${question.id} 的错项 ${option.id} 被判对了`);
      }
    }
  }
});

/**
 * guide-v2 的**全部**步 id（32 个简述 / 引导局 / 复盘 / 结尾步）与 16 个 quiz 步 id。
 * v3 重组后它们都不该再是独立一步 —— 每一个都必须能在 `GUIDE_ALIASES` 里找到去处。
 * 这份清单就是「深链一个都不断」的账本核对基准：课程再怎么改，账必须对得上。
 */
const V2_STEP_IDS: readonly string[] = [
  // c0 基础概念 I
  'c0-points', 'c0-turns',
  // c1 示例：当闲家
  'c1-bid', 'c1-auction', 'c1-play-brief', 'c1-play', 'c1-review',
  // c2 基础概念 II
  'c2-trump', 'c2-ladder', 'c2-trick', 'c2-ruff', 'c2-follow',
  // c3 示例：当庄家
  'c3-intro', 'c3-deal', 'c3-review',
  // c4 基础概念 III
  'c4-upgrade', 'c4-bury', 'c4-nt', 'c4-runs-side', 'c4-runs-trump',
  // c5 示例：当庄家（第二副）
  'c5-deal', 'c5-review',
  // c6 经典策略
  'c6-block', 'c6-hold', 'c6-cut', 'c6-runs', 'c6-count', 'c6-keep', 'c6-drain',
  // c7 示例：当闲家（第二副）
  'c7-deal', 'c7-review',
  // c8 回大厅
  'c8-end'
];

/** v2 的 quiz 步 id（guide-v2 并屏时吸收的那批）—— 它们的去处必须自带测验 */
const V2_QUIZ_IDS: readonly string[] = [
  'c0-points-tf', 'c0-points-count', 'c0-turns-tf',
  'c1-bid-higher', 'c1-bid-meaning',
  'c2-trump-tf', 'c2-ladder-tf', 'c2-trick-tf', 'c2-ruff-tf', 'c2-follow-single',
  'c4-upgrade-tf', 'c4-bury-single', 'c4-nt-tf', 'c4-runs-side-tf', 'c4-runs-trump-tf',
  'c6-strategy-tf'
];

/** 判定：两代退役的旧 id 是否个个有去处、账本里有没有来历不明的键 */
function ledgerComplete(map: ReadonlyMap<string, string>): { retiredCovered: boolean; noStaleKeys: boolean } {
  const retired = [...V2_STEP_IDS, ...V2_QUIZ_IDS];
  return {
    retiredCovered: retired.every((id) => map.has(id)),
    noStaleKeys: [...map.keys()].every((key) => retired.includes(key))
  };
}

test('深链别名账本：v2 的每一个旧 id 都有去处，账本里没有来历不明的键', () => {
  assert.ok(GUIDE_ALIASES.size > 0, '别名账本是空的：两代重组吸收的旧 id 就没人接了');
  for (const [oldId, newId] of GUIDE_ALIASES) {
    assert.equal(index.indexOf.get(oldId), undefined, `${oldId} 不该还是独立一步（它已被并进 ${newId}）`);
    assert.equal(index.chapterOf.get(oldId), undefined, `${oldId} 不该还挂在哪一幕名下`);
    assert.ok(index.indexOf.has(newId), `${oldId} 的去处 ${newId} 不存在`);
  }
  const ledger = ledgerComplete(GUIDE_ALIASES);
  assert.equal(ledger.retiredCovered, true, '有 v2 的旧 id 没登记进别名账本：分享出去的深链会掉回课程开头');
  assert.equal(ledger.noStaleKeys, true, '账本里有来历不明的键：v2 从没有过这个 id，登记它只会掩盖笔误');
  // 反证：从账本里抽掉一个旧 id，完整性判定必须翻红（守卫不空转）
  const missing = new Map(GUIDE_ALIASES);
  missing.delete('c2-trump');
  assert.equal(ledgerComplete(missing).retiredCovered, false, '抽掉一个旧 id 后判定仍通过：账本守卫是空转的');
  const stale = new Map(GUIDE_ALIASES);
  stale.set('c9-never-existed', 'g-end');
  assert.equal(ledgerComplete(stale).noStaleKeys, false, '塞进一个来历不明的键后判定仍通过：空转');

  // quiz 步的去处必须自带测验：那屏得接得住「链接里是题」的预期
  for (const quizId of V2_QUIZ_IDS) {
    const targetId = GUIDE_ALIASES.get(quizId)!;
    const target = allSteps.find((step) => step.id === targetId);
    assert.ok(
      target !== undefined && target.kind === 'brief' && (target.quiz ?? []).length > 0,
      `${quizId} 的去处 ${targetId} 没带测验组`
    );
  }
});

test('文案禁忌：没有方位称谓、没有裸花色字母，叫品一律写成 40♣ 这种', () => {
  for (const step of allSteps) {
    const text = textOf(step);
    assert.equal(/[东南西]/.test(text), false, `${step.id} 出现方位称谓`);
    assert.equal(
      /\d{2,3}\s?[CDHS]\b/.test(text),
      false,
      `${step.id} 的叫品写了裸花色字母（应写成 40♣）：${text.slice(0, 40)}`
    );
  }
});

test('依赖级牌点数的示例就地写明前提（凡是「某花色某点数 + 顺子」的句子都要带级牌）', () => {
  for (const group of quizGroupsOf()) {
    for (const question of group.questions) {
      const text = [
        question.prompt,
        ...question.options.flatMap((option) => [option.text, option.why]),
        question.note ?? ''
      ].join('\n');
      const hasFace = /[♣♦♥♠]\s?[0-9AJQK]/.test(text);
      const aboutRuns = /顺子|相邻|连着|连牌/.test(text);
      if (hasFace && aboutRuns) {
        assert.ok(text.includes('级牌'), `${question.id} 讲了顺子却没有就地写明级牌前提`);
      }
    }
  }
  // 简述屏同理：凡是摆出具体牌面的，都要在句子里说明本副环境
  for (const step of allSteps) {
    if (step.kind !== 'brief') continue;
    const text = step.points.join('\n');
    if (/[♣♦♥♠]\s?[0-9AJQK]/.test(text)) {
      assert.ok(text.includes('级牌') || text.includes('主打'), `${step.id} 摆出牌面却没写本副环境`);
    }
  }
});

test('毕业屏在最后一步，且课程不是空的', () => {
  assert.ok(allSteps.length > 20, `课程只有 ${allSteps.length} 步，太短了`);
  assert.equal(allSteps[allSteps.length - 1]!.kind, 'end');
  assert.equal(allSteps[allSteps.length - 1]!.id, 'g-end');
});
