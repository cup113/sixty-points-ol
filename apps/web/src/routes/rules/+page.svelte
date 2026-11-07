<script lang="ts">
  import {
    cardKey,
    cardsPoints,
    levelFromProgress,
    levelLabel,
    levelProgress,
    madeLevels,
    type BidCall
  } from '@sixty/engine';
  import CardView from '$lib/components/Card.svelte';
  import CardRow from '$lib/components/CardRow.svelte';
  import HandFan from '$lib/components/HandFan.svelte';
  import LevelBadge from '$lib/components/LevelBadge.svelte';
  import TrickCluster from '$lib/components/TrickCluster.svelte';
  import TryPlay from '$lib/components/TryPlay.svelte';
  import { strainGlyph, trumpText } from '$lib/labels';
  import { settlePreview } from '$lib/settle';
  import {
    BURY_HAND,
    cardsOf,
    DEFENDER_STEPS,
    DEMO_AUCTION,
    DEMO_CONTRACT,
    DEMO_KITTY,
    DEMO_SETTLE_INPUT,
    FOLLOW_ANSWER,
    FOLLOW_SHORT_HAND,
    FOLLOW_SHORT_LEAD,
    KITTY_EQUATION,
    KITTY_SWING,
    LEAD_CASES,
    LEVEL_DEMO,
    LEVEL_STEPS,
    MULTIPLIER_ROWS,
    PHASES,
    POINT_CARDS,
    POINT_ROWS,
    RUFF_LEAD,
    RUFF_WINNER,
    RUN_NOT_ADJACENT,
    RUN_SKIPS_LEVEL,
    sideSuitCards,
    TRICK_DEMO,
    TRUMP_HEARTS,
    TRUMP_LADDER_GROUPS,
    TRUMP_NT,
    TRUMP_RUN,
    TRUMP_RUN_CROSS,
    TRY_FOLLOW,
    TRY_RUFF,
    TUTORIAL_NAMES,
    UPGRADE_ROWS,
    trumpCount,
    trumpGroups
  } from '$lib/tutorial/scenarios';

  const TOC: readonly { readonly id: string; readonly label: string }[] = [
    { id: 'start', label: '目标' },
    { id: 'points', label: '分值' },
    { id: 'trump', label: '主牌' },
    { id: 'auction', label: '叫牌' },
    { id: 'bury', label: '埋底' },
    { id: 'play', label: '打牌' },
    { id: 'inference', label: '打牌推论' },
    { id: 'scoring', label: '结算' },
    { id: 'spectate', label: '观战与离座' }
  ];

  const section = 'scroll-mt-4 rounded-2xl bg-black/25 p-4 ring-1 ring-white/10 sm:p-5';
  const heading = 'text-base font-bold text-ivory';
  const body = 'mt-2 space-y-2 text-xs leading-relaxed text-white/65';
  const chip = 'rounded-md bg-white/10 px-2 py-1';
  /** 每个静态示例块顶部的将牌环境说明 */
  const env = 'mb-2 text-[11px] text-gold/70';
  const subhead = 'pt-1 font-semibold text-white/80';

  function callLabel(call: BidCall): string {
    return call === 'pass' ? '不叫' : `${call.points}${strainGlyph(call.strain)}`;
  }

  const kittyPoints = cardsPoints(DEMO_KITTY);
  const trickDemoPoints = cardsPoints(TRICK_DEMO);
  const heartTrumps = trumpGroups(TRUMP_HEARTS);
  const ntTrumps = trumpGroups(TRUMP_NT);
  const clubSuit = sideSuitCards(TRUMP_HEARTS, 'C');

  /** 领出示例：键 → 牌面只算一次，`dim` 要用 cardKey 而不是教程里的别名键 */
  const leadCases = LEAD_CASES.map((item) => ({ ...item, cards: cardsOf(item.keys) }));

  /** 闲家门槛：由底牌分与末轮张数算出，页面不手写数字 */
  const settle = settlePreview(DEMO_SETTLE_INPUT);

  /** 升级步进：用引擎自己的换算函数算目标级别，避免教程另写一套算术 */
  const steps = LEVEL_STEPS.map((step) => ({
    ...step,
    to: levelFromProgress(levelProgress(step.from) + step.levels)
  }));

  /** 结算那一节的四个数，全部由引擎函数推出，正文里不出现手写的 3 / 10 / 8(+0) / 20 */
  const madeLevelsNow = madeLevels(KITTY_EQUATION.madeFinal);
  const shortfallLevels = Math.ceil((KITTY_EQUATION.contract - KITTY_EQUATION.setFinal) / 10);
  const swing = kittyPoints * KITTY_EQUATION.multiplier;
  const demoAfterLabel = levelLabel(
    levelFromProgress(levelProgress({ rank: 5, cycle: 0 }) + madeLevelsNow)
  );
