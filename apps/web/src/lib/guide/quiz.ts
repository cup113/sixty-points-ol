/**
 * 测验判分：**门槛式**（CONTEXT.md 的 **测验**）。
 *
 * 三条口径：
 * - 必须答对才能继续 —— 答错不清空、不放过，给针对性解释后重选；
 * - 解释是**逐项**的：答错时只说「你选的那一项为什么不对」（多选另外列出漏掉的正确项），
 *   答对时给一句确认；单项选择题**不**顺手报出正确答案，否则重选就成了照抄；
 * - 不记分。新手引导不是考试，答错的纠偏与答对的确认都是教材。
 */
import { MIN_QUIZ_OPTIONS, type QuizQuestion } from './types.ts';

export interface GradeResult {
  readonly ok: boolean;
  /** 答对时是一句确认，答错时是逐项解释；空数组只出现在「什么都没选」之外的退化情形 */
  readonly feedback: readonly string[];
}

function selectedSet(selected: readonly string[]): Set<string> {
  return new Set(selected);
}

export function correctOptionIds(question: QuizQuestion): string[] {
  return question.options.filter((option) => option.correct).map((option) => option.id);
}

/**
 * 题面完整性：生成物与手写课程都要过这一关。
 * 返回 `null` 表示没问题，否则是给作者看的原因（`guide:check` 与单测共用）。
 */
export function validateQuestion(question: QuizQuestion): string | null {
  if (question.id.trim().length === 0) return '题目缺 id';
  if (question.prompt.trim().length === 0) return `${question.id} 缺题面`;
  if (question.options.length < MIN_QUIZ_OPTIONS) return `${question.id} 的选项少于 ${MIN_QUIZ_OPTIONS} 个`;
  const ids = new Set<string>();
  for (const option of question.options) {
    if (option.id.trim().length === 0) return `${question.id} 有选项缺 id`;
    if (ids.has(option.id)) return `${question.id} 的选项 id 重复：${option.id}`;
    ids.add(option.id);
    if (option.text.trim().length === 0) return `${question.id} 的选项 ${option.id} 缺文字`;
    if (option.why.trim().length === 0) return `${question.id} 的选项 ${option.id} 缺解释`;
  }
  const correct = correctOptionIds(question);
  if (question.kind === 'multi') {
    if (correct.length < 2) return `${question.id} 是多选，正确项应当至少 2 个`;
    if (correct.length === question.options.length) return `${question.id} 是多选，但没有一个错项`;
  } else if (correct.length !== 1) {
    return `${question.id} 是${question.kind === 'truefalse' ? '判断题' : '单选'}，正确项必须恰好 1 个`;
  }
  if (question.kind === 'truefalse' && question.options.length !== 2) {
    return `${question.id} 是判断题，选项必须恰好 2 个（对 / 错）`;
  }
  return null;
}

/** 判一次作答。调用方（QuizCard）只在 `ok === false` 时把 `feedback` 摊开给玩家看 */
export function gradeQuiz(question: QuizQuestion, selected: readonly string[]): GradeResult {
  const picked = selectedSet(selected);
  if (picked.size === 0) return { ok: false, feedback: ['先选一个答案。'] };

  const correct = correctOptionIds(question);
  const wrongPicked = question.options.filter((option) => picked.has(option.id) && !option.correct);
  const missed = question.options.filter((option) => !picked.has(option.id) && option.correct);

  const ok =
    question.kind === 'multi'
      ? picked.size === correct.length && correct.every((id) => picked.has(id))
      : picked.size === 1 && correct.length === 1 && picked.has(correct[0]!);

  if (ok) {
    const pickedOptions = question.options.filter((option) => picked.has(option.id));
    const fallback = pickedOptions.map((option) => option.why).join(' ');
    return { ok: true, feedback: [question.note ?? fallback] };
  }

  const feedback: string[] = [];
  for (const option of wrongPicked) feedback.push(`${option.text}：${option.why}`);
  // 多选才列「漏了哪些」：单选/判断题直接报出正确项，重选就变成照抄
  if (question.kind === 'multi') {
    for (const option of missed) feedback.push(`漏了「${option.text}」：${option.why}`);
  }
  if (feedback.length === 0) feedback.push('再想想。');
  return { ok: false, feedback };
}
