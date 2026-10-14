import { SEATS, type Card, type Seat } from './cards.ts';
import { bidOptions, type Bid, type BidOption } from './auction.ts';
import {
  auctionTurn,
  capturedPoints,
  highestBid,
  isDeclarerSide,
  playTurn,
  type BidEntry,
  type CompletedTrick,
  type Contract,
  type DealPhase,
  type DealSummary,
  type GameResult,
  type GameState,
  type Level,
  type TrickPlay
} from './state.ts';
import { levelProgress, type Trick } from './state.ts';
import type { TrumpModel } from './order.ts';
import { sortHand } from './order.ts';

/**
 * 公共牌局投影：**观战者也能看到的全部内容**。
 *
 * 这里出现的字段就是「公开」的定义本身，所以庄家私有的东西（例如拿上来的底牌）
 * 一律不放在这里 —— 观战者走的是同一个 builder（`publicDealOf`）。
 */
export interface PublicDealView {
  readonly phase: DealPhase;
  readonly dealNo: number;
  readonly dealerSeat: Seat;
  readonly auction: readonly BidEntry[];
  readonly highestBid: Bid | null;
  readonly auctionTurn: Seat;
  readonly contract: Contract | null;
  readonly trump: TrumpModel | null;
  readonly trick: Trick | null;
  readonly playTurn: Seat | null;
  readonly trickHistory: readonly CompletedTrick[];
  readonly captured: readonly { readonly seat: Seat; readonly points: number; readonly cards: readonly Card[] }[];
  readonly handCounts: readonly number[];
  readonly declarerSeat: Seat | null;
  readonly summary: DealSummary | null;
}

/**
 * 公共视图：不在座位上的人（观战者）能看到的全部内容。
 *
 * 与 **个人视图** 的差别只有一处 —— 没有 `you`（手牌、是否庄家、拿上来的底牌）。
 * 手牌与底牌从一开始就不在这个投影里，而不是在客户端被删掉（见 ADR-0002 / ADR-0007）。
 */
export interface PublicView {
  readonly version: number;
  readonly status: 'playing' | 'finished';
  readonly dealerSeat: Seat;
  readonly dealNo: number;
  readonly levels: readonly Level[];
  readonly progress: readonly number[];
  readonly result: GameResult | null;
  readonly history: readonly DealSummary[];
  readonly deal: PublicDealView | null;
}

/**
 * 玩家私有的一份信息：观战者没有 `you`（见 `role.ts` 的 `projectionFor`）。
 *
 * 两个字段都是**庄家自己的两批底牌**，即 `you` 里唯一的私有内容：
 *
 * - `originalKitty` = 发牌留下的 3 张暗牌（**拿上来的底牌**），只有庄家非 null。
 *   底牌本来就要并进庄家手牌（`state.ts` 的 bid 分支），所以这对庄家不是新信息 ——
 *   只是把「哪三张是拿上来的」显式说出来，否则 20 张排序后玩家再也认不出它们。
 * - `buriedKitty` = 他**埋下去的那 3 张**，埋底完成（play / scored）后才有值。
 *   那 3 张是他自己选的，所以同样不是新信息，而是「20 张里埋了哪 3 张」的回看；
 *   结算前公共视图与 `summary` 都没有它，闲家要到结算（`summary.kitty`）才看得到。
 *
 * 闲家两个字段恒为 null。放在 `you` 里而不是公共投影里，是为了让「庄家私有」这件事
 * 在类型上就成立：观战者连字段都没有。
 */
export interface PlayerSeat {
  readonly seat: Seat;
  readonly hand: readonly Card[];
  readonly isDeclarer: boolean;
  readonly originalKitty: readonly Card[] | null;
  readonly buriedKitty: readonly Card[] | null;
}

export interface PersonalView extends PublicView {
  readonly you: PlayerSeat;
}

/**
 * 服务器权威的公共视图：隐藏他人手牌与底牌（底牌只在结算后随 summary 公开）。
 */
export function publicView(state: GameState): PublicView {
  return {
    version: state.version,
    status: state.status,
    dealerSeat: state.dealerSeat,
    dealNo: state.dealNo,
    levels: state.levels,
    progress: state.levels.map(levelProgress),
    result: state.result,
    history: state.history,
    deal: publicDealOf(state)
  };
}

/**
 * 服务器权威的个人视图：公共视图 + 自己那一份隐藏信息。
 *
 * 唯一的私有例外是**庄家自己的两批底牌**（见 `PlayerSeat`）：拿上来的与埋下去的。
 */
export function personalView(state: GameState, seat: Seat): PersonalView {
  const deal = state.deal;
  const isDeclarer = deal !== null && isDeclarerSide(seat, deal);
  return {
    ...publicView(state),
    you: {
      seat,
      hand: deal === null ? [] : sortHand(deal.hands[seat]!, deal.trump),
      isDeclarer,
      originalKitty: isDeclarer ? [...deal.originalKitty] : null,
      // 埋底阶段还不能给：那时 `deal.kitty` 仍是发牌留下的占位（`state.ts` 的 newDeal），
      // 庄家尚未埋牌，把它当成「埋下去的 3 张」会指着一手还没做的决定。
      // 结算阶段继续给：与 `summary.kitty` 同源，庄家本来就全程知道。
      buriedKitty:
        isDeclarer && (deal.phase === 'play' || deal.phase === 'scored') ? [...deal.kitty] : null
    }
  };
}

function publicDealOf(state: GameState): PublicDealView | null {
  const deal = state.deal;
  if (deal === null) return null;
  return {
    phase: deal.phase,
    dealNo: deal.dealNo,
    dealerSeat: deal.dealerSeat,
    auction: deal.auction.map((e) => ({ ...e })),
    highestBid: highestBid(deal.auction),
    auctionTurn: auctionTurn(deal),
    contract: deal.contract,
    trump: deal.trump,
    trick: deal.trick === null ? null : { leaderSeat: deal.trick.leaderSeat, plays: [...deal.trick.plays] },
    playTurn: playTurn(deal),
    trickHistory: deal.trickHistory,
    captured: SEATS.map((s) => ({
      seat: s,
      points: capturedPoints(deal, s),
      cards: deal.captured[s]!
    })),
    handCounts: SEATS.map((s) => deal.hands[s]!.length),
    declarerSeat: deal.contract === null ? null : deal.contract.declarerSeat,
    summary: deal.summary
  };
}

/**
 * 牌桌用：从当前视图里取当前最高叫品。
 *
 * 参数取**公共视图**而不是个人视图：观战者没有 `you`，而叫牌候选只依赖公开信息
 * （叫牌历史与分数），所以观战者与玩家拿到的是同一份候选（观战者不渲染按钮而已）。
 *
 * 合法集本身在引擎的 `bidOptions`（唯一实现）：牌桌面板、牌局编排台与 MCP 的 `legal_bids` 共用。
 */
export function bidCandidates(view: PublicView, spread = 4): readonly BidOption[] {
  return bidOptions(view.deal?.highestBid ?? null, spread);
}
