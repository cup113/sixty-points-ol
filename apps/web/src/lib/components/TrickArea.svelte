<script lang="ts">
  import type { PublicView } from '@sixty/engine';
  import { lastCompletedTrick, trickSideBadge, whoLabel } from '$lib/labels';
  import TrickCluster from './TrickCluster.svelte';

  let {
    view,
    seat,
    mySeat = seat,
    names = []
  }: {
    view: PublicView;
    /** 布局锚点：玩家的座位（观战者用固定锚点，见 role.ts） */
    seat: number;
    /** 文案里的「我的座位」：观战者传 -1，于是所有座位都显示玩家名 */
    mySeat?: number;
    names?: readonly (string | null)[];
  } = $props();

  const deal = $derived(view.deal);
  const trump = $derived(deal?.trump ?? null);

  /** 我正在看的一墩：当前墩已有出牌就看当前，否则回看上一条已完成的墩 */
  const current = $derived(deal?.trick ?? null);
  // 「上一轮」只有一处定义（labels.ts）：bot 领出得再快，回看浮层读的也是同一份
  const previous = $derived(lastCompletedTrick(deal));
  const showingCurrent = $derived(current !== null && current.plays.length > 0);
  const plays = $derived(showingCurrent ? current!.plays : (previous?.plays ?? []));
  const winnerSeat = $derived(showingCurrent ? null : (previous?.winnerSeat ?? null));
  const trickPoints = $derived(showingCurrent ? 0 : (previous?.points ?? 0));
  const declarerSeat = $derived(deal?.declarerSeat ?? null);

  const leftSeat = $derived((seat + 1) % 3);
  const rightSeat = $derived((seat + 2) % 3);

  /**
   * 三家出牌点：**每点一个固定宽度预算的盒子**，位置上互相不可能相交（ADR-0020）。
   *
   * 早先三点是「左 `top-36` / 右 `top-56` / 我 `bottom-[20%]`」的错位布局，靠上下错开避免碰撞 ——
   * 但那只是把碰撞从窄屏挪到桌面端：桌面端左右两点**同一高度**，5 张起就开始叠
   * （5 张 = 5×56 + 4×6 = 304px，而两侧各从 24% 起，中段重叠约 26px；6 张重叠 150px）。
   * 而且错位本身并不好看（截图 #7：桌面端不错位、窄屏错位，两边观感不一致）。
   *
   * 现在：左右两点各占 **38%**，我这一点跨幅居中；同一高度即可，因为盒子已经各占各的宽度。
   * 三点加起来的宽度预算是 10 + 38 + 4 + 38 + 10 = 100% —— 这个加法就是「互不相交」的
   * 结构性保证（第一版写成 44 + 20 + 44 = 108%，实测两侧相交 8992px²）。
   *
   * **左右必须内缩同一个量**：两翼的中心于是落在 29% / 71%，中点正好在中线 50% 上，与
   * 「我」那一点、与状态条对齐。早先是 `left-0` + `right-[20%]`（中心 19% / 61%）——
   * 中点 40%，整组偏左 10%（窄屏实测 −31.2px），三家看起来是歪的。
   * 内缩 10% 同时让开右边缘常驻的活页签条（宽约 28px）：窄屏上它离毡面右缘 31.2px，
   * 减去毡面自身到屏幕的 24px 内边距，仍比 28px 的签条宽。
   *
   * 盒内放不下时由 `TrickCluster` 按紧凑比例收紧（见那里的 `computeClusterStep`）。
   */
  function spotOf(target: number): string {
    if (target === leftSeat) return 'left-[10%] w-[38%] top-0';
    if (target === rightSeat) return 'right-[10%] w-[38%] top-0';
    return 'inset-x-0 bottom-0';
  }
</script>

<!-- 首次领出前桌面是空的：不写任何提示，规则说明只在「?」弹层里。
     上一墩的金色徽标只报「这 N 分归庄方还是闲方」（`trickSideBadge`）——
     赢家是谁由牌堆上方那行玩家名说，徽标再重复一遍名字只是把字号浪费在已知信息上。

     `inset-0`：**整格归牌**。早先这里留 `top-11` 让开内容槽顶部那条阶段状态条，
     而状态条已经搬到毡面顶端那条常驻**信息须**上（ADR-0020 修订），于是这一让位不再需要 ——
     牌区因此拿回 44px（手机短屏上就是 5 张顺子那一墩拿得回的余量）。 -->
<div class="absolute inset-0">
  {#each plays as play (play.seat)}
    <!-- `data-trick-spot` 是测量钩子：每点一个固定宽度预算，于是两簇在结构上不可能相交
         （实测断言在 scripts/shot-auction.ts）。 -->
    <div data-trick-spot={play.seat} class={`absolute ${spotOf(play.seat)}`}>
      <TrickCluster
        cards={play.cards}
        {trump}
        caption={whoLabel(names, mySeat, play.seat)}
        badge={winnerSeat === play.seat ? trickSideBadge(declarerSeat, play.seat, trickPoints) : null}
      />
    </div>
  {/each}
</div>
