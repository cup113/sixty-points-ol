<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cardKey, START_LEVEL, type Level } from '@sixty/engine';
  import { TableClient } from '$lib/client/table.svelte';
  import { anchorSeatOf, labelSeatOf } from '$lib/role';
  import { fetchReplays, type ReplayResult } from '$lib/replays';
  import type { DrawerTabKey, ReportMode } from '$lib/drawer-tabs';
  import { SoundBoard } from '$lib/sound/board.svelte';
  import { soundEvents, soundSnapshot } from '$lib/sound/events';
  import ActionBar from '$lib/components/ActionBar.svelte';
  import BidPanel from '$lib/components/BidPanel.svelte';
  import BotRemoveConfirm from '$lib/components/BotRemoveConfirm.svelte';
  import BuryPanel from '$lib/components/BuryPanel.svelte';
  import DealSummary from '$lib/components/DealSummary.svelte';
  import HandFan from '$lib/components/HandFan.svelte';
  import InviteCode from '$lib/components/InviteCode.svelte';
  import LeaveConfirm from '$lib/components/LeaveConfirm.svelte';
  import LobbyPanel from '$lib/components/LobbyPanel.svelte';
  import SeatCard from '$lib/components/SeatCard.svelte';
  import SoundControl from '$lib/components/SoundControl.svelte';
  import TabRail from '$lib/components/TabRail.svelte';
  import TableDrawer from '$lib/components/TableDrawer.svelte';
  import TableHeaderActions from '$lib/components/TableHeaderActions.svelte';
  import InfoRail from '$lib/components/InfoRail.svelte';
  import TrickArea from '$lib/components/TrickArea.svelte';
  import TrickReview from '$lib/components/TrickReview.svelte';
  import { followSuitCards, kittyHandDelta, lastCompletedTrick } from '$lib/labels';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // 只取首次 SSR 数据构造客户端状态，不随后续 data 变化重建（角色与手牌以 SSE 负载为准）
  const client = untrack(
    () =>
      new TableClient(
        data.code,
        { role: data.role, view: data.view, you: data.you, table: data.table },
        data.inherited
      )
  );

  /**
   * 声音面板：三条通道（背景音乐 / 音效 / 震动）的执行者，见 `$lib/sound/board.svelte.ts`。
   * 与 client 一样只建一次；构造函数自己从 localStorage 读回上次的开关，
   * 音频设备要等到真出声那一刻才建（服务端渲染里没有 AudioContext）。
   */
  const sound = new SoundBoard();

  /**
   * 右侧活页签抽屉：`null` = 关着。
   *
   * 纯手动状态 —— 不自动打开、不自动换页，SSE 每帧都不碰它（见 CONTEXT.md 的 Flagged ambiguities）。
   * 每副结束自动弹出的结算（`summaryOpen`）与它无关，仍然是整页的模态。
   */
  let active = $state<DrawerTabKey | null>(null);
  /** 战报页内的模式（逐副 / 升级表）：页面持有，抽屉关掉再开还停在那一页 */
  let reportMode = $state<ReportMode>('deals');
  /**
   * 机器重演缓存（ADR-0016）：按副号取、结果不可变 —— 某副首次点开时整表拉一次，
   * 之后全靠缓存。SSE 不碰它（重演是静态存档，没有「随帧更新」这回事）。
   */
  let replays = $state<Record<number, ReplayResult>>({});
  let summaryOpen = $state(false);
  /**
   * 「上一轮」回看（`TrickReview`）：纯手动状态，默认关着 —— 与抽屉、结算弹窗同一条纪律
   * （SSE 每帧都不碰它）。入口是状态条上那枚「上一轮」，只在收过墩之后才出现。
   */
  let reviewOpen = $state(false);
  let leaveOpen = $state(false);
  /**
   * 要请离的机器人座位（null = 弹窗关着）。
   * 入口在抽屉「牌桌」页那一行（ADR-0020），而弹窗**必须挂在页面级** —— 抽屉有 `transform`，
   * 会把 `fixed` 弹窗困在抽屉里（见 `BotRemoveConfirm`）。所以状态由页面持有，
   * 抽屉只把「点了哪一行」透传上来。
   */
  let botRemoveSeat = $state<number | null>(null);
  let openedFor = -1; // 非响应式：仅用于「每副只自动弹出一次结算」

  onMount(() => {
    client.connect();
    // 音乐只在牌桌页：起播与「切到别的标签页就暂停」都交给面板自己管，卸载即停
    const detachSound = sound.attach();
    return () => {
      client.disconnect();
      detachSound();
    };
  });

  const view = $derived(client.view);
  const deal = $derived(view?.deal ?? null);
  const summary = $derived(deal?.summary ?? null);
  const trump = $derived(deal?.trump ?? null);
  /**
   * 叫牌阶段的主牌预示：三家级别的点数。
   *
   * 本副级牌点数取自**庄家**的级别，而庄家还没定 —— 所以哪一家的级别都可能成为它，
   * 手牌里命中任一点数的牌都该标「可能成为级牌」。王不在此列：它恒是主牌，
   * 由 `Card` 按主牌单独上色（`candidateRanks` 非 null 时）。
   */
  const candidateRanks = $derived(
    deal !== null && deal.phase === 'auction' && view !== null
      ? [...new Set(view.levels.map((level) => level.rank))]
      : null
  );
  const you = $derived(client.you);
  const seated = $derived(you !== null);
  /** 文本里一律用玩家名指代（不再有东/南/西）：座位卡显示的就是这些名字 */
  const names = $derived((client.table?.seats ?? []).map((seat) => seat.name));

  /**
   * 布局锚点与「我的座位」**只由 `you` 决定**（观战者 = 固定锚点 + 谁都不叫「你」）。
   *
   * 曾经这里回退到 SSR 的 `data.seat`：那个值只在上次 load 时算过，多标签页里另一处离座、
   * 或离座当帧 SSE 先到时，观战者会顶着旧座位被叫「你」。`data.seat` 已随之下线。
   */
  const anchor = $derived(anchorSeatOf(you?.seat ?? null));
  const label = $derived(labelSeatOf(you?.seat ?? null));

  const leftSeat = $derived((anchor + 1) % 3);
  const rightSeat = $derived((anchor + 2) % 3);

  const selectable = $derived(
    you !== null &&
      view !== null &&
      deal !== null &&
      ((deal.phase === 'play' && deal.playTurn === you.seat) ||
        (deal.phase === 'bury' && you.isDeclarer))
  );

  /**
   * **拟选**（ADR-0021）：在座玩家在出牌阶段随时可以点牌，不必等到轮到自己。
   *
   * 为什么值得改：轮到别人时手牌是完全冻结的，玩家最自然的动作（「我先看看要出哪两张」）
   * 会被无声地忽略 —— 出牌是个需要提前想的事，临到出手那一刻才开始点是现实里的常态。
   *
   * 条件与本墩已有领出 **同一个**（`deal.trick.plays.length > 0`），所以：
   * - 领出者的那一张还没落地时，任何人在手上都没有「该跟的那一门」，标记自然为空；
   * - 一旦有人领出，三家（在座者）都立刻看得到「该跟哪一门」的蓝框 —— 这正是要提前想的事。
   *
   * 合法性不在这一层判：轮到你时托盘会用引擎的 `checkPlay` 说明这组牌为什么不行（`playError`），
   * 拟选期间不做提前校验（那会在选到一半时就开始报错）。
   */
  const planning = $derived(
    you !== null &&
      deal !== null &&
      deal.phase === 'play' &&
      deal.trick !== null &&
      deal.trick.plays.length > 0
  );

  /**
   * 手牌蓝框标记（`data-marked`）：两个阶段各有一个「这几张现在最要紧」的集合。
   *
   * - **埋底（庄家）**：拿上来的底牌 —— `you.originalKitty` 是权威来源；
   * - **出牌（有人领出之后）**：领出那一门的全部手牌 —— 跟牌必须先跟同门，缺门时自然为空。
   *   拟选把这一份从「正轮到我的那个人」放宽到「在座的每个人」：能提前想的正是这件事。
   *
   * 其余阶段、其余人（含观战者）一律空集。
   */
  const markedKeys = $derived.by(() => {
    if (deal === null || you === null) return [];
    if (deal.phase === 'bury' && you.isDeclarer) {
      return kittyHandDelta(you.hand, you.originalKitty).map(cardKey);
    }
    if (planning) {
      return followSuitCards(you.hand, trump, deal.trick).map(cardKey);
    }
    return [];
  });

  // 每副结束自动弹出结算；关闭后可随时用「结算详情」重开（观战者也照弹，结算信息本来就是公开的）
  $effect(() => {
    if (summary !== null && summary.dealNo !== openedFor) {
      openedFor = summary.dealNo;
      summaryOpen = true;
    }
  });

  /**
   * 回看的那一墩已经不存在了（换副、全 pass 重发）⇒ 关掉浮层。
   *
   * 少了这一句，玩家在结算屏开着回看、按「下一副」之后，浮层会**自己**在下一副第一墩落地时
   * 弹出来（`reviewOpen` 还留着 true）：那时它盖住毡面，像出了故障。收敛只要一轮 ——
   * 这一轮把 reviewOpen 写成 false，下一轮条件不成立。
   */
  $effect(() => {
    if (reviewOpen && lastCompletedTrick(deal) === null) reviewOpen = false;
  });

  /**
   * 声音与震动：把 SSE 帧之间的变化翻成提示音。四条判据本身是纯函数
   * （`$lib/sound/events.ts`，逐帧可测），这里只负责「取帧、放声、震动」。
   *
   * `prevSound` 刻意是**普通变量**（非 `$state`）：它只用来记住上一帧，写它不该引起任何重算。
   * 观战者没有 `you`，`isMyTurn` 恒为假，所以「该你了」永不触发；出牌 / 收墩 / 结算是公开事件，一样听得到。
   */
  let prevSound = soundSnapshot(null, null);
  $effect(() => {
    const next = soundSnapshot(client.view, client.you);
    for (const cue of soundEvents(prevSound, next)) {
      if (cue === 'turn') sound.buzz();
      void sound.cue(cue);
    }
    prevSound = next;
  });

  function seatAt(index: number) {
    return client.table?.seats[index] ?? null;
  }

  function levelAt(index: number): Level {
    return view?.levels[index] ?? START_LEVEL;
  }

  function isTurnAt(index: number): boolean {
    if (deal === null) return false;
    if (deal.phase === 'auction') return deal.auctionTurn === index;
    if (deal.phase === 'bury') return deal.declarerSeat === index;
    if (deal.phase === 'play') return deal.playTurn === index;
    return false;
  }

  function selectTab(key: DrawerTabKey): void {
    active = active === key ? null : key;
  }

  /**
   * 某副的重演首次点开时拉全表（每副至多一次有效请求；失败的拉取不进缓存，
   * 下次点开自然重试）。战报逐副卡与结算弹窗共用这一条通道。
   */
  function openReplay(dealNo: number): void {
    if (dealNo in replays) return;
    void fetchReplays(data.code).then((rows) => {
      replays = Object.fromEntries(rows.map((row) => [row.dealNo, row.result]));
    });
  }
