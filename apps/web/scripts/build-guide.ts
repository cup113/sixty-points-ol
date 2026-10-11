/**
 * 引导局数据的校验与生成（`pnpm --filter web guide` / `guide:check`）。
 *
 * 纪律与旧的 `build-deal-stories.ts` 相同：**任何一条不过就非零退出并列出全部问题，绝不写半个文件。**
 * 校验分两层（`src/lib/guide/validate.ts`）：结构 + 语义（引擎重放、存证核对、引导词覆盖）。
 *
 * 为什么要 `register()` 解析钩子：Windows 上 pnpm 会把工作区包做成 **junction**，而 junction 由文件系统
 * 直接穿透，Node 看到的路径仍然在 `node_modules` 下 —— Node 24 **拒绝对 node_modules 里的文件做类型擦除**
 * （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。所以这里在**动态 import 之前**注册与测试同一份钩子，
 * 把 `@sixty/<包>` 映射到 `packages/<包>/src`。静态 import 会在这之前就完成解析，所以本文件一律动态引入。
 */
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register(new URL('../test/resolve-hooks.mjs', import.meta.url));

const WEB_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(WEB_ROOT, '../..');
const GUIDE_DIR = join(REPO_ROOT, 'docs', 'guide');
const DEALS_DIR = join(WEB_ROOT, 'src', 'lib', 'guide', 'deals');
const CHECK = process.argv.includes('--check');

interface Problem {
  readonly where: string;
  readonly message: string;
}

function readSources(): { slug: string; raw: unknown }[] {
  return globSync('*.json', { cwd: GUIDE_DIR })
    .sort()
    .map((file) => ({
      slug: basename(file, '.json'),
      raw: JSON.parse(readFileSync(join(GUIDE_DIR, file), 'utf8')) as unknown
    }));
}

async function main(): Promise<void> {
  const { parseGuideDeal, validateGuideDeal } = await import('../src/lib/guide/validate.ts');
  const { guideDealModuleText, guideDealsIndexText } = await import('../src/lib/guide/emit.ts');

  const problems: Problem[] = [];
  const deals: { slug: string; deal: import('../src/lib/guide/types.ts').GuideDealData }[] = [];

  for (const item of readSources()) {
    const parsed = parseGuideDeal(item.raw, item.slug);
    if (!parsed.ok) {
      for (const problem of parsed.problems) {
        problems.push({ where: `${item.slug}: ${problem.where}`, message: problem.message });
      }
      continue;
    }
    for (const problem of validateGuideDeal(parsed.deal)) {
      problems.push({ where: `${item.slug}: ${problem.where}`, message: problem.message });
    }
    deals.push({ slug: item.slug, deal: parsed.deal });
  }

  if (problems.length > 0) {
    console.error(`引导局校验没过（${problems.length} 条）：`);
    for (const problem of problems) console.error(`  · ${problem.where} —— ${problem.message}`);
    process.exit(1);
  }

  const slugs = deals.map((item) => item.slug);
  const outputs = [
    ...deals.map((item) => ({
      path: join(DEALS_DIR, `${item.slug}.ts`),
      text: guideDealModuleText(item.slug, item.deal)
    })),
    { path: join(DEALS_DIR, 'index.ts'), text: guideDealsIndexText(slugs) }
  ];

  if (CHECK) {
    const stale: string[] = [];
    for (const output of outputs) {
      let onDisk: string | null = null;
      try {
        onDisk = readFileSync(output.path, 'utf8');
      } catch {
        onDisk = null;
      }
      if (onDisk !== output.text) stale.push(output.path.slice(REPO_ROOT.length + 1));
    }
    // 仓库里多出来的旧生成物也要报（删了一副引导局却没删生成物）
    const expected = new Set([...slugs.map((slug) => `${slug}.ts`), 'index.ts']);
    for (const file of globSync('*.ts', { cwd: DEALS_DIR })) {
      if (!expected.has(file)) stale.push(join('apps/web/src/lib/guide/deals', file));
    }
    if (stale.length > 0) {
      console.error('引导局生成物与现场重算不一致（跑 `pnpm --filter web guide` 重生成）：');
      for (const path of stale) console.error(`  · ${path}`);
      process.exit(1);
    }
    console.log(`引导局校验通过：${slugs.length} 副，生成物与现场重算一致。`);
    return;
  }

  mkdirSync(DEALS_DIR, { recursive: true });
  for (const output of outputs) writeFileSync(output.path, output.text, 'utf8');
  console.log(`已生成 ${deals.length} 副引导局数据 → apps/web/src/lib/guide/deals/`);
}

await main();
