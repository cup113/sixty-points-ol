<script lang="ts">
  import type { ReplayResult } from '$lib/replays';
  import { contractText } from '$lib/labels';
  import ScoreEquation from './ScoreEquation.svelte';
  import VerdictBadge from './VerdictBadge.svelte';

  /**
   * 机器重演入口（ADR-0016）：一枚小按钮 + 展开体，战报逐副卡与结算弹窗共用。
   *
   * - 数据不自己拉：页面持有 `replays` 缓存与 `onOpen`（首次点开某副时整表拉一次，
   *   结果不可变，没有失效问题）；
   * - 展开体**复用结算那三件套**（`contractText` / `ScoreEquation` / `VerdictBadge`）——
   *   与逐副卡同一份标记，弹窗里读到的读法就是这里的读法，不做第二份实现；
   * - 展开体是**主卡的枝干**：一条竖向引导线 + 缩进，里面一律走那三件套的 `ghost` 档
   *   （字号与结论音量各降一档）、首行压成一枚 9px 徽章 + 一行小字。原来的展开体有与主卡
   *   同形的外壳（`bg-black/20` + `ring-1`）、算式与主卡同档、结论又是一枚同色实心胶囊，
   *   头行在弹窗里还按 16px 继承 —— 四项加起来与主胜负并列，喧宾夺主；
   * - 重演是自治的（含叫牌），定约/庄家可能与真实那副不同，所以头行要写重演自己的定约；
   * - 全 pass 是合法终态（约 5% 的副）：一句话交代；拉过之后没有记录的老副也一句话，
   *   不玩「按钮消失」——否则看起来像功能坏了。
   */
  let {
    dealNo,
    replays,
    onOpen,
    who,
    note = '这副没有机器重演记录'
  }: {
    dealNo: number;
    replays: Readonly<Record<number, ReplayResult>>;
    onOpen: (dealNo: number) => void;
    who: (seat: number) => string;
    /** 没有记录时的那句话：认赢结束的副说不出「剩下的牌逐张归谁」，要说清这条 */
    note?: string;
  } = $props();

  let open = $state(false);
  let requested = $state(false);
  const replay = $derived(replays[dealNo] ?? null);

  /** 每次展开都问一次：页面按「已有就不再拉」去重，于是失败的请求下次点开自然重试 */
  function toggle(): void {
    open = !open;
    if (open) {
      requested = true;
      onOpen(dealNo);
    }
  }
</script>

<button
  type="button"
  aria-expanded={open}
  class="mt-2 flex items-center gap-1 text-[11px] text-white/45 transition hover:text-white/75"
  onclick={toggle}
>
  机器重演 <span class="text-[9px] leading-none">{open ? '▴' : '▾'}</span>
</button>

{#if open}
  <!-- 枝干：左引导线 + 缩进，展开体因此读起来是这张卡的附属，而不是又一张同级卡 -->
  <div class="mt-1.5 ml-1 border-l border-white/20 pl-2.5">
    {#if replay === null}
      {#if requested}
        <p class="text-[11px] text-white/40">{note}</p>
      {:else}
        <p class="text-[11px] text-white/40">加载中…</p>
      {/if}
    {:else if replay.kind === 'all-pass'}
      <p class="text-[11px] text-white/45">机器人全 pass · 这副会被作废重发</p>
    {:else}
      <!-- 首行降权：9px 徽章 + 一行小字。定约必须写重演自己的 —— 它含叫牌，可能与真实那副不同 -->
      <p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-white/45">
        <span class="rounded border border-white/15 px-1 py-px font-mono text-[9px] leading-none"
          >重演</span
        >
        <span>定约 {contractText(replay.summary)}</span>
        <span class="text-white/25">·</span>
        <span>庄家 {who(replay.summary.contract.declarerSeat)}</span>
      </p>
      <div class="mt-2">
        <ScoreEquation summary={replay.summary} compact ghost />
      </div>
      <VerdictBadge summary={replay.summary} class="mt-2" ghost />
    {/if}
  </div>
{/if}
