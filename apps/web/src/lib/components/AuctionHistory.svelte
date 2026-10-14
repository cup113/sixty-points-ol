<script lang="ts">
  import { highestBid, type BidEntry, type Seat } from '@sixty/engine';
  import { SPECTATOR_LABEL_SEAT } from '$lib/role';
  import { bidText, whoLabel } from '$lib/labels';

  /**
   * 叫牌历史：三列表格，列 = 三位玩家（列序从发牌人起 = 叫牌顺位），行 = 一轮。
   *
   * 为什么是表格而不是「昵称 + 叫品」的碎片流：碎片流一行塞得下几个人全看昵称长度
   * （2/3/4 个都可能），三家叫牌的对位关系反而看不出来；表格列宽固定、昵称超长就截断，
   * 一行读下来正好是这一轮三家的出声顺序。
   *
   * props 只取**结构切片**（`auction` + `dealerSeat`）：真桌传公共视图的 `view.deal`，
   * `/learn` 的引导局传引擎的 `DealState`——两边都天然满足这个形状，组件谁也不依赖。
   * 最高叫品由引擎的 `highestBid`（唯一实现）从叫牌史算出，不在这里写第二份。
   *
   * **不自带滚动区**：宿主（`BidPanel` / 引导局）自己管滚动，这里只做普通文档流。
   */
  let {
    deal,
    mySeat = SPECTATOR_LABEL_SEAT,
    names = []
  }: {
    /** 只读 `auction` 与 `dealerSeat` 两个字段；`null` = 还没发牌 */
    deal: { readonly auction: readonly BidEntry[]; readonly dealerSeat: Seat } | null;
    /** 文案里的「我的座位」：观战者传 -1，于是都显示玩家名 */
    mySeat?: number;
    names?: readonly (string | null)[];
  } = $props();

  /** 最高叫品：表格里那一格标金加粗，与信息面顶部的大字呼应 */
  const top = $derived(deal === null ? null : highestBid(deal.auction));

  /** 列序从发牌人起：一行读下来就是这一轮三家的出声顺序 */
  const cols = $derived([0, 1, 2].map((step) => ((deal?.dealerSeat ?? 0) + step) % 3));

  interface Cell {
    readonly seat: number;
    readonly text: string;
    readonly cls: string;
  }

  /** 叫牌严格按座位轮转（每家一轮各出手一次），所以每三条恰是一轮，放进各自座位列 */
  const rows = $derived.by((): readonly (readonly Cell[])[] => {
    const auction = deal?.auction ?? [];
    const out: Cell[][] = [];
    for (let i = 0; i < auction.length; i += 3) {
      const round = auction.slice(i, i + 3);
      out.push(
        cols.map((seat): Cell => {
          const entry = round.find((item) => item.seat === seat);
          if (entry === undefined) return { seat, text: '', cls: '' };
          const call = entry.call;
          const isTop =
            call !== 'pass' && top !== null && call.points === top.points && call.strain === top.strain;
          return {
            seat,
            text: bidText(call),
            cls: call === 'pass' ? 'text-white/40' : isTop ? 'font-semibold text-gold' : ''
          };
        })
      );
    }
    return out;
  });
</script>

<table class="mt-3 w-full table-fixed border-collapse text-[12px]">
  <thead>
    <tr class="text-white/45">
      {#each cols as seat (seat)}
        <th
          class="truncate px-1 pb-1 text-left text-[11px] font-medium"
          title={whoLabel(names, mySeat, seat)}
        >
          {whoLabel(names, mySeat, seat)}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as row, index (index)}
      <tr>
        {#each row as cell (cell.seat)}
          <td class={['px-1 py-0.5 tabular-nums', cell.cls]}>{cell.text}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
