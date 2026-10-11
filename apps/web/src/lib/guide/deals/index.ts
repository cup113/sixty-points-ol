/**
 * 引导局数据（**生成物**，勿手改）：由 `pnpm --filter web guide` 从 `docs/guide/<slug>.json` 生成。
 *
 * 校验链见 `scripts/build-guide.ts`：结构 → 引擎重放 → 存证核对 → 引导词覆盖。
 * 手改这个文件会在 `guide:check` 与 `test/guide-generated.test.ts` 里报红。
 */
import type { GuideDealData } from '../types.ts';
import { DECLARER_01 } from './declarer-01.ts';
import { DECLARER_02 } from './declarer-02.ts';
import { DEFENDER_01 } from './defender-01.ts';
import { DEFENDER_02 } from './defender-02.ts';

export const GUIDE_DEALS: readonly GuideDealData[] = [
  DECLARER_01,
  DECLARER_02,
  DEFENDER_01,
  DEFENDER_02
];

const BY_SLUG = new Map(GUIDE_DEALS.map((deal) => [deal.slug, deal]));

export function dealOf(slug: string): GuideDealData | null {
  return BY_SLUG.get(slug) ?? null;
}
