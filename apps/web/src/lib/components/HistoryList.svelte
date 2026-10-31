<script lang="ts">
  import type { PublicView } from '@sixty/engine';
  import { SEATS } from '@sixty/engine';
  import { changedLevelRows, contractText, levelProgression, whoLabel } from '$lib/labels';
  import { REPORT_MODES, type ReportMode } from '$lib/drawer-tabs';
  import type { ReplayResult } from '$lib/replays';
  import LevelBadge from './LevelBadge.svelte';
  import LevelTable from './LevelTable.svelte';
  import ReplayPanel from './ReplayPanel.svelte';
  import ScoreEquation from './ScoreEquation.svelte';
  import VerdictBadge from './VerdictBadge.svelte';

  /**
   * 战报内容（抽屉「战报」页的正文），两种模式**页内**切换（见 `drawer-tabs.ts` 的 `REPORT_MODES`）：
   *
   * - `deals` 逐副：新 → 旧，每副一张卡 = 结算弹窗的紧凑版。算式、结论、升级行分别复用
   *   `ScoreEquation` / `VerdictBadge` / `LevelTable`（同一份标记，只有尺寸与列数不同），
   *   再加上 `contractText` 给的「定约 · 级牌」——旧副的级牌各不相同，只写定约读不出来。
   *   卡尾是 `ReplayPanel`（机器重演入口）：数据通道由页面持有（`replays` 缓存 +
   *   `onOpenReplay`），本组件不碰网络。
   * - `progress` 升级表：开局 → 最后一副，三家级别逐副累积（`levelProgression`），
   *   当副动了的格子亮、没动的淡显，纵着扫一列就是那个人的全程。**没有**重演入口 ——
   *   升级表说的是真实进度，重演是每副的对照。
   *
   * 逐副卡的升级**只列升级者**（`changedLevelRows`）：历史负载只记变动，没升级的座位当时
   * 是什么级别无从还原 —— 与弹窗三家全列有意不同。
   *
   * 它自己**没有**抽屉外壳与标题 —— 外壳、标题、关闭都在 `TableDrawer` 一处，
   * 否则每加一页就要复制一遍 `fixed / z-50 / ×` 那套（原来的战报就是自己一套外壳）。
   */
  let {
    view,
    mySeat = -1,
    names = [],
    mode = 'deals',
    onModeChange,
    replays = {},
    onOpenReplay
  }: {
    view: PublicView;
    /** 文案里的「我的座位」：观战者传 -1，于是都显示玩家名 */
    mySeat?: number;
    names?: readonly (string | null)[];
    /** 页内模式（由页面持有，抽屉关掉再开还停在上一次那一页） */
    mode?: ReportMode;
    onModeChange?: (mode: ReportMode) => void;
    /** 机器重演缓存（页面持有；按副号取，见 `ReplayPanel`） */
    replays?: Readonly<Record<number, ReplayResult>>;
    /** 首次点开某副的重演时拉全表（页面去重） */
    onOpenReplay?: (dealNo: number) => void;
  } = $props();

  const deals = $derived([...view.history].reverse());
  const who = (seat: number): string => whoLabel(names, mySeat, seat);

  /** 升级表：开局 → 第 N 副（`levelProgression` 返回的第一行就是开局） */
  const progression = $derived(levelProgression(view.history));

  /** 列模版：第一列是副号，后三列是三家 —— 表头与数据行共用这一份 */
  const PROG_COLS = 'grid grid-cols-[3.25rem_repeat(3,minmax(0,1fr))] items-center gap-x-1';
</script>

{#if deals.length === 0}
  <p class="text-white/45">还没有完成的牌局</p>
{:else}
  <!-- 页内分段切换：两枚小按钮，默认「逐副」（页面持有状态，纯手动，不随 SSE 变） -->
  <div class="mb-3 flex items-center gap-1 rounded-lg bg-black/30 p-1 ring-1 ring-white/10">
    {#each REPORT_MODES as tab (tab.key)}
      {@const on = mode === tab.key}
      <button
        type="button"
        aria-pressed={on}
        class="flex-1 rounded-md px-2 py-1 text-[11px] transition {on
          ? 'bg-gold font-bold text-ink'
          : 'text-white/60 hover:bg-white/10'}"
        onclick={() => onModeChange?.(tab.key)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if mode === 'progress'}
    <div class="space-y-1 text-xs">
      <div class="{PROG_COLS} px-2 text-[10px] text-white/45">
        <span>副</span>
        {#each SEATS as seat (seat)}
          <span class="truncate text-center">{who(seat)}</span>
        {/each}
      </div>
      {#each progression as row (row.dealNo)}
        <div class="{PROG_COLS} rounded-lg bg-white/5 px-2 py-1.5 ring-1 ring-white/10">
          <span class="text-white/45">{row.dealNo === 0 ? '开局' : `第 ${row.dealNo} 副`}</span>
          {#each SEATS as seat (seat)}
            <LevelBadge level={row.levels[seat]!} class={row.changed[seat] ? '' : 'opacity-40'} />
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    <div class="space-y-2 text-xs">
      {#each deals as deal (deal.dealNo)}
        <div class="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
          <p class="text-white/80">
            第 {deal.dealNo} 副 · {contractText(deal)} · 庄家 {who(deal.contract.declarerSeat)}
          </p>
          {#if deal.claim}
            <p class="mt-1 text-[11px] text-gold/80">
              认赢 · {who(deal.claim.seat)} 剩余全收 · 末轮 {deal.claim.lastTrick} 张
            </p>
          {/if}
          <div class="mt-3">
            <ScoreEquation summary={deal} compact />
          </div>
          <VerdictBadge summary={deal} class="mt-3" />
          {#if deal.levelChanges.length > 0}
            <div class="mt-2">
              <LevelTable rows={changedLevelRows(deal)} {who} />
            </div>
          {/if}
          <ReplayPanel
            dealNo={deal.dealNo}
            {replays}
            onOpen={(no) => onOpenReplay?.(no)}
            {who}
            note={deal.claim ? '认赢结束的副没有重演（剩下的牌没有逐张归属）' : undefined}
          />
        </div>
      {/each}
    </div>
  {/if}
{/if}
