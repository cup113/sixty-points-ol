/**
 * 测验判分（CONTEXT.md 的 **测验**）：门槛式、逐项解释、不记分。
 *
 * 两条最容易被写错、这里专门钉住：
 * - 判断题 / 单选题答错时**不许**顺手报出正确项（否则重选变成照抄）；
 * - 多选题答错时必须列出「漏了哪些」（漏选在多选里与选错一样常见）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { correctOptionIds, gradeQuiz, validateQuestion } from '../src/lib/guide/quiz.ts';
import type { QuizQuestion } from '../src/lib/guide/types.ts';

const tf: QuizQuestion = {
  id: 'q-tf',
  kind: 'truefalse',
  prompt: '♥10 是分牌。',
  options: [
    { id: 'yes', text: '对', correct: true, why: '10 记 10 分，四张 10 一共 40 分。' },
    { id: 'no', text: '错', correct: false, why: '10 是分牌，与它是不是主牌无关。' }
  ],
  note: '分牌只看点数：5、10、K。'
};

const single: QuizQuestion = {
  id: 'q-single',
  kind: 'single',
  prompt: '这五张牌一共多少分？',
  cards: ['H5', 'S10', 'CK', 'D3', 'H9'],
  options: [
    { id: 'a', text: '15 分', correct: false, why: '5 + 10 = 15，但 K 也是 10 分。' },
    { id: 'b', text: '25 分', correct: true, why: '5 + 10 + 10 = 25。' },
    { id: 'c', text: '30 分', correct: false, why: '只有三张分牌，凑不出 30。' }
  ]
};

const multi: QuizQuestion = {
  id: 'q-multi',
  kind: 'multi',
  prompt: '下面哪些叫品比 45♥ 大？',
  options: [
    { id: 'a', text: '45♠', correct: true, why: '同分比花色，♠ 在 ♥ 之上。' },
    { id: 'b', text: '45NT', correct: true, why: '同分比花色，无主最大。' },
    { id: 'c', text: '45♦', correct: false, why: '同分比花色，♦ 在 ♥ 之下。' },
    { id: 'd', text: '40♠', correct: false, why: '分数低一档，再怎么换花色也压不过 45。' }
  ]
};

test('题面校验：单选/判断题恰好一个正确项，多选至少两个', () => {
  assert.equal(validateQuestion(tf), null);
  assert.equal(validateQuestion(single), null);
  assert.equal(validateQuestion(multi), null);

  const twoCorrect: QuizQuestion = {
    ...single,
    options: single.options.map((option) => ({ ...option, correct: true }))
  };
  assert.match(validateQuestion(twoCorrect) ?? '', /恰好 1 个/);

  const multiOne: QuizQuestion = { ...multi, options: multi.options.map((o) => ({ ...o, correct: o.id === 'a' })) };
  assert.match(validateQuestion(multiOne) ?? '', /至少 2 个/);

  const allCorrectMulti: QuizQuestion = { ...multi, options: multi.options.map((o) => ({ ...o, correct: true })) };
  assert.match(validateQuestion(allCorrectMulti) ?? '', /没有一个错项/);

  const threeWayTrueFalse: QuizQuestion = { ...tf, options: [...tf.options, { id: 'x', text: '不知道', correct: false, why: '没有这一项。' }] };
  assert.match(validateQuestion(threeWayTrueFalse) ?? '', /恰好 2 个/);

  const noWhy: QuizQuestion = { ...single, options: single.options.map((o) => ({ ...o, why: '' })) };
  assert.match(validateQuestion(noWhy) ?? '', /缺解释/);
});

test('答对：给确认解释（note 优先），并放行', () => {
  const result = gradeQuiz(tf, ['yes']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.feedback, ['分牌只看点数：5、10、K。']);

  const noNote = gradeQuiz(multi, ['a', 'b']);
  assert.equal(noNote.ok, true);
  assert.match(noNote.feedback[0] ?? '', /♠ 在 ♥ 之上/);
});

test('判断题答错：只解释选错的那一项，不报出正确项', () => {
  const result = gradeQuiz(tf, ['no']);
  assert.equal(result.ok, false);
  assert.equal(result.feedback.length, 1);
  assert.match(result.feedback[0]!, /10 是分牌，与它是不是主牌无关/);
  assert.ok(
    result.feedback.every((line) => !line.includes('10 记 10 分')),
    '答错时泄露了正确项的解释'
  );
});

test('多选答错：列出手上选错的项，也列出漏掉的正确项', () => {
  const missed = gradeQuiz(multi, ['a', 'c']);
  assert.equal(missed.ok, false);
  assert.ok(missed.feedback.some((line) => line.startsWith('漏了')), '漏选没有被指出');
  assert.ok(missed.feedback.some((line) => line.includes('♦ 在 ♥ 之下')), '选错的那项没有解释');

  const extra = gradeQuiz(multi, ['a', 'b', 'd']);
  assert.equal(extra.ok, false);
  assert.ok(extra.feedback.some((line) => line.includes('压不过 45')));
});

test('什么都不选：先选一个答案（不算答错到解释里）', () => {
  const result = gradeQuiz(single, []);
  assert.equal(result.ok, false);
  assert.deepEqual(result.feedback, ['先选一个答案。']);
});

test('correctOptionIds 是唯一那份「正确项」的定义', () => {
  assert.deepEqual(correctOptionIds(multi), ['a', 'b']);
  assert.deepEqual(correctOptionIds(tf), ['yes']);
});
