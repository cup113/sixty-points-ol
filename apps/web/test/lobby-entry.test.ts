/**
 * 大厅「牌桌」入口的形状守卫：**两枚按钮**，不是两个 tab。
 *
 * 被修掉的形状：牌桌卡做成「新建 / 加入」两个 tab，选中的 tab 是金的，tab 里那枚主按钮
 * 也是金的 —— 同一屏两处强调色（金色读起来既是「你选中了它」又是「按这个」），
 * 而「加入」那个输入框还得靠切换 tab 才看得见。
 *
 * 现在：新建是直接动作（金色），加入开弹窗（`JoinTableDialog`，普通色，邀请码与邀请链接都收）。
 * 这条判据落不了单测（要渲染整页），与 `page-source.test.ts` / `table-chrome.test.ts` 同一条纪律：
 * 对源码断言形状，并留一条反证证明这条判据真的会红。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const PAGE = read('../src/routes/+page.svelte');
const DIALOG = read('../src/lib/components/JoinTableDialog.svelte');

function lobbyEntryProblem(page: string, dialog: string): string | null {
  if (/tableTab/.test(page)) return '牌桌入口又变成 tab 了：选中态与主操作会各上一次金色';
  if (!page.includes('新建牌桌') || !page.includes('加入牌桌')) {
    return '牌桌入口不是「新建牌桌 / 加入牌桌」两枚按钮';
  }
  if (!/<JoinTableDialog/.test(page)) return '「加入牌桌」没有挂弹窗：邀请码与邀请链接没处填';
  if (!dialog.includes('parseInvite(') || !/from '\$lib\/invite'/.test(dialog)) {
    return '加入弹窗没有走 parseInvite：粘整条邀请链接会认不出来';
  }
  return null;
}

test('牌桌入口是两枚按钮：新建直接建，加入开弹窗收邀请码或链接', () => {
  assert.equal(lobbyEntryProblem(PAGE, DIALOG), null);
});

test('反证：把「牌桌 tab」写回去会被同一条判据抓出来', () => {
  const broken = PAGE.replace('let joinOpen =', 'let tableTab = $state("create");\n  let joinOpen =');
  assert.notEqual(broken, PAGE, '反证注入失败：找不到 joinOpen 的声明，这条断言等于没跑');
  assert.equal(
    lobbyEntryProblem(broken, DIALOG),
    '牌桌入口又变成 tab 了：选中态与主操作会各上一次金色'
  );
});

test('反证：加入弹窗不认邀请链接也会被抓出来', () => {
  const broken = DIALOG.replace("import { parseInvite } from '$lib/invite';", '');
  assert.equal(
    lobbyEntryProblem(PAGE, broken),
    '加入弹窗没有走 parseInvite：粘整条邀请链接会认不出来'
  );
});
