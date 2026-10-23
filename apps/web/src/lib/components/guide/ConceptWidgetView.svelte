<script lang="ts">
  /**
   * 概念挂件（原 `deck/DeckWidget.svelte`）。
   *
   * 幻灯片退役后它服务的是新手引导的**概念简述屏**；示例仍全部取自 `tutorial/scenarios.ts`
   * —— 那些牌面都被 `tutorial.test.ts` 逐个用引擎核对过，这里不新造第二份事实。
   * 每种 `kind` 只渲染既有示例，不接受 props 之外的输入。
   */
  import { cardKey, cardsPoints, levelLabel } from '@sixty/engine';
  import CardRow from '$lib/components/CardRow.svelte';
  import HandFan from '$lib/components/HandFan.svelte';
  import LevelBadge from '$lib/components/LevelBadge.svelte';
  import TrickCluster from '$lib/components/TrickCluster.svelte';
  import { bidText, strainGlyph, trumpText } from '$lib/labels';
  import { settlePreview } from '$lib/settle';
  import type { ConceptWidget } from '$lib/guide/types';
  import {
    BURY_HAND,
    DEFENDER_STEPS,
    DEMO_AUCTION,
    DEMO_CONTRACT,
    DEMO_KITTY,
    DEMO_SETTLE_INPUT,
    FOLLOW_ANSWER,
    KITTY_EQUATION,
    LEAD_CASES,
    LEVEL_DEMO,
    LEVEL_STEPS,
    MULTIPLIER_ROWS,
    POINT_UNITS,
    RUFF_LEAD,
    RUFF_WINNER,
    TRICK_DEMO,
    TRUMP_HEARTS,
    TRUMP_LADDER_GROUPS,
    TRUMP_NT,
    TRUMP_RUN_CROSS,
    TRY_FOLLOW,
    TUTORIAL_NAMES,
    UPGRADE_ROWS,
    cardsOf,
    sideSuitCards,
    trumpCount,
    trumpGroups
  } from '$lib/tutorial/scenarios';

  let { widget }: { widget: ConceptWidget } = $props();

  const box = 'rounded-xl bg-black/30 p-3';
  const env = 'mb-2 text-xs text-gold/70';
  const chip = 'rounded-md bg-white/10 px-2 py-1 text-xs';

  const ntTrumps = trumpGroups(TRUMP_NT);
  const clubSuit = sideSuitCards(TRUMP_HEARTS, 'C');
  const leadCases = LEAD_CASES.map((item) => ({ ...item, cards: cardsOf(item.keys) }));
  const bars = settlePreview(DEMO_SETTLE_INPUT);
  const steps = LEVEL_STEPS;
  const trickDemoPoints = cardsPoints(TRICK_DEMO);
  const kittyPoints = cardsPoints(DEMO_KITTY);
</script>

