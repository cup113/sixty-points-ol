<script lang="ts">
  /**
   * 新手引导（ADR-0025）：`/learn` 从幻灯片改成**一门交互课程** —— 概念简述 + 门槛式测验 + 引导局。
   *
   * 四件事在这里：
   * 1. **深链**：`?s=<step-id>` 服务端就算得出来（`+page.ts`），分享出去的链接直接落在那一步；
   *    翻页时用 `history.replaceState` 同步地址（不往历史里塞几十条记录）。
   * 2. **续读**：最远到达的步与引导局里的动作下标存 localStorage，没有 `?s=` 时接着上次读。
   * 3. **测验门槛**：没答对不放行（`QuizCard` 自己管判分，这里只认它报的 done）。
   * 4. **引导局接线**：把 `GuideBoard` 的进展写回续读位置，打完这一段就能继续。
   */
  import { onMount, untrack } from 'svelte';
  import BriefCard from '$lib/components/guide/BriefCard.svelte';
  import GuideBoard from '$lib/components/guide/GuideBoard.svelte';
  import GuideReview from '$lib/components/guide/GuideReview.svelte';
  import QuizCard from '$lib/components/guide/QuizCard.svelte';
  import { COURSE } from '$lib/guide/course';
  import { dealOf } from '$lib/guide/deals/index';
  import { indexCourse } from '$lib/guide/types';

  let { data }: { data: { step: string } } = $props();

  const course = COURSE;
  const index = indexCourse(course);
  const total = index.steps.length;
  const STORAGE_KEY = 'sixty.guide.progress';

  interface Saved {
    readonly v: string;
    /** 最远到达的步下标 */
    readonly index: number;
    /** 那一步的 id（课程改了之后下标会漂，靠 id 兜住） */
    readonly step: string;
    /** 引导局里的动作下标（那一步是引导局时才有） */
    readonly action: number | null;
  }

  function readSaved(): Saved | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as Saved;
      return parsed.v === course.id ? parsed : null;
    } catch {
      return null;
    }
  }

  /** 起始步：优先 `?s=`（服务端算得出，分享链接直接落位），否则第一步；续读在 onMount 里接上 */
  let current = $state(untrack(() => Math.max(0, index.indexOf.get(data.step) ?? 0)));
  let far = $state(untrack(() => current));
  let menuOpen = $state(false);
  let quizDone = $state(false);
  /** 引导局那一步打完没有（打完才放行下一步） */
  let dealDone = $state(false);
  let dealAction = $state<number | null>(null);
  let saved = $state<Saved | null>(null);

  const step = $derived(index.steps[current]!);
  const chapter = $derived(index.chapterOf.get(step.id)!);
  const progress = $derived(total <= 1 ? 100 : Math.round(((current + 1) / total) * 100));
  /** 测验与引导局必须当场过掉才放行；其他步随时可往下走 */
  const gated = $derived((step.kind === 'quiz' && !quizDone) || (step.kind === 'deal' && !dealDone));
  const alreadyPassed = $derived(current < far);
  const canNext = $derived(!gated || alreadyPassed);

  function persist(next: number, action: number | null): void {
    try {
      const payload: Saved = { v: course.id, index: next, step: index.steps[next]?.id ?? '', action };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      saved = payload;
    } catch {
      // 隐私模式里写不进去就算了：续读是锦上添花，不能因此挡住课程
    }
  }

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (clamped === current) return;
    current = clamped;
    quizDone = false;
    dealDone = false;
    dealAction = null;
    if (clamped > far) {
      far = clamped;
      persist(clamped, null);
    }
  }

  /** 题目全答对、或这一副引导局打完：记录进展并允许往下走 */
  function onStepPassed(): void {
    const next = Math.min(total - 1, current + 1);
    if (next > far) {
      far = next;
      persist(next, null);
    }
  }

  function onDealProgress(action: number): void {
    dealAction = action;
    if (current >= far) persist(current, action);
  }

  onMount(() => {
    saved = readSaved();
    if (data.step.length === 0 && saved !== null) {
      const at = index.indexOf.get(saved.step);
      if (at !== undefined && at > 0) {
        current = at;
        far = Math.max(far, saved.index);
        dealAction = saved.action;
      }
    }
    return () => undefined;
  });

  // 这一屏有没有已经读过去：前进过就视为已通过（否则回头再看测验会被门槛挡住）
  $effect(() => {
    if (current < far) {
      quizDone = true;
      dealDone = true;
    }
  });

  // 翻到哪一步，地址栏就写哪一步（replaceState：不往历史里塞几十条记录）
  $effect(() => {
    const id = step.id;
    if (typeof window === 'undefined') return;
    if (window.location.hash.replace(/^#/, '') !== id) {
      window.history.replaceState(null, '', `#${id}`);
    }
  });

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return;
    // 引导局里方向键可能被用来选牌，别和翻页抢
    if (step.kind === 'deal') {
      if (event.key === 'Escape') menuOpen = false;
      return;
    }
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        if (canNext) go(current + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        go(current - 1);
        break;
      case 'Escape':
        menuOpen = false;
        break;
      default:
        break;
    }
  }

  const ghost =
    'rounded-lg px-3 py-1.5 text-[11px] text-white/70 ring-1 ring-white/15 transition hover:bg-white/10 disabled:opacity-30';
</script>

<svelte:window onkeydown={onKeydown} />

