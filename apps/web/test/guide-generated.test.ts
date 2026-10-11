/**
 * 生成物守卫（原 `deal-story.test.ts` 的那条纪律，改钉引导局）：
 *
 * 1. `docs/guide/*.json` 必须逐份过「结构 + 语义」两层校验（引擎重放、存证核对、引导词覆盖）；
 * 2. 提交进仓库的 `guide/deals/<slug>.ts` 与 `deals/index.ts` 必须等于**现场重算**的文本 ——
 *    手改生成物、或改完 JSON 忘了重跑 `pnpm --filter web guide`，都会在这里报红。
 *
 * 为什么不只在脚本里校验：脚本靠人记得跑；测试是 CI 的一环（`pnpm test:web`），跑不掉。
 */
import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { guideDealModuleText, guideDealsIndexText } from '../src/lib/guide/emit.ts';
import { GUIDE_DEALS, dealOf } from '../src/lib/guide/deals/index.ts';
import { parseGuideDeal, validateGuideDeal } from '../src/lib/guide/validate.ts';
import { COURSE } from '../src/lib/guide/course.ts';
import type { GuideDealData } from '../src/lib/guide/types.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GUIDE_DIR = join(REPO_ROOT, 'docs', 'guide');
const DEALS_DIR = join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'guide', 'deals');

/** `docs/guide/*.json`（不含 `candidates/`：那是待挑的草稿，不进校验） */
function jsonFiles(): string[] {
  if (!existsSync(GUIDE_DIR)) return [];
  return globSync('*.json', { cwd: GUIDE_DIR }).sort();
}

function readDeal(file: string): GuideDealData {
  const slug = basename(file, '.json');
  const parsed = parseGuideDeal(JSON.parse(readFileSync(join(GUIDE_DIR, file), 'utf8')) as unknown, slug);
  assert.equal(parsed.ok, true, `${file} 结构校验失败：${parsed.ok ? '' : parsed.problems.map((p) => `${p.where} ${p.message}`).join('；')}`);
  if (!parsed.ok) throw new Error('unreachable');
  return parsed.deal;
}

test('docs/guide 下每一份引导局都过结构 + 语义校验（引擎重放、存证、引导词覆盖）', () => {
  for (const file of jsonFiles()) {
    const deal = readDeal(file);
    const problems = validateGuideDeal(deal);
    assert.deepEqual(
      problems,
      [],
      `${file} 语义校验失败：${problems.map((p) => `${p.where} ${p.message}`).join('；')}`
    );
  }
});

test('生成物 == 现场重算（手改生成物或忘了重跑 guide 都会红）', () => {
  const slugs = jsonFiles().map((file) => basename(file, '.json'));
  assert.deepEqual(
    GUIDE_DEALS.map((deal) => deal.slug),
    slugs,
    'deals/index.ts 里的引导局清单与 docs/guide 下的 JSON 对不上'
  );
  for (const file of jsonFiles()) {
    const slug = basename(file, '.json');
    const expected = guideDealModuleText(slug, readDeal(file));
    const committed = readFileSync(join(DEALS_DIR, `${slug}.ts`), 'utf8');
    assert.equal(committed, expected, `${slug}.ts 与现场重算不一致：改数据请改 docs/guide/${file}，再跑 pnpm --filter web guide`);
    assert.deepEqual(dealOf(slug), readDeal(file), `${slug} 的生成物与 JSON 语义不一致`);
  }
  const indexExpected = guideDealsIndexText(slugs);
  assert.equal(readFileSync(join(DEALS_DIR, 'index.ts'), 'utf8'), indexExpected, 'deals/index.ts 需要重跑生成');
});

test('课程引用的每一副引导局都有数据（或写明为什么还没有）', () => {
  for (const chapter of COURSE.chapters) {
    for (const step of chapter.steps) {
      if (step.kind !== 'deal' && step.kind !== 'review') continue;
      const deal = dealOf(step.slug);
      if (deal !== null) continue;
      assert.ok(
        step.pending !== undefined && step.pending.trim().length > 0,
        `${step.slug} 既没有数据、也没有 pending 说明（不允许静默缺失）`
      );
    }
  }
});

test('引导局的角色与课程声明的座位一致（当庄家 / 当闲家不能写反）', () => {
  for (const deal of GUIDE_DEALS) {
    const declarer = deal.expect.contract.declarerSeat;
    const role = deal.learnerSeat === declarer ? 'declarer' : 'defender';
    assert.equal(deal.role, role, `${deal.slug}：role=${deal.role} 与庄家座位 ${declarer} 不符`);
  }
});

test('候选草稿不进校验目录（candidates/ 只是待挑清单）', () => {
  const candidates = join(GUIDE_DIR, 'candidates');
  if (!existsSync(candidates)) return;
  for (const file of globSync('*.json', { cwd: candidates })) {
    // 草稿补完内容之前不该出现在正式目录里
    assert.equal(
      existsSync(join(GUIDE_DIR, file)),
      false,
      `docs/guide/${file} 与 candidates/${file} 同时存在：挑中的应当「挪」而不是复制`
    );
  }
});
