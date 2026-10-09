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
   * 现在：左右两点各占 **38%**（中间留 24% 的空带），我这一点跨幅居中；同一高度即可，
   * 因为盒子已经各占各的宽度。三点加起来的宽度预算是 38 + 24 + 38 = 100% —— 这个加法就是
   * 「互不相交」的结构性保证（第一版写成 44 + 20 + 44 = 108%，实测两侧相交 8992px²）。
   * 右侧仍留 `right-[20%]` 让开右边缘常驻的活页签条（宽约 28px）。
   * 盒内放不下时由 `TrickCluster` 按可读下限紧凑（见那里的 `computeClusterStep`）。
   */
  function spotOf(target: number): string {
    if (target === leftSeat) return 'left-0 w-[38%] top-0';
    if (target === rightSeat) return 'right-[20%] w-[38%] top-0';
    return 'inset-x-0 bottom-0';
  }
</script>

<!-- 首次领出前桌面是空的：不写任何提示，规则说明只在「?」弹层里。
     上一墩的金色徽标只报「这 N 分归庄方还是闲方」（`trickSideBadge`）——
     赢家是谁由牌堆上方那行玩家名说，徽标再重复一遍名字只是把字号浪费在已知信息上。

     `top-11`：让开内容槽顶部那条阶段状态条（定约 / 庄已抓 / 轮次）——三者同处内容槽，
     状态条按正常文档流占最上面一行，出牌区从它下面开始。 -->
<div class="absolute inset-x-0 top-11 bottom-0">
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
