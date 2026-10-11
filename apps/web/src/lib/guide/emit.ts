/**
 * 引导局生成物的**文本**（唯一一份）：`scripts/build-guide.ts` 写文件、`test/guide-generated.test.ts`
 * 核对「仓库里的生成物 == 现场重算」，两边必须走同一段代码，否则守卫会与生成器漂移。
 */
import type { GuideDealData } from './types.ts';

/** 生成物的模块名：`defender-01` → `DEFENDER_01` */
export function guideModuleName(slug: string): string {
  return slug.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
}

const HEADER = `/**
 * 引导局数据（**生成物**，勿手改）：由 \`pnpm --filter web guide\` 从 \`docs/guide/<slug>.json\` 生成。
 *
 * 校验链见 \`scripts/build-guide.ts\`：结构 → 引擎重放 → 存证核对 → 引导词覆盖。
 * 手改这个文件会在 \`guide:check\` 与 \`test/guide-generated.test.ts\` 里报红。
 */
`;

export function guideDealModuleText(slug: string, deal: GuideDealData): string {
  return `${HEADER}import type { GuideDealData } from '../types.ts';\n\nexport const ${guideModuleName(slug)}: GuideDealData = ${JSON.stringify(deal, null, 2)};\n`;
}

export function guideDealsIndexText(slugs: readonly string[]): string {
  const imports = slugs.map((slug) => `import { ${guideModuleName(slug)} } from './${slug}.ts';`).join('\n');
  const entries = slugs.map((slug) => `  ${guideModuleName(slug)}`).join(',\n');
  return `${HEADER}import type { GuideDealData } from '../types.ts';
${imports.length === 0 ? '' : `${imports}\n`}
export const GUIDE_DEALS: readonly GuideDealData[] = [
${entries.length === 0 ? '' : `${entries}\n`}];

const BY_SLUG = new Map(GUIDE_DEALS.map((deal) => [deal.slug, deal]));

export function dealOf(slug: string): GuideDealData | null {
  return BY_SLUG.get(slug) ?? null;
}
`;
}
