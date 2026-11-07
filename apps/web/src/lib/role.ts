import { personalView, publicView, type GameState, type Seat } from '@sixty/engine';
import type { Role, StreamPayload } from './shared';

/**
 * 「谁该看到哪个投影」的唯一判断处（纯函数，CI 有单测）。
 *
 * 服务端只调用这里的 `projectionFor`，因此「观战者拿到的必须是公共视图」这条不变量
 * 可以在不进服务器、不连数据库的情况下被测试守住（见 role.test.ts / ADR-0007）。
 */

/** 观战布局锚点：把座位 2 摆在「自己」的位置，于是左＝座位 1、右＝座位 0、下＝座位 2 */
export const SPECTATOR_ANCHOR_SEAT = 2;

/** 观战者没有座位：传给 `whoLabel` 的「我的座位」用 -1，所有座位都显示玩家名 */
export const SPECTATOR_LABEL_SEAT = -1;

export interface ArrivalState {
  /** 已经坐在该桌的座位上 */
  readonly seated: boolean;
  /** 对该桌有观战记录（主动离座过，或上次就是在观战） */
  readonly watching: boolean;
  readonly freeSeats: number;
}

/**
 * 到达一张同桌时的角色（见 ADR-0007）：
 * 已在座 → 玩家（不动）；有观战记录 → 观战（不再自动塞回座位）；有空座 → 自动入座；满座 → 观战。
 */
export function resolveArrivalRole(state: ArrivalState): Role {
  if (state.seated) return 'player';
  if (state.watching) return 'spectator';
  return state.freeSeats > 0 ? 'player' : 'spectator';
}

/**
 * 角色 → 视图投影：观战者拿公共视图，玩家拿个人视图，未开局则视图为空。
 *
 * **`you` 的存在就是「我坐在这张桌的座位上」**：还没发牌时它的手牌是空数组而不是 null，
 * 否则界面会把在座的人当成观战者（这正是 lobby 开局按钮消失的那个回归）。
 */
export function projectionFor(
  state: GameState | null,
  seat: Seat | null
): Pick<StreamPayload, 'role' | 'view' | 'you'> {
  if (seat === null) {
    return { role: 'spectator', view: state === null ? null : publicView(state), you: null };
  }
  if (state === null) {
    // 还没发牌：手牌为空，但「我在座位上」这件事必须表达出来；两批底牌此时都还不存在
    return {
      role: 'player',
      view: null,
      you: { seat, hand: [], isDeclarer: false, originalKitty: null, buriedKitty: null }
    };
  }
  // 手牌只发一份：从个人视图里摘掉 you，视图本身保持公共形态
  const { you, ...view } = personalView(state, seat);
  return { role: 'player', view, you };
}

/** 布局锚点：玩家以自己为锚，观战者用固定锚点 */
export function anchorSeatOf(seat: number | null): number {
  return seat ?? SPECTATOR_ANCHOR_SEAT;
}

/** 毡面顶行两张对手卡的座位 */
export interface SeatSides {
  /** 屏幕**左边**那张卡：上家（他先于你出牌） */
  readonly left: number;
  /** 屏幕**右边**那张卡：下家（你出完就轮到他） */
  readonly right: number;
}

/**
 * 顶行两张对手卡分别是谁 —— **唯一的出处**（牌桌页的座位行与出牌区的两翼都读它）。
 *
 * 方向：座位号按出牌顺序递增（`auctionTurn` / `playTurn` 都是 `+1`），而屏幕上是
 * **逆时针**——下家在右手边、上家在左手边，于是眼睛跟着「你 → 右 → 左上 → 你」走一圈
 * 就是出牌顺序，与麻将 / 斗地主的桌面习惯一致。第一版是反的（下家在左），
 * 那让整张桌子看起来像顺时针在转。
 *
 * 为什么必须只有一个出处：两处各算一份的话，改一处忘了另一处，某一家出的牌就会
 * 落在**对面**那张座位卡下方（`table-chrome.test.ts` 的 `seatSidesCheck` 守着这条）。
 */
export function seatSidesOf(anchor: number): SeatSides {
  return { left: (anchor + 2) % 3, right: (anchor + 1) % 3 };
}

/** 文案里的「我的座位」：玩家是自己，观战者是 -1（谁都不叫「你」） */
export function labelSeatOf(seat: number | null): number {
  return seat ?? SPECTATOR_LABEL_SEAT;
}