</script>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
  <header>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <a class="text-xs text-white/50 hover:text-white" href="/">← 大厅</a>
      <a class="text-xs font-semibold text-gold hover:underline" href="/learn">不想读长文？看规则演示（幻灯片）→</a>
    </div>
    <h1 class="mt-2 text-2xl font-black tracking-wide text-ivory">新手教程</h1>
    <div class="mt-2 space-y-2 text-xs leading-relaxed text-white/55">
      <p>
        一言以蔽之，六十分是<b class="text-ivory">桥牌</b>、<b class="text-ivory">双升（八十分 / 拖拉机）</b>、<b
          class="text-ivory">斗地主</b
        >的融合版。如果你接触过<b class="text-ivory">五十 K</b>、<b class="text-ivory">掼蛋</b>，也可能见到一些熟悉的概念。
      </p>
      <p>六十分给希望拥有双升 / 桥牌一般体验、但只能凑出 <b class="text-ivory">3 个人</b>的牌友提供一种新玩法。</p>
    </div>
  </header>

  <nav class="flex flex-wrap gap-1.5 text-[11px]">
    {#each TOC as item (item.id)}
      <a class="rounded-full bg-black/30 px-3 py-1 text-white/65 ring-1 ring-white/10 hover:bg-black/50" href={`#${item.id}`}
        >{item.label}</a
      >
    {/each}
  </nav>

  <section id="start" class={section}>
    <h2 class={heading}>1. 目标：六十分的胜败关键</h2>
    <div class={body}>
      <p>
        六十分的<b class="text-ivory">每一副都是「1v2」</b>。叫到牌的那个人当<b class="text-ivory">庄家</b>，另外两家临时联手当<b
          class="text-ivory">闲家</b
        >。一副牌的胜败关键就是：
      </p>
      <p class="rounded-xl bg-black/30 p-3 text-[13px] font-semibold text-ivory">
        庄家抓到的分，有没有达到他叫出去的分数。
      </p>
      <p>如果够了，庄家升级；如果不够，两家闲家升级。</p>
      <p>
        所以，从全局尺度看，最终任务是<b class="text-ivory">升级</b>；从单局尺度看，最终任务是<b class="text-ivory">得分</b>。
      </p>

      <p class={subhead}>一副牌一共有四个阶段：</p>
      <div class="flex flex-wrap items-stretch gap-1.5">
        {#each PHASES as phase, index (phase.id)}
          <a
            class="flex-1 rounded-xl bg-black/30 p-2.5 ring-1 ring-white/10 hover:bg-black/50"
            href={`#${phase.id}`}
          >
            <p class="text-[11px] font-bold text-gold">{index + 1}. {phase.label}</p>
            <p class="mt-0.5 text-[10px] leading-snug text-white/55">{phase.blurb}</p>
          </a>
        {/each}
      </div>

      <ul class="ml-4 list-disc space-y-1">
        <li><b class="text-ivory">发牌</b>：54 张，每人 17 张，剩 3 张扣着不动，叫「<b class="text-ivory">底牌</b>」。</li>
        <li><b class="text-ivory">座次</b>：<b class="text-ivory">庄家出第一轮</b>，之后每轮由上轮的赢家先出。</li>
        <li>第一个发牌的人也<b class="text-ivory">先叫牌</b>，每副轮换。</li>
        <li>一共 17 轮，三家每轮各出一次。</li>
      </ul>

      <p>
        每个人有<b class="text-ivory">独立的级别</b>：从 <b class="text-gold">2</b> 开始一级一级往上，爬完 <b class="text-gold">A</b> 再套圈进入下一轮的
        <b class="text-gold">2</b>，记作 <b class="text-ivory">5(+0)</b>、<b class="text-ivory">A(+1)</b>、<b class="text-ivory">5(+2)</b>。
      </p>
    </div>
  </section>

  <section id="points" class={section}>
    <h2 class={heading}>2. 分：总计 100 分</h2>
    <div class={body}>
      <p>
        全场一共 <b class="text-ivory">100 分</b>，只藏在三种牌里：
      </p>
      <CardRow cards={POINT_CARDS} size="md" />
      <div class="flex flex-wrap gap-1.5">
        {#each POINT_ROWS as row (row.label)}
          <span class={chip}>{row.label} = <b class="text-gold">{row.points}</b> 分</span>
        {/each}
      </div>
      <p>四张 5 = 20 分、四张 10 = 40 分、四张 K = 40 分，加起来正好 100。</p>

      <p>一副牌打完，这 100 分只会落在三个地方：</p>
      <p class="rounded-xl bg-black/30 p-3 text-[13px] font-semibold text-ivory">
        庄家赢下的轮里的分 ＋ 闲家赢下的轮里的分 ＋ 底牌那 3 张的分 ＝ 100
      </p>
      <p>
        注意：<b class="text-ivory">底牌</b>的分不算在任何人的轮里，只在最后算账时按倍数记到庄家头上（第 5 节）。
      </p>

      <div class="pt-1">
        <p class={env}>一墩三张 —— 这一轮的分记给赢家（这墩里带 {trickDemoPoints} 分）</p>
        <CardRow cards={TRICK_DEMO} trump={TRUMP_HEARTS} size="md" />
      </div>
    </div>
  </section>

  <section id="trump" class={section}>
    <h2 class={heading}>3. 主牌：一副 18 张的大牌</h2>
    <div class={body}>
      <p>
        <b class="text-ivory">主牌压副牌</b>，这是这副牌唯一真正的强弱关系：只要一轮里能凑出跟对手<b class="text-ivory">同样张数</b
        >的主牌连牌，就能直接赢下来，不用比大小。
      </p>

      <p>哪些牌算主牌？三部分：</p>
      <ol class="ml-4 list-decimal space-y-1">
        <li><b class="text-ivory">大小王</b> —— 永远算主牌，而且永远是最大的两张。</li>
        <li>
          <b class="text-ivory">级牌</b> —— <b>点数等于庄家级别的那四张</b>，什么花色都算；本副示例里庄家级别是
          <b class="text-gold">5</b>，所以四张 5 全是主牌。
        </li>
        <li><b class="text-ivory">主花色</b> —— 叫牌叫到的那个花色，整门都算。示例主打 ♥，所以 ♥ 整门都是主牌。</li>
      </ol>

      <p>
        三部分加起来，示例这一副共 <b class="text-gold">{trumpCount(TRUMP_HEARTS)} 张主牌</b>（♥5 已经在「四张 5」里数过，不重复）：
      </p>
      <p class={env}>本副：{trumpText(TRUMP_HEARTS)}</p>
      <div class="space-y-2 rounded-xl bg-black/30 p-3">
        {#each heartTrumps as group (group.title)}
          <div>
            <p class="mb-1 text-[11px] text-white/55">
              <b class="text-ivory">{group.title}</b>
              （{group.cards.length} 张）· {group.hint}
            </p>
            <CardRow cards={group.cards} trump={TRUMP_HEARTS} size="sm" />
          </div>
        {/each}
      </div>

      <p class="pt-1">
        <b class="text-ivory">如果叫的是「无主」，第 3 部分就没了</b>，主牌只剩
        <b class="text-gold">{trumpCount(TRUMP_NT)} 张</b>：双王 + 四张级牌。同一手牌，主打花色不同，你的强牌会从
        {trumpCount(TRUMP_HEARTS)} 张掉到 {trumpCount(TRUMP_NT)} 张 —— 这就是叫牌挑花色的意义。
      </p>
      <p class={env}>本副：{trumpText(TRUMP_NT)}</p>
      <div class="space-y-2 rounded-xl bg-black/30 p-3">
        {#each ntTrumps as group (group.title)}
          <div>
            <p class="mb-1 text-[11px] text-white/55">
              <b class="text-ivory">{group.title}</b>（{group.cards.length} 张）
            </p>
            <CardRow cards={group.cards} trump={TRUMP_NT} size="sm" />
          </div>
        {/each}
        <p class="text-[11px] text-white/50">无主时四张级牌完全相等，所以主牌的大小只剩「四张 5 &lt; 小王 &lt; 大王」。</p>
      </div>

      <p class={subhead}>主牌内部也分大小，从大到小：</p>
      <div class="flex flex-wrap items-end gap-2 rounded-xl bg-black/30 p-3">
        {#each TRUMP_LADDER_GROUPS as group, index (group.title)}
          {#if index > 0}
            <span class="pb-6 text-white/30">→</span>
          {/if}
          <div>
            <p class="mb-1 text-center text-[10px] text-white/50">{group.title}</p>
            <CardRow cards={group.cards} trump={TRUMP_HEARTS} size="md" gap="gap-1" />
          </div>
        {/each}
      </div>
      <div class="overflow-hidden rounded-xl ring-1 ring-white/10">
        <table class="w-full text-[11px]">
          <thead class="bg-white/5 text-white/50">
            <tr>
              <th class="px-3 py-1.5 text-left font-semibold">顺序</th>
              <th class="px-3 py-1.5 text-left font-semibold">叫什么</th>
              <th class="px-3 py-1.5 text-left font-semibold">说明</th>
            </tr>
          </thead>
          <tbody>
            {#each TRUMP_LADDER_GROUPS as group, index (group.title)}
              <tr class="border-t border-white/5">
                <td class="px-3 py-1.5 tabular-nums text-white/45">{index + 1}</td>
                <td class="px-3 py-1.5 whitespace-nowrap text-gold">{group.title}</td>
                <td class="px-3 py-1.5">{group.note}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <p class="pt-1">
        <b class="text-ivory">副牌那边，每一门都「跳过级牌」。</b> 级牌 5 已经归主牌，所以副牌里根本没有 5 这张牌：♣ 这一门是 ♣2 ♣3 ♣4 ♣6 ♣7
        … ♣A，<b class="text-ivory">♣4 的下家直接就是 ♣6，它们是连着的。</b>
      </p>
      <div>
        <p class={env}>本副：{trumpText(TRUMP_HEARTS)} —— ♣ 这一门整门（{clubSuit.length} 张，没有 ♣5）</p>
        <CardRow cards={clubSuit} trump={TRUMP_HEARTS} size="md" />
      </div>

      <p class="pt-1">
        <b class="text-ivory">顺子可以跨过「主花色 → 级牌 → 王」这个边界</b>，因为它们在主牌里本来就是相邻的：
      </p>
      <div>
        <p class={env}>
          本副：{trumpText(TRUMP_HEARTS)}（浅金底 = 主牌；下面这 {TRUMP_RUN_CROSS.length} 张是一条合法顺子）
        </p>
        <CardRow cards={TRUMP_RUN_CROSS} trump={TRUMP_HEARTS} size="md" highlight={TRUMP_RUN_CROSS.map(cardKey).slice(3)} />
        <p class="mt-1 text-[11px] text-white/50">
          注意：一条主牌顺子里最多只能有一张副级 —— 三张副级完全相等，彼此不算相邻。
        </p>
      </div>
    </div>
  </section>

  <section id="auction" class={section}>
    <h2 class={heading}>4. 叫牌：谁坐庄、打什么、要得多少分</h2>
    <div class={body}>
      <p>
        叫牌一次定下三件事：<b class="text-ivory">庄家是谁、将牌是什么、庄家要得多少分</b>。
      </p>
      <ul class="ml-4 list-disc space-y-1">
        <li>从 <b class="text-ivory">40 分起叫，每次至少加 5 分</b>。</li>
        <li>可以一次跳很高（40 → 60），<b class="text-ivory">没有上限、没有加倍</b>。</li>
        <li>分数优先比大小；分数一样时比花色：♣ &lt; ♦ &lt; ♥ &lt; ♠ &lt; 无主。</li>
        <li>也可以「不叫」。</li>
      </ul>

      <p>
        <b class="text-ivory">什么时候结束</b>：<b class="text-ivory">连续两家不叫</b>，最后叫的那个人成交；如果三家一起不叫，这一副作废重发 ——
        级别不变，只换下一家发牌。
      </p>

      <p>
        不叫不必等到轮到你才点：叫牌面板底下有一行<b class="text-ivory">「这一副剩下的都不叫」</b>，
        勾上之后凡轮到你都会替你过（对家抬价后再次轮到你，也照样过）。它只对这一副有效、换副就作废；
        页面关掉就不作数 —— 所以它救的是「我在看但懒得点」，不是「我人不在」。
      </p>

      <p>看一段真实成交的叫牌（发牌人是你）：</p>
      <div class="flex flex-wrap gap-1.5">
        {#each DEMO_AUCTION as entry, index (index)}
          <span class={chip}>
            <span class="text-white/50">{TUTORIAL_NAMES[entry.seat]}</span>
            {callLabel(entry.call)}
          </span>
        {/each}
      </div>
      <p>
        → <b class="text-gold">{TUTORIAL_NAMES[DEMO_CONTRACT.declarerSeat]} {DEMO_CONTRACT.points}{strainGlyph(
          DEMO_CONTRACT.strain
        )} 坐庄</b
        >：主打 {strainGlyph(DEMO_CONTRACT.strain)}、本副级牌是{TUTORIAL_NAMES[DEMO_CONTRACT.declarerSeat]}的 5、<b
          class="text-ivory"
          >{TUTORIAL_NAMES[DEMO_CONTRACT.declarerSeat]}必须抓够 {DEMO_CONTRACT.points} 分才算打成</b
        >。
      </p>

      <p>
        <b class="text-ivory">叫牌是「认领责任」。</b>成交之后你一个人对两家，叫多少就至少要抓多少。
      </p>
      <p>
        所谓「六十分」，便是在长时间的试验中找到的平衡：一般而言，平均成交分数和最终获得分数的平均值大概是这个数。
      </p>

      <p>
        <b class="text-ivory">升级只看你实际抓了多少分，跟叫了多少分没关系，这和桥牌是不一样的</b>。叫 45 打成、拿到 75 分，和叫 75
        打成、拿到 75 分，升级完全一样；而两种情况拿到 70 分，则就一胜一败了。由此得出两条基本结论：
      </p>
      <ul class="ml-4 list-disc space-y-1">
        <li><b class="text-ivory">正常情况不跳叫</b>。别人不拦着你，自己多承诺 5 分百害而无一利。</li>
        <li>
          <b class="text-ivory">牌差建议不叫</b>。三家全不叫只是重发，你一分不亏；有人接了你就当闲家，队友可能更强，压力给到庄家。
        </li>
      </ul>

      <p class={subhead}>当然，叫牌阶段也有一些心理博弈：</p>
      <div class="rounded-xl bg-black/30 p-3">
        <p><b class="text-gold">① 「阻击叫」</b>：对手叫到 ♥65，你明明知道自己打 ♠65 胜算不大，但是你认为对手牌力较强，于是你叫 ♠65，逼着对手拿 ♥70 来压你。这样，只要他抓不到 70，欠的分就更多，你就能升更多的级；而如果对手不接了给你打 ♠65，你最后打到 45 输两级，也比对手打到 80 赢四级好。当然，也有可能你最后打到 25，这种惨败的可能性就是需要承担的代价了。</p>
        <p class="mt-2"><b class="text-gold">② 位置决定压力</b>：连续两家不叫就定案，所以上家叫完，你不叫，就把压力给到下家 —— 他不抬，就得让上家以较低的压力打；他继续叫，就有可能砸到自己手上。</p>
        <p class="mt-2"><b class="text-gold">③ 比分不同，风险偏好也该不同</b>：落后时更该冲高分；领先时叫稳一点，别把机会送出去。</p>
      </div>

      <p>
        最后，什么样的手牌值得叫高？<b class="text-ivory">长套多</b>（某一门牌特别多）、<b class="text-ivory">常主多</b
        >（双王与级牌都在你手上）。四门平均又没常主时，40 分都可能守不住。
      </p>
    </div>
  </section>

  <section id="bury" class={section}>
    <h2 class={heading}>5. 埋底：庄家的那 3 张</h2>
    <div class={body}>
      <p>
        庄家把底牌 3 张收进手里，一共 20 张，然后<b class="text-ivory">扣 3 张埋回去</b>。这 3 张在算账之前，另外两家都看不到。
      </p>
      <p class={env}>本副：{trumpText(TRUMP_HEARTS)}（浅金底 = 主牌；真实为 20 张，这里取 12 张展示扇形）</p>
      <div class="rounded-xl bg-black/25 px-2 py-3">
        <HandFan hand={BURY_HAND} trump={TRUMP_HEARTS} />
      </div>
      <div class="flex flex-wrap items-center gap-3 pt-1">
        <p class="text-[11px] text-white/55">示例底牌（{kittyPoints} 分）</p>
        <CardRow cards={DEMO_KITTY} size="md" />
      </div>

      <p>
        <b class="text-ivory">底牌的分不会消失</b>，最后按这个倍数记到庄家账上，倍数就是<b class="text-ivory">最后一轮每家出了几张</b>：
      </p>
      <div class="flex flex-wrap gap-1.5">
        {#each MULTIPLIER_ROWS as row (row.lastTrick)}
          <span class={chip}>{row.lastTrick} → 底分 × <b class="text-gold">{row.multiplier}</b></span>
        {/each}
      </div>
      <ul class="ml-4 list-disc space-y-1">
        <li>最后一轮<b class="text-emerald-300">庄家赢</b> → 加分，叫<b class="text-emerald-300">保底</b>（超过一百也可以）。</li>
        <li>最后一轮<b class="text-rose-300">闲家赢</b> → 扣分，叫<b class="text-rose-300">抠底</b>（扣成负数也可以）。</li>
      </ul>
      <p>
        所以埋分是双刃剑：埋进去 {kittyPoints} 分，保底就白拿 <b class="tabular-nums">{kittyPoints} × 张数</b>，被抠底就倒扣一样多。
        如果牌足够好，常见打法便是<b class="text-ivory">把分埋掉、把大牌留在手上护底</b>，并且<b class="text-ivory">最后一轮尽量多出牌</b> ——
        例如 {KITTY_SWING.multiplier} 张顺子 × {KITTY_SWING.kittyPoints} 分底牌 = <b class="text-gold"
          >+{KITTY_SWING.multiplier * KITTY_SWING.kittyPoints}</b
        > 分，甚至可能直接逆风翻盘。
      </p>
    </div>
  </section>

  <section id="play" class={section}>
    <h2 class={heading}>6. 打牌：领出、跟牌、杀牌</h2>
    <div class={body}>
      <p>一轮里三家各出一次，赢的人领下一轮。一副牌一共 17 轮。</p>

      <p class={subhead}>① 领出</p>
      <p>出一张，或者出<b class="text-ivory">同一门里大小相邻的连牌</b>（2 张及以上）。不允许甩牌。</p>
      <p class={env}>本副：{trumpText(TRUMP_HEARTS)}（浅金底 = 主牌）</p>
      <div class="space-y-2 rounded-xl bg-black/30 p-3">
        {#each leadCases as item, index (index)}
          <div class="flex flex-wrap items-center gap-2">
            <span class={item.ok ? 'text-[11px] font-semibold text-emerald-300' : 'text-[11px] font-semibold text-rose-300'}>
              {item.ok ? '✓' : '✗'}
            </span>
            <CardRow
              cards={item.cards}
              trump={TRUMP_HEARTS}
              size="md"
              dim={item.ok ? [] : item.cards.map(cardKey)}
            />
            <span class="text-[11px] text-white/50">{item.note}</span>
          </div>
        {/each}
      </div>

      <p class={subhead}>② 跟牌</p>
      <p>
        必须<b class="text-ivory">同一门、同一张数</b>。如果这一门不够张数，就先把这一门全部出光，剩下的随便垫。
      </p>
      <div class="flex flex-wrap items-end gap-4 rounded-xl bg-black/30 p-3">
        <TrickCluster cards={FOLLOW_SHORT_LEAD} trump={TRUMP_HEARTS} caption="上家领出 3 张" />
        <span class="pb-6 text-white/30">→</span>
        <TrickCluster cards={FOLLOW_SHORT_HAND.slice(0, 3)} trump={TRUMP_HEARTS} caption="你只有 ♣Q 一张，另外两张随便垫" />
      </div>

      <p class={subhead}>③ 这一门够张数时，要「结构优先」：必须先把最长的那段连牌拿出来</p>
      <TryPlay
        title={TRY_FOLLOW.title}
        task={TRY_FOLLOW.task}
        hand={TRY_FOLLOW.hand}
        trump={TRY_FOLLOW.trump}
        lead={TRY_FOLLOW.lead}
      />
      <p>
        你手里 ♣ 有 5 张，够跟 4 张。有两种拆法：<b class="text-ivory">♣3-4-6</b> + ♣Q-K，或者 ♣Q-K + 两张散牌。<b
          class="text-ivory">规则要求前者</b
        >：先把最长的 3 连拿出来，再随便配 1 张。所以正确答案是 <b class="text-gold">♣3-4-6 + ♣Q</b>（或 +♣K）。
      </p>
      <div class="flex flex-wrap items-end gap-4">
        <TrickCluster cards={TRY_FOLLOW.lead ?? []} trump={TRY_FOLLOW.trump} caption="上家领出 4 张 ♣ 顺子" />
        <span class="pb-6 text-white/30">→</span>
        <TrickCluster cards={FOLLOW_ANSWER} trump={TRY_FOLLOW.trump} caption="你跟：♣3-4-6 + ♣Q" />
      </div>
      <p class="rounded-xl bg-black/30 p-3 text-[11px] text-white/70">
        <b class="text-ivory">为什么要有这条规则</b>：不然你可以永远用「大牌 + 小牌」的组合把长套拆开藏着，跟牌就成了随便选牌。
      </p>

      <p class={subhead}>④ 一轮归谁</p>
      <p>得同时满足三条：</p>
      <ol class="ml-4 list-decimal space-y-1">
        <li><b class="text-ivory">张数一样</b>（上家领 4 张，你也得出 4 张）；</li>
        <li><b class="text-ivory">要么同门、而且比上家的大</b>；<b class="text-ivory">要么是主牌连牌</b>（主牌天然压副牌，张数一样就行）；</li>
        <li>
          张数不同、或结构不同（比如人家出 <b class="text-ivory">3 连 + 1 张</b>，你出 <b class="text-ivory">2 连 + 2 连</b>），<b
            class="text-ivory">都不能赢</b
          > —— 只能算垫牌。
        </li>
      </ol>
      <p>大小完全一样时（比如两张副级牌碰上），<b class="text-ivory">先出的赢</b>。</p>

      <p class={subhead}>⑤ 缺门</p>
      <p>
        某一门一张都没有时，你有两条路 —— 用<b class="text-ivory">同样张数的连续主牌</b>杀牌赢下这一轮，或者垫掉没用的牌。<b
          class="text-ivory">垫牌不管多大都不能赢。</b
        >
      </p>
      <TryPlay title={TRY_RUFF.title} task={TRY_RUFF.task} hand={TRY_RUFF.hand} trump={TRY_RUFF.trump} lead={TRY_RUFF.lead} />
      <p>
        你一张 ♠ 都没有。<b class="text-gold">♥3-4-6</b> 是三张连续主牌（♥5 是主级、比它们都大，所以 ♥4 与 ♥6 之间是连的），能杀掉这一轮；<b
          class="text-gold">♣2 ♣3 ♦4</b
        > 是垫牌，不能赢。
      </p>
    </div>
  </section>

  <section id="inference" class={section}>
    <h2 class={heading}>7. 三条最值钱的推论</h2>
    <div class={body}>
      <div class="rounded-xl bg-black/30 p-3">
        <p class="font-semibold text-ivory">① 常主永远最大</p>
        <p class="mt-1">双王、主级、副级合称<b class="text-ivory">常主</b>，任何副牌连牌都杀不过它们。所以一副副牌大牌看着吓人，遇到最低的三张主牌连牌照样输：</p>
        <p class={env}>本副：{trumpText(TRUMP_HEARTS)}（♠ 是副牌；♥ 与四张 5、双王都是主牌）</p>
        <div class="mt-2 flex flex-wrap items-end gap-4">
          <TrickCluster cards={RUFF_LEAD} trump={TRUMP_HEARTS} caption="副牌里最大的三张：♠A-K-Q" />
          <span class="pb-6 text-white/30">→</span>
          <TrickCluster cards={RUFF_WINNER} trump={TRUMP_HEARTS} caption="主牌里最小的三张" badge="赢墩" />
        </div>
      </div>

      <div class="rounded-xl bg-black/30 p-3">
        <p class="font-semibold text-ivory">② 副牌顺子跳过级牌</p>
        <p class="mt-1">
          级牌 5 归主牌，♣ 这一门从 ♣4 直接到 ♣6，所以 <b class="text-gold">♣3-4-6 三张是连着的</b>，可以当顺子出。反过来，♣3 和 ♣9 中间隔着
          ♣4 ♣6 ♣7 ♣8，<b class="text-ivory">不能一起出</b>。
        </p>
        <p class={env}>本副：{trumpText(TRUMP_HEARTS)}（级牌 5 已归主牌，三门副牌的 5 都空了）</p>
        <div class="mt-2 space-y-2">
          <div>
            <p class="mb-1 text-[11px] text-emerald-300">✓ ♣3-4-6 合法顺子（♣5 是级牌，不在这一门）</p>
            <CardRow cards={RUN_SKIPS_LEVEL} trump={TRUMP_HEARTS} size="md" />
          </div>
          <div>
            <p class="mb-1 text-[11px] text-rose-300">✗ ♣3 与 ♣9 中间隔着 ♣4 ♣6 ♣7 ♣8，不能一起出</p>
            <CardRow cards={RUN_NOT_ADJACENT} trump={TRUMP_HEARTS} size="md" />
          </div>
          <div>
            <p class="mb-1 text-[11px] text-white/55">
              主牌同理：♥3-4-6 也连着（♥5 是主级，位置比这六张里的 ♥ 都高）
            </p>
            <CardRow cards={TRUMP_RUN} trump={TRUMP_HEARTS} size="md" />
          </div>
        </div>
      </div>

      <div class="rounded-xl bg-black/30 p-3">
        <p class="font-semibold text-ivory">③ 分牌晚出，或者垫给队友</p>
        <p class="mt-1">
          5 / 10 / K 谁赢走算谁的。手里有分牌时，尽量等一轮自己能赢的再出；跟不出门时，优先把分垫给队友（庄家正好相反：想尽办法把分收进自己手里）。<b
            class="text-ivory">最后一轮一定要抢</b
          > —— 只有赢了最后一轮才有保底 / 抠底。
        </p>
      </div>
    </div>
  </section>

  <section id="scoring" class={section}>
    <h2 class={heading}>8. 算账：打成没有、谁升几级</h2>
    <div class={body}>
      <p><b class="text-ivory">一条式子：</b></p>
      <div class="flex items-start justify-center gap-1.5 rounded-xl bg-black/30 py-3">
        <div class="w-14 text-center">
          <p class="text-[26px] font-black leading-none tabular-nums">{KITTY_EQUATION.trickPoints}</p>
          <p class="mt-1.5 text-[10px] text-white/50">墩分</p>
        </div>
        <span class="mt-2 text-lg leading-none text-white/40">＋</span>
        <div class="w-14 text-center">
          <p class="text-[26px] font-black leading-none tabular-nums">{KITTY_EQUATION.kittyPoints}</p>
          <p class="mt-1.5 text-[10px] text-white/50">底牌 {DEMO_KITTY.length} 张</p>
          <div class="kitty-mini mt-1 flex justify-center">
            {#each DEMO_KITTY as card (cardKey(card))}
              <CardView {card} trump={TRUMP_HEARTS} size="sm" />
            {/each}
          </div>
        </div>
        <span class="mt-2 text-lg leading-none text-white/40">×</span>
        <div class="w-10 text-center">
          <p class="text-[26px] font-black leading-none tabular-nums text-gold">{KITTY_EQUATION.multiplier}</p>
          <p class="mt-1.5 text-[10px] text-white/50">末轮张数</p>
        </div>
        <span class="mt-2 text-lg leading-none text-white/40">＝</span>
        <div class="w-14 text-center">
          <p class="text-[26px] font-black leading-none tabular-nums text-gold">{KITTY_EQUATION.madeFinal}</p>
          <p class="mt-1.5 text-[10px] text-white/50">最终得分</p>
        </div>
      </div>

      <p>同一副牌，最后一轮谁赢，结果完全不同：</p>
      <ul class="ml-4 list-disc space-y-1">
        <li>
          最后一轮<b class="text-emerald-300">庄家赢</b>（保底）→ <b class="tabular-nums"
            >{KITTY_EQUATION.trickPoints} + {KITTY_EQUATION.kittyPoints} × {KITTY_EQUATION.multiplier} =
            {KITTY_EQUATION.madeFinal}</b
          >
        </li>
        <li>
          最后一轮<b class="text-rose-300">闲家赢</b>（抠底）→ <b class="tabular-nums"
            >{KITTY_EQUATION.trickPoints} − {KITTY_EQUATION.kittyPoints} × {KITTY_EQUATION.multiplier} =
            {KITTY_EQUATION.setFinal}</b
          >
        </li>
      </ul>
      <p>
        <b class="text-ivory">最终得分 ≥ 叫的分数 → 打成</b>（正好相等也算打成）。上例叫的是 {KITTY_EQUATION.contract}：保底
        {KITTY_EQUATION.madeFinal} ≥ {KITTY_EQUATION.contract}，打成；被抠底 {KITTY_EQUATION.setFinal} &lt;
        {KITTY_EQUATION.contract}，打输。
      </p>

      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-xl bg-emerald-500/10 p-3 ring-1 ring-emerald-400/25">
          <p class="font-semibold text-emerald-300">保底（末轮庄家赢）</p>
          <p class="mt-1">
            {KITTY_EQUATION.trickPoints} + {kittyPoints} × {KITTY_EQUATION.multiplier} =
            <b class="tabular-nums">{KITTY_EQUATION.madeFinal}</b> ≥ {KITTY_EQUATION.contract} → 打成
          </p>
        </div>
        <div class="rounded-xl bg-rose-500/10 p-3 ring-1 ring-rose-400/25">
          <p class="font-semibold text-rose-300">抠底（末轮闲家赢）</p>
          <p class="mt-1">
            {KITTY_EQUATION.trickPoints} − {kittyPoints} × {KITTY_EQUATION.multiplier} =
            <b class="tabular-nums">{KITTY_EQUATION.setFinal}</b> &lt; {KITTY_EQUATION.contract} → 打输
          </p>
        </div>
      </div>

      <p class="rounded-xl bg-black/30 p-3 text-[11px] text-white/70">
        <b class="text-ivory">这就是最后一轮关键所在</b>：底牌只有 {kittyPoints} 分，却能在最后一轮的输赢之间摆动 ±<b class="tabular-nums"
          >{swing}</b
        > 分。同一副牌，从「庄家打包升 {madeLevelsNow} 级」直接翻成「庄家打输、两家各升 {shortfallLevels} 级」。
      </p>

      <p>
        <b class="text-ivory">闲家要抓够多少分才能把庄家打输？</b> 不是 <b class="tabular-nums"
          >100 − {KITTY_EQUATION.contract} = {settle.naiveBar}</b
        >：
      </p>
      <p class="rounded-xl bg-black/30 p-3 text-[11px] text-white/70">
        底牌那 {kittyPoints} 分不进任何人的轮，只走庄家的账 —— 所以<b class="text-emerald-300">保底</b>时闲家要严格超过
        <b class="tabular-nums text-emerald-300">{settle.protectBar}</b> 分，<b class="text-rose-300">抠底</b>时超过
        <b class="tabular-nums text-rose-300">{settle.digBar}</b> 分就够。
      </p>
      <p>一句话：<b class="text-ivory">埋了分，就等于把自己的命门押在最后一轮上。</b></p>
      <p class="text-[11px] text-white/50">
        但注意：如果前期分差太大，庄家保底 / 闲家抠底也可能无力回天。若庄家不埋分，那最后一轮便没有什么特殊的用处。
      </p>

      <p class={subhead}>打成 → 庄家升级</p>
      <p>升级只看最终得分：</p>
      <div class="overflow-hidden rounded-xl ring-1 ring-white/10">
        <table class="w-full text-[11px]">
          <thead class="bg-white/5 text-white/50">
            <tr>
              <th class="px-3 py-1.5 text-left font-semibold">最终得分</th>
              <th class="px-3 py-1.5 text-left font-semibold">庄家升级</th>
            </tr>
          </thead>
          <tbody>
            {#each UPGRADE_ROWS as row (row.range)}
              <tr class="border-t border-white/5">
                <td class="px-3 py-1.5 tabular-nums">{row.range}</td>
                <td class="px-3 py-1.5 text-gold">{row.levels}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <p>
        <b class="text-ivory">「升 N 级」= 从你现在的级别往前推 N 级，跨过 A 就进位到下一轮的 2：</b>
      </p>
      <div class="flex flex-wrap gap-4 rounded-xl bg-black/30 p-3">
        {#each LEVEL_DEMO as level, index (index)}
          <div class="text-center">
            <LevelBadge {level} />
            <p class="mt-1.5 text-[10px] text-white/45">{levelLabel(level)}</p>
          </div>
        {/each}
        <p class="self-center text-[11px] text-white/55">左起：5(+0) 也叫「打 5」、A(+1)、5(+2)</p>
      </div>
      <div class="space-y-1.5">
        {#each steps as step, index (index)}
          <p class="rounded-lg bg-black/30 px-3 py-2 text-[11px]">
            {levelLabel(step.from)} 升 {step.levels} 级 →
            <b class="text-gold">{levelLabel(step.to)}</b>
            <span class="ml-1 text-white/45">（{step.note}）</span>
          </p>
        {/each}
      </div>
      <p>
        上例：{TUTORIAL_NAMES[DEMO_CONTRACT.declarerSeat]}是 5(+0)，保底拿 {KITTY_EQUATION.madeFinal} 分 → 升
        {madeLevelsNow} 级 → <b class="text-gold">{demoAfterLabel}</b>。
      </p>

      <p class={subhead}>打输 → 庄家级别不变，两家闲家各升「上取整(差 / 10)」级</p>
      <p>其中 <b class="text-ivory">差 = 叫的分数 − 最终得分</b>：</p>
      <div class="flex flex-wrap gap-1.5">
        {#each DEFENDER_STEPS as step (step.shortfall)}
          <span class={chip}>差 {step.shortfall} → 各升 <b class="text-gold">{step.levels}</b> 级</span>
        {/each}
      </div>
      <p>
        上例抠底：差 = {KITTY_EQUATION.contract} − {KITTY_EQUATION.setFinal} = <b class="tabular-nums"
          >{KITTY_EQUATION.contract - KITTY_EQUATION.setFinal}</b
        > → 两家各升 {shortfallLevels} 级。
      </p>
      <p>
        所以叫太高而打输，代价是<b class="text-ivory">同时给对手两个人送级</b>；反过来，闲家也有动力把分抓狠一点 ——
        庄家差得越多，两家一次升得越多。
      </p>

      <p class={subhead}>什么时候结束</p>
      <p>
        如果想要打得长一点（约 20 局），任意<b class="text-ivory">两位玩家</b>达到 <b class="text-gold">2(+2)</b>，或者任意<b
          class="text-ivory">一位玩家</b
        >冲到 <b class="text-gold">2(+3)</b>，对局结束，总进度最高的那位是冠军。当然，也可以协商任何时候结束。
      </p>
    </div>
  </section>

  <section id="spectate" class={section}>
    <h2 class={heading}>9. 观战与离座</h2>
    <div class={body}>
      <p>
        一张牌桌只有 <b class="text-ivory">3 个座位</b>，但可以有任意多个<b class="text-ivory">观战者</b>。满座时用邀请链接进来的人
        自动成为观战者；在座的人点「离座」也会转为观战者 —— 离座之后你仍然看得见这一桌，刷新也不会被自动塞回座位。
      </p>

      <p class={subhead}>观战者看得到什么</p>
      <p>
        只有<b class="text-ivory">公共信息</b>：每家还剩几张手牌、已经打出的牌与赢下的墩、定约与将牌、庄家已经抓到的分。
        <b class="text-ivory">结算前看不到任何人的手牌，也看不到暗底</b>；结算后的底牌与升级随结算一并公开。
      </p>
      <p>
        所以观战时与桌上的玩家通电话没有用 —— 这条边界不是 UI 上的遮挡，是服务器根本不会把那些牌放进给观战者的数据里。
      </p>

      <p class={subhead}>入座：补位的人接下的是座位</p>
      <p>
        点「入座」即可占用一个空座。级别与手牌都<b class="text-ivory">记在座位上</b>：如果有人在某一副打到一半离座，补位的人会拿到这个座位当时的手牌
        与级别，从那一副继续打完，而不是从头开始。三人没齐时开不了下一副。
      </p>

      <p class={subhead}>改名字 / 换身份</p>
      <p>
        <b class="text-ivory">不在座位上时</b>才能改名字或换身份（在座时先离座）。名字全局唯一，改名之后凭据串会重签，旧串当场失效，
        新串会自动写回你当前这台设备。
      </p>
    </div>
  </section>

  <footer class="flex flex-wrap items-center justify-between gap-2 pb-4 text-xs text-white/50">
    <span>看完了？回大厅开一桌吧。</span>
    <a class="rounded-lg bg-gold px-4 py-2 text-xs font-bold text-ink transition hover:brightness-110" href="/">回大厅</a>
  </footer>
</main>
