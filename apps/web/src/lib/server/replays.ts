/**
 * 机器重演的服务端落点（ADR-0016）：结算那一刻重建输入、同步跑完、只读存档。
 *
 * 为什么必须在结算时算：`GameState.deal` 此刻还留着这副的全部隐藏信息
 * （`trickHistory` 能还原三家原始 17 张 —— 打完后手牌已空，打过的牌都在墩史里；
 * `originalKitty` 就是拿上来的底牌），而下一副发牌会把 `deal` 整个换掉、
 * `history` 里的 `DealSummary` 又不含手牌 —— 想点开时再算就得为每副存整份牌面快照。
 *
 * 重演结果一经落库就不再重算：机器人策略日后调整，旧记录仍是**当时那版策略**打出来的
 * （这也是「确定性重演」的一部分 —— 同一副永远同一结果，没有抽样）。
 */
import { removeCards, SEATS, type Card, type GameState, type Level, type Seat } from '@sixty/engine';
import { simulateDeal, type ReplayInput, type ReplayResult } from '@sixty/bot';
import { db, now } from './db';

/** 一条已存档的重演（`result` 即 `@sixty/bot` 的 `ReplayResult`） */
export interface ReplayRow {
  readonly dealNo: number;
  readonly result: ReplayResult;
}

/**
 * 从**刚结算**的状态重建重演输入。副前级别的还原：`levelChanges` 里变动座的 `from`
 * 是开打前的值；未变动的座当前值就是开打前的值（没动过）。
 * 形状不对（理论不该发生）返回 null —— 重演是附加产物，绝不让它影响结算本身。
 */
export function replayInputOf(state: GameState): ReplayInput | null {
  const deal = state.deal;
  const summary = deal?.summary ?? null;
  if (deal === null || summary === null) return null;
  // 认赢结束的副没有重演：剩下的牌被整墩收走，**没有逐张归属**，墩史拼不回三家的 17 张。
  // 显式排除，而不是撞在下文「打出的牌不足 17 张」那条副作用上 —— 将来谁改了收牌方式也不会
  // 把一副认赢的牌重演成另一副牌。
  if (summary.claim != null) return null;

  const declarer = summary.contract.declarerSeat;
  const hands: Card[][] = [];
  for (const seat of SEATS as readonly Seat[]) {
    let played = deal.trickHistory.flatMap((trick) => trick.plays.find((play) => play.seat === seat)?.cards ?? []);
    if (seat === declarer) {
      // 庄家的手牌经历过「拿底」：17 + 拿上来的 3 = 20，埋下 3、打出 17。
      // 打出的 17 ≠ 原始的 17（埋的可能不是底牌本身），要还原：
      //   原始 17 = 打出的 17 ∪ 埋下的 3（= summary.kitty）− 拿上来的 3（= originalKitty）
      // 拿上来的三张必在「打出 ∪ 埋下」里（它们进过那 20 张），removeCards 不会失败。
      const full = [...played, ...summary.kitty];
      const rest = removeCards(full, deal.originalKitty);
      if (rest === null) return null;
      played = rest;
    }
    if (played.length !== 17) return null;
    hands.push(played);
  }
  if (deal.originalKitty.length !== 3) return null;

  const levels: readonly Level[] = SEATS.map(
    (seat: Seat) => summary.levelChanges.find((change) => change.seat === seat)?.from ?? state.levels[seat]!
  );

  return {
    hands: hands.map((hand) => [...hand]),
    originalKitty: [...deal.originalKitty],
    dealerSeat: deal.dealerSeat,
    dealNo: deal.dealNo,
    levels: levels.map((level) => ({ ...level }))
  };
}

/** 结算动作的附带一步：重建输入并同步跑完重演；失败只记日志，返回 null（不落库） */
export function computeReplay(state: GameState): ReplayRow | null {
  const deal = state.deal;
  if (deal === null || deal.phase !== 'scored') return null;
  const input = replayInputOf(state);
  if (input === null) return null;
  try {
    return { dealNo: deal.dealNo, result: simulateDeal(input) };
  } catch (error) {
    console.error(`机器重演失败（第 ${deal.dealNo} 副）：${String(error)}`);
    return null;
  }
}

/** 落库：同一 (table, dealNo) 只写一次 —— 重演结果不可变，重放不覆盖 */
export function saveReplay(tableId: number, row: ReplayRow): void {
  db.prepare(
    `INSERT INTO replays (table_id, deal_no, result, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(table_id, deal_no) DO NOTHING`
  ).run(tableId, row.dealNo, JSON.stringify(row.result), now());
}

/** 开新对局时清空：dealNo 重新从 1 计数，不清就会张冠李戴（见 db.ts 的表注释） */
export function clearReplays(tableId: number): void {
  db.prepare('DELETE FROM replays WHERE table_id = ?').run(tableId);
}

/** 这张桌的全部重演，按副号升序（给 `GET /api/tables/[code]/replays` 用） */
export function replaysOf(tableId: number): ReplayRow[] {
  const rows = db
    .prepare('SELECT deal_no, result FROM replays WHERE table_id = ? ORDER BY deal_no')
    .all(tableId) as unknown as { deal_no: number; result: string }[];
  return rows.map((row) => ({ dealNo: row.deal_no, result: JSON.parse(row.result) as ReplayResult }));
}
