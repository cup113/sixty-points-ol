<script lang="ts">
  /**
   * 测验屏：判断 / 单选 / 多选三种题型，**门槛式**判分（CONTEXT.md 的 **测验**）。
   *
   * 门禁的读法：答错 → 只给所选那一项的解释（多选另列「漏了哪些」）→ 接着选；
   * 答对 → 给确认解释 → 「继续」。全对之后才回调 `onDone`，课程壳据此放行下一步。
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

  function choose(id: string): void {
    if (settled) return;
    if (question.kind === 'multi') {
      picked = picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id];
      result = null;
      return;
    }
    picked = [id];
    result = gradeQuiz(question, [id]);
  }

  function confirm(): void {
    if (settled || picked.length === 0) return;
    result = gradeQuiz(question, picked);
  }

  function next(): void {
    if (index + 1 < questions.length) {
      index += 1;
      picked = [];
      result = null;
      return;
    }
    onDone();
  }
</script>

<section class="space-y-3" data-quiz data-quiz-id={question.id}>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-sm font-bold text-ivory">{title}</h2>
    <span class="text-[10px] text-white/45">第 {index + 1} / {questions.length} 题</span>
  </div>

  <p class="text-[13px] leading-relaxed text-white/80">
    <RichText text={question.prompt} />
  </p>

  {#if cards.length > 0}
    <div class="rounded-xl bg-black/30 px-2 py-3">
      <CardRow cards={cards} size="md" />
    </div>
  {/if}

  <div class="space-y-1.5" data-quiz-options>
    {#each question.options as option (option.id)}
      {@const active = picked.includes(option.id)}
      <button
        type="button"
        class={[
          'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] ring-1 transition',
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
        <span
          class={[
            'grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold',
            active ? 'bg-gold/25 text-gold' : 'bg-white/10 text-white/45'
          ]}
        >
          {question.kind === 'multi' ? (active ? '✓' : '') : String.fromCharCode(65 + question.options.indexOf(option))}
        </span>
        <span class="min-w-0 flex-1"><RichText text={option.text} /></span>
      </button>
    {/each}
  </div>

  {#if question.kind === 'multi' && !settled}
    <button
      type="button"
      class="rounded-lg bg-gold/20 px-3 py-1.5 text-[11px] font-semibold text-gold ring-1 ring-gold/40 disabled:opacity-40"
      disabled={picked.length === 0}
      onclick={confirm}
    >
      确认作答
    </button>
  {/if}

  {#if result !== null}
    <div
      class={[
        'space-y-1 rounded-xl p-3 text-[11px] leading-relaxed ring-1',
        result.ok ? 'bg-emerald-500/10 text-emerald-100 ring-emerald-400/30' : 'bg-rose-500/10 text-rose-100 ring-rose-400/30'
      ]}
      data-quiz-feedback={result.ok ? 'ok' : 'retry'}
    >
      {#each result.feedback as line, i (i)}
        <p><RichText text={line} /></p>
      {/each}
    </div>
  {/if}

  {#if settled}
    {#if index + 1 < questions.length}
      <button
        type="button"
        class="rounded-lg bg-gold/20 px-3 py-1.5 text-[11px] font-semibold text-gold ring-1 ring-gold/40"
        onclick={next}
      >
        下一题 →
      </button>
    {:else}
      <button
        type="button"
        class="rounded-lg bg-gold/20 px-3 py-1.5 text-[11px] font-semibold text-gold ring-1 ring-gold/40"
        onclick={next}
        data-quiz-passed
      >
        这一组过了 ✓ 往下读
      </button>
    {/if}
  {/if}
</section>
