/**
 * 从**已结算**的真实牌局状态还原一副引导局的草稿（ADR-0025 的取材路径）。
 *
 * 为什么能还原：结算那一刻 `deal` 里还留着这副的全部真相 —— 三家打过的牌都在 `trickHistory` 里，
 * 拿上来的底牌是 `originalKitty`，埋回去的是 `kitty`。庄家那 17 张要反推：
 *   原始 17 = 打出的 17 ∪ 埋下的 3 − 拿上来的 3
 * 闲家的 17 张就是他们打出的 17 张（与 `src/lib/server/replays.ts` 的 `replayInputOf` 同一套数学，
 * 这里重写一份是因为那份挂在服务端模块上、import 它会顺带打开应用的 SQLite）。
 *
 * 纯函数：只吃 `GameState`，不吃数据库、不碰文件，所以能用引擎合成的整副牌直接单测。
 */
import {
  cardKey,
  isPass,
  levelLabel,
  removeCards,
  SEATS,
  type BidCall,
  type Card,
  type GameState,
  type Level,
  type Seat
} from '@sixty/engine';
import type { GuideAction } from './types.ts';

/** 副号与桌码这些**来源信息**：只有这些来自数据库，牌面一律来自状态 */
export interface ExtractSource {
  readonly table: string;
  readonly date: string;
}

export interface ExtractedFeatures {
  readonly contractPoints: number;
  readonly strain: string;
  readonly declarerSeat: Seat;
  readonly made: boolean;
  readonly finalScore: number;
  readonly trickCount: number;
  readonly trumpCount: number;
  /** 三家开打时的主牌张数（判断「谁的主长」，挑副时有用） */
  readonly trumpLengths: readonly number[];
}

/** 草稿：`docs/guide/candidates/<slug>.json` 的形状，人工补 title / aliases / guides / review */
export interface ExtractedDraft {
  readonly version: 1;
  readonly slug: string;
  readonly title: string;
  readonly role: 'declarer' | 'defender';
  readonly learnerSeat: Seat;
  readonly aliases: readonly [string, string, string];
  readonly source: ExtractSource & { readonly dealNo: number };
  readonly facts: {
    readonly hands: readonly (readonly string[])[];
    readonly originalKitty: readonly string[];
    readonly dealerSeat: Seat;
    readonly levels: readonly Level[];
    readonly dealNo: number;
  };
  readonly actions: readonly GuideAction[];
  readonly guides: Readonly<Record<string, never>>;
  readonly review: { readonly intro: string; readonly outro: string };
  readonly expect: NonNullable<NonNullable<GameState['deal']>['summary']>;
}

export type ExtractResult =
  | {
      readonly ok: true;
      readonly draft: ExtractedDraft;
      readonly features: ExtractedFeatures;
      /** 副前级别：`summary.levelChanges` 里没动的座位，当前级别就是开打前的级别 */
      readonly levelNote: string;
    }
  | { readonly ok: false; readonly reasons: readonly string[] };

function seatHands(deal: NonNullable<GameState['deal']>, declarerSeat: Seat): Card[][] | null {
  const hands: Card[][] = [];
  for (const seat of SEATS as readonly Seat[]) {
    let played = deal.trickHistory.flatMap(
      (trick) => trick.plays.find((play) => play.seat === seat)?.cards ?? []
    );
    if (seat === declarerSeat) {
      const full = [...played, ...deal.kitty];
      const rest = removeCards(full, deal.originalKitty);
      if (rest === null) return null;
      played = rest;
    }
    if (played.length !== 17) return null;
    hands.push(played);
  }
  return hands;
}

/**
 * 从结算状态还原草稿。`slug` 与代称由脚本给（桌码 + 副号），牌面与动作全部现场算。
 *
 * 默认让**庄家**当学习者（`role: 'declarer'`）：挑副的人可以改 `learnerSeat`，
 * 但「闲家视角」的副从同一份草稿改一个字就能得到，没必要提取两份。
 */
