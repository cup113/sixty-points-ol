<script lang="ts">
  import type { PublicView } from '@sixty/engine';
  import { endgameStandings, placeLabel, whoLabel } from '$lib/labels';
  import LevelBadge from './LevelBadge.svelte';

  /**
   * 对局结束那一块（本副结算弹窗的底部）。
   *
   * 三件事，一条也不许界面自己算：
   * - **名次**读引擎的 `result.places`（并列共享、下一名次跳号）。用 `result.ranking` 的
   *   下标当名次会把并列读成「第 2 名 / 第 3 名」—— 而两名闲家总是同拍升级，二三名并列是常态。
   * - **结束原因**读引擎的 `result.reason`（「有人冲到 2(+3)」），界面不去比阈值。
   * - **副数**取 `history.length`（打完的副），不是 `dealNo`（它还数着全 pass 作废重发的那些）。
   *
   * 级别复用座位卡那枚 `LevelBadge`：这一屏是三个人一起看的，徽标的读法必须与座位卡一致。
   * 名字走 `whoLabel`：本人写「你」；座位空着就如实写「空座」（级别属于座位，空座也能是冠军）。
   */
  let {
    view,
    mySeat = -1,
    names = []
  }: {
    view: PublicView;
    /** 文案里的「我的座位」：观战者传 -1，于是三行都显示玩家名 */
    mySeat?: number;
    names?: readonly (string | null)[];
  } = $props();

  const standing = $derived(endgameStandings(view));
  const who = (seat: number): string => whoLabel(names, mySeat, seat);
</script>

{#if standing !== null}
  <section data-endgame-card="true" class="mt-3 rounded-lg border border-gold/50 bg-black/30 p-3">
    <h3 class="text-sm font-semibold text-gold">对局结束</h3>
    <p class="mt-0.5 text-[11px] text-white/45">
      {standing.reasonText} · 打完 {standing.dealCount} 副
    </p>

    <!-- 名次 / 名字 / 级别徽标 / 一句结论：四列定宽（名次 1rem、结论 3.5rem），
         所以三行的徽标落在同一条竖线上，眼睛才比得动。 -->
    <ol class="mt-2 divide-y divide-white/10 overflow-hidden rounded-lg bg-black/25 ring-1 ring-white/10">
      {#each standing.rows as row (row.seat)}
        <li data-endgame-row={row.seat} class="flex items-center gap-2 px-2 py-1">
          <span
            class={[
              'w-4 shrink-0 text-xs font-extrabold tabular-nums',
              row.champion ? 'text-gold' : 'text-white/45'
            ]}>{placeLabel(row)}</span
          >
          <span class="min-w-0 flex-1 truncate text-xs {row.champion ? 'text-white' : 'text-white/80'}"
            >{who(row.seat)}</span
          >
          <LevelBadge level={row.level} />
          <span class="flex w-14 shrink-0 justify-end">
            {#if row.champion}
              <span class="rounded-full px-1.5 text-[10px] font-extrabold leading-4 text-gold ring-1 ring-gold/55"
                >冠军</span
              >
            {:else}
              <span class="text-[11px] tabular-nums text-white/40">差 {row.lag} 级</span>
            {/if}
          </span>
        </li>
      {/each}
    </ol>
  </section>
{/if}
