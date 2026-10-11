/**
 * 课程结构守卫：章节顺序、步 id 唯一、深链可定位、测验完整性、文案禁忌。
 *
 * 分工（与旧 `deck.test.ts` 同一条纪律）：
 * - **内容正确性**由 `tutorial.test.ts` 盯着（概念挂件的示例都被引擎核对过）与 `guide-*.test.ts`（引导局机制）；
 * - 这里只守**结构**与**口径**：漏一屏、id 撞车、深链定位不到、测验少解释、文案里冒出方位词或裸花色字母。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { COURSE } from '../src/lib/guide/course.ts';
import { dealOf } from '../src/lib/guide/deals/index.ts';
import { gradeQuiz, validateQuestion } from '../src/lib/guide/quiz.ts';
import { isCardKey } from '../src/lib/guide/replay.ts';
import { indexCourse, type CourseStep } from '../src/lib/guide/types.ts';

const course = COURSE;
const index = indexCourse(course);
const allSteps: readonly CourseStep[] = index.steps;

function textOf(step: CourseStep): string {
  switch (step.kind) {
    case 'brief':
      return [step.title, ...step.points].join('\n');
    case 'quiz':
      return [
        step.title,
        ...step.questions.flatMap((question) => [
          question.prompt,
          ...question.options.flatMap((option) => [option.text, option.why]),
          question.note ?? ''
        ])
      ].join('\n');
    case 'deal':
    case 'review':
      return step.title;
    case 'end':
      return step.title;
  }
}

test('章节：按大纲从基础概念 I 排到回大厅，每章都有标题与说明', () => {
  assert.deepEqual(
    course.chapters.map((chapter) => chapter.id),
    ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']
  );
  for (const chapter of course.chapters) {
    assert.ok(chapter.title.trim().length > 0, `${chapter.id} 缺标题`);
    assert.ok(chapter.blurb.trim().length > 0, `${chapter.id} 缺说明`);
    assert.ok(chapter.steps.length > 0, `${chapter.id} 是空章`);
  }
  // 状态机与页面共用的扁平索引必须与章内步数完全对上
  assert.equal(allSteps.length, course.chapters.reduce((sum, chapter) => sum + chapter.steps.length, 0));
});

test('步 id 全局唯一，深链（?s=<step-id>）都能定位回来', () => {
  const seen = new Set<string>();
  for (const step of allSteps) {
    assert.ok(step.id.trim().length > 0, '有步缺 id');
    assert.equal(seen.has(step.id), false, `步 id 重复：${step.id}`);
    seen.add(step.id);
    assert.equal(index.indexOf.get(step.id), allSteps.indexOf(step), `${step.id} 定位错了`);
    assert.ok(index.chapterOf.get(step.id) !== undefined, `${step.id} 不属于任何章`);
  }
  assert.equal(index.indexOf.get('不存在的步'), undefined);
});

test('四副引导局按大纲就位：闲家 → 庄家 → 庄家 → 闲家，各自都有复盘屏', () => {
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
  // 大纲 1.1.4 / 1.2：第一副拆成「叫牌段 + 出牌段」两屏；其余整副一气打完
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

test('测验：每题都过题面校验，题目 id 全局唯一，选项里的牌面都能还原', () => {
  const quizzes = allSteps.filter((step) => step.kind === 'quiz');
  assert.ok(quizzes.length >= 10, '测验太少：大纲要求概念段与叫牌段都有题');
  const ids = new Set<string>();
  for (const step of quizzes) {
    if (step.kind !== 'quiz') continue;
    assert.ok(step.questions.length > 0, `${step.id} 没有题目`);
    for (const question of step.questions) {
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
  for (const step of allSteps) {
    if (step.kind !== 'quiz') continue;
    for (const question of step.questions) {
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

test('收尾屏在最后一步，且课程不是空的', () => {
  assert.ok(allSteps.length > 20, `课程只有 ${allSteps.length} 步，太短了`);
  assert.equal(allSteps[allSteps.length - 1]!.kind, 'end');
  assert.equal(allSteps[allSteps.length - 1]!.id, 'c8-end');
});
