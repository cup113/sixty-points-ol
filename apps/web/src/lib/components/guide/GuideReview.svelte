<script lang="ts">
  /**
   * 复盘屏（大纲里每一副引导局的收尾）：**三家全亮** + 结算 + 逐墩回看。
   *
   * 与打牌过程的可见性对照（CONTEXT.md 的 **引导局**）：过程只见自己的手牌，
   * 到这里才把三家的发牌手牌、埋下的底牌、每一墩谁赢多少分一起摊开——
   * 「揭底」只在这一屏发生，所以过程里的推理与记牌仍然成立。
   */
  import CardRow from '$lib/components/CardRow.svelte';
  import ScoreEquation from '$lib/components/ScoreEquation.svelte';
  import LevelTable from '$lib/components/LevelTable.svelte';
  import TrickCluster from '$lib/components/TrickCluster.svelte';
  import VerdictBadge from '$lib/components/VerdictBadge.svelte';
  import { levelRows, strainGlyph, trickSideBadge, trumpText } from '$lib/labels';
  import { handFromKeys, replayGuide } from '$lib/guide/replay';
  import type { GuideDealData } from '$lib/guide/types';

  let { deal }: { deal: GuideDealData } = $props();

  const replay = $derived(replayGuide(deal));
  const summary = $derived(deal.expect);
  const trump = $derived({
    strain: summary.contract.strain,
    rank: deal.facts.levels[summary.contract.declarerSeat]!.rank
  });
  const hands = $derived(deal.facts.hands.map((hand) => handFromKeys(hand)));
  /** 结算摘要里的底牌本身就是牌对象（`DealSummary.kitty`），不必再解牌键 */
  const kitty = $derived(summary.kitty);
  const contractLabel = $derived(`${summary.contract.points}${strainGlyph(summary.contract.strain)}`);
  const tricks = $derived(replay.tricks);

  function nameOf(seat: number): string {
    return deal.aliases[seat] ?? `座位 ${seat}`;
  }
</script>

<section class="space-y-3" data-guide-review>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-sm font-bold text-ivory">{deal.title} · 复盘</h2>
    <span class="text-[10px] text-white/45">
      {contractLabel} 定约 · {nameOf(summary.contract.declarerSeat)} 坐庄 · 本副：{trumpText(trump)}
    </span>
  </div>

  <p class="text-[12px] leading-relaxed text-white/75">{deal.review.intro}</p>

  <div class="grid gap-2 sm:grid-cols-3">
    {#each hands as hand, seat (seat)}
      <div class="rounded-xl bg-black/30 p-2.5">
        <p class="mb-1.5 text-[11px] text-white/60">
          <b class="text-ivory">{nameOf(seat)}</b>
          · {seat === summary.contract.declarerSeat ? '庄家' : '闲家'}
          · 发牌时 {hand.length} 张
        </p>
        <CardRow cards={hand} {trump} size="sm" gap="gap-1" />
      </div>
    {/each}
  </div>

  <div class="rounded-xl bg-black/30 p-2.5">
    <p class="mb-1.5 text-[11px] text-white/60">
      埋下的底牌 <b class="text-ivory">{kitty.length}</b> 张（结算时按保底 / 抠底 × 末轮张数进出庄家的账）
    </p>
    <CardRow cards={kitty} {trump} size="md" />
  </div>

  <div class="space-y-2 rounded-xl bg-black/30 p-3">
    <VerdictBadge {summary} />
    <ScoreEquation {summary} compact />
    <LevelTable rows={levelRows(summary, deal.facts.levels)} who={nameOf} heading />
  </div>

  <div class="space-y-2">
    <p class="text-[11px] text-white/50">逐墩回看（这一副 {tricks.length} 墩）</p>
    <div class="max-h-[24rem] space-y-2 overflow-y-auto overscroll-contain pr-1">
      {#each tricks as trick (trick.ordinal)}
        <div class="rounded-xl bg-black/25 p-2.5">
          <p class="text-[11px] text-white/60">
            第 {trick.ordinal + 1} 墩 · <b class="text-ivory">{nameOf(trick.winnerSeat)}</b> 赢
            <span class="text-gold">{trickSideBadge(summary.contract.declarerSeat, trick.winnerSeat, trick.points)}</span>
          </p>
          <div class="mt-1.5 flex flex-wrap items-end gap-3">
            {#each trick.plays as play (play.seat)}
              <TrickCluster cards={play.cards} {trump} caption={nameOf(play.seat)} />
            {/each}
          </div>
          {#if deal.review.tricks?.[String(trick.ordinal)] !== undefined}
            <p class="mt-1.5 text-[11px] leading-relaxed text-gold/85">{deal.review.tricks[String(trick.ordinal)]}</p>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <p class="text-[12px] leading-relaxed text-white/75">{deal.review.outro}</p>
</section>
