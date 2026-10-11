/**
 * 从 db 副本里挑**候选引导局**（`scripts/guide-extract.ts` 的内核，服务端专用）。
 *
 * 硬门槛（ADR-0025）：这一副**三人均非机器人**（`users.is_bot` 全 0），且已经结算。
 * 只读：调用方给的一个 `DatabaseSync`，这里一条写语句都没有。
 *
 * 已知边界：每张桌只有**最后一副**能完整还原 —— 老副的手牌不在事件表里，`games.state` 也只留当前这副。
 * 所以候选池 = 各桌的最后一副；不够就再多打几副。
 *
 * 放在 `$lib/server/` 是为了**编译期**保证它进不了客户端 bundle：它要 `node:sqlite` 与整副状态的 JSON，
 * 页面侧一个字节都不该碰到（`/learn` 只消费烘焙好的生成物）。
 */
import type { DatabaseSync } from 'node:sqlite';
import { extractDeal, type ExtractedDraft, type ExtractedFeatures } from '../guide/extract.ts';

/** 一行候选：或是一份可用草稿，或是一句「为什么不用它」 */
export type Candidate =
  | {
      readonly ok: true;
      readonly slug: string;
      readonly table: string;
      readonly dealNo: number;
      readonly draft: ExtractedDraft;
      readonly features: ExtractedFeatures;
      readonly levelNote: string;
    }
  | { readonly ok: false; readonly table: string; readonly reason: string };

interface GameRow {
  readonly tableId: number;
  readonly code: string;
  readonly updatedAt: string;
  readonly state: string;
}

/** 这张桌每个座位的机器人标记（1 = 机器人） */
interface SeatRow {
  readonly seat: number;
  readonly isBot: number;
}

/** 表名与列名与 `src/lib/server/db.ts` 一致；换库结构时这里与那个文件必须一起改 */
export function readCandidates(db: DatabaseSync, date: string): Candidate[] {
  const games = db
    .prepare(
      `SELECT g.table_id AS tableId, t.code AS code, g.updated_at AS updatedAt, g.state AS state
       FROM games g JOIN tables t ON t.id = g.table_id
       ORDER BY t.code`
    )
    .all() as unknown as GameRow[];
  const seatsOf = db.prepare(
    `SELECT s.seat AS seat, u.is_bot AS isBot
     FROM seats s JOIN users u ON u.id = s.user_id
     WHERE s.table_id = ?
     ORDER BY s.seat`
  );

  const out: Candidate[] = [];
  for (const game of games) {
    const seats = seatsOf.all(game.tableId) as unknown as SeatRow[];
    if (seats.length < 3) {
      out.push({ ok: false, table: game.code, reason: `只有 ${seats.length} 个座位` });
      continue;
    }
    const bots = seats.filter((seat) => seat.isBot !== 0).length;
    if (bots > 0) {
      out.push({ ok: false, table: game.code, reason: `有 ${bots} 个机器人座位，不符合「三人均非 bot」` });
      continue;
    }

    let state: unknown;
    try {
      state = JSON.parse(game.state) as unknown;
    } catch {
      out.push({ ok: false, table: game.code, reason: '状态 JSON 解析失败' });
      continue;
    }

    const dealNo = (state as { deal?: { dealNo?: number } }).deal?.dealNo ?? 0;
    const slug = `${game.code.toLowerCase()}-${dealNo}`;
    const result = extractDeal(state as never, { table: game.code, date: game.updatedAt.slice(0, 10) || date }, slug);
    if (!result.ok) {
      out.push({ ok: false, table: game.code, reason: result.reasons.join('；') });
      continue;
    }
    out.push({
      ok: true,
      slug,
      table: game.code,
      dealNo,
      draft: result.draft,
      features: result.features,
      levelNote: result.levelNote
    });
  }
  return out;
}
