<script lang="ts">
  import type { PublicView } from '@sixty/engine';
  import { SPECTATOR_LABEL_SEAT } from '$lib/role';
  import AuctionHistory from './AuctionHistory.svelte';
  import AuctionInfo from './AuctionInfo.svelte';

  /**
   * 叫牌记录：信息面 + 历史表，**毡面面板与抽屉共用这一份**。
   *
   * 两处渲染是故意的（见 CONTEXT.md 的 Flagged ambiguities）：叫牌阶段你正对着毡面操作，
   * 历史就在手边；打牌阶段才需要翻抽屉查「定约是多少、谁叫的」。一份组件两处渲染，
   * 不会出现两套叫牌记录各写一遍再各自过期。
   *
   * 毡面的 `BidPanel` **不**用这个组合件，而是分别用 `AuctionInfo` / `AuctionHistory` ——
   * 好在两者之间插进候选叫品档位，见那边的头部注释。
   *
   * 这里**只有记录与展示**：候选叫品按钮与「不叫」留在 `BidPanel`（动作面不进抽屉）。
   */
  let {
    view,
    mySeat = SPECTATOR_LABEL_SEAT,
    names = [],
    heading = true
  }: {
    view: PublicView;
    /** 文案里的「我的座位」：观战者传 -1，于是都显示玩家名 */
    mySeat?: number;
    names?: readonly (string | null)[];
    /** 抽屉里已有页签标题时不重复写一遍「叫牌」 */
    heading?: boolean;
  } = $props();
</script>

<AuctionInfo {view} {mySeat} {names} {heading} />
<AuctionHistory deal={view.deal} {mySeat} {names} />
