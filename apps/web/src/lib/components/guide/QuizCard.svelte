<script lang="ts">
  /**
   * 测验屏：判断 / 单选 / 多选三种题型，**门槛式**判分（CONTEXT.md 的 **测验**）。
   *
   * 门禁的读法：答错 → 只给所选那一项的解释（多选另列「漏了哪些」）→ 接着选；
   * 答对 → 给确认解释。**组里最后一题答对的那一刻**回调 `onDone`，课程壳据此放行下一步 ——
   * 页面的主 CTA（「下一节 · …」）自己就是那个「往下读」，测验不再自备一枚金按钮。
   */
  import CardRow from '$lib/components/CardRow.svelte';
  import RichText from './RichText.svelte';
  import { handFromKeys } from '$lib/guide/replay';
  import { gradeQuiz, type GradeResult } from '$lib/guide/quiz';
  import type { QuizQuestion } from '$lib/guide/types';

  let { title, questions, onDone }: { title: string; questions: readonly QuizQuestion[]; onDone: () => void } =
    $props();

  let index = $state(0);
  let picked = $state<string[]>([]);
  let result = $state<GradeResult | null>(null);

  const question = $derived(questions[index]!);
  const cards = $derived(question.cards === undefined ? [] : handFromKeys(question.cards));
  const settled = $derived(result?.ok === true);
  const last = $derived(index + 1 >= questions.length);

  /** 判分 + 放行：最后一题答对就回调 `onDone`，不另设「这一组过了」那一步 */
  function grade(ids: readonly string[]): void {
    const graded = gradeQuiz(question, ids);
    result = graded;
    if (graded.ok && last) onDone();
  }

  function choose(id: string): void {
    if (settled) return;
    if (question.kind === 'multi') {
      picked = picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id];
      result = null;
      return;
    }
    picked = [id];
    grade([id]);
  }

  function confirm(): void {
    if (settled || picked.length === 0) return;
    grade(picked);
  }

  function next(): void {
    if (last) return;
    index += 1;
    picked = [];
    result = null;
  }
</script>

<section class="space-y-3" data-quiz data-quiz-id={question.id}>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-base font-bold text-ivory">{title}</h2>
    <span class="text-xs text-white/45">第 {index + 1} / {questions.length} 题</span>
  </div>

  <p class="text-base leading-relaxed text-white/85">
    <RichText text={question.prompt} />
  </p>

  {#if cards.length > 0}
    <div class="rounded-xl bg-black/30 px-2 py-3">
      <CardRow cards={cards} size="md" />
    </div>
  {/if}

  <div
    class={question.kind === 'truefalse' ? 'grid grid-cols-2 gap-2' : 'space-y-1.5'}
    data-quiz-options
  >
    {#each question.options as option (option.id)}
      {@const active = picked.includes(option.id)}
      <button
        type="button"
        class={[
          'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm ring-1 transition',
          question.kind === 'truefalse' ? 'justify-center py-3' : 'w-full text-left',
          settled && option.correct
            ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/40'
            : active
              ? 'bg-white/10 text-ivory ring-gold/40'
              : 'text-white/70 ring-white/15 hover:bg-white/5',
          settled && !option.correct && active && 'ring-rose-400/40'
        ]}
        data-quiz-option={option.id}
        data-picked={active}
        aria-pressed={active}
        onclick={() => choose(option.id)}
      >
        {#if question.kind === 'truefalse'}
          <!-- 图标画成 SVG 而不是 ✓/✗ 两个字：那两个码位会落到不同字体，
               一个粗实心、一个细斜线（实测），并排看着不像一对；SVG 还随按钮色走 -->
          <svg
            viewBox="0 0 24 24"
            class="size-6 shrink-0"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            {#if option.id === 'yes'}
              <path d="M4 12.5 9.5 18 20 6.5" />
            {:else}
              <path d="M6 6 18 18M18 6 6 18" />
            {/if}
          </svg>
          <span class="font-semibold"><RichText text={option.text} /></span>
        {:else}
          <span
            class={[
              'grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold',
              active ? 'bg-gold/25 text-gold' : 'bg-white/10 text-white/45'
            ]}
          >
            {question.kind === 'multi' ? (active ? '✓' : '') : String.fromCharCode(65 + question.options.indexOf(option))}
          </span>
          <span class="min-w-0 flex-1"><RichText text={option.text} /></span>
        {/if}
      </button>
    {/each}
  </div>

  {#if question.kind === 'multi' && !settled}
    <button
      type="button"
      class="rounded-lg bg-gold/20 px-4 py-2 text-sm font-semibold text-gold ring-1 ring-gold/40 disabled:opacity-40"
      disabled={picked.length === 0}
      onclick={confirm}
    >
      确认作答
    </button>
  {/if}

  {#if result !== null}
    <div
      class={[
        'rounded-xl p-3 text-sm leading-relaxed ring-1',
        result.ok ? 'bg-emerald-500/10 text-emerald-100 ring-emerald-400/30' : 'bg-rose-500/10 text-rose-100 ring-rose-400/30'
      ]}
      data-quiz-feedback={result.ok ? 'ok' : 'retry'}
    >
      <!-- 记号与解释同一行：✓ 是这句话的行首，不是它自己的一行 -->
      <div class="flex items-start gap-1.5">
        <span class="text-lg font-black leading-none" aria-hidden="true">{result.ok ? '✓' : '↻'}</span>
        <div class="min-w-0 flex-1 space-y-1">
          {#each result.feedback as line, i (i)}
            <p><RichText text={line} /></p>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if settled && !last}
    <button
      type="button"
      class="rounded-lg bg-gold/20 px-4 py-2 text-sm font-semibold text-gold ring-1 ring-gold/40"
      onclick={next}
    >
      下一题 →
    </button>
  {/if}
</section>
