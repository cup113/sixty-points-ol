/**
 * 从 db 副本提取**候选引导局**：`pnpm --filter web guide:extract`
 *
 * 输入是一份 SQLite 副本（默认 `data/guide-source.db`，可用 `SIXTY_GUIDE_DB` 覆盖）——
 * 从部署机拷一份下来，或者本地开发时三人真人开桌打几副。**只读**，绝不写库。
 *
 * 输出 `docs/guide/candidates/<slug>.json`（草稿：事实与动作齐备，title / 代称 / 引导词 / 复盘待填），
 * 外加一张控制台清单供挑副。挑中的候选**挪**进 `docs/guide/<slug>.json` 再补内容；
 * `candidates/` 不进仓库校验（`build-guide.ts` 只扫 `docs/guide/*.json`）。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

// 静态 import 会在这之前完成解析；`@sixty/*` 是工作区 junction，Node 24 不肯擦除 node_modules 下的类型
register(new URL('../test/resolve-hooks.mjs', import.meta.url));

const WEB_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(WEB_ROOT, '../..');
const DB_PATH = process.env['SIXTY_GUIDE_DB'] ?? join(REPO_ROOT, 'data', 'guide-source.db');
const OUT_DIR = join(REPO_ROOT, 'docs', 'guide', 'candidates');

async function main(): Promise<void> {
  const { readCandidates } = await import('../src/lib/server/guide-source.ts');

  if (!existsSync(DB_PATH)) {
    console.error(`找不到数据库副本：${DB_PATH}`);
    console.error(
      '把部署机上的 sixty.db 拷到 data/guide-source.db（或在本地三人开桌打几副），或用 SIXTY_GUIDE_DB 指定路径。'
    );
    process.exit(1);
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const candidates = readCandidates(db, new Date().toISOString().slice(0, 10));

  mkdirSync(OUT_DIR, { recursive: true });
  const lines: string[] = [];
  let written = 0;

  for (const item of candidates) {
    if (!item.ok) {
      lines.push(`— ${item.table}：${item.reason}`);
      continue;
    }
    writeFileSync(join(OUT_DIR, `${item.slug}.json`), `${JSON.stringify(item.draft, null, 2)}\n`, 'utf8');
    written += 1;
    const f = item.features;
    lines.push(
      `✔ ${item.slug}：${f.contractPoints}${strainGlyph(f.strain)} · 庄家 ${f.declarerSeat} · ` +
        `${f.made ? '打成' : '打输'} ${f.finalScore} 分 · ${f.trickCount} 墩 · ` +
        `主牌 ${f.trumpLengths.join('/')}（共 ${f.trumpCount}） · ${item.levelNote}`
    );
  }

  console.log(lines.length === 0 ? '（这份库里没有别结算的三人非 bot 牌局）' : lines.join('\n'));
  console.log(`\n写入 ${written} 份候选 → docs/guide/candidates/`);
  console.log(
    '挑中的那一份挪成 docs/guide/<slug>.json，补 title / aliases / guides（用户座位每个动作一条）/ review，' +
      '再跑 pnpm --filter web guide。'
  );
}

/** 叫品字形：与界面同一套（无主写 NT） */
function strainGlyph(strain: string): string {
  return { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' }[strain] ?? strain;
}

await main();