</script>

<main class="mx-auto flex h-[100dvh] min-h-0 w-full max-w-6xl flex-col overflow-hidden px-3 py-2 sm:px-4">
  <!-- 页头只留必要信息：大厅、邀请码，以及右上角那枚**桌况簇**（观战人数 + 离座 / 改名 + 入座）——
       连接正常时页头一个像素都不占（断线才由下面那条提示出声）。
       战报/叫牌/底牌/牌桌 的**查阅面**全在右侧活页签抽屉里；教程已由操作条的「?」弹层承担。
       桌况簇回到页头是因为它是有界的三个「一步动作」，而页头两次爆满都是堆**查阅**入口堆出来的。 -->
  <header class="flex items-center justify-between gap-2 pb-2 text-sm">
    <div class="flex min-w-0 items-center gap-2 sm:gap-3">
      <a class="shrink-0 text-white/50 hover:text-white" href="/">← 大厅</a>
      <!-- 点邀请码即复制邀请链接（原来的「复制链接」按钮已去掉） -->
      <InviteCode
        code={data.code}
        class="shrink-0 font-mono text-base font-bold tracking-[.2em] text-gold sm:text-lg sm:tracking-[.3em]"
      />
    </div>
    <div class="flex shrink-0 items-center gap-2 text-[11px]">
      <!-- 声音设置：页头白名单里的第三样（另两样是邀请码与桌况簇）。
           它是一枚**有界的一步动作**（一枚图标 + 三个开关的弹层），不是查阅入口 ——
           页头两次爆满堆进去的都是战报/教程这类查阅面（见 table-chrome.test.ts 的白名单）。 -->
      <SoundControl board={sound} />
      <TableHeaderActions
        {client}
        onLeave={() => (leaveOpen = true)}
        onRename={() => (active = 'table')}
      />
    </div>
  </header>

  <!-- 连接异常只在坏的时候出声：`live`（常态）与首帧的 `connecting` 都不占像素 ——
       手机上没有 hover，旧的那枚绿点既解释不了、也没有动作可做；EventSource 自己会重连，
       所以这里只需说明「画面可能停在上一帧」。role="status" 让读屏也能听到重连。
       被否的替代（常驻圆点 / 挪进「牌桌」页 / connecting 也提示）见 CONTEXT.md。 -->
  {#if client.connection === 'offline'}
    <p
      role="status"
      class="mb-2 rounded-lg bg-amber-400/15 px-3 py-1.5 text-xs text-amber-200 ring-1 ring-amber-400/30"
    >
      连接中断，正在重连…画面可能停在上一帧。
    </p>
  {/if}

  {#if client.error}
    <p class="mb-2 rounded-lg bg-red-500/20 px-3 py-2 text-xs text-red-200">{client.error}</p>
  {/if}

  <!-- 中途补位：接下的是别人的手牌与进度，说一声再让人上手（关掉即消，不常驻） -->
  {#if client.inheritedNotice && you !== null}
    <div class="mb-2 flex items-center gap-2 rounded-lg bg-gold/15 px-3 py-2 text-xs text-gold ring-1 ring-gold/30">
      <span class="min-w-0 flex-1">
        这一副正在进行：你补进了空座，接下这手 <b class="tabular-nums">{you.hand.length}</b> 张牌继续打完。
      </span>
      <button
        type="button"
        class="shrink-0 rounded-md border border-gold/40 px-2 py-0.5 text-[11px] hover:bg-gold/10"
        onclick={() => (client.inheritedNotice = false)}
      >
        知道了
      </button>
    </div>
  {/if}

  <div
    class="felt relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-2 p-3 sm:gap-3 sm:p-5"
  >
    <!-- 毡面 = **四行格**（ADR-0020 及其修订）：`[信息须][顶卡][内容槽 1fr][我的底栏]`。
         为什么要结构化的行、而不是各处自己写 `top-[4.5rem]` / `top-[5.5rem]` / `top-[22%]`：
         那些魔数各自算各自的偏移，谁也管不了谁 —— 手机短屏上「定约 / 庄已抓」会压到埋底槽位上、
         叫牌面板会压住座位卡、托盘会压住我的座位卡（截图里的 #3 #4 #5 就是这么来的）。
         行格让「非座位层只能住在内容槽里」成为**结构**保证，而不是靠调数维持。
         钩子 `data-felt-row` 供 `scripts/shot-auction.ts` 的实测断言定位（源码守卫看不见几何）。

         第一行是**信息须**（`InfoRail`：回溯 / 定约 / 级牌 / 庄已抓），常驻：
         它整条横贯内宽、四列一张计分表，于是内容槽里只剩「打这一墩」的东西，牌区上方不再悬着任何层；
         同一份内容也就不再随视口宽度在「标题行」与「空绿区里的孤岛」之间摇摆
         （实测窄屏占毡面 79%、桌面只占 25%）。它**没有内容时高度为 0**（叫牌阶段与大厅），
         但这一格始终在（行的顺序恒定，不靠条件渲染挪行）。

         `grid-cols-1`（= `minmax(0, 1fr)`）不是多余的：单列网格不给列模版时那一列是 `auto`，
         内容比容器宽就会**把整条轨道撑宽** —— 埋底阶段实测撑到 352px（内容是 21rem 的埋底面板
         加上外层 `px-2`），于是各行一起变宽：「我」那条底栏（`w-full`）跟着变成 352px 并右偏 5px，
         居中判据直接不过。列模版钉成 `minmax(0, 1fr)` 之后轨道只能是容器宽度，
         内容宽了就在自己那一槽里溢出，不再牵动别的行。 -->
    <div data-felt-row="rail" class="min-w-0">
      {#if view !== null}
        <InfoRail {view} onReviewTrick={() => (reviewOpen = true)} />
      {/if}
    </div>

    <div data-felt-row="seats" class="flex items-start justify-between gap-2">
      <!-- 左＝下家、右＝上家；观战者没有「我」，两张卡都显示玩家名。
           这两张是**纯展示**：卡片上的「+ 机器人 / 请离」已撤到抽屉的「牌桌」页（ADR-0020）。 -->
      {#each [leftSeat, rightSeat] as seat, index (seat)}
        <SeatCard
          name={seatAt(seat)?.name ?? null}
          level={levelAt(seat)}
          online={seatAt(seat)?.online ?? false}
          bot={seatAt(seat)?.bot ?? false}
          isMe={seated && seat === (you?.seat ?? -1)}
          isTurn={isTurnAt(seat)}
          isDeclarer={deal?.declarerSeat === seat}
          class={['w-36 shrink-0 sm:w-44', index === 1 && 'ml-auto'].filter(Boolean).join(' ')}
        />
      {/each}
    </div>

    <div data-felt-row="slot" class="relative min-h-0">
      {#if deal === null}
        <LobbyPanel {client} code={data.code} />
      {:else if view !== null}
        {#if deal.phase === 'bury'}
          <!-- 埋底面板住在内容槽里、居中；状态条已在信息须上（不在这一格里） -->
          <div class="flex flex-col items-center gap-3 px-2 pt-1">
            <BuryPanel {client} />
          </div>
        {:else if deal.phase === 'auction'}
          <BidPanel {client} />
        {:else}
          <TrickArea {view} seat={anchor} mySeat={label} {names} />
        {/if}
      {/if}
    </div>

    <!-- 第三行：「我」那一条底栏（一行装完身份）。观战者没有座位，这一行整行消失。
         `max-w-[var(--rail-w)]`（基准 16rem = 256px、`sm` 以上 18rem = 288px）+ `mx-auto`：
         栏里只有「庄冠 + 头像 + 名字 + 级别」这几样，桌面端毡面 1080px 时让它整幅铺开
         既没必要、也不好看（实测宽 1080px → 384 → 256）。
         宽度**不自己写一个数**：它取毡面的那一条尺度（`app.css` 的 `--rail-w`），
         与顶部信息须**同一个值** —— 两者一上一下、同宽同居中才是同一个台面框
         （早先信息须按内容撑到 229–238px，比这一条窄 18–27px，上下框对不齐）。
         那一档尺度在 `sm` 上跟着值那一档数字一起长大（20px → 24px），两块一起变宽 ——
         这里因此只写变量名：**改尺度的地方只有 `app.css` 一处**。
         为什么不更宽：这一条只装身份，名字列本来就 `truncate`（合法名字上限 12 字，
         256px 下名字列约 124px ≈ 8 个汉字，超出部分按设计省略而不是把卡片撑长）。
         居中走 auto 边距（这一行是 flex 行），不靠再加一层嵌套。 -->
    <div data-felt-row="me" class="flex">
      {#if you !== null}
        <SeatCard
          variant="bar"
          name={seatAt(anchor)?.name ?? null}
          level={levelAt(anchor)}
          online={seatAt(anchor)?.online ?? false}
          bot={seatAt(anchor)?.bot ?? false}
          isMe={seated}
          isTurn={isTurnAt(anchor)}
          isDeclarer={deal?.declarerSeat === anchor}
          class="mx-auto w-full max-w-[var(--rail-w)]"
        />
      {/if}
    </div>

    <!-- 「上一轮」回看：**住在毡面里**（`absolute inset-0`）而不是整屏 ——
         手牌因此始终可见、可继续选牌；bot 出手再快，收掉的那一墩也还找得回来。
         默认关着（`reviewOpen` 初值 false），所以 SSR 首帧里没有这一层。 -->
    <TrickReview {client} open={reviewOpen} onClose={() => (reviewOpen = false)} />
  </div>

  <!-- 操作条：「?」、状态句**或动作托盘**、右端那枚闹钟，以及结算阶段的那几个按钮。
       托盘的落点就在这一行里（问号右边那一格，见 `ActionTray`）——
       「毡面与操作条之间那条 44px 常驻动作带」已经撤掉（ADR-0020 修订）：
       零回流由这一行的 `min-h-[2.6rem]` 保证，不必再占一条空白，那 44px 还给牌区。 -->
  <div class="relative">
    <ActionBar {client} {summaryOpen} onToggleSummary={() => (summaryOpen = !summaryOpen)} />
  </div>

  <!-- 观战者没有手牌：手牌区整块消失，牌桌更大。
       `selectable` 只在「这一手归你动」时为真（托盘也在那时才出现），
       而 `planning` 让**没轮到的在座玩家**也能点牌（拟选，见 ADR-0021）——
       HandFan 的 `selectable` 同时决定光标与点击，两者都按这个或的关系给。 -->
  {#if you !== null}
    <HandFan
      hand={you.hand}
      {trump}
      {candidateRanks}
      selected={client.selected}
      marked={markedKeys}
      selectable={selectable || planning}
      onToggle={(card) => client.toggle(card)}
    />
  {/if}
</main>

<!-- 右边缘活页签条：常驻，点一个拉起对应的抽屉页；点当前页签即收起。
     抽屉**不套 {#if view}**：「牌桌」页（座位/身份、改名换身份）在没发牌时也要能用，
     而且它常驻 DOM 正是那两条观战守卫仍然有效的原因。 -->
<TabRail {active} onSelect={selectTab} />
<TableDrawer
  {client}
  {active}
  {reportMode}
  onReportMode={(mode) => (reportMode = mode)}
  {replays}
  onOpenReplay={openReplay}
  onClose={() => (active = null)}
  onLeave={() => (leaveOpen = true)}
  onRemoveBot={(seat) => (botRemoveSeat = seat)}
/>

{#if view !== null}
  <DealSummary
    {client}
    open={summaryOpen}
    onClose={() => (summaryOpen = false)}
    {replays}
    onOpenReplay={openReplay}
  />
{/if}
<LeaveConfirm {client} open={leaveOpen} onClose={() => (leaveOpen = false)} />
<BotRemoveConfirm
  {client}
  seat={botRemoveSeat}
  name={botRemoveSeat === null ? null : (seatAt(botRemoveSeat)?.name ?? null)}
  onClose={() => (botRemoveSeat = null)}
/>