{#if widget.kind === 'point-values'}
  <div class={box}>
    <ul class="grid grid-cols-3 gap-x-2 gap-y-3">
      {#each POINT_UNITS as unit (cardKey(unit.card))}
        <li class="flex flex-col items-center gap-1">
          <CardRow cards={[unit.card]} size="md" />
          <span class={unit.points > 0 ? 'text-xs font-semibold text-gold' : 'text-xs text-white/45'}>
            {unit.points} 分
          </span>
        </li>
      {/each}
    </ul>
  </div>
{:else if widget.kind === 'point-places'}
  <!-- 一张图说完「一墩」：三张牌摊在桌上，分就压在这几张里 —— 比分归赢家那句话好读 -->
  <div class={box}>
    <p class={env}>一墩就这么三张 —— 谁大，这 {trickDemoPoints} 分就归谁</p>
    <CardRow cards={TRICK_DEMO} trump={TRUMP_HEARTS} size="md" />
  </div>
{:else if widget.kind === 'trump-groups'}
  <!-- 无主那一屏只摆无主：有主那 18 张是别的屏讲的事，摆在这里只会把「只剩 6 张」埋掉 -->
  <div class={box}>
    <p class={env}>
      本副：{trumpText(TRUMP_NT)} —— 整副主牌只剩 {trumpCount(TRUMP_NT)} 张（有主时是 {trumpCount(TRUMP_HEARTS)} 张）
    </p>
    <div class="space-y-2">
      {#each ntTrumps as group (group.title)}
        <div>
          <p class="mb-1 text-[12px] text-white/55">
            <b class="text-ivory">{group.title}</b>（{group.cards.length} 张）· {group.hint}
          </p>
          <CardRow cards={group.cards} trump={TRUMP_NT} size="sm" />
        </div>
      {/each}
    </div>
  </div>
{:else if widget.kind === 'trump-ladder'}
  <!-- 座次是**从上到下**的一条阶梯：一张一行，标题与说明贴着自己那一行。
       原来是一横排五组 + 底下再列五条重名的说明，尺寸一窄就挤成两行、说明还与卡片对不上号 -->
  <div class={box}>
    <p class={env}>主牌从大到小，一行一级</p>
    <div class="space-y-2.5">
      {#each TRUMP_LADDER_GROUPS as group (group.title)}
        <div>
          <p class="mb-1 text-[12px] leading-snug">
            <b class="text-ivory">{group.title}</b>
            <span class="text-white/45"> · {group.note}</span>
          </p>
          <CardRow cards={group.cards} trump={TRUMP_HEARTS} size="sm" gap="gap-1" />
        </div>
      {/each}
    </div>
  </div>
{:else if widget.kind === 'side-suit'}
  <div class={box}>
    <p class={env}>本副：{trumpText(TRUMP_HEARTS)} —— ♣ 整门 {clubSuit.length} 张，数一数，缺的正是 ♣5</p>
    <CardRow cards={clubSuit} trump={TRUMP_HEARTS} size="md" />
  </div>
{:else if widget.kind === 'trump-run-cross'}
  <div class={box}>
    <p class={env}>本副：{trumpText(TRUMP_HEARTS)} —— 下面这 {TRUMP_RUN_CROSS.length} 张就是一条合法顺子</p>
    <CardRow
      cards={TRUMP_RUN_CROSS}
      trump={TRUMP_HEARTS}
      size="md"
      highlight={TRUMP_RUN_CROSS.map(cardKey).slice(3)}
    />
  </div>
{:else if widget.kind === 'bid-demo'}
  <div class={box}>
    <p class={env}>这副牌的叫牌，发牌人是你</p>
    <div class="flex flex-wrap gap-1.5">
      {#each DEMO_AUCTION as entry, index (index)}
        <span class={chip}>
          <span class="text-white/50">{TUTORIAL_NAMES[entry.seat]}</span>
          {bidText(entry.call)}
        </span>
      {/each}
    </div>
    <p class="mt-2 text-[12px] leading-relaxed text-ivory">
      → {TUTORIAL_NAMES[DEMO_CONTRACT.declarerSeat]} {DEMO_CONTRACT.points}{strainGlyph(DEMO_CONTRACT.strain)}
      坐庄：主打 {strainGlyph(DEMO_CONTRACT.strain)}、要抓够 {DEMO_CONTRACT.points} 分。
    </p>
  </div>
{:else if widget.kind === 'bury-demo'}
  <div class="space-y-3">
    <div class={box}>
      <p class={env}>本副：{trumpText(TRUMP_HEARTS)}（20 张，这里摊开 12 张）</p>
      <HandFan hand={BURY_HAND} trump={TRUMP_HEARTS} />
    </div>
    <div class={box}>
      <p class="text-[12px] text-white/55">从底下拿上来的三张，一共 {kittyPoints} 分</p>
      <CardRow cards={DEMO_KITTY} size="md" />
    </div>
  </div>
{:else if widget.kind === 'multiplier'}
  <div class={box}>
    <div class="flex flex-wrap gap-1.5">
      {#each MULTIPLIER_ROWS as row (row.lastTrick)}
        <span class={chip}>{row.lastTrick} → 底分 × <b class="text-gold">{row.multiplier}</b></span>
      {/each}
    </div>
    <ul class="mt-2 space-y-0.5 text-[12px]">
      <li>最后一轮<b class="text-emerald-300">庄家赢</b> → 加分，叫<b class="text-emerald-300">保底</b>。</li>
      <li>最后一轮<b class="text-rose-300">闲家赢</b> → 扣分，叫<b class="text-rose-300">抠底</b>。</li>
      <li class="text-white/60">底牌 10 分、末轮 2 张时，最后一轮的输赢就能摆动 ±20 分。</li>
    </ul>
  </div>
{:else if widget.kind === 'lead-cases'}
  <div class={box}>
    <p class={env}>本副：{trumpText(TRUMP_HEARTS)}（浅金底 = 主牌）</p>
    <div class="space-y-2">
      {#each leadCases as item, index (index)}
        <div class="flex flex-wrap items-center gap-2">
          <span class={item.ok ? 'text-[12px] font-semibold text-emerald-300' : 'text-[12px] font-semibold text-rose-300'}>
            {item.ok ? '✓' : '✗'}
          </span>
          <CardRow cards={item.cards} trump={TRUMP_HEARTS} size="md" dim={item.ok ? [] : item.cards.map(cardKey)} />
          <span class="text-[12px] text-white/50">{item.note}</span>
        </div>
      {/each}
    </div>
  </div>
{:else if widget.kind === 'follow-answer'}
  <div class={box}>
    <p class={env}>本副：{trumpText(TRY_FOLLOW.trump)}</p>
    <div class="flex flex-wrap items-end gap-4">
      <TrickCluster cards={TRY_FOLLOW.lead ?? []} trump={TRY_FOLLOW.trump} caption="上家领出 4 张 ♣ 顺子" />
      <span class="pb-6 text-white/30">→</span>
      <TrickCluster cards={FOLLOW_ANSWER} trump={TRY_FOLLOW.trump} caption="你跟：♣3-4-6 + ♣Q" />
    </div>
  </div>
{:else if widget.kind === 'ruff-contrast'}
  <div class={box}>
    <p class={env}>本副：{trumpText(TRUMP_HEARTS)}（♠ 是副牌；♥ 与四张 5、双王都是主牌）</p>
    <div class="flex flex-wrap items-end gap-4">
      <TrickCluster cards={RUFF_LEAD} trump={TRUMP_HEARTS} caption="副牌里最大的三张：♠A-K-Q" />
      <span class="pb-6 text-white/30">→</span>
      <TrickCluster cards={RUFF_WINNER} trump={TRUMP_HEARTS} caption="主牌里最小的三张" badge="赢墩" />
    </div>
  </div>
{:else if widget.kind === 'settle-equation'}
  <div class={box}>
    <div class="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
      <span>墩分 <b class="text-ivory">{KITTY_EQUATION.trickPoints}</b></span>
      <span class="text-white/40">±</span>
      <span>底牌 <b class="text-ivory">{KITTY_EQUATION.kittyPoints}</b> 分 × 末轮 <b class="text-ivory">{KITTY_EQUATION.multiplier}</b> 张</span>
      <span class="text-white/40">=</span>
      <span>最终得分</span>
    </div>
    <ul class="mt-2 space-y-0.5 text-[12px]">
      <li>庄家赢末轮（保底）：{KITTY_EQUATION.trickPoints} + {KITTY_EQUATION.kittyPoints} × {KITTY_EQUATION.multiplier} = <b class="text-emerald-300">{KITTY_EQUATION.madeFinal}</b> ≥ {KITTY_EQUATION.contract} → 打成</li>
      <li>闲家赢末轮（抠底）：{KITTY_EQUATION.trickPoints} − {KITTY_EQUATION.kittyPoints} × {KITTY_EQUATION.multiplier} = <b class="text-rose-300">{KITTY_EQUATION.setFinal}</b> &lt; {KITTY_EQUATION.contract} → 打输</li>
      <li class="text-white/55">闲家要打输庄家：保底时得严格超过 {bars.protectBar} 分，抠底时超过 {bars.digBar} 分——不是直觉的 100 − 定约 = {bars.naiveBar}。</li>
    </ul>
  </div>
{:else if widget.kind === 'upgrade-table'}
  <div class="space-y-3">
    <div class={box}>
      <p class="text-[12px] text-white/55">打成 → 庄家升级（只看最终得分）</p>
      <div class="mt-1.5 overflow-hidden rounded-lg ring-1 ring-white/10">
        <table class="w-full text-[12px]">
          <thead class="bg-white/5 text-white/50">
            <tr><th class="px-3 py-1 text-left font-semibold">最终得分</th><th class="px-3 py-1 text-left font-semibold">庄家升级</th></tr>
          </thead>
          <tbody>
            {#each UPGRADE_ROWS as row (row.range)}
              <tr class="border-t border-white/5">
                <td class="px-3 py-1 tabular-nums">{row.range}</td>
                <td class="px-3 py-1 text-gold">{row.levels}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    <div class={box}>
      <p class="text-[12px] text-white/55">打输 → 庄家不动，两家闲家各升 ⌈差 ÷ 10⌉ 级</p>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        {#each DEFENDER_STEPS as step (step.shortfall)}
          <span class={chip}>差 {step.shortfall} → 各升 <b class="text-gold">{step.levels}</b> 级</span>
        {/each}
      </div>
    </div>
    <div class={box}>
      <p class="text-[12px] text-white/55">「升 N 级」就是从当前级别往前推 N 级，跨过 A 就进位</p>
      <div class="mt-1.5 flex flex-wrap items-center gap-4">
        {#each LEVEL_DEMO as level, index (index)}
          <div class="text-center">
            <LevelBadge {level} />
            <p class="mt-1 text-[12px] text-white/45">{levelLabel(level)}</p>
          </div>
        {/each}
      </div>
      <div class="mt-2 space-y-1">
        {#each steps as step, index (index)}
          <p class="rounded-lg bg-black/30 px-2.5 py-1 text-[12px]">
            {levelLabel(step.from)} 升 {step.levels} 级 →
            <b class="text-gold">{levelLabel(step.to)}</b>
            <span class="ml-1 text-white/45">（{step.note}）</span>
          </p>
        {/each}
      </div>
    </div>
  </div>
{/if}