export function extractDeal(
  state: GameState,
  source: ExtractSource,
  slug: string
): ExtractResult {
  const reasons: string[] = [];
  const deal = state.deal;
  if (deal === null) return { ok: false, reasons: ['这张桌还没发过牌'] };
  if (deal.phase !== 'scored' || deal.summary === null) {
    return { ok: false, reasons: ['这副还没结算（引导局只取自打完的牌）'] };
  }
  const summary = deal.summary;
  const declarerSeat = summary.contract.declarerSeat;

  const hands = seatHands(deal, declarerSeat);
  if (hands === null) {
    return { ok: false, reasons: ['三家手牌还原不出来（墩史不完整，或底牌对不上）'] };
  }
  if (deal.originalKitty.length !== 3) {
    return { ok: false, reasons: ['拿上来的底牌不是 3 张'] };
  }
  if (deal.kitty.length !== 3) {
    return { ok: false, reasons: ['埋回去的底牌不是 3 张'] };
  }

  // 动作序列：叫牌（按 `auction` 的顺序）→ 埋底 → 每一墩的出牌
  const actions: GuideAction[] = [];
  for (const entry of deal.auction) {
    const call: BidCall = entry.call;
    actions.push({ type: 'bid', seat: entry.seat, call: isPass(call) ? 'pass' : { points: call.points, strain: call.strain } });
  }
  actions.push({ type: 'bury', seat: declarerSeat, cards: deal.kitty.map(cardKey) });
  for (const trick of deal.trickHistory) {
    for (const play of trick.plays) {
      actions.push({ type: 'play', seat: play.seat, cards: play.cards.map(cardKey) });
    }
  }

  if (actions.some((action) => action.type === 'bid' && isPass(action.call)) === false && deal.auction.length === 0) {
    reasons.push('这副没有叫牌记录');
  }
  if (deal.auction.every((entry) => isPass(entry.call))) {
    reasons.push('这副三家全不叫（作废重发），不能当引导局');
  }

  // 副前级别：变动座的 `from` 是开打前的值；没变的座当前值就是开打前的值
  const levels: Level[] = (SEATS as readonly Seat[]).map((seat) => {
    const change = summary.levelChanges.find((item) => item.seat === seat);
    return change === undefined ? { ...state.levels[seat]! } : { ...change.from };
  });

  const trumpLengths = hands.map((hand) =>
    hand.filter((card) => {
      if ('joker' in card) return true;
      if (card.rank === deal.trump!.rank) return true;
      return deal.trump!.strain !== 'NT' && card.suit === deal.trump!.strain;
    }).length
  );
  const features: ExtractedFeatures = {
    contractPoints: summary.contract.points,
    strain: summary.contract.strain,
    declarerSeat,
    made: summary.made,
    finalScore: summary.finalScore,
    trickCount: deal.trickHistory.length,
    trumpCount: trumpLengths.reduce((sum, n) => sum + n, 0),
    trumpLengths
  };

  if (reasons.length > 0) return { ok: false, reasons };

  const draft: ExtractedDraft = {
    version: 1,
    slug,
    title: '（待填）这一副讲什么',
    role: 'declarer',
    learnerSeat: declarerSeat,
    aliases: ['（待填）', '（待填）', '（待填）'],
    source: { table: source.table, dealNo: deal.dealNo, date: source.date },
    facts: {
      hands: hands.map((hand) => hand.map(cardKey)),
      originalKitty: deal.originalKitty.map(cardKey),
      dealerSeat: deal.dealerSeat,
      levels,
      dealNo: deal.dealNo
    },
    actions,
    guides: {},
    review: { intro: '（待填）这一副的看点', outro: '（待填）收尾' },
    expect: summary
  };

  return {
    ok: true,
    draft,
    features,
    levelNote: `副前级别：${levels.map((level) => levelLabel(level)).join(' / ')}`
  };
}