<main class="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-3 py-4 sm:px-6">
  <header class="flex flex-wrap items-center gap-2">
    <a class="text-xs text-white/50 hover:text-white" href="/">← 大厅</a>
    <a class="text-xs text-white/50 hover:text-white" href="/rules">文字教程</a>
    <div class="ml-auto flex flex-wrap items-center gap-1.5">
      <button type="button" class={ghost} onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen}>
        {chapter.title} ▾
      </button>
      <span class="text-[11px] tabular-nums text-white/45">{current + 1} / {total}</span>
    </div>
  </header>

  <div class="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
    <div class="h-full bg-gold transition-all" style={`width:${progress}%`}></div>
  </div>

  {#if menuOpen}
    <nav class="mt-3 grid gap-1 rounded-2xl bg-black/40 p-3 ring-1 ring-white/10" aria-label="章节">
      {#each course.chapters as item (item.id)}
        {@const first = index.indexOf.get(item.steps[0]!.id) ?? 0}
        <button
          type="button"
          class={[
            'flex items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/10',
            item.id === chapter.id ? 'bg-white/10' : ''
          ]}
          onclick={() => {
            go(first);
            menuOpen = false;
          }}
        >
          <span class="min-w-0 flex-1 truncate text-[12px] text-ivory">{item.title}</span>
          <span class="shrink-0 text-[10px] text-white/40">{item.blurb} · {item.steps.length} 步</span>
        </button>
      {/each}
    </nav>
  {/if}

  <div class="mt-3 min-h-0 flex-1 rounded-2xl bg-black/25 p-3 ring-1 ring-white/10 sm:p-4">
    {#if step.kind === 'brief'}
      <BriefCard title={step.title} points={step.points} widget={step.widget} />
    {:else if step.kind === 'quiz'}
      <QuizCard title={step.title} questions={step.questions} onDone={onStepPassed} />
    {:else if step.kind === 'deal'}
      {@const deal = dealOf(step.slug)}
      {#if deal === null}
        <div class="space-y-2" data-guide-pending>
          <h2 class="text-sm font-bold text-ivory">{step.title}</h2>
          <p class="text-[12px] leading-relaxed text-white/60">{step.pending ?? '这一副引导局还没接上数据。'}</p>
          <p class="text-[11px] text-white/40">
            概念与测验里已经讲透的部分不受影响；这一副接上数据后会换成整副手把手强制引导。
          </p>
        </div>
      {:else}
        <GuideBoard
          {deal}
          segment={step.segment}
          startAt={current === index.indexOf.get(step.id) ? dealAction : null}
          onprogress={onDealProgress}
          ondone={onStepPassed}
        />
      {/if}
    {:else if step.kind === 'review'}
      {@const deal = dealOf(step.slug)}
      {#if deal === null}
        <div class="space-y-2" data-guide-pending>
          <h2 class="text-sm font-bold text-ivory">{step.title}</h2>
          <p class="text-[12px] leading-relaxed text-white/60">{step.pending ?? '这一副引导局还没接上数据。'}</p>
        </div>
      {:else}
        <GuideReview {deal} />
      {/if}
    {:else}
      <div class="space-y-3" data-guide-end>
        <h2 class="text-base font-bold text-ivory">{step.title}</h2>
        <p class="text-[13px] leading-relaxed text-white/70">
          你已经把四副真实牌局打了一遍：竞叫之后让给他打、十一张主牌坐庄、无主局把 30 分埋进底、盯住庄家的主牌等它打光。
          叫牌怎么算账、埋底埋什么、跟牌为什么结构优先、末轮怎么保底抠底，你都亲手摸过一遍了。
          接下来轮到你自己的牌局 —— 拉上两个牌友（或先加个机器人陪练），开一桌真打。
        </p>
        <ul class="space-y-1 text-[12px] text-white/60">
          <li>· 开桌、加入、离座与补位都在大厅里；牌桌左下角的「?」按阶段给即时说明。</li>
          <li>· 想查某一条规则，去 <a class="text-gold underline" href="/rules">文字教程</a>，那里可以搜索、可以跳转。</li>
          <li>· 随时可以回到 <a class="text-gold underline" href="/learn">新手引导</a>；左侧章节菜单能直接跳到任意一步。</li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <a class="rounded-lg bg-gold/20 px-4 py-2 text-xs font-semibold text-gold ring-1 ring-gold/40" href="/">
            回大厅开一桌 →
          </a>
          <a class="rounded-lg px-4 py-2 text-xs text-white/70 ring-1 ring-white/15 hover:bg-white/10" href="/rules">
            查文字教程
          </a>
        </div>
      </div>
    {/if}
  </div>

  <footer class="mt-3 flex flex-wrap items-center justify-between gap-2 pb-2">
    <button type="button" class={ghost} disabled={current === 0} onclick={() => go(current - 1)}>← 上一步</button>
    <span class="text-[10px] text-white/35">
      {#if gated && !alreadyPassed}
        {step.kind === 'quiz' ? '答对才能继续' : '把这一段打完才能继续'}
      {:else}
        ← → 翻步 · 深度链接 {`?s=${step.id}`}
      {/if}
      {#if saved !== null && saved.index > current}· 已读到第 {saved.index + 1} 步{/if}
    </span>
    <button type="button" class={ghost} disabled={!canNext || current >= total - 1} onclick={() => go(current + 1)}>
      下一步 →
    </button>
  </footer>

  <p class="sr-only" aria-live="polite">
    第 {current + 1} 步，共 {total} 步：{chapter.title} · {step.title}
  </p>
</main>
