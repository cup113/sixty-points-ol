<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cardKey, START_LEVEL, type Level } from '@sixty/engine';
  import { TableClient } from '$lib/client/table.svelte';
  import { BOT_LIMIT } from '$lib/shared';
  import { anchorSeatOf, labelSeatOf } from '$lib/role';
  import { fetchReplays, type ReplayResult } from '$lib/replays';
  import type { DrawerTabKey, ReportMode } from '$lib/drawer-tabs';
  import { SoundBoard } from '$lib/sound/board.svelte';
  import { soundEvents, soundSnapshot } from '$lib/sound/events';
  import ActionBar from '$lib/components/ActionBar.svelte';
  import ActionTray from '$lib/components/ActionTray.svelte';
  import BidPanel from '$lib/components/BidPanel.svelte';
  import BotRemoveConfirm from '$lib/components/BotRemoveConfirm.svelte';
  import BuryPanel from '$lib/components/BuryPanel.svelte';
  import DealSummary from '$lib/components/DealSummary.svelte';
  import HandFan from '$lib/components/HandFan.svelte';
  import InviteCode from '$lib/components/InviteCode.svelte';
  import LeaveConfirm from '$lib/components/LeaveConfirm.svelte';
  import LobbyPanel from '$lib/components/LobbyPanel.svelte';
  import MusicDock from '$lib/music/components/MusicDock.svelte';
  import SeatCard from '$lib/components/SeatCard.svelte';
  import SoundControl from '$lib/components/SoundControl.svelte';
  import TabRail from '$lib/components/TabRail.svelte';
  import TableDrawer from '$lib/components/TableDrawer.svelte';
  import TableHeaderActions from '$lib/components/TableHeaderActions.svelte';
  import TableStatus from '$lib/components/TableStatus.svelte';
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
  /** 要请离的机器人座位（null = 弹窗关着）；弹窗必须挂在页面级，见 BotRemoveConfirm */
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
  /** 三个座位卡的绝对定位类：必须只来自这里，别与自身的 position 类混用（见 ui-check） */
  const SPOTS = [
    'left-3 top-3 sm:left-5 sm:top-5',
    'right-3 top-3 sm:right-5 sm:top-5',
    'bottom-3 left-3 sm:bottom-5 sm:left-5'
  ] as const;

  const selectable = $derived(
    you !== null &&
      view !== null &&
      deal !== null &&
      ((deal.phase === 'play' && deal.playTurn === you.seat) ||
        (deal.phase === 'bury' && you.isDeclarer))
  );

  /**
   * 手牌蓝框标记（`data-marked`）：两个阶段各有一个「这几张现在最要紧」的集合。
   *
   * - **埋底（庄家）**：拿上来的底牌 —— `you.originalKitty` 是权威来源；
   * - **出牌（轮到自己跟牌）**：领出那一门的手牌 —— 跟牌必须先跟同门，缺门时集合自然为空。
   *
   * 其余阶段、其余人（含观战者）一律空集：标记是给正要出手的那个人看的。
   */
  const markedKeys = $derived.by(() => {
    if (deal === null || you === null) return [];
    if (deal.phase === 'bury' && you.isDeclarer) {
      return kittyHandDelta(you.hand, you.originalKitty).map(cardKey);
    }
    if (deal.phase === 'play' && deal.playTurn === you.seat) {
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

  /**
   * 机器人动作只在**自己坐在这一桌**时出现（观战者不改变桌面构成，服务端也会拒）。
   * 上限 2：至少留一个人类座位去按「开下一副」（机器人从不发起桌面级动作，见 ADR-0015）。
   */
  const botCount = $derived((client.table?.seats ?? []).filter((seat) => seat.bot).length);
  const canAddBot = $derived(seated && botCount < BOT_LIMIT);

  /**
   * 加机器人：**点哪张空座卡就坐哪张**（补位进哪个座位是有差别的：那个座位可能正好轮得到、
   * 或者手牌更好）。结果随 SSE 广播回来，不做乐观更新。
   */
  async function addBot(seat: number): Promise<void> {
    await client.addBot(seat);
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

  <div class="felt relative min-h-0 flex-1 rounded-[1.75rem] sm:rounded-[2.5rem]">
    <!-- 三家座位：左＝下家、右＝上家、我＝左下；观战者没有「我」，三张卡都显示玩家名 -->
    {#each [leftSeat, rightSeat, anchor] as seat, index (seat)}
      <SeatCard
        name={seatAt(seat)?.name ?? null}
        level={levelAt(seat)}
        online={seatAt(seat)?.online ?? false}
        bot={seatAt(seat)?.bot ?? false}
        canAddBot={canAddBot && (seatAt(seat)?.name ?? null) === null}
        onAddBot={() => void addBot(seat)}
        canRemoveBot={seated}
        onRemoveBot={() => (botRemoveSeat = seat)}
        busy={client.busy}
        isMe={seated && seat === (you?.seat ?? -1)}
        isTurn={isTurnAt(seat)}
        isDeclarer={deal?.declarerSeat === seat}
        class={`absolute w-36 sm:w-44 ${SPOTS[index]}`}
      />
    {/each}

    {#if deal === null}
      <LobbyPanel {client} code={data.code} />
    {:else if view !== null}
      {#if deal.phase === 'bury'}
        <!-- 阶段状态条与埋底面板同属**一个**绝对定位的列容器：槽位永远排在状态条下面。
             早先两者各自绝对定位（状态条 top-[5.5rem]、面板 top-[12%]），手机短屏上
             「定约 / 庄已抓」会压到暗底槽位上 —— 两处各算各的位置，谁也管不了谁。
             这一层横跨整幅毡面，所以要**让开点击**（`pointer-events-none`）：它会在座位卡的
             「+ 机器人」/「请离」按钮上吃掉点击。里面只有埋底面板那行底牌是可点的，
             由 BuryPanel 自己 `pointer-events-auto` 接回来（见 `BuryPanel.svelte` 与
             `test/table-chrome.test.ts` 的「横跨毡面的覆盖层必须让开点击」）。 -->
        <div class="pointer-events-none absolute inset-x-0 top-[4.5rem] flex flex-col items-center gap-3 px-2 sm:top-6">
          <!-- 埋底阶段不接回看入口：那时 `trickHistory` 必然是空的（还没有人出过牌），
               接了也永远不渲染 —— 顺带让这一条在埋底阶段仍然是纯信息条。 -->
          <TableStatus {view} />
          <BuryPanel {client} />
        </div>
      {:else if deal.phase === 'auction'}
        <BidPanel {client} />
      {:else}
        <div class="pointer-events-none absolute inset-x-0 top-[5.5rem] flex justify-center px-2 sm:top-6">
          <TableStatus {view} onReviewTrick={() => (reviewOpen = true)} />
        </div>
        <TrickArea {view} seat={anchor} mySeat={label} {names} />
      {/if}
    {/if}

    <!-- 「上一轮」回看：**住在毡面里**（`absolute inset-0`）而不是整屏 ——
         手牌因此始终可见、可继续选牌；bot 出手再快，收掉的那一墩也还找得回来。
         默认关着（`reviewOpen` 初值 false），所以 SSR 首帧里没有这一层。 -->
    <TrickReview {client} open={reviewOpen} onClose={() => (reviewOpen = false)} />
  </div>

  <!-- 操作条与动作托盘是**同一块版面**：托盘绝对定位悬在这一条上、再居中于手牌正上方。
       它不占流，所以「轮到自己 / 轮空」之间切换时毡面与手牌不会上下跳；z-30 压过上浮的选中牌。
       早先出牌/埋底控件就在这一条的行内 —— 窄屏一晚换行就把整页高度顶动，按钮还落在最左侧。 -->
  <div class="relative">
    <ActionBar {client} {summaryOpen} onToggleSummary={() => (summaryOpen = !summaryOpen)} />
    <ActionTray {client} />
  </div>

  <!-- 观战者没有手牌：手牌区整块消失，牌桌更大 -->
  {#if you !== null}
    <HandFan
      hand={you.hand}
      {trump}
      {candidateRanks}
      selected={client.selected}
      marked={markedKeys}
      {selectable}
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

<!-- 网易云音乐悬浮窗（旁挂功能，见 docs/adr/0019）：
     牌桌页对它的全部了解就是这一行 —— 它自成一个模块（`$lib/music/`），不读 `client`、
     不进 SSE、不落库；`SIXTY_MUSIC=off` 时它自己什么都不渲染，而 `/api/music/*` 也一并 404。 -->
<MusicDock enabled={data.musicEnabled} level={data.musicLevel} />
