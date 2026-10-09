/**
 * 叫牌面板可达性的**源码**守卫（进 CI 的 `pnpm test:web`）。
 *
 * 这条不变式换过两代，都是因为「页脚被内容吃掉」：
 * 1. f40bad9 那次没修成的修复：面板加上了 `max-h-[56%]`，却仍是 flex 列 + `overflow-hidden`。
 *    手机上面板可用高度 ~240px、固定开销 ~344px，唯一可压缩的历史区被压到 0 之后，
 *    差额由 `overflow-hidden` 从底部裁掉 —— 裁掉的正是排在最后的「不叫」，而且它不在任何
 *    滚动区里，滚也滚不回来。当时那条 ui-check 只断言「页面里有 max-h-[56%] 与 overflow-y-auto」，
 *    两个类一直都在，所以它对那次故障完全瞎。
 * 2. 「面板自己滚 + 不叫 sticky 贴底」：按钮点得到了，但 sticky 的语义就是**浮在内容上** ——
 *    历史行从它下面穿过，最后那半行「45NT / 50NT / 55♥」被压掉。换顺序只是换谁被挡。
 *
 * 现在的要求：面板 flex 列 + max-h；**唯一可伸缩**的是叫牌历史的滚动区（min-h-0 + flex-1 +
 * overflow-y-auto）；「不叫」排在它之后、正常文档流、shrink-0、不 sticky。于是页脚既不压住内容，
 * 也不会被裁掉。
 *
 * 这里三步：1) 现在的 BidPanel 必须满足不变式；2) 目标形状的正对照必须通过；
 * 3) 两代坏形状与它们的近似形状喂进同一个判断，必须被判为不可达 —— 守卫不空转的常驻证据
 * （判断逻辑在 src/lib/panel-guard.ts，ui-check 对出货 HTML 用的是同一份）。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkBidPanelReachability, checkBidSlots } from '../src/lib/panel-guard.ts';

/** 剥掉注释再断言：解释「为什么这么写」的注释里提到 overflow / 发牌 不构成违规（同 table-chrome.test.ts） */
function strip(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function readComponent(name: string): string {
  return strip(readFileSync(new URL(`../src/lib/components/${name}.svelte`, import.meta.url), 'utf8'));
}

const source = readComponent('BidPanel');

test('叫牌面板自己滚、「不叫」是 sticky 底部页脚', () => {
  const result = checkBidPanelReachability(source);
  assert.equal(result.ok, true, `面板可达性守卫没过：${result.reason}`);
});

/**
 * 面板里唯一的外部内容块是叫牌信息与历史（`AuctionInfo` / `AuctionHistory`），
 * 毡面面板与抽屉共用（抽屉走 `AuctionRecord` 这个组合件）。
 * `checkBidPanelReachability` 只审 `BidPanel.svelte` 这一个文件的 `<section>` ——
 * 这两块里一旦长出滚动区，上面的守卫照样绿，而 CI 只跑 `pnpm test:web`（不跑 ui-check，
 * 那条要起服务端）。所以那条「面板里不许有第二处 overflow」的不变式，得在这一侧也钉一下。
 */
const RECORD_PARTS = ['AuctionInfo', 'AuctionHistory', 'AuctionRecord'] as const;

test('叫牌信息/历史本身不自带滚动区（面板里不许有第二个 overflow）', () => {
  for (const name of RECORD_PARTS) {
    const found = readComponent(name).match(/overflow-(?:y-auto|hidden)/g) ?? [];
    assert.equal(
      found.length,
      0,
      `${name}.svelte 里出现了 ${found.join('、')}：面板「唯一滚动区」这条不变式断在这里，` +
        '而源码守卫只看 BidPanel.svelte 的 section，看不见这个文件'
    );
  }
});

/* ---------- 候选区形状：固定五槽 + 跳叫触发（源码级，判定在 src/lib/panel-guard.ts） ---------- */

test('候选区是固定五槽 + 跳叫触发，形状来自 labels.ts 的 bidTiers（面板不自己判断）', () => {
  const result = checkBidSlots(source);
  assert.equal(result.ok, true, `候选区形状守卫没过：${result.reason}`);
  assert.ok(
    source.includes('bidTiers('),
    '面板没有走 labels.ts 的 bidTiers：固定五槽与跳叫触发必须只有一处实现'
  );
  assert.ok(
    !source.includes('bidCandidates('),
    '面板又自己拿 bidCandidates 摆档了：那就绕过了固定五槽与跳叫触发'
  );
});

/**
 * 这次要修的旧形状：按「合法花色」逐档摆 —— 后面的花色会往前补位，
 * 于是「上一档第 3 个按钮」与「下一档第 3 个按钮」不再是同一个花色。
 */
const OLD_COLLAPSED = `<div class="mt-3 shrink-0 space-y-1.5">
  {#each rows as row (row.points)}
    <div class="flex items-center gap-1.5">
      <span class="w-7 shrink-0 text-right">{row.points}</span>
      {#each row.strains as strain (strain)}
        <button class="bidbtn px-2.5 py-1.5">{BID_GLYPH[strain]}</button>
      {/each}
    </div>
  {/each}
</div>`;

test('反证：旧的补位形状必须被判出来（它连固定槽标记都没有）', () => {
  const result = checkBidSlots(OLD_COLLAPSED);
  assert.equal(result.ok, false, '旧形状被判为通过：这条守卫是空转的');
});

/** 近似形状：槽标记齐全，却仍按「合法花色」摆 —— 必须被单列的那条规则抓住 */
const PADDED_SLOTS = `<div data-bid-trigger="line">
  {#each rows as row (row.points)}
    {#each row.strains as strain (strain)}
      <span data-bid-slot="legal" class="w-9 shrink-0">{BID_GLYPH[strain]}</span>
      <span data-bid-slot="invisible" class="invisible w-9 shrink-0">·</span>
    {/each}
  {/each}
</div>`;

test('反证：标记齐全但仍按合法花色摆放（补位）必须被判出来', () => {
  const result = checkBidSlots(PADDED_SLOTS);
  assert.equal(result.ok, false, '补位形状混过了守卫');
  assert.match(result.reason, /row\.strains/);
});

test('反证：不可叫的花色渲染成 <button>（隐形但可点）必须被判出来', () => {
  const clickablePlaceholder = `<div data-bid-trigger="line">
  <button data-bid-slot="legal" class="w-9 shrink-0">♣</button>
  <button data-bid-slot="invisible" class="invisible w-9 shrink-0">♦</button>
</div>`;
  const result = checkBidSlots(clickablePlaceholder);
  assert.equal(result.ok, false, '可点的隐形占位被判为通过：那正是误触的来源');
  assert.match(result.reason, /不可点/);
});

test('反证：缺 data-bid-trigger、或取值不在枚举里，都必须被判出来', () => {
  assert.match(
    checkBidSlots('<div><span data-bid-slot="legal" class="w-9 shrink-0">♣</span></div>').reason,
    /data-bid-trigger/
  );
  assert.match(
    checkBidSlots(
      '<div data-bid-trigger="maybe"><span data-bid-slot="legal" class="w-9 shrink-0">♣</span></div>'
    ).reason,
    /line/
  );
});

/**
 * 几何不变式的反证：**跳叫触发钮挤回档位行**、**槽位丢掉 shrink-0** —— 两者都会让
 * 「同一横向位置在不同档之间换了位置」，而它们在渲染完的 HTML 上根本看不出来
 * （隐形占位与可叫槽长得一样）。真正的像素证据在 `scripts/shot-auction.ts` 的实测断言。
 */
test('反证：触发钮挤进档位行、或槽位丢掉 shrink-0，都必须被判出来', () => {
  const noShrink = `<div data-bid-trigger="line">
  <div data-bid-row="40">
    <span class="w-7 shrink-0">40</span>
    <button data-bid-slot="legal" class="w-9">♣</button>
  </div>
</div>`;
  assert.match(checkBidSlots(noShrink).reason, /shrink-0/, '槽位丢掉 shrink-0 没有被判出来');

  const triggerInsideRow = `<div data-bid-trigger="line">
  <div data-bid-row="40">
    <span class="w-7 shrink-0">40</span>
    <button data-bid-slot="legal" class="w-9 shrink-0">♣</button>
    <button data-bid-jump="line">▶ 跳叫</button>
  </div>
</div>`;
  assert.match(
    checkBidSlots(triggerInsideRow).reason,
    /档位行/,
    '触发钮挤进档位行没有被判出来（那一行会被压窄，两行的槽就错开了）'
  );
});

/**
 * 面板里三块的先后：信息面 → 候选档位 → 历史表（「不叫」是历史之后、正常文档流里的页脚）。
 * 页脚排错位置就会压住排在它前面的最后一块内容 —— 顺序错了会重现「不叫遮住叫品档位」。
 */
function panelOrder(markup: string): 'ok' | 'missing' | 'wrong' {
  const info = markup.indexOf('<AuctionInfo');
  const tiers = markup.indexOf('{#each layout.tiers as tier');
  const history = markup.indexOf('<AuctionHistory');
  if (info < 0 || tiers < 0 || history < 0) return 'missing';
  return info < tiers && tiers < history ? 'ok' : 'wrong';
}

test('候选档位排在信息面之后、历史表之前（「不叫」只能压住历史）', () => {
  assert.equal(
    panelOrder(source),
    'ok',
    'BidPanel 里三块的顺序不对：候选档位必须夹在信息面与历史表之间，否则「不叫」会压住要点的按钮'
  );
});

test('反证：旧的「历史 → 档位 → 不叫」顺序必须被判为错序', () => {
  const OLD_ORDER = `<AuctionInfo />
<AuctionHistory />
{#each layout.tiers as tier}
<button class="sticky bottom-4 min-h-11">不叫</button>`;
  assert.equal(panelOrder(OLD_ORDER), 'wrong', '旧顺序被判为合规：这条守卫是空转的');
  assert.equal(panelOrder('<AuctionInfo />'), 'missing', '缺块时应返回 missing');
});

test('历史是三列表格，信息面头部不再写「发牌」', () => {
  const history = readComponent('AuctionHistory');
  const info = readComponent('AuctionInfo');
  assert.ok(history.includes('<table') && history.includes('<thead'), '叫牌历史不是表格：昵称长度会决定一行塞几个人');
  assert.ok(!history.includes('flex flex-wrap gap-1.5'), '叫牌历史又回到了碎片流（flex-wrap 的昵称+叫品）');
  assert.ok(!info.includes('发牌'), '叫牌信息面又写上了发牌人（「发牌」对新手不透明，界面上已统一删除）');
  assert.ok(/第 \{deal\?\.dealNo \?\? 1\} 副/.test(info), '叫牌信息面没有「第 N 副」');
});

test('反证：旧的发牌人头部文案必须被判出来', () => {
  const OLD_HEADER = '第 {deal?.dealNo ?? 1} 副 · {whoLabel(names, mySeat, deal?.dealerSeat ?? 0)} 发牌';
  assert.ok(OLD_HEADER.includes('发牌'), '旧的头部文案没有「发牌」二字：这条反证本身写错了');
});


/**
 * f40bad9（= 修复前 HEAD）的 `<section>` 逐字抄本。两处必要改动：
 * 1. 补上 `data-bid-panel="true"` —— 这次新引入的定位钩子，不补守卫连面板都找不到；
 *    除此之外每个 class 都与那个 commit 一模一样。
 * 2. 源码里那处 JS 模板字面量写成 `\`\${turnName}\``，否则外层模板字面量会自己插值。
 *
 * 刻意不写进 fixture 文件、也不在测试里跑 `git show`：CI 是浅克隆，取不到这个 commit，
 * 反证就成了「有时红有时绿」。抄本配合下面那条断言，跑在任何机器上都一样。
 */
const OLD_PANEL = `<section
  data-bid-panel="true"
  class="absolute inset-x-3 top-[22%] flex max-h-[56%] flex-col overflow-hidden rounded-2xl bg-black/55 p-4 ring-1 ring-white/10 backdrop-blur-sm sm:inset-x-0 sm:top-1/2 sm:mx-auto sm:max-h-[74%] sm:w-[22rem] sm:-translate-y-1/2 sm:p-5"
>
  <div class="flex shrink-0 items-baseline justify-between">
    <h2 class="text-sm font-bold">叫牌</h2>
    <span class="text-[11px] text-white/45">
      第 {deal?.dealNo ?? 1} 副 · {whoLabel(names, mySeat, deal?.dealerSeat ?? 0)} 发牌
    </span>
  </div>

  <!-- 大字：最后一次有效叫品 -->
  <div class="mt-2 flex shrink-0 items-baseline justify-between gap-2">
    {#if top === null}
      <span class="text-2xl font-black tracking-wide text-white/35">还没人叫</span>
    {:else}
      <span class="text-3xl font-black leading-none tracking-wide tabular-nums text-gold">
        {top.points}<span class={isRedStrain(top.strain) ? 'text-rose-300' : ''}>{BID_GLYPH[top.strain]}</span>
      </span>
    {/if}
    {#if deal !== null}
      <span
        class={[
          'shrink-0 rounded-md px-2 py-1 text-[11px]',
          myTurn ? 'bg-gold/25 ring-1 ring-gold/40' : 'bg-white/10 text-white/55'
        ]}
      >
        {myTurn ? '轮到你' : \`\${turnName} 叫牌中\`}
      </span>
    {/if}
  </div>

  <!-- 历史：自己滚，不再把下面的按钮顶出去 -->
  <div class="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <div class="flex flex-wrap gap-1.5 text-[11px]">
      {#each deal?.auction ?? [] as entry, index (index)}
        <span class="rounded-md bg-white/10 px-2 py-1">
          <span class="text-white/50">{whoLabel(names, mySeat, entry.seat)}</span>
          {bidText(entry.call)}
        </span>
      {/each}
    </div>
  </div>

  {#if myTurn}
    <!-- 候选区也自己滚：「不叫」固定在它下面 -->
    <div class="mt-3 max-h-44 shrink-0 space-y-1.5 overflow-y-auto overscroll-contain sm:max-h-56">
      {#each rows as row (row.points)}
        <div class="flex items-center gap-1.5">
          <span class="w-7 shrink-0 text-right text-xs tabular-nums text-white/55">{row.points}</span>
          {#each row.strains as strain (strain)}
            <button
              type="button"
              class={['bidbtn rounded-lg bg-white/10 px-2.5 py-1.5 text-[13px] hover:bg-white/20',
                isRedStrain(strain) && 'text-rose-300']}
              disabled={client.busy}
              onclick={() => void client.bid({ points: row.points, strain })}
            >
              {BID_GLYPH[strain]}
            </button>
          {/each}
        </div>
      {/each}
    </div>
    <button
      type="button"
      class="mt-2 shrink-0 rounded-lg border border-white/25 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"
      disabled={client.busy}
      onclick={() => void client.bid('pass')}
    >
      不叫
    </button>
  {/if}
</section>`;

/** 正对照：这一版的目标形状 —— flex 列 + 可伸缩的历史滚动区 + 正常文档流里的页脚 */
const PANEL_OK = `<section data-bid-panel="true" class="flex max-h-[56%] flex-col overflow-y-auto">
  <div class="shrink-0">信息面</div>
  <div class="mt-3 shrink-0">三档</div>
  <div class="mt-1 min-h-0 flex-1 overflow-y-auto">历史</div>
  <button type="button" class="mt-3 min-h-11 w-full shrink-0">不叫</button>
</section>`;

/**
 * 上一版的形状：面板自己滚 + 「不叫」sticky 贴底。
 * 按钮点得到，但它是**浮**在内容上的 —— 滚动时压住排在最后的历史行。
 */
const STICKY_FOOTER = `<section data-bid-panel="true" class="flex max-h-[56%] flex-col overflow-y-auto">
  <div class="shrink-0">信息面</div>
  <div class="mt-1 min-h-0 flex-1 overflow-y-auto">历史</div>
  <button type="button" class="sticky bottom-4 mt-3 min-h-11 w-full shrink-0">不叫</button>
</section>`;

/** 面板自己滚，但滚动块是固定高度的（shrink-0 + max-h-*）：固定开销照样能把按钮顶出去 */
const RIGID_SCROLL = `<section data-bid-panel="true" class="flex max-h-[56%] flex-col overflow-y-auto">
  <div class="shrink-0">信息面</div>
  <div class="mt-3 max-h-44 shrink-0 overflow-y-auto">历史</div>
  <button type="button" class="mt-3 min-h-11 w-full shrink-0">不叫</button>
</section>`;

/** 面板自己滚、但里面根本没有可伸缩的滚动区：历史一长就把按钮顶出面板 */
const NO_HISTORY_SCROLL = `<section data-bid-panel="true" class="flex max-h-[56%] flex-col overflow-y-auto">
  <div class="shrink-0">信息面</div>
  <button type="button" class="mt-3 min-h-11 w-full shrink-0">不叫</button>
</section>`;

test('正对照：flex 列 + 可伸缩的历史滚动区 + 正常文档流的页脚 = 通过', () => {
  const result = checkBidPanelReachability(PANEL_OK);
  assert.equal(result.ok, true, `目标形状被判为不可达：${result.reason}`);
});

test('反证：f40bad9 的旧形状必须被判为不可达（它用 overflow-hidden 裁掉了「不叫」）', () => {
  const result = checkBidPanelReachability(OLD_PANEL);
  assert.equal(result.ok, false, '旧形状被判为通过：守卫是空转的');
  assert.match(result.reason, /overflow-hidden/);
});

test('反证：sticky 页脚必须被判出来（它浮在历史行上，压掉那半行叫牌记录）', () => {
  const result = checkBidPanelReachability(STICKY_FOOTER);
  assert.equal(result.ok, false, 'sticky 页脚被判为通过：那种形状会遮挡内容');
  assert.match(result.reason, /sticky/);
});

test('反证：固定高度、不可伸缩的滚动块必须被判出来', () => {
  const result = checkBidPanelReachability(RIGID_SCROLL);
  assert.equal(result.ok, false, '不可伸缩的滚动块被判为通过');
  assert.match(result.reason, /可伸缩/);
});

test('反证：面板里没有历史滚动区时必须点出来', () => {
  const result = checkBidPanelReachability(NO_HISTORY_SCROLL);
  assert.equal(result.ok, false, '没有历史滚动区却判为通过');
  assert.match(result.reason, /找不到叫牌历史的滚动区/);
});

test('观战者/非本家轮次的页面：没有「不叫」按钮也要能单独校验面板本身', () => {
  const withoutButton = PANEL_OK.replace(/\s*<button[\s\S]*?<\/button>/, '');
  assert.equal(checkBidPanelReachability(withoutButton).ok, false, '默认口径下缺按钮就该红');
  assert.equal(
    checkBidPanelReachability(withoutButton, { requirePassButton: false }).ok,
    true,
    'requirePassButton:false 时应只看面板本身（ui-check 在没轮到的页面上用这一档）'
  );
});
