<script lang="ts">
  /**
   * 教练栏：引导局里**常驻**的那一条引导语（CONTEXT.md 的 **教练栏**）。
   *
   * 三块内容：一句话（为什么这么打）、可选的事实依据、右上角一枚目标小标（该叫什么 / 该出哪几张）。
   * 它是引导局唯一的「讲解面」—— 桌面本身只摆牌，不写说明。住**手牌正上方**
   * （由 `GuideBoard` 排版：贴着它讲的那几颗牌说，讲解面不垫底），所以底色与描边
   * 都比上一版加重一档 —— 教学桌面里它是最该被一眼看到的东西之一。
   * 引导词里的 `**粗体**` 走 `RichText`，星号不许原样上屏；目标小标带 `coach-glow`
   * 呼吸金圈（guide-v3.3）——「该点哪儿」不用找。
   */
  import RichText from './RichText.svelte';

  let {
    word,
    why = null,
    target = null,
    /** `wait`：等对手出牌（引导词已经给的是你**接下来**那一手） */
    waiting = false
  }: {
    word: string;
    why?: string | null;
    target?: string | null;
    waiting?: boolean;
  } = $props();
</script>

<div
  class="flex items-start gap-2.5 rounded-xl bg-gold/15 p-2.5 ring-1 ring-gold/40"
  data-coach
  aria-live="polite"
>
  <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-gold/20 text-gold" aria-hidden="true">
    <svg viewBox="0 0 24 24" class="size-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  </span>
  <div class="min-w-0 flex-1">
    <p class="text-[15px] font-semibold leading-relaxed text-ivory">
      <RichText text={word} />
      {#if waiting}
        <span class="text-white/45">（先读着，轮到你就照这个来）</span>
      {/if}
    </p>
    {#if why !== null && why.length > 0}
      <p class="mt-1 text-xs leading-relaxed text-white/50">
        <RichText text={why} />
      </p>
    {/if}
  </div>
  {#if target !== null && target.length > 0}
    <span
      class="coach-glow shrink-0 rounded-md bg-gold/15 px-2 py-1 text-xs font-semibold text-gold"
      data-coach-target
    >
      {target}
    </span>
  {/if}
</div>
