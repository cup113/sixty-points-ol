<script lang="ts">
  import type { PublicView } from '@sixty/engine';
  import { lastCompletedTrick, trickSideBadge, whoLabel } from '$lib/labels';
  import { spotBox } from '$lib/fan-layout';
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
   * 三家出牌点：**每点一个宽度预算的盒子**，位置上互相不可能相交（ADR-0020 及修订）。
   *
   * 早先三点是「左 `top-36` / 右 `top-56` / 我 `bottom-[20%]`」的错位布局，靠上下错开避免碰撞 ——
   * 但那只是把碰撞从窄屏挪到桌面端：桌面端左右两点**同一高度**，5 张起就开始叠
   * （5 张 = 5×56 + 4×6 = 304px，而两侧各从 24% 起，中段重叠约 26px；6 张重叠 150px）。
   * 而且错位本身并不好看（截图 #7：桌面端不错位、窄屏错位，两边观感不一致）。
   *
   * 现在：左右两点各占一个百分比宽度、**内侧边缘钉在 48% / 52%**，我这一点跨幅居中；
   * 同一高度即可，因为盒子已经各占各的宽度。`2 × inset + 2 × width + 4 = 100`
   * 这个加法就是「互不相交」的结构性保证（第一版写成 44 + 20 + 44 = 108%，实测两侧相交 8992px²）。
   *
   * **宽度按张数自适应**（`spotBox`）：宽度是这一簇唯一的可支配资源，而需要多少只由张数决定 ——
   * 一张牌 30%、五张 38%（实测锚点）、八张及以上 44%（上限）。两侧取**同一个值**
   * （两家张数的较大者），否则两翼的中点会偏出中线。
   *
   * **内缩同时保证让开右边缘那条活页签条**（宽约 28px）：宽度 38% 时内缩 10%，
   * 窄屏上它离毡面右缘 31.2px，减去毡面自身到屏幕的 24px 内边距，仍比 28px 的签条宽；
   * 宽度顶到 44% 时内缩 4%（320px 上约 11px，右缘 285px vs 签条 292px，仍不相撞）。
   *
   * 盒内放不下时由 `TrickCluster` 按紧凑比例收紧（见那里的 `computeClusterStep`）。
   */
  const wingCount = $derived.by(() => {
    const counts = plays.filter((play) => play.seat !== seat).map((play) => play.cards.length);
    return counts.length === 0 ? 1 : Math.max(...counts);
  });
  const spot = $derived(spotBox(wingCount));
  const isWing = (target: number): boolean => target === leftSeat || target === rightSeat;

  function spotClass(target: number): string {
    return isWing(target) ? 'absolute top-0' : 'absolute inset-x-0 bottom-0';
  }

  /** 两翼的位置写成内联样式（宽度是个算出来的百分比，Tailwind 的 `w-[38%]` 表达不了） */
  function spotStyle(target: number): string | null {
    if (!isWing(target)) return null;
    const side = target === leftSeat ? 'left' : 'right';
    return `${side}:${spot.insetPct}%;width:${spot.widthPct}%;top:0`;
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
    <!-- `data-trick-spot` 是测量钩子：每点一个宽度预算，于是两簇在结构上不可能相交
         （实测断言在 scripts/shot-auction.ts）。两翼的宽度是**算出来的**（按张数），
         所以走内联样式；「我」那一点跨整幅、宽度不必算。 -->
    <div
      data-trick-spot={play.seat}
      class={spotClass(play.seat)}
      style={spotStyle(play.seat)}
    >
      <TrickCluster
        cards={play.cards}
        {trump}
        caption={whoLabel(names, mySeat, play.seat)}
        badge={winnerSeat === play.seat ? trickSideBadge(declarerSeat, play.seat, trickPoints) : null}
      />
    </div>
  {/each}
</div>
