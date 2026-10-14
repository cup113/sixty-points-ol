<script lang="ts">
  /**
   * 新手引导（ADR-0025）：`/learn` 是一出**五幕剧**（guide-v3）—— 概念跟着牌走，
   * 讲解与它的测验**同屏**，每道门一口气就能过完。
   *
   * 五件事在这里：
   * 1. **深链**：`?s=<step-id>` 服务端就算得出来（`+page.ts`），分享出去的链接直接落在那一步；
   *    翻页时用 `history.replaceState` 同步地址。两代重组（guide-v2 并屏、guide-v3 分幕）吸收的
   *    全部旧步 id 经 `GUIDE_ALIASES` 落到内容对应的那一屏。
   * 2. **续读**：最远到达的步与引导局里的动作下标存 localStorage，没有 `?s=` 时接着上次读。
   * 3. **门槛**：测验全组答对、引导局打完，才放行（`QuizCard` 管判分，这里只认 done）。
   *    门槛句写在 CTA 位、口吻是教练的：「不急 —— 答对就翻页」；过门那一刻把 CTA 滚进视野，
   *    「下一步在哪」不用找。
   * 4. **引导局接线**：把 `GuideBoard` 的进展写回续读位置；打完亮一行「✓ 这一段打完了」。
   * 5. **课程地图**：页头的「课程地图」摊开五幕全程 —— 状态点标出走过 / 在看 / 没到，
   *    旅程一眼可见，不再是一个章节下拉框。
   *
   * 导航的形状：可前进时内容底部是金色主按钮「下一节 · <标题> →」（按钮自己预告去哪）；
   * 键盘 ←/→ 照旧可用，但不写出来（那是开发者的语言）。
   */
  import { onMount, untrack } from 'svelte';
  import BriefCard from '$lib/components/guide/BriefCard.svelte';
  import GuideBoard from '$lib/components/guide/GuideBoard.svelte';
  import GuideReview from '$lib/components/guide/GuideReview.svelte';
  import QuizCard from '$lib/components/guide/QuizCard.svelte';
  import { COURSE, GUIDE_ALIASES } from '$lib/guide/course';
  import { dealOf } from '$lib/guide/deals/index';
  import { indexCourse, type CourseStep } from '$lib/guide/types';

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

  /** 定位一步：直接命中，或是两代重组吸收掉的旧步 id（别名表里查它去了哪） */
  function locate(stepId: string): number {
    const direct = index.indexOf.get(stepId);
    if (direct !== undefined) return direct;
    const aliased = GUIDE_ALIASES.get(stepId);
    return aliased === undefined ? 0 : (index.indexOf.get(aliased) ?? 0);
  }

  /** 起始步：优先 `?s=`（服务端算得出，分享链接直接落位），否则第一步；续读在 onMount 里接上 */
  let current = $state(untrack(() => Math.max(0, locate(data.step))));
  let far = $state(untrack(() => current));
  let mapOpen = $state(false);
  /** 已答对的测验组（组下标集合）：全部组过了这一步才算过 */
  let quizPassed = $state<ReadonlySet<number>>(new Set());
  /** 引导局那一步打完没有（打完才放行下一步） */
  let dealDone = $state(false);
  let dealAction = $state<number | null>(null);
  let ctaEl = $state<HTMLDivElement | null>(null);

  const step = $derived(index.steps[current]!);
  const chapter = $derived(index.chapterOf.get(step.id)!);
  const actNo = $derived(course.chapters.indexOf(chapter) + 1);
  const progress = $derived(total <= 1 ? 100 : Math.round(((current + 1) / total) * 100));
  /** 这一步自带的测验组（只有 brief 有；没有就是空数组 = 无门槛） */
  const quizGroups = $derived(step.kind === 'brief' ? (step.quiz ?? []) : []);
  const quizComplete = $derived(quizPassed.size >= quizGroups.length);
  /** 测验与引导局必须当场过掉才放行；其他步随时可往下走 */
  const gated = $derived(
    (quizGroups.length > 0 && !quizComplete) || (step.kind === 'deal' && !dealDone)
  );
  const alreadyPassed = $derived(current < far);
  const canNext = $derived(!gated || alreadyPassed);
  const nextStep = $derived(current + 1 < total ? index.steps[current + 1]! : null);

  function persist(next: number, action: number | null): void {
    try {
      const payload: Saved = { v: course.id, index: next, step: index.steps[next]?.id ?? '', action };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 隐私模式里写不进去就算了：续读是锦上添花，不能因此挡住课程
    }
  }

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (clamped === current) return;
    current = clamped;
    quizPassed = new Set();
    dealDone = false;
    dealAction = null;
    if (clamped > far) {
      far = clamped;
      persist(clamped, null);
    }
    // 翻页的明确提示：新的一屏从顶上开始读，而不是停在上一屏滚到的位置
    window.scrollTo({ top: 0 });
  }

  /** 过门那一刻：把 CTA 滚进视野 —— 「下一步在哪」不用找（只在用户动作后调用，SSR 安全） */
  function scrollToCta(): void {
    ctaEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** 某一测验组答对：记下；全部组过、或引导局打完，才记录进展并允许往下走 */
  function onQuizGroupDone(group: number): void {
    quizPassed = new Set(quizPassed).add(group);
    if (quizPassed.size >= quizGroups.length) {
      onStepPassed();
      scrollToCta();
    }
  }

  function onStepPassed(): void {
    const next = Math.min(total - 1, current + 1);
    if (next > far) {
      far = next;
      persist(next, null);
    }
  }

  /** 引导局打完：记进展 + 亮「这一段打完了」（GuideBoard 段界到达时回调） */
  function onDealDone(): void {
    dealDone = true;
    onStepPassed();
  }

  function onDealProgress(action: number): void {
    dealAction = action;
    if (current >= far) persist(current, action);
  }

  onMount(() => {
    const saved = readSaved();
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
      quizPassed = new Set(quizGroups.map((_, group) => group));
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
      if (event.key === 'Escape') mapOpen = false;
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
        mapOpen = false;
        break;
      default:
        break;
    }
  }

  /** 课程地图上每一步的小记号：这屏是读、是试、是打、还是复盘 */
  function markOf(item: CourseStep): string {
    switch (item.kind) {
      case 'brief':
        return item.quiz !== undefined && item.quiz.length > 0 ? '读 · 试' : '读';
      case 'deal':
        return '打';
      case 'review':
        return '盘';
      default:
        return '终';
    }
  }

  const ghost =
    'rounded-lg px-3 py-1.5 text-xs text-white/70 ring-1 ring-white/15 transition hover:bg-white/10 disabled:opacity-30';
</script>

<svelte:window onkeydown={onKeydown} />

<main class="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-3 py-4 sm:px-6">
  <header class="flex flex-wrap items-center gap-2">
    <a class="text-xs text-white/50 hover:text-white" href="/">← 大厅</a>
    <a class="text-xs text-white/50 hover:text-white" href="/rules">文字教程</a>
    <div class="ml-auto flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-white/45">
        第 <b class="text-gold/80">{actNo}</b> 幕 · {chapter.title}
      </span>
      <button type="button" class={ghost} onclick={() => (mapOpen = !mapOpen)} aria-expanded={mapOpen}>
        课程地图 ▾
      </button>
    </div>
  </header>

  <div class="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
    <div class="h-full bg-gold transition-all" style={`width:${progress}%`}></div>
  </div>

  <!-- 课程地图：五幕全程摊开 —— 状态点（走过 / 在看 / 没到）+ 每步的小记号（读 / 打 / 盘） -->
  {#if mapOpen}
    <nav class="mt-3 space-y-2.5 rounded-2xl bg-black/40 p-3 ring-1 ring-white/10" aria-label="课程地图" data-guide-map>
      {#each course.chapters as act, actIndex (act.id)}
        <div>
          <p class="flex flex-wrap items-baseline gap-1.5 px-1 pb-1 text-[11px] text-white/45">
            <b class="text-gold/80">第 {actIndex + 1} 幕</b>
            <b class="text-ivory">{act.title}</b>
            <span class="min-w-0 truncate">· {act.blurb}</span>
          </p>
          <div class="grid gap-0.5">
            {#each act.steps as item (item.id)}
              {@const at = index.indexOf.get(item.id) ?? 0}
              <button
                type="button"
                class={[
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-white/10',
                  at === current ? 'bg-white/10' : ''
                ]}
                onclick={() => {
                  go(at);
                  mapOpen = false;
                }}
              >
                <span
                  class={[
                    'size-1.5 shrink-0 rounded-full',
                    at === current ? 'bg-gold ring-2 ring-gold/40' : at < far ? 'bg-gold/50' : 'bg-white/15'
                  ]}
                  aria-hidden="true"
                ></span>
                <span class="shrink-0 text-[10px] tabular-nums text-white/35">{markOf(item)}</span>
                <span class="min-w-0 flex-1 truncate text-[12px] text-ivory">{item.title}</span>
                {#if at === current}<span class="shrink-0 text-[10px] text-gold">在这屏</span>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </nav>
  {/if}

  <div class="mt-3 min-h-0 flex-1 rounded-2xl bg-black/25 p-3 ring-1 ring-white/10 sm:p-4">
    <!-- 一步 = 一屏 = 一份新状态：Svelte 会在**同一条 {#if} 链的同一分支上复用组件实例**，
          于是连着两步都是测验时 `QuizCard` 的题号会从上一屏漏过来（第二屏只有一题、题号却还停在
          上一屏的第四题 → 越界取题 → `question.cards` 抛错，整页从此不再刷新）；
          连着两步都是引导局时 `GuideBoard` 的快照同理。`{#key step.id}` 把这条边界钉死。 -->
    {#key step.id}
      {#if step.kind === 'brief'}
        <div class="space-y-4">
          <BriefCard title={step.title} points={step.points} widget={step.widget} />
          {#each quizGroups as group, groupIndex (group.title)}
            <QuizCard
              title={group.title}
              questions={group.questions}
              onDone={() => onQuizGroupDone(groupIndex)}
            />
          {/each}
        </div>
      {:else if step.kind === 'deal'}
        {@const deal = dealOf(step.slug)}
        {#if deal === null}
          <div class="space-y-2" data-guide-pending>
            <h2 class="text-sm font-bold text-ivory">{step.title}</h2>
            <p class="text-sm leading-relaxed text-white/60">{step.pending ?? '这一副引导局还没接上数据。'}</p>
          </div>
        {:else}
          <GuideBoard
            {deal}
            segment={step.segment}
            startAt={current === index.indexOf.get(step.id) ? dealAction : null}
            onprogress={onDealProgress}
            ondone={onDealDone}
          />
        {/if}
      {:else if step.kind === 'review'}
        {@const deal = dealOf(step.slug)}
        {#if deal === null}
          <div class="space-y-2" data-guide-pending>
            <h2 class="text-sm font-bold text-ivory">{step.title}</h2>
            <p class="text-sm leading-relaxed text-white/60">{step.pending ?? '这一副引导局还没接上数据。'}</p>
          </div>
        {:else}
          <GuideReview {deal} />
        {/if}
      {:else}
        <!-- 毕业屏：四副真牌的成绩单 + 开桌去。链接给全，但不堆砌。 -->
        <div class="space-y-3" data-guide-end>
          <h2 class="text-lg font-bold text-ivory">毕业了 —— 桌子在你手上</h2>
          <p class="text-sm leading-relaxed text-white/70">
            四副真牌打完：跟教练抢过分，也独挑过大梁；叫牌、埋底、跟牌、保底抠底，每一条都是亲手摸过的。
          </p>
          <ul class="grid gap-1.5 text-sm text-white/60 sm:grid-cols-2">
            <li class="rounded-xl bg-black/30 px-3 py-2">第一副 · 当闲家 —— 竞叫之后让给他打</li>
            <li class="rounded-xl bg-black/30 px-3 py-2">第二副 · 当庄家 —— 十一张主牌坐庄</li>
            <li class="rounded-xl bg-black/30 px-3 py-2">第三副 · 再坐庄 —— 无主局把 30 分埋进底</li>
            <li class="rounded-xl bg-black/30 px-3 py-2">第四副 · 当闲家 —— 盯住庄家的主牌等它打光</li>
          </ul>
          <p class="text-sm leading-relaxed text-white/70">
            拉上牌友、或加个机器人陪练，开一桌真打。
          </p>
          <div class="flex flex-wrap gap-2">
            <a class="rounded-lg bg-gold/20 px-4 py-2 text-sm font-semibold text-gold ring-1 ring-gold/40" href="/">
              回大厅开一桌 →
            </a>
            <a class="rounded-lg px-4 py-2 text-sm text-white/70 ring-1 ring-white/15 hover:bg-white/10" href="/rules">
              查文字教程
            </a>
            <button type="button" class="rounded-lg px-4 py-2 text-sm text-white/70 ring-1 ring-white/15 hover:bg-white/10" onclick={() => go(0)}>
              从头再看一遍
            </button>
          </div>
        </div>
      {/if}
    {/key}

    <!-- 主 CTA：可前进时是「下一节 · <标题>」（按钮自己预告去哪）；被门槛卡住时同一位置说原因，
         口吻是教练的。引导局打完先亮一行「这一段打完了」再给按钮。 -->
    {#if step.kind !== 'end'}
      <div class="mt-4 flex flex-col items-center gap-1.5 border-t border-white/10 pt-3" data-guide-cta bind:this={ctaEl}>
        {#if step.kind === 'deal' && dealDone}
          <p class="text-sm font-semibold text-emerald-300" data-guide-passed>✓ 这一段打完了</p>
        {/if}
        {#if canNext && nextStep !== null}
          <button
            type="button"
            class="rounded-lg bg-gold/20 px-5 py-2 text-sm font-semibold text-gold ring-1 ring-gold/40 transition hover:bg-gold/30"
            onclick={() => go(current + 1)}
          >
            下一节 · {nextStep.title} →
          </button>
        {:else if gated && !alreadyPassed}
          <p class="text-xs text-white/50" data-guide-gate>
            {step.kind === 'deal' ? '跟着教练把这副打完，就能继续' : '不急 —— 把上面的小题答对，就翻下一页'}
          </p>
        {/if}
      </div>
    {/if}
  </div>

  <footer class="mt-3 flex flex-wrap items-center justify-between gap-2 pb-2">
    <button type="button" class={ghost} disabled={current === 0} onclick={() => go(current - 1)}>← 上一步</button>
    <button type="button" class={ghost} disabled={!canNext || current >= total - 1} onclick={() => go(current + 1)}>
      下一步 →
    </button>
  </footer>

  <p class="sr-only" aria-live="polite">
    第 {current + 1} 步，共 {total} 步：第 {actNo} 幕 {chapter.title} · {step.title}
  </p>
</main>
