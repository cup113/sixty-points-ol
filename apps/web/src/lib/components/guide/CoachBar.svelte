<script lang="ts">
  /**
   * 教练栏：引导局里**常驻**的那一条引导语（CONTEXT.md 的 **教练栏**）。
   *
   * 三块内容：一句话（为什么这么打）、可选的事实依据、右上角一枚目标小标（该叫什么 / 该出哪几张）。
   * 它是引导局唯一的「讲解面」—— 桌面本身只摆牌，不写说明。
   */
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
  class="flex items-start gap-2.5 rounded-xl bg-gold/10 p-2.5 ring-1 ring-gold/25"
  data-coach
  aria-live="polite"
>
  <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-gold/20 text-gold" aria-hidden="true">
    <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  </span>
  <div class="min-w-0 flex-1">
    <p class="text-[12px] leading-relaxed text-ivory">
      {word}
      {#if waiting}
        <span class="text-white/45">（对手出手时先读着，轮到你照这个来）</span>
      {/if}
    </p>
    {#if why !== null && why.length > 0}
      <p class="mt-1 text-[10px] leading-relaxed text-white/50">{why}</p>
    {/if}
  </div>
  {#if target !== null && target.length > 0}
    <span class="shrink-0 rounded-md bg-gold/15 px-2 py-1 text-[10px] font-semibold text-gold" data-coach-target>
      {target}
    </span>
  {/if}
</div>
