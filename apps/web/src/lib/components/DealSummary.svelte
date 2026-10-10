<script lang="ts">
  import type { TableClient } from '$lib/client/table.svelte';
  import { SPECTATOR_LABEL_SEAT } from '$lib/role';
  import { levelRows, strainGlyph, whoLabel } from '$lib/labels';
  import type { ReplayResult } from '$lib/replays';
  import LevelTable from './LevelTable.svelte';
  import ReplayPanel from './ReplayPanel.svelte';
  import ScoreEquation from './ScoreEquation.svelte';
  import VerdictBadge from './VerdictBadge.svelte';

  let {
    client,
    open = false,
    onClose,
    replays = {},
    onOpenReplay,
    nextDealReady = true
  }: {
    client: TableClient;
    open?: boolean;
    onClose?: () => void;
    /** 机器重演缓存与拉取通道（页面持有，与战报逐副卡同一条路，见 `ReplayPanel`） */
    replays?: Readonly<Record<number, ReplayResult>>;
    onOpenReplay?: (dealNo: number) => void;
    /**
     * 「下一副 / 开新对局」是否已解锁（结算三拍走完，ADR-0022）。
     *
     * 与操作条那一行的同名按钮**共用这一个锁**：跳过只推进自己看的进度，
     * 换副却是全桌的动作 —— 少了这把锁，一个跳得快的人在 ~0 秒就能开下一副，
     * 而别人可能还在看末墩，那一副的亮底牌就被切走了。
     */
    nextDealReady?: boolean;
  } = $props();

  const view = $derived(client.view);
  const summary = $derived(view?.deal?.summary ?? null);
  const finished = $derived(view?.status === 'finished');
  const spectating = $derived(client.you === null);
  const mySeat = $derived(client.you?.seat ?? SPECTATOR_LABEL_SEAT);
  const names = $derived((client.table?.seats ?? []).map((seat) => seat.name));
  const who = (seat: number): string => whoLabel(names, mySeat, seat);

  /** 升级表：三家都要出现（没动的那家写「不变」），升级的排前面 —— 见 labels.ts 的 levelRows */
  const rows = $derived(summary !== null && view !== null ? levelRows(summary, view.levels) : []);
</script>

{#if open && summary !== null && view !== null}
  <div
    data-deal-summary="true"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
  >
    <!-- 高度上限与自己的滚动区：结算内容高度不定（底牌牌面、级别表、对局结束块），
         没有上限时短屏上排在最后的「下一副 / 开新对局」会落到视口外，且无处可滚。 -->
    <div
      class="max-h-[92dvh] w-[24rem] max-w-[94vw] overflow-y-auto overscroll-contain rounded-2xl bg-felt-800 p-4 ring-1 ring-gold/30 sm:p-5"
    >
      <div class="flex items-start justify-between gap-2">
        <h2 class="text-base font-bold">
          本副结算
          <span class="ml-1 text-xs font-normal text-white/50">
            {summary.contract.points}{strainGlyph(summary.contract.strain)} · 庄家
            {who(summary.contract.declarerSeat)}
          </span>
        </h2>
        <button
          type="button"
          class="rounded-md px-2 text-lg leading-none text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="关闭"
          onclick={() => onClose?.()}>×</button
        >
      </div>

      <!-- 算式、结论、升级表三块都住在**共用组件**里 —— 战报的每副卡用的是同一份
           （`ScoreEquation` / `VerdictBadge` / `LevelTable`），两处的读法因此不可能各走各的。 -->
      <div class="mt-5">
        <ScoreEquation {summary} />
      </div>

      <VerdictBadge {summary} class="mt-4" />

      <div class="mt-3">
        <LevelTable {rows} {who} heading />
      </div>

      <!-- 机器重演（ADR-0016）：结算那一刻服务端已算好落库，这里点开只是取存档。
           展开体复用上面那三件套，弹窗与战报的读法一致。 -->
      <ReplayPanel dealNo={summary.dealNo} {replays} onOpen={(no) => onOpenReplay?.(no)} {who} />

      {#if finished && view.result}
        <div class="mt-3 rounded-lg border border-gold/50 bg-black/30 p-3">
          <h3 class="mb-1 text-sm font-semibold text-gold">
            对局结束 · 冠军 {who(view.result.ranking[0]!)}
          </h3>
          <ol class="space-y-0.5 text-xs text-white/80">
            {#each view.result.ranking as seat, index (seat)}
              <li>第 {index + 1} 名：{who(seat)}（总进度 {view.result.progress[seat]}）</li>
            {/each}
          </ol>
        </div>
      {/if}

      <div class="mt-4 flex items-center justify-end gap-2">
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-lg border border-white/20 px-4 py-1.5 text-xs text-white/70 hover:bg-white/10"
            onclick={() => onClose?.()}
          >
            看看桌面
          </button>
          {#if spectating}
            <span class="self-center text-xs text-white/45">观战中 · 下一副由在座玩家开</span>
          {:else if finished}
            <button
              type="button"
              class="rounded-lg bg-gold px-5 py-1.5 text-xs font-bold text-ink hover:brightness-110 disabled:opacity-40"
              disabled={client.busy || !nextDealReady}
              title={nextDealReady ? '开新对局' : '让末墩与底牌先亮完'}
              onclick={() => void client.newGame()}
            >
              开新对局
            </button>
          {:else}
            <button
              type="button"
              class="rounded-lg bg-gold px-5 py-1.5 text-xs font-bold text-ink hover:brightness-110 disabled:opacity-40"
              disabled={client.busy || !nextDealReady}
              title={nextDealReady ? '下一副' : '让末墩与底牌先亮完'}
              onclick={() => void client.deal()}
            >
              下一副
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
