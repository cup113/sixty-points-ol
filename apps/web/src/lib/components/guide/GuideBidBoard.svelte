<script lang="ts">
  /**
   * 引导局里的叫牌盘：一格格把**整个叫牌空间**摆出来，而不是只给「最便宜的两档」。
   *
   * 与真桌 `BidPanel` 的分工：那边是给熟练玩家用的（默认只摆非跳叫档、跳叫要展开），
   * 这里是**教学**用的 —— 引导叫牌时学员要看见「比当前叫品大的每一格」，
   * 于是「分数为主序、花色为次序」这条规则是看出来的，不是背的。
   *
   * 五槽恒定位（`♣ ♦ ♥ ♠ NT` 的顺序永不变）+ 无主写 `NT`，与 CONTEXT.md 的 **叫品显示** 同一套。
   */
  import { STRAINS, validateCall, type Bid, type BidCall, type Strain } from '@sixty/engine';
  import { callText, strainGlyph } from '$lib/labels';

  let {
    highest,
    target,
    onpick
  }: {
    highest: Bid | null;
    /** 这一步引导词指定的叫品（含 `'pass'`） */
    target: BidCall;
    onpick: (call: BidCall) => void;
  } = $props();

  /** 行：从「当前叫品低一档」摆到比它高两档 —— 低了看得见「必须更高」，高了看得见空间 */
  const base = $derived(highest === null ? 40 : highest.points);
  const rows = $derived.by(() => {
    const start = Math.max(40, base - 5);
    const end = base + 10;
    const out: number[] = [];
    for (let points = start; points <= end; points += 5) out.push(points);
    return out;
  });

  function state(points: number, strain: Strain): 'guided' | 'current' | 'legal' | 'illegal' {
    const call = { points, strain };
    if (highest !== null && highest.points === points && highest.strain === strain) return 'current';
    if (validateCall(call, highest) !== null) return 'illegal';
    if (target !== 'pass' && target.points === points && target.strain === strain) return 'guided';
    return 'legal';
  }

  const passGuided = $derived(target === 'pass');
</script>

<div class="rounded-xl bg-black/30 p-2.5" data-bid-board>
  <div class="flex items-center justify-between gap-2">
    <p class="text-[10px] text-white/50">
      当前叫品:{highest === null ? '还没人叫' : `　${callText(highest)}`}
    </p>
    <button
      type="button"
      class={[
        'rounded-lg px-3 py-1 text-[11px] font-semibold ring-1 transition',
        passGuided
          ? 'bg-gold/20 text-gold ring-gold/50'
          : 'text-white/60 ring-white/15 hover:bg-white/10'
      ]}
      onclick={() => onpick('pass')}
    >
      不叫
    </button>
  </div>

  <div class="mt-2 space-y-1">
    {#each rows as points (points)}
      <div class="grid grid-cols-[2.6rem_repeat(5,minmax(0,1fr))] items-center gap-1">
        <span class="text-[11px] tabular-nums text-white/45">{points}</span>
        {#each STRAINS as strain (strain)}
          {@const tone = state(points, strain)}
          <button
            type="button"
            class={[
              'rounded-md py-1 text-[12px] font-semibold ring-1 transition',
              tone === 'guided' && 'bg-gold/20 text-gold ring-gold/50',
              tone === 'current' && 'bg-white/10 text-white/50 ring-white/20',
              tone === 'legal' && 'text-ivory ring-white/15 hover:bg-white/10',
              tone === 'illegal' && 'text-white/25 ring-white/10 hover:bg-white/5'
            ]}
            data-bid-cell={`${points}-${strain.toLowerCase()}`}
            data-bid-tone={tone}
            aria-label={`${points}${strain === 'NT' ? 'NT' : strainGlyph(strain)}`}
            onclick={() => onpick({ points, strain })}
          >
            {strainGlyph(strain)}
          </button>
        {/each}
      </div>
    {/each}
  </div>

  <p class="mt-2 text-[10px] leading-relaxed text-white/45">
    分数为主序、花色为次序：同一分数上 ♣ &lt; ♦ &lt; ♥ &lt; ♠ &lt; NT。灰格也点得，点了会告诉你它为什么叫不出口。
  </p>
</div>
