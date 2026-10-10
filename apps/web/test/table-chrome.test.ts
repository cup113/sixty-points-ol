/**
 * 同桌页「面板归属」的**源码**守卫：哪些东西属于页头，哪些属于右侧活页签抽屉。
 *
 * 为什么需要它：手机端页头「爆满」已经发生过两次（一次是座位/观战徽标、一次是战报与身份入口），
 * 每次都是往页头再加一个按钮就好了，直到窄屏换行。行为层面没法在这里渲染验证
 * （要浏览器 + 真实视口宽度），所以改为对源码断言「页头里只允许出现这几样」，
 * 与 `page-source.test.ts`（观战者不许被当成「你」）是同一套路。
 *
 * **页头现在允许两样**：桌况簇（`TableHeaderActions`：观战人数 + 离座 / 改名 + 入座）与
 * 声音图标（`SoundControl`：背景音乐 / 音效 / 震动三个开关的弹层）——
 * 两者都是有界的「一步动作」；两次爆满堆进去的都是**查阅**入口，
 * 所以白名单收紧的是那些（战报/教程/叫牌/底牌/结算详情）。
 *
 * 抽屉侧守两条更硬的边界：
 * - **动作面不进抽屉**：叫牌候选、确认埋底、出牌、发牌都不能在抽屉各页里出现
 *   （查阅面可以进，动作面进去就变成「改一次点两步」）；出牌与确认埋底住在毡面的
 *   `ActionTray` 里 —— 一个绝对定位、居中的独立浮层，不占操作条那一行，也不占文档流。
 * - **「牌桌」页必须常驻 DOM**：它承载 `ui-check` / `spectate-check` 抓 SSR 的两处入口
 *   （「改名 / 换身份」与「座位已满」），一旦被改成 `{#if active === 'table'}`，
 *   那两条端到端守卫就会从「入口真的在页面上」退化成「标签名存在」。
 *
 * 还有一条关于**页头里不该有什么**：连接状态不是常驻指示器，只在 SSE 断开时
 * 于页头下方出一句话 —— 绿点已下线（手机上没有 hover 能解释它），但也不许反过来
 * 改成常显（每次加载闪一条、顶动牌桌）。
 *
 * 第四块是**结算那三件东西**：算式（`ScoreEquation`）、结论（`VerdictBadge`）、升级表
 * （`LevelTable`）。它们由结算弹窗与**战报的每副卡**共用 —— 复盘时在弹窗里读到的读法就是
 * 战报里的读法，所以判据落在了组件这一层（弹窗只负责把它们拼起来），另加战报与底牌页
 * 各自形状的判据。结算弹窗 SSR 里永远不出现（`summaryOpen` 初值是 false，只在客户端
 * 「本副刚结算」那一帧打开），ui-check 够不到，所以只能落在源码这一层。
 *
 * 第五块是**机器重演入口**（`ReplayPanel`，ADR-0016）：它同时挂在战报逐副卡与结算弹窗上，
 * 但**升级表没有** —— 升级表说的是真实进度，重演是每副的对照；展开体复用结算那三件套，
 * 数据通道由页面持有（组件自己发请求就是第二条取数路径）。它还是**主卡的枝干**：左引导线 +
 * 缩进，里面一律走那三件套的 `ghost` 档（数字 20px → 16px、结论只留淡边框与同色淡字），
 * 首行压成一枚 9px 徽章 —— 早先它与主卡同形同档（`bg-black/20` + `ring-1` 外壳、同档算式、
 * 又一枚同色实心胶囊，头行在弹窗里还按 16px 继承），四项并列就是「喧宾夺主」。
 * 战报按需渲染（`active === 'report'` 才在 DOM 里），所以 ui-check 同样够不到它，判据也只能在这一层。
 *
 * 第六块是**「上一轮」回看**（`TrickReview`）：机器人出手只有 0.5–1.5 秒，收墩后赢家立刻领出，
 * 上一墩的三家出牌一眨眼就没了 —— 入口是状态条**最左**那枚「上一轮」（它取代了原来的「第 N 轮」
 * chip：轮次号只有回看浮层的标题该说），内容是 `trickHistory`
 * 末项。它同样**默认关着**（`reviewOpen` 初值 false，SSR 里够不到），所以判据落在这里：
 * 入口必须 `pointer-events-auto`（外层是让开点击的信息条）、浮层必须是**毡面内**的
 * （`absolute`，不许 `fixed` —— 改成整屏就盖住手牌，而手牌必须一直可见可点）、
 * 牌面必须复用 `TrickCluster`、三条关闭路径（背景 / × / Esc）都要在，
 * 且「上一轮」的定义只有 `labels.ts` 的 `lastCompletedTrick` 一处。
 *
 * 沙箱内按包运行：node --test --test-isolation=none "test/*.test.ts"
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const page = read('../src/routes/table/[code]/+page.svelte');
const tabs = read('../src/lib/drawer-tabs.ts');
const rail = read('../src/lib/components/TabRail.svelte');
const drawer = read('../src/lib/components/TableDrawer.svelte');
const bidPanel = read('../src/lib/components/BidPanel.svelte');
const auctionRecord = read('../src/lib/components/AuctionRecord.svelte');
const buryPanel = read('../src/lib/components/BuryPanel.svelte');
const kittyPanel = read('../src/lib/components/KittyPanel.svelte');
const tablePanel = read('../src/lib/components/TablePanel.svelte');
const seatCard = read('../src/lib/components/SeatCard.svelte');
const seatActions = read('../src/lib/components/SeatActions.svelte');
const tableHeaderActions = read('../src/lib/components/TableHeaderActions.svelte');
const lobbyPanel = read('../src/lib/components/LobbyPanel.svelte');
const tableStatus = read('../src/lib/components/TableStatus.svelte');
const actionBar = read('../src/lib/components/ActionBar.svelte');
const actionTray = read('../src/lib/components/ActionTray.svelte');
const actionClock = read('../src/lib/components/ActionClock.svelte');
const trickArea = read('../src/lib/components/TrickArea.svelte');
const handFan = read('../src/lib/components/HandFan.svelte');
const dealSummary = read('../src/lib/components/DealSummary.svelte');
const historyList = read('../src/lib/components/HistoryList.svelte');
const scoreEquation = read('../src/lib/components/ScoreEquation.svelte');
const verdictBadge = read('../src/lib/components/VerdictBadge.svelte');
const levelTable = read('../src/lib/components/LevelTable.svelte');
const replayPanel = read('../src/lib/components/ReplayPanel.svelte');
const trickReview = read('../src/lib/components/TrickReview.svelte');
/** 出牌堆的间距是「组件算步距 + CSS 负边距」两半拼的，所以两半都要守（见 clusterCssCheck） */
const appCss = read('../src/app.css');

/** 剥掉注释再断言：注释里提到旧写法不构成引用（同 page-source.test.ts 的理由） */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

function headerOf(source: string): string {
  const match = /<header[\s\S]*?<\/header>/.exec(code(source));
  assert.ok(match !== null, '同桌页里找不到 <header>，无法校验页头内容');
  return match[0];
}

const pageCode = code(page);
const header = headerOf(page);

test('页头只留必要信息：大厅 / 邀请码 / 桌况簇 / 声音图标，加一样就要在这里显式改白名单', () => {
  for (const banned of ['战报', '教程', '叫牌', '底牌', 'HistoryList', 'IdentityQuickEdit', '结算详情']) {
    assert.equal(
      header.includes(banned),
      false,
      `页头里出现了「${banned}」：它属于右侧活页签抽屉（页头只剩 大厅 / 邀请码 / 桌况簇 / 声音）`
    );
  }
  // 声音设置的落点（`SoundControl`）是**有界的一步动作**：一枚图标 + 三个开关的弹层。
  // 它与 桌况簇 同类（页头两次爆满堆进去的都是战报/教程这类**查阅**面），所以在这里显式备案。
  for (const needed of ['← 大厅', 'InviteCode', 'TableHeaderActions', 'SoundControl']) {
    assert.ok(header.includes(needed), `页头少了「${needed}」（这是页头白名单里必须保留的一项）`);
  }
  // 桌况簇的两条接线：离座走**页面级**确认弹窗（抽屉的 transform 会困住 fixed 弹窗），
  // 改名开抽屉的「牌桌」页（表单要输入框，页头放不下）。
  assert.ok(
    header.includes('onLeave={() => (leaveOpen = true)}'),
    '页头的离座没有接到页面级的确认弹窗：挂在抽屉里会被 transform 困住'
  );
  assert.ok(
    header.includes("onRename={() => (active = 'table')}"),
    '页头的改名不是开抽屉的「牌桌」页：身份表单没有第二个落点'
  );
  // 连接圆点已下线：它只在没事的时候亮着，而手机上没有 hover 解释它。
  // 断线提示必须留在页头**之外**（见下一条测试），不然页头又会被撑高、回到老问题。
  for (const gone of ['dotClass', 'h-2 w-2 rounded-full', '连接中断']) {
    assert.equal(
      header.includes(gone),
      false,
      `页头里出现了「${gone}」：连接状态不再是常驻指示器，断线提示在页头下方单独成条`
    );
  }
});

/**
 * 桌况簇（`TableHeaderActions`）的形状：观战人数 + 一步动作。
 *
 * 判据三条，各对应一个具体的坏法：
 * ① 人数**含 0 常显**（不许被条件包住）—— 否则 0 → 1 时右侧会横跳一下；
 * ② 在座给「离座」、不在座给「改名」（+ 有空座时「入座」）—— 三态齐全，不给必定失败的按钮；
 * ③ 入座按钮要禁用 busy（慢网下防双击，与座位卡/座位页同一套判据）。
 */
function headerClusterCheck(source: string): string | null {
  const src = code(source);
  const span = src.indexOf('data-watch-count');
  const firstIf = src.indexOf('{#if');
  if (span < 0) return '桌况簇里找不到观战人数（data-watch-count）：页头又只剩一个入座按钮了';
  if (firstIf >= 0 && span > firstIf) {
    return '观战人数被条件包住了：它要含 0 常显，否则 0 → 1 时页头右侧会横跳一下';
  }
  if (!src.includes('spectatorCount')) {
    return '观战人数不是取负载里的 spectatorCount（口径是实时连接数，不是观战记录条数）';
  }
  if (!/\{#if seated\}[\s\S]*?离座[\s\S]*?\{:else\}[\s\S]*?改名/.test(src)) {
    return '三态不对：在座要「离座」、不在座要「改名」（先离座再改名才是一条走得通的路）';
  }
  if (!/\{#if free\}[\s\S]*?入座/.test(src)) {
    return '「入座」不是只在有空座时出现：补位有时限，没有空座时就该没有这个按钮';
  }
  // 认「入座那个按钮自己那个标签」：disabled 在标签里排在「入座」二字之前，
  // 从文字往后截会把它漏掉（第一版就是这么空转的）。
  const sitTag = tagOf(src, src.indexOf('入座'));
  if (!sitTag.includes('disabled={client.busy}')) {
    return '「入座」按钮没有 disabled={client.busy}：慢网下会被人连点两次';
  }
  return null;
}

test('桌况簇：观战人数含 0 常显，在座给离座、不在座给改名（+ 有空座才给入座）', () => {
  const problem = headerClusterCheck(tableHeaderActions);
  assert.equal(problem, null, problem ?? '');
});

test('反证：人数被条件包住 / 三态丢失 / 入座不为 busy 禁用，都必须被判出来', () => {
  const CLUSTER =
    '<span data-watch-count="true">{client.table?.spectatorCount ?? 0} 人观战</span>' +
    '{#if seated}<button>离座</button>{:else}<button>改名</button>{#if free}' +
    '<button disabled={client.busy}>入座</button>{/if}{/if}';
  assert.equal(headerClusterCheck(CLUSTER), null, '这条守卫对合规的最小簇也报错（过宽）');
  assert.match(
    headerClusterCheck(`{#if seated}<button>离座</button>{/if}${CLUSTER}`) ?? '',
    /条件包住/,
    '观战人数排在第一个 {#if} 之后（被条件包住）却没有被判出来'
  );
  assert.match(
    headerClusterCheck(CLUSTER.replace('{:else}<button>改名</button>', '')) ?? '',
    /三态/,
    '不在座没有「改名」没有被判出来'
  );
  assert.match(
    headerClusterCheck(CLUSTER.replace('{#if free}', '')) ?? '',
    /入座/,
    '「入座」不再受有空座约束没有被判出来'
  );
  assert.match(
    headerClusterCheck(CLUSTER.replace('disabled={client.busy}', '')) ?? '',
    /busy/,
    '「入座」丢掉 busy 禁用没有被判出来'
  );
  assert.match(
    headerClusterCheck(CLUSTER.replace('client.table?.spectatorCount ?? 0', '0')) ?? '',
    /spectatorCount/,
    '观战人数写死成 0（不取负载）没有被判出来'
  );
});

test('连接状态只在断线时出声：正常态不占像素，也不许改成常显', () => {
  assert.ok(
    pageCode.includes("client.connection === 'offline'"),
    '断线提示不是「只在 offline 时出现」：常显会在每次加载时闪一条并顶动牌桌（见 CONTEXT.md）'
  );
  assert.ok(pageCode.includes('连接中断'), '找不到断线提示的文案（它要说明画面可能停在上一帧）');
  assert.ok(pageCode.includes('role="status"'), '断线提示缺 role="status"：读屏听不到重连');
});

test('四个页签与顺序只在 drawer-tabs.ts 里写一次，且与你的清单一致', () => {
  const order = ["{ key: 'report', label: '战报' }", "{ key: 'auction', label: '叫牌' }", "{ key: 'kitty', label: '底牌' }", "{ key: 'table', label: '牌桌' }"];
  let cursor = -1;
  for (const entry of order) {
    const at = tabs.indexOf(entry);
    assert.ok(at > cursor, `drawer-tabs.ts 里缺「${entry}」或顺序不对（应为 战报 → 叫牌 → 底牌 → 牌桌）`);
    cursor = at;
  }
  assert.ok(code(rail).includes('DRAWER_TABS'), '页签条没有从 drawer-tabs.ts 读清单（会与抽屉各写一份）');
  assert.ok(code(drawer).includes('drawerTabLabel'), '抽屉标题没有从 drawer-tabs.ts 取（会与页签条各写一份）');
});

test('抽屉默认关闭且「牌桌」页常驻：那两条抓 SSR 的端到端守卫靠它', () => {
  assert.ok(
    pageCode.includes('let active = $state<DrawerTabKey | null>(null)'),
    '抽屉的初始状态不是「关着」：不许自动打开（纯手动，见 CONTEXT.md）'
  );
  assert.ok(
    drawer.includes("hidden={active !== 'table'}"),
    '「牌桌」页不是常驻的（被写成 {#if active === \'table\'}）：改名/换身份与座位已满就不再出现在观战页的 SSR 里'
  );
  assert.ok(
    tablePanel.includes('改名 / 换身份'),
    '「牌桌」页里找不到「改名 / 换身份」（ui-check 与 spectate-check 都按这个字符串抓）'
  );
  assert.equal(
    code(drawer).includes('座位已满'),
    false,
    '座位已满应当由「牌桌」页里的 SeatActions 渲染，不是抽屉自己写'
  );
});

test('查阅面进抽屉，动作面留桌面', () => {
  for (const [name, source] of [
    ['TableDrawer', drawer],
    ['KittyPanel', kittyPanel],
    ['TablePanel', tablePanel]
  ] as const) {
    for (const action of ['client.bury(', 'client.play(', 'client.bid(', 'client.deal(', 'client.newGame(']) {
      assert.equal(
        code(source).includes(action),
        false,
        `${name} 里出现了 ${action}：这是动作面，必须留在桌面（叫牌候选、确认埋底、出牌、发牌）`
      );
    }
  }
  // 叫牌记录只有**一份实现**：`AuctionInfo`（信息面）+ `AuctionHistory`（历史表），
  // 抽屉走 `AuctionRecord` 这个组合件，毡面面板直接拼两块 —— 它插在两者之间的只有候选档位
  // （顺序还要对，见 test/bid-panel.test.ts），自己不许写第二份记录。
  assert.ok(
    code(bidPanel).includes('AuctionInfo') && code(bidPanel).includes('AuctionHistory'),
    '毡面的叫牌面板没有复用 AuctionInfo / AuctionHistory（叫牌记录会出现第二份真相）'
  );
  assert.ok(
    code(auctionRecord).includes('AuctionInfo') && code(auctionRecord).includes('AuctionHistory'),
    '抽屉那侧的 AuctionRecord 没有把信息面与历史表拼起来（两处渲染会各自过期）'
  );
  for (const own of ['bidText(', 'highestCall(', '还没人叫']) {
    assert.equal(
      code(bidPanel).includes(own),
      false,
      `BidPanel 里出现了 ${own}：记录面必须留在 AuctionInfo / AuctionHistory，` +
        '面板只负责把候选档位与「不叫」插在它们之间'
    );
  }
  assert.ok(
    code(kittyPanel).includes('buriedKitty'),
    '「底牌」页没有读 you.buriedKitty（它要的是庄家埋下去的那 3 张）'
  );
  // 动作面的**唯一**落点：毡面上的 ActionTray（出牌与埋底都在那里，且只在该你出手时出现）
  assert.ok(
    code(actionTray).includes('client.play(') && code(actionTray).includes('client.bury('),
    '动作托盘里找不到出牌/埋底：动作面（出牌、确认埋底）必须留在桌面'
  );
  assert.equal(
    code(kittyPanel).includes('originalKitty'),
    false,
    '「底牌」页引用了 originalKitty：拿上来的那 3 张只活在毡面的埋底面板里，两处不许混同'
  );
});


test('横跨一层的覆盖层必须让开点击（否则它盖住的东西看得见、点不到）', () => {
  // 起因是一个实测 bug：`LobbyPanel` 的 `absolute inset-0` 铺满毡面、在 DOM 里又排在座位卡**之后**，
  // 于是刚开桌（还没发牌、两个空座）时「+ 机器人」按钮被它整层盖住 —— 看得见、点下去命中大厅层。
  // 规则：铺满一层的覆盖层根节点一律 `pointer-events-none`，需要点的控件自己 `pointer-events-auto`；
  // 例外必须写进 EXEMPT 并说明理由。
  //
  // ADR-0020 之后毡面里已经没有动作按钮了（座位卡上的「+ 机器人 / 请离」搬进了抽屉的「牌桌」页），
  // 所以这条规则的**受害者**变成了毡面里剩下的可点元素：状态条上那枚「上一轮」回看入口、
  // 埋底面板里那行底牌。规则本身照旧 —— 将来谁又铺一层，它照样会盖住那些控件。
  const EXEMPT: Record<string, string> = {
    'BidPanel.svelte':
      '它自己就是滚动容器（inset-0 + overflow-y-auto）：让开点击会把滚轮一起让掉，反而点不到「不叫」',
    'TrickArea.svelte':
      '只在各家的出牌点上画牌（盒子各占 38% 的宽度预算，不是整面覆盖），且它住在内容槽里',
    'ActionTray.svelte':
      '它铺满的是**动作带**（毡面之外那条常驻空带），带里没有别的控件；毡面一侧由带子自己的边界隔开，' +
      '所以它不需要让开点击 —— 它是这一层里**唯一**的可点内容'
  };

  /** 取根元素的 class（剥注释后第一个 section/div 的 class 属性） */
  function rootClass(source: string): string {
    const stripped = code(source);
    const match = /<(?:section|div|aside|figure)[^>]*\sclass=(?:"([^"]*)"|\{(\[[\s\S]*?\])\})/.exec(stripped);
    assert.ok(match !== null, '取不到根元素的 class');
    return match[1] ?? match[2]!;
  }

  const dir = new URL('../src/lib/components/', import.meta.url);
  const files = readdirSync(fileURLToPath(dir)).filter((name) => name.endsWith('.svelte'));
  const wide: string[] = [];
  for (const file of files) {
    const source = code(read(`../src/lib/components/${file}`));
    // 毡面级 = absolute 定位且横跨整幅（inset-0 / inset-x-0 / inset-x-3 都算）
    if (!/class="[^"]*\babsolute\b[^"]*\binset-(?:x-)?[03]\b/.test(source) && !/absolute inset-0/.test(source)) continue;
    wide.push(file);
    if (EXEMPT[file] !== undefined) continue;
    assert.ok(
      rootClass(read(`../src/lib/components/${file}`)).includes('pointer-events-none'),
      `${file} 铺满了一层却没让开点击：它会在那一层里可点的东西上吃掉点击（毡面里就有「上一轮」与底牌行）`
    );
  }
  // 断言不能空转：实测踩过的那个大厅层必须真的被扫进来
  assert.ok(wide.includes('LobbyPanel.svelte'), 'LobbyPanel.svelte 没被这条守卫扫到 —— 扫描规则可能失效了');

  /**
   * **层不出内容槽**（ADR-0020）。
   *
   * 早先这一节守的是「横跨整幅毡面的层必须让开点击」—— 那时候状态条 / 大厅面板 / 回看浮层
   * 各自绝对定位、横跨整幅，所以会在座位卡的动作按钮上吃掉点击。现在毡面是**三行格**
   * （`[顶卡][内容槽][我的底栏]`），除座位行与那张有意做成模态的回看浮层之外，所有层都必须
   * 住在**内容槽里**：槽自己 `relative min-h-0` 把它们的上下界框死，于是「两个层各算各的
   * 偏移而互相压住」在结构上不可能（截图里的 #3 #5 正是那样来的）。
   *
   * 判据用**顺序**表达：毡面三个行钩子按 seats → slot → me 出现，且每个层组件都出现在
   * slot 与 me 之间（即都住在内容槽里）。真正的像素由 `scripts/shot-auction.ts` 实测。
   */
  const feltRowIndex = (name: string): number => code(page).indexOf(`data-felt-row="${name}"`);
  assert.deepEqual(
    ['seats', 'slot', 'me'].map(feltRowIndex).every((at, index, all) => at > 0 && (index === 0 || at > all[index - 1]!)),
    true,
    `毡面不是「顶卡 / 内容槽 / 我的底栏」三行格（钩子位置：${['seats', 'slot', 'me'].map(feltRowIndex).join(', ')}）`
  );
  const slotAt = feltRowIndex('slot');
  const meAt = feltRowIndex('me');
  for (const layer of ['LobbyPanel', 'TableStatus', 'BuryPanel', 'BidPanel', 'TrickArea'] as const) {
    const at = code(page).indexOf(`<${layer}`);
    assert.ok(
      at > slotAt && at < meAt,
      `${layer} 不在内容槽里（位置 ${at}，内容槽 ${slotAt}–${meAt}）：它又成了各算各的偏移层，` +
        '会与别的层压在一起 —— 必须住在 data-felt-row="slot" 里'
    );
  }

  // 让开之后，可点的控件必须自己接回来，否则连邀请码 / 开始第一副 / 规则演示都点不动了
  for (const [name, source, minimum] of [
    ['LobbyPanel.svelte', lobbyPanel, 3], // 邀请码、开始第一副、规则演示链接
    ['BuryPanel.svelte', buryPanel, 1] // 「拿上来的底牌」那块
  ] as const) {
    const auto = code(source).split('pointer-events-auto').length - 1;
    assert.ok(auto >= minimum, `${name} 只接了 ${auto} 处 pointer-events-auto（至少要 ${minimum} 处）`);
  }
  // 三层里必须一个可点元素都不少（别用「删掉控件」来让守卫变绿）。
  // 埋底面板那一行这一版不再写「你拿上来的底牌」那句话（蓝框自己说话），所以认它的钩子。
  for (const [name, source, needle] of [
    ['LobbyPanel.svelte', lobbyPanel, 'InviteCode'],
    ['LobbyPanel.svelte', lobbyPanel, '开始第一副'],
    ['TableStatus.svelte', tableStatus, '定约'],
    ['BuryPanel.svelte', buryPanel, 'data-taken-kitty']
  ] as const) {
    assert.ok(source.includes(needle), `${name} 里少了「${needle}」`);
  }
});

test('动作按钮都要在有请求在飞时禁用（慢网下防双击），机器人按钮也不例外', () => {
  // 参照物：入座/离座一直是对的；加机器人这些后加的按钮当初漏了 busy 判断
  assert.ok(
    code(seatActions).includes('disabled={client.busy}'),
    '「入座」按钮不再禁用 busy —— 参照物变了，请检查这条守卫是不是在空转'
  );
  // 机器人动作的**唯一**落点是抽屉「牌桌」页（`TablePanel`），见 ADR-0020：
  // 它们曾挂在毡面的座位卡底下，比对手卡高出一整行，正是毡面重叠的直接原因。
  // 不用正则拼标签（标签里有 `+`，正则里是量词）——按 <button 切块找，读起来也直白
  const buttons = code(tablePanel).split('<button').slice(1);
  for (const label of ['+ 机器人', '请离']) {
    const block = buttons.find((piece) => piece.includes(label));
    assert.ok(block !== undefined, `「牌桌」页里找不到「${label}」按钮`);
    assert.ok(
      block.includes('disabled={client.busy}'),
      `「${label}」按钮没有 disabled={client.busy}：慢网下会被人连点两次`
    );
  }
  // 按钮位置必须带语义：点哪个空座就加进哪个座位（曾经过：无论点哪个都加进第一个空座）
  assert.ok(
    code(tablePanel).includes('client.addBot(seat.seat)'),
    '空座那一行的「+ 机器人」没有把自己的座位传出去 —— 又会变成「点第二个、坐到第一个」'
  );
  // 反向：这两个动作不许回到毡面的座位卡上（那正是它偏高的原因）
  for (const label of ['+ 机器人', '请离']) {
    assert.equal(
      code(seatCard).includes(label),
      false,
      `座位卡上又长出了「${label}」：它会让卡片高出整整一行，再次压住状态条与叫牌面板`
    );
  }
  // 请离的确认弹窗必须挂在页面级：抽屉有 transform，会把它困在抽屉里（fixed 会失效）
  assert.ok(
    code(page).includes('<BotRemoveConfirm') && code(page).includes('onRemoveBot={'),
    '请离的确认弹窗没挂在页面级：抽屉的 transform 会把 fixed 弹窗困住'
  );
});

/* ---------- 埋底阶段：状态条与暗底槽位同列流 + 字号不许回潮 ---------- */

/**
 * 阶段状态条（定约 / 庄已抓）与埋底面板必须同属**一个**列容器，两者自己都不许定位。
 *
 * 早先两者各定各的（状态条 `top-[5.5rem]`、埋底面板 `top-[12%]`），手机短屏上「定约 / 庄已抓」
 * 正好压在暗底槽位上 —— 两处各算各的位置，谁也管不了谁。ADR-0020 之后更进一层：这个列容器
 * 住在毡面的**内容槽**里（`data-felt-row="slot"`），所以它连 `absolute` 都不该有 ——
 * 上下界由内容槽给，偏移量一个都不需要。这条在无浏览器的环境里只能落到源头上。
 */
function phaseStatusFlow(pageSource: string, statusSource: string, burySource: string): string | null {
  const src = code(pageSource);
  const flow =
    /<div class="([^"]*)"[^>]*>\s*<TableStatus \{view\} \/>\s*<BuryPanel \{client\} \/>/.exec(src);
  if (flow === null) {
    return '牌桌页没有把状态条与埋底面板放进同一个列容器（各定各的位置，短屏上就会重叠）';
  }
  const cls = flow[1] ?? '';
  if (/\babsolute\b/.test(cls)) {
    return '状态条/埋底面板的列容器又绝对定位了：它住在内容槽里，上下界由槽给，不需要任何偏移';
  }
  if (/\btop-\[|\bbottom-\[/.test(cls)) {
    return `列容器又自己写了偏移（${cls}）：内容槽已经框定了上下界，魔数偏移正是「两处各算各的」的来源`;
  }
  if (/\bpointer-events-none\b/.test(cls)) {
    return '列容器还在让开点击：它不再横跨毡面（只在内容槽里），让开点击会让底牌行点不动';
  }
  if (/\babsolute\b/.test(code(statusSource))) return 'TableStatus 自己绝对定位：它和埋底面板会各算各的位置';
  if (/\babsolute\b/.test(code(burySource))) return 'BuryPanel 自己绝对定位：它和状态条会各算各的位置';
  return null;
}

/** 状态条字号自检：定约 / 庄已抓要有大号数字，且不许回到 10px 的小号 chip */
function statusTypeCheck(statusSource: string): string | null {
  const src = code(statusSource);
  if (!/text-2xl/.test(src)) return '定约 / 庄已抓的数字没有 text-2xl：又缩回不显眼的小字了';
  if (/text-\[10px\]/.test(src)) return '状态条里又出现了 10px 小字（整条被缩回小 chip）';
  return null;
}

test('埋底阶段：状态条与暗底槽位同列流，短屏也不重叠', () => {
  const problem = phaseStatusFlow(page, tableStatus, buryPanel);
  assert.equal(problem, null, problem ?? '');
});

test('反证：各自绝对定位的旧版面必须被判出来', () => {
  const OLD_PAGE = `<TableStatus {view} />\n<BuryPanel {client} />`;
  assert.ok(
    phaseStatusFlow(OLD_PAGE, tableStatus, buryPanel) !== null,
    '旧版面（没有同列容器）被判为合规：这条守卫是空转的'
  );
  assert.ok(
    phaseStatusFlow(page, '<div class="absolute top-[5.5rem]">状态条</div>', buryPanel) !== null,
    '状态条自己绝对定位被判为合规'
  );
  // 列容器自己又写上偏移（或又让开点击）—— 两者都说明它没有「住进内容槽」
  const offset = code(page).replace(
    '<div class="flex flex-col items-center gap-3 px-2 pt-1">',
    '<div class="pointer-events-none absolute inset-x-0 top-[4.5rem] flex flex-col items-center gap-3 px-2">'
  );
  assert.match(
    phaseStatusFlow(offset, tableStatus, buryPanel) ?? '',
    /绝对定位|偏移/,
    '列容器回到「自己算偏移」的旧形状没有被判出来'
  );
});

test('定约与庄已抓是大号数字（不再是小号 chip）', () => {
  const problem = statusTypeCheck(tableStatus);
  assert.equal(problem, null, problem ?? '');
});

test('反证：旧的 10px chip 版面必须被判出来', () => {
  const OLD_STATUS = `<div class="flex flex-wrap justify-center gap-1.5 px-2 text-[10px] sm:text-[11px]">
  <span class="rounded-full bg-black/35 px-2.5 py-1">第 <b>{trickNo}</b> 轮</span>
  <span class="rounded-full bg-black/35 px-2.5 py-1">定约</span>
</div>`;
  assert.match(statusTypeCheck(OLD_STATUS) ?? '', /text-2xl/, '旧版面没有被判出来');
});

test('埋底面板不再写标题行，也不写底牌说明句（钩子留着给 ui-check）', () => {
  const src = code(buryPanel);
  for (const gone of ['选 3 张扣入暗底', '庄家埋底中', '你拿上来的底牌']) {
    assert.equal(
      src.includes(gone),
      false,
      `BuryPanel 又写回了「${gone}」：阶段说明归「?」、动作提示归操作条，这里不写第二遍`
    );
  }
  assert.ok(
    src.includes('data-taken-kitty'),
    'BuryPanel 丢了 data-taken-kitty 钩子：ui-check 靠它认「拿上来的底牌」那一行'
  );
});

/* ---------- 出牌阶段：动作托盘、赢墩徽标、跟牌蓝框 ---------- */

/**
 * 动作控件（已选张数 / 出牌 / 清空 / 确认埋底）必须活在**独立的一层**里，而且那一层住在
 * 毡面**之外**的那条常驻动作带上（ADR-0020）。每条要求都对应一次真实返工：
 *
 * ① 页面必须有一条 `data-action-band` 的常驻带，且 `ActionTray` 在它**里面** ——
 *    托盘原先钉在操作条上沿（`bottom-full`），而那 40px 整根落在毡面的最后 40px 里：
 *    手机 375px 上与自己的座位卡竖直重叠 32px、水平重叠 84px（截图里的 #4）。
 *    「抬高座位卡」只是把同一块地方换个方式占掉，所以这一带必须明确归属：**归托盘**。
 * ② 带子排在 `<ActionBar` **之前** —— 带在操作条之上、毡面之下；顺序反了托盘会跑到操作条下面。
 * ③ 托盘铺满带子并居中（`absolute inset-0` + `items-center justify-center`）；带子自己有高度，
 *    所以「轮到我 / 轮空」之间切换时毡面与手牌**零回流**。
 * ④ `flex-nowrap`：早先是 `flex-wrap`，窄屏上「清空」与红字各自挤出一行，托盘被撑到近 180px 高。
 * ⑤ `z-30`：压过上浮的选中牌。
 * ⑥ `w-max` + 每个 class 常量的 `whitespace-nowrap`：居中 + 宽度 auto 时 shrink-to-fit 的可用
 *    宽度会退化成内容的一半，子项被压缩后 CJK 会竖排（「出 牌」写成两行 —— 截图里那一次返工）。
 * ⑦ 旧锚不许回来：`bottom-full` / `-translate-y-1/2`（那就又是「悬在毡面最后 40px 里」）。
 */
function trayCoupling(pageSource: string, barSource: string, traySource: string): string | null {
  const pageSrc = code(pageSource);
  if (!/<div[^>]*data-action-band="true"[^>]*>[\s\S]*?<ActionTray\b/.test(pageSrc)) {
    return '牌桌页没有把 ActionTray 放进那条常驻动作带（缺 data-action-band，或托盘不在它里面）：托盘会回到毡面里压住「我」那条底栏';
  }
  const bandAt = pageSrc.indexOf('data-action-band');
  const barAt = pageSrc.indexOf('<ActionBar');
  if (barAt < 0 || bandAt > barAt) {
    return '动作带没有排在操作条之前：带子在操作条之上、毡面之下，顺序反了托盘会跑到操作条下面';
  }
  const tray = code(traySource);
  /**
   * 两层：外层是**铺满动作带**的那一层（`absolute inset-0` + 居中 + z-30），内层是带
   * `data-action-tray` 的内容盒（`w-max` + 不换行）。分开查是因为每一条判据只属于其中一层 ——
   * 混在一起查会让「根节点丢掉 w-max」与「外层回到旧锚」互相蒙混过去。
   */
  const layer = /<div[^>]*class="([^"]*)"[^>]*>\s*<div[^>]*data-action-tray/.exec(tray)?.[1] ?? '';
  const root = /<div[^>]*data-action-tray="true"[^>]*>/.exec(tray)?.[0] ?? '';
  // 旧锚先查：它是这一版要修的东西，报出来的就该是它（而不是被下一条「缺少 inset-0」遮住）
  if (layer.includes('bottom-full')) {
    return 'ActionTray 外层又用 bottom-full 钉在操作条上了：那 40px 整根落在毡面里，会盖住「我」那条底栏';
  }
  if (layer.includes('-translate-y-1/2') || layer.includes('top-1/2')) {
    return 'ActionTray 外层又垂直居中悬在操作条上了：应当铺满「毡面之外那条动作带」';
  }
  for (const cls of ['absolute', 'inset-0', 'items-center', 'justify-center', 'z-30']) {
    if (!layer.includes(cls)) {
      return `ActionTray 外层缺少 ${cls}：它不再铺满动作带（要么回毡面，要么不再居中）`;
    }
  }
  if (!tray.includes('flex-nowrap')) {
    return 'ActionTray 缺少 flex-nowrap：窄屏上「清空」与红字会各自挤出一行，把托盘撑高压住手牌';
  }
  if (/\bflex-wrap\b/.test(tray)) {
    return 'ActionTray 又允许换行（flex-wrap）：窄屏上「清空」与红字会各自挤出一行，把托盘撑高压住手牌';
  }
  if (/(^|[\s"'])w-full\b/.test(tray)) {
    return 'ActionTray 里出现了 w-full：错误提示一旦占满一行就会把托盘撑成两行（它必须绝对定位浮在上方）';
  }
  // ⑥ 宽度：居中 + 宽度 auto 时 shrink-to-fit 的可用宽度会退化成内容的一半，flex 子项于是被压缩，
  //    而 CJK 可以在任意字间断行 ——「出 牌」「清 空」就竖排成两行了。取**根开标签**判断：
  //    只扫全文会被错误气泡那枚 w-max 蒙混过去。
  if (!root.includes('w-max')) {
    return 'ActionTray 的根节点缺少 w-max：宽度会被压成半个容器，子项被压缩后「出 牌」会竖排';
  }
  // 第二道防线：每一个 class 常量都要带 whitespace-nowrap（计数 + 三个按钮）
  for (const name of ['count', 'gold', 'play', 'ghost']) {
    const match = new RegExp(`const ${name} =\\s*'([^']*)'`).exec(tray);
    if (match === null || !match[1]!.includes('whitespace-nowrap')) {
      return `ActionTray 的 ${name} 缺 whitespace-nowrap：被压缩时中文会在任意字间断行（「确认埋底」写成两行）`;
    }
  }
  if (!tray.includes('data-action-tray')) return 'ActionTray 丢了 data-action-tray 钩子：ui-check 靠它认出这一层';
  for (const gone of ['client.play(', 'client.bury(', '已选']) {
    if (code(barSource).includes(gone)) {
      return `ActionBar 里又出现了 ${gone}：动作控件必须只在 ActionTray（否则窄屏换行会顶动整页）`;
    }
  }
  return null;
}

/** 赢墩徽标只说分归哪一方（`trickSideBadge`）：旧的「上一轮 · 赢墩 +N 分」不许回来 */
function badgeCheck(trickAreaSource: string): string | null {
  const src = code(trickAreaSource);
  if (!src.includes('trickSideBadge')) {
    return '出牌区没有用 trickSideBadge：赢墩徽标会退回「上一轮 · 赢墩 +N 分」';
  }
  for (const gone of ['上一轮', '赢墩 +']) {
    if (src.includes(gone)) return `出牌区又写回了「${gone}」：徽标只报这 N 分归庄方还是闲方`;
  }
  return null;
}

/** 跟牌蓝框：领出那一门必须经 `followSuitCards` 接进 HandFan 的 marked */
function followMarkCheck(pageSource: string, fanSource: string): string | null {
  const src = code(pageSource);
  if (!src.includes('followSuitCards')) {
    return '牌桌页没有在跟牌时算领出那一门：跟牌看不到该跟哪几张（标记会一直是空的）';
  }
  if (!/marked=\{markedKeys\}/.test(src)) {
    return 'HandFan 的 marked 不再是 markedKeys：跟牌/埋底的蓝框标记接错了来源';
  }
  if (!/followSuitCards\(you\.hand, trump, deal\.trick\)/.test(src)) {
    return 'followSuitCards 的入参不对：应当是（我的手牌, trump, 当前墩）';
  }
  if (!code(fanSource).includes('marked')) {
    return 'HandFan 不再接受 marked：蓝框标记传不到牌面上';
  }
  return null;
}

test('出牌阶段：动作控件住在毡面之外那条常驻动作带里，操作条只剩信息', () => {
  const problem = trayCoupling(page, actionBar, actionTray);
  assert.equal(problem, null, problem ?? '');
});

test('反证：托盘回毡面、丢掉动作带、垂直居中、允许换行、错误提示占整行，都必须被判出来', () => {
  assert.ok(
    trayCoupling(page, actionBar, '<div class="flex gap-2">出 牌</div>') !== null,
    '流内托盘被判为合规：这条守卫是空转的'
  );
  assert.ok(
    trayCoupling(
      page,
      '<span>已选 {n} 张</span><button onclick={() => void client.play()}>出 牌</button>',
      actionTray
    ) !== null,
    '操作条里重新长出动作控件被判为合规'
  );
  assert.ok(
    trayCoupling('<ActionBar {client} />\n<ActionTray {client} />', actionBar, actionTray) !== null,
    '没有动作带（托盘会回毡面）被判为合规'
  );
  // 带子排在操作条之后：托盘会跑到操作条下面
  const BAND_BELOW = '<ActionBar {client} />\n<div data-action-band="true"></div>\n<ActionTray {client} />';
  assert.match(
    trayCoupling(BAND_BELOW, actionBar, actionTray) ?? '',
    /动作带/,
    '动作带排到操作条之后没有被判出来'
  );
  // 截图里那一次：悬在操作条上方 → 整根落在毡面最后 40px 里，压住「我」那条底栏。
  // 从**真实托盘**改一个字，这样它只会踩中这一条规则（用极简字面量当反例时，先撞上的往往是别的检查）。
  const OLD_ANCHOR = actionTray.replace('absolute inset-0', 'absolute bottom-full');
  assert.match(
    trayCoupling(page, actionBar, OLD_ANCHOR) ?? '',
    /bottom-full/,
    '回到旧锚（bottom-full）的托盘没有被判出来'
  );
  // 换行 + 红字各占一行 → 撑高压住手牌
  const WRAPPING = actionTray.replace('flex w-max flex-nowrap', 'flex w-max flex-wrap');
  assert.match(trayCoupling(page, actionBar, WRAPPING) ?? '', /flex-nowrap/, '允许换行的托盘没有被判出来');
  // 精确性：`max-w-full` 这类「以 w-full 结尾的另一个类名」不该被误判成整行宽度
  const MAX_W = actionTray.replace('flex-nowrap items-center', 'flex-nowrap max-w-full items-center');
  assert.equal(trayCoupling(page, actionBar, MAX_W), null, 'max-w-full 被误判成了 w-full（守卫过宽）');
  // 截图里那一次：根节点宽度只剩半个容器 ⇒ flex 子项被压缩 ⇒「出 牌」竖排
  assert.match(
    trayCoupling(page, actionBar, actionTray.replace('flex w-max', 'flex')) ?? '',
    /w-max/,
    '根节点丢掉 w-max（宽度被压成半个容器）没有被判出来'
  );
  // 第二道防线被删掉：某个 class 常量的 whitespace-nowrap 不见了
  assert.match(
    trayCoupling(
      page,
      actionBar,
      actionTray.replace(
        'play-btn inline-flex items-center justify-center whitespace-nowrap rounded-lg',
        'play-btn inline-flex items-center justify-center rounded-lg'
      )
    ) ?? '',
    /whitespace-nowrap/,
    '按钮的 whitespace-nowrap 被删掉没有被判出来'
  );
});

test('赢墩徽标只说「庄 / 闲 +N 分」', () => {
  const problem = badgeCheck(trickArea);
  assert.equal(problem, null, problem ?? '');
});

test('反证：旧的「上一轮 · 赢墩 +N 分」必须被判出来', () => {
  assert.ok(
    badgeCheck('<TrickCluster badge={`上一轮 · 赢墩 +${points} 分`} />') !== null,
    '旧徽标文案没有被判出来'
  );
});

test('跟牌时领出那一门接进 HandFan 的 marked', () => {
  const problem = followMarkCheck(page, handFan);
  assert.equal(problem, null, problem ?? '');
});

test('反证：标记接错来源 / 入参不对时必须被判出来', () => {
  assert.ok(
    followMarkCheck('<HandFan marked={markedKeys} />', handFan) !== null,
    '没有 followSuitCards 被判为合规'
  );
  assert.ok(
    followMarkCheck(
      page.replace('followSuitCards(you.hand, trump, deal.trick)', 'followSuitCards(you.hand, null, null)'),
      handFan
    ) !== null,
    'followSuitCards 的入参被换掉没有判出来'
  );
  assert.ok(
    followMarkCheck(page, '<div class="fan"></div>') !== null,
    'HandFan 不再接受 marked 没有判出来'
  );
});

/* ---------- 「距上一步」计时 ---------- */

/**
 * 计时的数据来源必须是**负载里的年龄**（服务端算的），不是浏览器自己「页面打开到现在」：
 * 后者在刷新/重连后会从 0 重来，把「这桌已经卡了 5 分钟」显示成「刚动过」。
 * 判据两条：操作条渲染了 `ActionClock` 并把 `client.table.actionAgeMs` 传进去；
 * 计时组件真的在走（`setInterval`），初值来自 prop（`formatElapsed(ageMs)`）。
 */
function clockWiring(barSource: string, clockSource: string): string | null {
  const bar = code(barSource);
  if (!bar.includes('<ActionClock')) return '操作条没有渲染 ActionClock：牌桌上没有「距上一步」计时';
  if (!bar.includes('actionAgeMs')) {
    return 'ActionClock 的年龄不是从负载里取的（缺 client.table.actionAgeMs）：刷新后计时会从 0 重来';
  }
  if (!/<ActionClock[^>]*class="ml-auto"/.test(bar)) {
    return '计时没有靠 ml-auto 停在操作条右端：它该像牌桌上的钟一样待在一边，而不是挤在「?」与状态句中间';
  }
  const clock = code(clockSource);
  if (!clock.includes('formatElapsed')) return '计时组件没有用 formatElapsed 写时长';
  if (!clock.includes('setInterval')) return '计时组件不会走时（缺 setInterval）：那只是一张静止的截图';
  if (!clock.includes('data-action-clock')) return '计时组件丢了 data-action-clock 钩子：ui-check 靠它认这个元素';
  if (!/elapsed !== null/.test(clock)) return '计时组件在还没有牌局（ageMs 为 null）时也会渲染：大厅里没有「上个动作」可说';
  return null;
}

test('「距上一步」计时读负载里的年龄，并且真的在走', () => {
  const problem = clockWiring(actionBar, actionClock);
  assert.equal(problem, null, problem ?? '');
});

test('反证：计时不渲染 / 从页面打开计时 / 不走时，都必须被判出来', () => {
  assert.ok(
    clockWiring('<div class="flex">?</div>', actionClock) !== null,
    '操作条里没有计时被判为合规'
  );
  assert.ok(
    clockWiring('<ActionClock ageMs={openedAt} />', actionClock) !== null,
    '年龄不从负载取（改成页面打开时刻）被判为合规'
  );
  assert.ok(
    clockWiring(actionBar, '<span data-action-clock="true">{formatElapsed(0)}</span>') !== null,
    '不走时的「时钟」被判为合规'
  );
  assert.ok(
    clockWiring(
      '<ActionClock ageMs={client.table.actionAgeMs} />',
      '<span data-action-clock="true">{formatElapsed(elapsed)}</span>'
    ) !== null,
    '计时没有停在操作条右端被判为合规'
  );
});

/* ---------- 结算的三件东西（弹窗与战报共用）+ 战报页 + 底牌页 ---------- */

/** 取某个位置所在的那个标签（往回找最近的 `<`，往后截到第一个 `>`）—— 与 panel-guard.ts 同一套路 */
function tagOf(source: string, index: number): string {
  const start = source.lastIndexOf('<', index);
  const end = source.indexOf('>', index);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end + 1);
}

/**
 * 算式（`ScoreEquation`）：结算弹窗、战报的每副卡、机器重演展开体是**同一条算式**，
 * 三档尺寸只差 token。
 * 四条判据各对应一次真实缺陷：
 * ① 墩分与底分之间的符号必须来自 `kittySign`（抠底 −、保底 +）—— 早先硬写 `+`，
 *    抠底时显示出「60 + 10 × 1 = 50」这种自相矛盾的算式；
 * ② 那个符号按保底/抠底着色（绿 / 红），且着色认的是**符号自己那个标签**；
 * ③ 符号与四个数字**同级字号**：各档尺寸各只有一个 `num` token，五处共用它 ——
 *    抽成档位之后「同一个 token」才是「同级字号」的真判据（早先这里写死 `text-[26px]`）；
 * ④ **ghost 档必须在**（机器重演展开体用）：数字比 `compact` 再小一档、底牌小牌面淡一档 ——
 *    少了它，展开体的算式就与主卡同档，喧宾夺主。
 */
function equationCheck(source: string): string | null {
  const src = code(source);
  const call = src.lastIndexOf('kittySign(');
  if (call < 0) {
    return '算式没有用 kittySign：墩分与底分之间会退回硬写的 `+`（抠底时显示出 60 + 10 × 1 = 50）';
  }
  const sign = tagOf(src, call);
  for (const cls of ['font-black', 'text-emerald-300', 'text-rose-300']) {
    if (!sign.includes(cls)) {
      return `算式的加减号缺少 ${cls}：它决定「加还是扣」，要与数字同级字重并按保底/抠底着色 —— ${sign.slice(0, 150)}`;
    }
  }
  if (!sign.includes('{s.num}')) {
    return '加减号没有与数字共用同一个字号 token（{s.num}）：「加还是扣」的符号被缩成小字了';
  }
  const sizes = src.split('{s.num}').length - 1;
  if (sizes < 5) {
    return `只有 ${sizes} 处用 {s.num}：符号与四个数字（墩分/底分/末轮/得分）必须共用同一档字号`;
  }
  if (!src.includes('kitty-mini')) return '算式里没有底牌小牌面（.kitty-mini）：底分那一格看不到是哪三张';
  for (const size of ['text-[26px]', 'text-xl']) {
    if (!src.includes(size)) {
      return `算式缺少 ${size} 这一档：弹窗用大字、战报卡用窄幅小字，两档都要在（战报卡放不下大字）`;
    }
  }
  if (!src.includes('底分')) return '底分那一格没有「底分」子标：子标只有一份文案，两档不许各写各的';
  if (!/ghost:\s*\{/.test(src)) {
    return '算式没有 ghost 档（机器重演展开体用）：展开体里那三格会与主卡同档，喧宾夺主';
  }
  if (!src.includes('text-base')) {
    return 'ghost 档没有把数字降下来（text-base）：它要比 compact（text-xl）小一档才叫降权';
  }
  if (!src.includes('opacity-75')) {
    return 'ghost 档没有把底牌小牌面淡一档（opacity-75）：三张白牌会成为展开体里最响的东西';
  }
  return null;
}

/**
 * 结论（`VerdictBadge`）：**只有一行**（`scoreLineText`），底色与文字色是唯一的输赢着色来源。
 * 不许回潮成「打输 · 差 N 分」再加一行「两名闲家各升 ceil(差 / 10) = N 级；庄家级别不变」。
 *
 * 另有 ghost 档（机器重演展开体用）：它**只许降音量、不许改色相** —— 少了这一档，展开体里
 * 会与主卡那枚并列出两枚同尺寸同色的实心胶囊，一起抢眼；而改成中性色就等于把「唯一的输赢
 * 着色来源」从展开体里拿掉，读数会退回「差 N 分」那串字。
 */
function verdictCheck(source: string): string | null {
  const src = code(source);
  if (!src.includes('scoreLineText(')) {
    return '结论没有走 scoreLineText：又会写成「打输 · 差 N 分」再加一行 ceil(差 / 10)';
  }
  if (src.includes('两名闲家各升')) {
    return '结论又写回了「两名闲家各升 ceil(差 / 10) = N 级」：结论只有一行';
  }
  if (src.includes('庄家级别不变')) {
    return '结论里又出现「庄家级别不变」：没升级的那行在升级表里写「不变」';
  }
  for (const cls of [
    'bg-emerald-500/15',
    'ring-emerald-400/30',
    'text-emerald-300',
    'bg-rose-500/15',
    'ring-rose-400/30',
    'text-rose-300'
  ]) {
    if (!src.includes(cls)) return `结论缺少 ${cls}：底色与文字色是唯一的输赢着色来源`;
  }
  if (!/ghost:\s*\{/.test(src)) {
    return '结论没有 ghost 档（机器重演展开体用）：两枚同尺寸同色的胶囊并列，重演那枚会和主卡抢眼';
  }
  for (const cls of ['text-emerald-300/70', 'text-rose-300/70']) {
    if (!src.includes(cls)) {
      return `结论的 ghost 档丢了 ${cls}：降权只许降音量，赢绿 / 输红是唯一的输赢着色来源`;
    }
  }
  for (const cls of ['bg-emerald-500/5', 'bg-rose-500/5']) {
    if (!new RegExp(`${cls}(?![0-9])`).test(src)) {
      return `结论的 ghost 档底色不是 ${cls}：那一档要是近乎透明的淡底，而不是另一枚实心胶囊`;
    }
  }
  return null;
}

/**
 * 升级表（`LevelTable`）：级别复用座位卡那枚 `LevelBadge`（档位数字 + 金色「+过次」徽标），
 * 没升级的那行写「不变」；列模版**只有一份**（表头与数据行共用，否则三列各算各的宽度）。
 */
function levelTableCheck(source: string): string | null {
  const src = code(source);
  if (!src.includes('<LevelBadge')) {
    return '升级表没有复用 LevelBadge（档位数字 + 金色「+过次」徽标）：跨 A 的轮次读不出来';
  }
  if (src.includes('levelLabel(')) return '升级表用了 levelLabel 文本：级别要复用 LevelBadge 那枚徽标';
  if (!src.includes('不变')) return '升级表里没有「不变」二字：没升级的那行会被读成没渲染出来';
  const cols = src.split('grid-cols-[minmax(0,1fr)_3rem_1rem_3rem]').length - 1;
  if (cols !== 1) {
    return `列模版出现了 ${cols} 次：表头与数据行必须共用同一份（否则「谁 / 原级别 / 新级别」三列会各算各的宽度）`;
  }
  if (!src.includes('heading')) return '升级表没有 heading 开关：战报的每副卡会被迫带上表头';
  return null;
}

/**
 * 结算弹窗（`DealSummary`）自己：只负责把三块**共用组件**拼起来，加卡片的高度上限。
 *
 * 「这里没有第二份实现」是这条的要害：算式/结论/升级表都住在组件里，弹窗里再写一遍
 * 就等于两处会各自过期（战报读的是同一批组件）。这个弹窗**没法**交给 ui-check：
 * `summaryOpen` 初值是 false，它只在客户端「本副刚结算」那一帧打开，SSR 里永远不出现 ——
 * 所以它由这条源码守卫 + `labels.test.ts` 的纯函数单测两层守。
 */
function settlePanelCheck(source: string): string | null {
  const src = code(source);
  for (const [needle, what] of [
    ['<ScoreEquation', '算式'],
    ['<VerdictBadge', '结论'],
    ['<LevelTable', '升级表']
  ] as const) {
    if (!src.includes(needle)) {
      return `结算弹窗没有复用 ${needle}：${what}会出现第二份实现，两处会各自过期`;
    }
  }
  for (const own of ['kittySign(', 'scoreLineText(', '<LevelBadge']) {
    if (src.includes(own)) {
      return `结算弹窗里又出现了 ${own}：算式/结论/升级表都该只在共用组件里渲染`;
    }
  }
  if (!src.includes('levelRows(summary, view.levels)')) {
    return '升级表没有走 levelRows：三家不会都出现（没升级的那家会整行消失）';
  }
  if (src.includes('保底') || src.includes('抠底')) {
    return '结算弹窗又写回了保底/抠底那句说明：符号的红/绿已经说明了加还是扣';
  }
  const cardAt = src.indexOf('max-w-[94vw]');
  const card = cardAt < 0 ? '' : tagOf(src, cardAt);
  if (!card.includes('max-h-') || !card.includes('overflow-y-auto')) {
    return '结算卡片没有高度上限与自己的滚动区（max-h-* + overflow-y-auto）：短屏上底部的「下一副」会落到视口外';
  }
  return null;
}

/**
 * 战报（`HistoryList`）：页内两模式 + 每副卡。
 * ① 每副卡是结算弹窗的紧凑版 —— 算式/结论/升级行复用同一批组件，另加「定约 · 级牌」
 *    （旧副的级牌各不相同，只写定约读不出来）；底牌不再用一行文本列出，走 `.kitty-mini` 牌面；
 * ② 升级行只列**升级者**（`changedLevelRows`）：历史负载只记变动，没升级的座位当时是什么级别
 *    无从还原 —— 与弹窗三家全列有意不同；
 * ③ 升级表模式走 `levelProgression`，两模式清单走 `drawer-tabs.ts` 的 `REPORT_MODES`
 *    （页内切换，不是第五个页签）。
 */
function historyCardCheck(source: string): string | null {
  const src = code(source);
  if (!src.includes('contractText(')) {
    return '战报的每副卡没有写「定约 · 级牌」（contractText）：旧副的级牌各不相同，只写定约读不出来';
  }
  if (!/<ScoreEquation summary=\{deal\} compact/.test(src)) {
    return '每副卡没有复用 ScoreEquation 的紧凑档（compact）：算式会有第二份实现，两处会各自过期';
  }
  if (!src.includes('<VerdictBadge')) return '每副卡没有复用 VerdictBadge：结论会各写各的';
  if (!src.includes('<LevelTable')) return '每副卡的升级行没有复用 LevelTable：级别渲染会各写各的';
  if (!src.includes('changedLevelRows(')) {
    return '每副卡的升级行没有走 changedLevelRows：会退回「升级：你 +4（6+0）」那种文本流';
  }
  if (src.includes('levelLabel(')) return '战报用了 levelLabel 文本：级别要复用 LevelBadge 那枚徽标';
  if (/deal\.kitty\.map\(cardText\)/.test(src)) {
    return '战报又用一行文本列底牌（deal.kitty.map(cardText)）：牌面要走 .kitty-mini';
  }
  if (src.includes('保底') || src.includes('抠底')) {
    return '战报每副卡又写回了「抠底 / 保底」那句说明：符号的红/绿已经说明加还是扣';
  }
  if (!src.includes('levelProgression(')) return '升级表模式没有走 levelProgression：级别进程会各算各的';
  if (!src.includes('REPORT_MODES')) {
    return '两个模式没有从 drawer-tabs.ts 的 REPORT_MODES 渲染：页内切换会出现第二份清单';
  }
  return null;
}

/**
 * 底牌页（`KittyPanel`）：**七种状态各一行居中提示** + 该看得见的牌面。
 * 不许回潮：三段解释（保底/抠底怎么算、发牌留下的暗底、结算前只有庄家看得到）与
 * 毡面待定槽位的镜像 —— 前者归「?」与 /rules，后者毡面上有同一份而且可点。
 */
function kittyPanelCheck(source: string): string | null {
  const src = code(source);
  for (const text of [
    '还没发牌',
    '还没定庄家',
    '等待你埋底',
    '等待庄家埋底',
    '底牌仅你可见',
    '底牌暂对闲家不可见',
    '已公开，底'
  ]) {
    if (!src.includes(text)) return `底牌页少了「${text}」这一态：七种状态各有自己那一行提示`;
  }
  const hint = /const hint = '([^']*)'/.exec(src)?.[1] ?? '';
  if (!hint.includes('text-center')) {
    return '底牌页的提示没有一行居中（const hint 缺 text-center）：七态共用同一份居中样式';
  }
  if (!src.includes('buriedKitty')) return '「底牌」页没有读 you.buriedKitty（它要的是庄家埋下去的那 3 张）';
  if (src.includes('originalKitty')) {
    return '「底牌」页引用了 originalKitty：拿上来的那 3 张只活在毡面的埋底面板里，两处不许混同';
  }
  if (src.includes('client.selectedCards')) {
    return '「底牌」页又镜像了毡面的待定槽位：毡面上有同一份、而且那里可点，抽屉里再摆一份只是重复';
  }
  for (const gone of ['暗底', '结算前只有你看得到', '乘末轮张数']) {
    if (src.includes(gone)) {
      return `底牌页又写回了「${gone}」那段解释：规则说明归「?」与 /rules，这一页只有一行提示`;
    }
  }
  return null;
}

test('算式：加减号来自 kittySign、带色、与数字同级字号（两档共用 num）', () => {
  const problem = equationCheck(scoreEquation);
  assert.equal(problem, null, problem ?? '');
});

test('反证：硬写 +、符号褪色、符号被缩成小字、丢掉底牌牌面、少一档尺寸、ghost 档退化，都必须被判出来', () => {
  assert.ok(
    equationCheck(scoreEquation.replace('{kittySign(summary.protectedBottom)}', '+')) !== null,
    '硬写 `+` 的旧算式被判为合规（这条守卫是空转的）'
  );
  // 精确性：着色只认**符号自己那个标签**——把符号那处改成灰的，别处的颜色不该救它
  assert.ok(
    equationCheck(scoreEquation.replace("'text-rose-300'", "'text-white/40'")) !== null,
    '符号自己没着色（靠别处的颜色蒙混）被判为合规'
  );
  assert.match(
    equationCheck(
      scoreEquation.replace(
        '{s.num} font-black leading-none {summary.protectedBottom',
        'text-lg font-black leading-none {summary.protectedBottom'
      )
    ) ?? '',
    /s\.num/,
    '符号被缩成小字（不再与数字共用 num）没有被判出来'
  );
  assert.match(
    equationCheck(scoreEquation.replaceAll('kitty-mini', 'x')) ?? '',
    /kitty-mini/,
    '丢掉底牌牌面没有被判出来'
  );
  assert.match(
    equationCheck(scoreEquation.replace('text-[26px]', 'text-2xl')) ?? '',
    /text-\[26px\]/,
    '弹窗那一档字号被改掉（两档尺寸不齐）没有被判出来'
  );
  assert.match(
    equationCheck(scoreEquation.replace('text-base', 'text-lg')) ?? '',
    /text-base/,
    'ghost 档不再比 compact 小一档（digit 与主卡同档）没有被判出来'
  );
  assert.match(
    equationCheck(scoreEquation.replace('opacity-75', 'opacity-100')) ?? '',
    /opacity-75/,
    'ghost 档的底牌小牌面不再淡一档没有被判出来'
  );
});

test('结论：只有一行 scoreLineText，底色与文字色是唯一的输赢着色', () => {
  const problem = verdictCheck(verdictBadge);
  assert.equal(problem, null, problem ?? '');
});

test('反证：两行结论、丢掉着色、不写「不变」，都必须被判出来', () => {
  assert.match(
    verdictCheck(
      verdictBadge.replace(
        '{scoreLineText(summary)}',
        '{scoreLineText(summary)}<p>两名闲家各升 ceil({summary.shortfall} / 10) = 1 级；庄家级别不变</p>'
      )
    ) ?? '',
    /两名闲家各升/,
    '旧的两行结论被判为合规'
  );
  assert.match(
    verdictCheck(verdictBadge.replaceAll('text-rose-300', 'text-white/40')) ?? '',
    /text-rose-300/,
    '结论丢掉打输那一档文字色没有被判出来'
  );
  assert.match(
    verdictCheck(verdictBadge.replace('text-rose-300/70', 'text-white/40')) ?? '',
    /text-rose-300\/70/,
    'ghost 档被调成中性色（降权顺手把输赢色相也拿掉了）没有被判出来'
  );
  assert.match(
    verdictCheck(verdictBadge.replace('ghost:', 'xx:')) ?? '',
    /ghost/,
    '结论的 ghost 档整档消失没有被判出来'
  );
  assert.match(
    levelTableCheck(levelTable.replaceAll('不变', '—')) ?? '',
    /不变/,
    '没升级那行不写「不变」被判为合规'
  );
});

test('升级表：复用 LevelBadge、没升级写「不变」、列模版只有一份', () => {
  const problem = levelTableCheck(levelTable);
  assert.equal(problem, null, problem ?? '');
});

test('反证：退回 levelLabel 文本、不再复用 LevelBadge、列模版写两份，都必须被判出来', () => {
  assert.match(
    levelTableCheck(levelTable.replace('<LevelBadge level={row.to} />', '<b>{levelLabel(row.to)}</b>')) ?? '',
    /levelLabel/,
    '退回 levelLabel 文本被判为合规'
  );
  assert.match(
    levelTableCheck(levelTable.replaceAll('<LevelBadge', '<span data-old')) ?? '',
    /LevelBadge/,
    '升级表不再复用 LevelBadge 被判为合规'
  );
  assert.match(
    levelTableCheck(
      levelTable.replace(
        'class="{COLS} rounded-lg px-3 py-1.5',
        'class="grid grid-cols-[minmax(0,1fr)_3rem_1rem_3rem] items-center gap-x-2 rounded-lg px-3 py-1.5'
      )
    ) ?? '',
    /列模版/,
    '列模版被写成两份（表头与数据行各一份）没有被判出来'
  );
});

test('结算弹窗：三块共用组件 + 卡片高度上限', () => {
  const problem = settlePanelCheck(dealSummary);
  assert.equal(problem, null, problem ?? '');
});

test('反证：弹窗里又写一份算式、不是三家都出、没有滚动区、保底说明回潮，都必须被判出来', () => {
  assert.match(
    settlePanelCheck(
      dealSummary.replace('<ScoreEquation {summary} />', '<div>{kittySign(summary.protectedBottom)}</div>')
    ) ?? '',
    /第二份实现|又出现了/,
    '弹窗里又写一份算式被判为合规'
  );
  assert.match(
    settlePanelCheck(dealSummary.replace('levelRows(summary, view.levels)', 'summary.levelChanges')) ?? '',
    /levelRows/,
    '不是三家都出的旧列表被判为合规'
  );
  assert.match(
    settlePanelCheck(dealSummary.replace('max-h-[92dvh] ', '')) ?? '',
    /max-h/,
    '卡片没有高度上限被判为合规'
  );
  assert.match(
    settlePanelCheck(dealSummary + '\n<p>抠底 · 末轮被闲家赢走，底分 ×{summary.multiplier} 扣除</p>') ?? '',
    /保底|抠底/,
    '保底/抠底那句说明回潮被判为合规'
  );
});

test('战报：每副卡复用结算那三块，升级表走 levelProgression，模式走 REPORT_MODES', () => {
  const problem = historyCardCheck(historyList);
  assert.equal(problem, null, problem ?? '');
});

test('反证：战报不写级牌、用文本列底牌、升级行走文本流、模式清单写死，都必须被判出来', () => {
  assert.match(
    historyCardCheck(historyList.replace('{contractText(deal)}', '{deal.contract.points}')) ?? '',
    /contractText/,
    '不写「定约 · 级牌」没有被判出来'
  );
  assert.match(
    historyCardCheck(historyList + "\n<p>底牌 {deal.kitty.map(cardText).join(' ')}</p>") ?? '',
    /kitty-mini/,
    '用一行文本列底牌没有被判出来'
  );
  assert.match(
    historyCardCheck(historyList.replace('changedLevelRows(deal)', 'deal.levelChanges')) ?? '',
    /changedLevelRows/,
    '升级行不走 changedLevelRows 没有被判出来'
  );
  assert.match(
    historyCardCheck(historyList.replaceAll('REPORT_MODES', 'TABS')) ?? '',
    /REPORT_MODES/,
    '两模式清单写死（不再从 drawer-tabs.ts 读）没有被判出来'
  );
});

test('底牌页：七态各一行居中提示，且不再镜像待定槽位', () => {
  const problem = kittyPanelCheck(kittyPanel);
  assert.equal(problem, null, problem ?? '');
});

test('反证：少一态、提示不居中、解释段回潮、镜像槽位回潮，都必须被判出来', () => {
  assert.match(
    kittyPanelCheck(kittyPanel.replace('>还没发牌<', '><')) ?? '',
    /还没发牌/,
    '少了一态的提示没有被判出来'
  );
  assert.match(
    kittyPanelCheck(kittyPanel.replace("const hint = 'text-center", "const hint = '")) ?? '',
    /text-center/,
    '提示不居中（丢掉 text-center）没有被判出来'
  );
  assert.match(
    kittyPanelCheck(kittyPanel + '\n<p>发牌会留下 3 张暗底</p>') ?? '',
    /暗底/,
    '解释段回潮没有被判出来'
  );
  assert.match(
    kittyPanelCheck(kittyPanel + '\n<p>{client.selectedCards.length}</p>') ?? '',
    /待定槽位|selectedCards/,
    '毡面待定槽位的镜像回潮没有被判出来'
  );
});

/**
 * 机器重演入口（`ReplayPanel`，ADR-0016）：两个入口 + 一条数据通道 + 复用结算那三件套 + 枝干降权。
 *
 * 判据分五层：① **入口只在逐副卡与结算弹窗**，升级表**没有** —— 升级表说的是真实进度，
 * 重演是每副的对照；② 逐副卡按 `deal.dealNo` 显式取存档；③ 展开体**复用**
 * `contractText` / `ScoreEquation` / `VerdictBadge` —— 弹窗、战报、重演三处读法不可能各走各的；
 * ④ **数据通道归页面**（`fetchReplays` + `onOpenReplay`）：组件自己发请求就是第二条取数路径；
 * ⑤ 展开体是**枝干**（左引导线 + 缩进）且一律走 ghost 档、正文 11px —— 与主卡同形同档就会
 * 喧宾夺主（外壳、算式、结论、头行四样都曾与主卡并列）。
 * 两种「没有」也要如实说（全 pass / 老副无记录），不许退化成按钮消失 —— 那看起来像功能坏了。
 */
function replayEntryCheck(
  historyListSource: string,
  dealSummarySource: string,
  panelSource: string,
  pageSource: string
): string | null {
  const history = code(historyListSource);
  const entry = history.indexOf('<ReplayPanel');
  if (entry < 0) return '战报逐副卡的卡尾没有机器重演入口（<ReplayPanel）';
  if (history.indexOf('<ReplayPanel', entry + 1) >= 0) {
    return '机器重演入口不止一处（升级表分支也给了）：升级表说的是真实进度，重演是每副的对照';
  }
  if (entry < history.lastIndexOf('{:else}')) {
    return '机器重演入口落在升级表分支里（最后一个 {:else} 之前）：它只属于逐副卡';
  }
  if (!history.includes('dealNo={deal.dealNo}')) {
    return '逐副卡没有把副号显式传给重演面板（dealNo={deal.dealNo}）：面板要按副号取存档';
  }

  const summary = code(dealSummarySource);
  const inSummary = summary.indexOf('<ReplayPanel');
  if (inSummary < 0) return '结算弹窗没有机器重演入口（<ReplayPanel）';
  if (inSummary < summary.indexOf('<LevelTable')) {
    return '结算弹窗把机器重演排在了升级表之前：那三件套之后才是每副的对照';
  }

  const panel = code(panelSource);
  if (!panel.includes('contractText(')) {
    return '重演面板没有写重演自己的定约（contractText）：重演含叫牌，定约可能与真实那副不同';
  }
  if (!/<ScoreEquation[\s\S]*?summary=\{replay\.summary\}/.test(panel)) {
    return '重演面板没有复用 ScoreEquation 的紧凑档（compact）：算式会有第二份实现';
  }
  if (!panel.includes('<VerdictBadge')) return '重演面板没有复用 VerdictBadge：结论会各写各的';
  // 展开体是**枝干**，不是又一张同级卡：左引导线 + 缩进；同级卡那套外壳不许回潮
  if (!panel.includes('border-l')) {
    return '重演展开体没有左侧引导线（border-l）：它会被读成又一张同级卡，而不是这张牌的枝干';
  }
  if (!/pl-\d/.test(panel)) return '重演展开体没有跟着引导线缩进（pl-*）';
  if (/bg-black\/20|ring-1 ring-white\/10/.test(panel)) {
    return '重演展开体又长回了同级卡的外壳（bg-black/20 + ring-1 ring-white/10）：喧宾夺主正是那个盒子';
  }
  // 里面一律走 ghost 档：算式与结论都降一档，头行不再靠继承字号（弹窗里是 16px）。
  // 认的是**那一枚标签自己**带 ghost（`[^>]*`）—— 只看「附近有没有 ghost」会被旁边那枚救掉
  if (!/<ScoreEquation[^>]*ghost/.test(panel)) {
    return '重演没有走算式的 ghost 档：展开体与主卡同档字号';
  }
  if (!/<VerdictBadge[^>]*ghost/.test(panel)) {
    return '重演没有走结论的 ghost 档：两枚同尺寸同色的结论会一起抢眼';
  }
  if (!panel.includes('text-[11px]')) {
    return '重演展开体的正文没有降一档（text-[11px]）：在弹窗里它会按 16px 继承，比弹窗标题还大';
  }
  if (!panel.includes('机器重演')) return '重演入口没有「机器重演」这枚按钮';
  if (!panel.includes('全 pass')) return '全 pass 那句话没了：约 5% 的副是合法终态，要如实说';
  if (!panel.includes('没有机器重演记录')) {
    return '老副没有记录时没有一句话：不许玩「按钮消失」，那看起来像功能坏了';
  }
  if (/fetchReplays|fetch\(/.test(panel)) {
    return '重演面板自己发请求：数据通道必须由页面持有（replays 缓存 + onOpen）';
  }

  const pageCode = code(pageSource);
  if (!pageCode.includes('fetchReplays(')) return '页面没有持有重演数据通道（fetchReplays）';
  if (!pageCode.includes('onOpenReplay')) return '页面没有把 onOpenReplay 传给战报与结算弹窗';
  return null;
}

test('机器重演：入口只在逐副卡与结算弹窗，复用那三件套的 ghost 档，通道归页面', () => {
  const problem = replayEntryCheck(historyList, dealSummary, replayPanel, page);
  assert.equal(problem, null, problem ?? '');
});

test('反证：升级表也加入口、弹窗丢入口、重演里自写算式、面板自发请求、页面丢通道、枝干退化，都必须被判出来', () => {
  assert.match(
    replayEntryCheck(
      historyList.replace(
        "{#if mode === 'progress'}",
        "{#if mode === 'progress'}\n<ReplayPanel dealNo={0} {replays} onOpen={() => {}} {who} />"
      ),
      dealSummary,
      replayPanel,
      page
    ) ?? '',
    /不止一处/,
    '升级表分支也给了重演入口没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary.replace(/[ \t]*<ReplayPanel[\s\S]*?\/>\n/, ''),
      replayPanel,
      page
    ) ?? '',
    /ReplayPanel/,
    '结算弹窗丢了重演入口没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary,
      replayPanel.replace(
        '<ScoreEquation summary={replay.summary} compact ghost />',
        '<p>{replay.summary.finalScore}</p>'
      ),
      page
    ) ?? '',
    /ScoreEquation/,
    '重演面板自写一份算式没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary,
      replayPanel.replace('compact ghost', 'compact'),
      page
    ) ?? '',
    /ghost/,
    '重演没有走 ghost 档（回到与主卡同档字号）没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary,
      replayPanel.replace('class="mt-2" ghost', 'class="mt-2"'),
      page
    ) ?? '',
    /结论的 ghost/,
    '重演没有走结论的 ghost 档（靠算式那枚蒙混）没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary,
      replayPanel.replace('border-l border-white/20', 'bg-black/20 ring-1 ring-white/10'),
      page
    ) ?? '',
    /外壳|引导线/,
    '重演展开体长回同级卡外壳（喧宾夺主那个盒子）没有被判出来'
  );
  assert.match(
    replayEntryCheck(historyList, dealSummary, replayPanel.replace('border-l', ''), page) ?? '',
    /引导线/,
    '重演展开体丢掉左侧引导线（不再是枝干）没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary,
      replayPanel.replaceAll('text-[11px]', 'text-base'),
      page
    ) ?? '',
    /text-\[11px\]/,
    '重演展开体的正文又按继承字号（弹窗里 16px）出现没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary,
      replayPanel + '\n<script>const bogus = fetchReplays("a");</script>',
      page
    ) ?? '',
    /数据通道/,
    '重演面板自己发请求没有被判出来'
  );
  assert.match(
    replayEntryCheck(
      historyList,
      dealSummary,
      replayPanel,
      page.replace('fetchReplays(', 'Fake(')
    ) ?? '',
    /fetchReplays/,
    '页面不再持有重演数据通道没有被判出来'
  );
});

test('座位卡上的名字不许被裁剪：机器人名字曾在卡上只剩「机…」', () => {
  const source = code(seatCard);
  // 参照物：头行必须在，否则下面的判据会跟着一起「通过」（守卫空转）
  assert.ok(
    source.includes('flex items-center gap-2">'),
    '座位卡的头行不见了 —— 判据变了，请重看这条守卫'
  );
  // 卡形态与底栏形态各有一个名字节点，**只对卡形态**要求不裁剪：
  // 卡是 144px 宽、名字与头像/级别同处一行（实测 176px 的卡只剩 23.6px、`w-36` 的手机卡只剩 0px，
  // 而「机器人·小六」需要 76px —— 卡上于是只画出「机…」），所以那里宁可折行也不许裁。
  // 底栏是**跨宽**的一行，`truncate` 在那里是对的（名字再长也只是省略号，不会挤掉级别徽标）。
  const nameNodes = [...source.matchAll(/<p class="([^"]*)">\{name \?\? '空座'\}<\/p>/g)].map(
    (match) => match[1] ?? ''
  );
  assert.equal(
    nameNodes.length,
    2,
    `座位卡应当恰好有两个名字节点（卡形态的「折行」+ 底栏形态的「跨宽截断」），实际 ${nameNodes.length} 个`
  );
  const cardClasses = nameNodes.find((cls) => cls.includes('break-words'));
  assert.ok(cardClasses !== undefined, '两个名字节点里找不到卡形态那个（缺 break-words）—— 判据变了，重看这条守卫');
  for (const forbidden of ['truncate', 'line-clamp', 'whitespace-nowrap', 'overflow-hidden']) {
    assert.ok(
      !cardClasses.includes(forbidden),
      `卡形态的名字节点带上了 ${forbidden}：窄卡上会被裁掉（实测「机器人·小六」需要 76px）`
    );
  }
  const barClasses = nameNodes.find((cls) => cls !== cardClasses) ?? '';
  assert.ok(
    barClasses.includes('truncate') && barClasses.includes('min-w-0'),
    '底栏形态的名字节点没有 min-w-0 + truncate：跨宽一行上长名字会把级别徽标挤出可视区'
  );
  // 名字不许自己当那个 flex item —— 那正是被装饰吃干净的原因；它必须住在 flex-1 的列里
  assert.ok(
    !/<p class="min-w-0 flex-1/.test(source),
    '名字又自己当 flex item 了：它会与头像/徽标/级别抢同一行，重新被挤成「机…」'
  );
  assert.ok(
    source.includes('<div class="min-w-0 flex-1">'),
    '座位卡里没有包住名字的 min-w-0 flex-1 列：名字失去了独占的那一行'
  );
  // 机器人的身份标记：**头像自己就是标记**（内联 SVG），早先另有一行「机器人」徽标 ——
  // 那一行正是卡片偏高的原因（ADR-0020）。判据落在 SVG 与名字前缀上，不是那句徽标文案。
  assert.ok(
    source.includes('<svg') && /aria-label="机器人"/.test(source),
    '机器人头像不再是那枚内联 SVG（机器人身份就没有标记了）'
  );
  assert.ok(
    !source.includes('>机器人</span'),
    '座位卡又长出了「机器人」徽标行：它让卡片高出一整行，正是毡面重叠的原因'
  );
  // 机器人那两个动作必须不在座位卡上（搬进了抽屉的「牌桌」页）
  assert.ok(!source.includes('请离'), '座位卡上又出现了「请离」入口：它会让卡片高出一整行');
  assert.ok(source.includes('<LevelBadge'), '座位卡上少了级别徽标');
});

/* ---------- 「上一轮」回看（bot 出牌太快，收掉的那一墩要还找得回来） ---------- */

/**
 * 「上一轮」回看：入口 / 层级 / 复用 / 关闭路径 / 唯一定义，五组判据各有一次真实缺陷对应。
 *
 * - **入口**（`TableStatus`）：收过墩才出现，且必须 `pointer-events-auto` —— 整条状态条是
 *   `pointer-events-none`（横跨毡面，要让座位卡上的按钮点得到），少了这一句按钮就看得见点不到
 *   （`BuryPanel` 记过这个坑）。
 * - **状态归页面、默认关着**：`reviewOpen` 初值 false ⇒ SSR 首帧里没有这一层；且它必须住在
 *   `.felt` **里面**（`<TrickReview` 排在 `felt` 之后）—— 浮层只覆盖毡面，手牌与操作条留在外面。
 * - **浮层的层**：根节点横跨毡面 ⇒ 必须让开点击；且**不许 `fixed`** —— 一旦整屏，手牌就看不见了，
 *   而回看最需要的恰恰是「一边看上一墩、一边看自己的牌」。
 * - **复用**：牌面走 `TrickCluster`（与毡面、/rules 同一份），徽标走 `trickSideBadge`，
 *   称呼走 `whoLabel`，取墩走 `lastCompletedTrick` —— 这一墩的读法不许有第二份。
 * - **关闭路径**：背景按钮、× 、Esc 三条都在（`TrickReview` 一律只在这三条里关）。
 */
function trickReviewCheck(
  pageSource: string,
  statusSource: string,
  reviewSource: string,
  trickAreaSource: string
): string | null {
  const page = code(pageSource);
  const status = code(statusSource);
  const review = code(reviewSource);

  // ① 入口：状态条上、收过墩才有、自己接回点击，且**站在整条最左**
  if (!status.includes('上一轮</button')) {
    return '状态条里没有「上一轮」回看入口：上一墩的牌又只剩毡面上那一瞬';
  }
  if (!status.includes('onReviewTrick')) {
    return '状态条里没有「上一轮」回看入口（onReviewTrick）：上一墩的牌又只剩毡面上那一瞬';
  }
  if (!status.includes('trickHistory')) {
    return '「上一轮」入口不看 trickHistory：还没收过墩（叫牌/埋底/刚换副）也会出现这个按钮';
  }
  if (!status.includes('pointer-events-auto')) {
    return '「上一轮」入口缺 pointer-events-auto：外层让开点击，按钮会看得见点不到';
  }
  // 位置与轮次号是同一条判据的两半：这枚入口**取代了原来的「第 N 轮」chip**，所以它必须是首项，
  // 而「第 N 轮」必须消失。
  // - 为什么删轮次号：它在这里没有信息量 —— 打到第几轮由毡面上那墩牌自己说明，唯一需要说清
  //   轮次的地方是**回看浮层**的标题（「上一轮 · 第 N 轮」）；而它占的不是零成本，四项并列时
  //   360px 上这一条会折行（实测折行；守卫见 shot 的 ⑬与下面的字数判据）。
  // - 为什么必须是首项：入口排在末尾时，折行风险最高的那一项正好是它自己；删掉轮次号之后
  //   三项（入口 + 定约 + 庄已抓）最坏情形约 262px，远在 375px 可用宽度 ~335px 之内。
  const reviewEntryAt = status.indexOf('上一轮');
  const contractChipAt = status.indexOf('定约');
  if (contractChipAt < 0 || reviewEntryAt > contractChipAt) {
    return '「上一轮」入口没有排在状态条首项：它要取代「第 N 轮」chip 站在最左（理由见 TableStatus 的注释）';
  }
  if ((status.match(/轮/g) ?? []).length !== 1) {
    return '状态条里又长出了「第 N 轮」chip（或轮次号换了个写法）：它这一条会把三项挤到折行，' +
      '而轮次只有回看浮层的标题该说';
  }
  // ② 状态归页面、默认关着、且浮层住在毡面里
  if (!page.includes('let reviewOpen = $state(false)')) {
    return '回看状态不是 `let reviewOpen = $state(false)`：默认必须关着（SSR 首帧不许有这一层）';
  }
  if (!page.includes('onReviewTrick={() => (reviewOpen = true)}')) {
    return '页面没有把打开回看的回调接给状态条：入口是死的';
  }
  if (!page.includes('<TrickReview')) return '页面没有渲染 TrickReview';
  // 渲染位置：毡面开标签之后、操作条之前 —— 也就是毡面那一块版面的最后（DOM 里排在座位卡与出牌区后面，
  // 于是 `absolute inset-0` 的参照物是 `.felt` 自己，而不是 `<main>` 或操作条那一行）。
  // 真正的几何（375px 上不盖手牌、不压座位卡）由 tool-bridge 的 UI 走查量，这里只钉住结构。
  // 用正则而不是字面量：毡面的开标签会因为类名变长而被换行折开（`grid-cols-1` 那一版就是），
  // 钉死单行写法会把这条守卫变成「格式守卫」。
  const feltAt = page.search(/<div[^>]*class="felt\b/);
  const reviewAt = page.indexOf('<TrickReview');
  const barAt = page.indexOf('<ActionBar');
  if (feltAt < 0) return '牌桌页里找不到 .felt 容器：回看浮层的参照物不明';
  if (!(feltAt < reviewAt && reviewAt < barAt)) {
    return '回看浮层不在毡面里（<TrickReview 应排在 .felt 之后、操作条 <ActionBar 之前）：它会盖住手牌与操作条';
  }

  // ③ 浮层的层：毡面内 + 让开点击
  const root = /<div[^>]*data-trick-review="true"[^>]*>/.exec(review)?.[0] ?? '';
  if (root === '') {
    return '回看的根节点丢了 data-trick-review 钩子：ui-check 靠它认这一层（也靠它证明默认关着）';
  }
  if (/\bfixed\b/.test(root)) {
    return '回看浮层改成了 fixed：它会盖住手牌 —— 手牌必须始终可见可点（所以它不是整屏、也不是抽屉）';
  }
  for (const cls of ['pointer-events-none', 'absolute', 'inset-0']) {
    if (!root.includes(cls)) {
      return `回看浮层的根节点缺少 ${cls}：横跨毡面的层会吃掉座位卡上的点击（或定位塌回文档流）`;
    }
  }

  // ④ 复用：牌面/徽标/称呼/取墩各只有一份
  for (const need of ['TrickCluster', 'trickSideBadge', 'whoLabel', 'lastCompletedTrick(']) {
    if (!review.includes(need)) {
      return `回看浮层没有走 ${need}：这一墩的读法会出现第二份实现`;
    }
  }
  if (review.includes('<CardView')) {
    return '回看浮层自己拼了一份牌堆（<CardView）：牌面要走 TrickCluster';
  }

  // ⑤ 三条关闭路径
  if (!review.includes('Escape') || !review.includes('onkeydown')) {
    return '回看浮层没有 Esc 关闭：键盘用户只能去够右上角那个 ×';
  }
  if (!review.includes('aria-label="关闭回看"')) {
    return '回看浮层没有「点背景关闭」的键（缺 aria-label="关闭回看"）：手机上没有 hover 可解释';
  }

  // ⑥「上一轮」只有一处定义
  if (!code(trickAreaSource).includes('lastCompletedTrick(')) {
    return '毡面出牌区没有走 lastCompletedTrick：出牌区与回看浮层会各写一份「上一轮」';
  }
  return null;
}

test('「上一轮」回看：入口在状态条上、浮层只在毡面内、复用同一份牌面与徽标', () => {
  const problem = trickReviewCheck(page, tableStatus, trickReview, trickArea);
  assert.equal(problem, null, problem ?? '');
});

test('反证：入口点不动 / 默认就开着 / 浮层整屏 / 丢掉让开点击 / 自拼牌堆 / 少了关闭路径 / 第二份「上一轮」，都必须被判出来', () => {
  const cases: readonly (readonly [string, string | null, RegExp])[] = [
    [
      '入口丢掉 pointer-events-auto',
      trickReviewCheck(page, tableStatus.replaceAll('pointer-events-auto', 'pointer-events-none'), trickReview, trickArea),
      /pointer-events-auto/
    ],
    [
      '入口不看 trickHistory',
      trickReviewCheck(page, tableStatus.replaceAll('trickHistory', 'hands'), trickReview, trickArea),
      /trickHistory/
    ],
    [
      '入口被挪到末尾（不再是首项）',
      trickReviewCheck(
        page,
        // 把整块入口挪到文件末尾：剥掉注释后，「上一轮」就排在「定约」之后了
        (() => {
          const block = /\{#if canReview\}[\s\S]*?\{\/if\}/.exec(tableStatus)?.[0] ?? '';
          return tableStatus.replace(block, '') + '\n' + block;
        })(),
        trickReview,
        trickArea
      ),
      /首项/
    ],
    [
      '「第 N 轮」chip 又回来了',
      trickReviewCheck(
        page,
        `<span>第 <b class="tabular-nums">{trickNo}</b> 轮</span>` + tableStatus,
        trickReview,
        trickArea
      ),
      /第 N 轮/
    ],
    [
      '回看默认就开着（SSR 首帧出现浮层）',
      trickReviewCheck(page.replace('let reviewOpen = $state(false)', 'let reviewOpen = $state(true)'), tableStatus, trickReview, trickArea),
      /默认必须关着/
    ],
    [
      '浮层搬到毡面之外（渲染在 .felt 之前）',
      trickReviewCheck(
        // 按开标签的**正则**注入（同上：不依赖它写成一行）
        page.replace(
          /(<div[^>]*class="felt\b)/,
          '<TrickReview {client} open={reviewOpen} />\n  $1'
        ),
        tableStatus,
        trickReview,
        trickArea
      ),
      /毡面里/
    ],
    [
      '浮层改成整屏 fixed（盖住手牌）',
      trickReviewCheck(page, tableStatus, trickReview.replace('absolute inset-0 z-20', 'fixed inset-0 z-20'), trickArea),
      /fixed/
    ],
    [
      '浮层根节点不再让开点击',
      trickReviewCheck(page, tableStatus, trickReview.replace('pointer-events-none absolute inset-0', 'absolute inset-0'), trickArea),
      /pointer-events-none/
    ],
    [
      '浮层自己拼牌堆',
      trickReviewCheck(page, tableStatus, trickReview + '\n<CardView card={play.cards[0]} />', trickArea),
      /CardView/
    ],
    [
      '少了 Esc 关闭',
      trickReviewCheck(page, tableStatus, trickReview.replace(/Escape/g, 'Enter'), trickArea),
      /Esc/
    ],
    [
      '出牌区退回自己那一份「上一轮」',
      trickReviewCheck(page, tableStatus, trickReview, trickArea.replace('lastCompletedTrick(deal)', 'deal.trickHistory[deal.trickHistory.length - 1]')),
      /lastCompletedTrick/
    ]
  ];
  for (const [name, problem, pattern] of cases) {
    assert.match(problem ?? '', pattern, `${name}：没有被判出来（守卫空转）`);
  }
});

/* ---------- 出牌堆的 CSS 契约（与 fan-layout.ts 的 CLUSTER_STRIP_RATIO 一体两面） ---------- */

/**
 * 为什么这一条落在 CSS 这一层：出牌堆的间距是「组件算步距 + CSS 负边距」两半拼出来的，
 * 而**两半各错一次**正是截图 #1 的成因 ——
 *
 * ① 已测量时必须**关掉 flex 的 `gap`**：负边距公式 `calc(var(--step) - var(--cw))` 按
 *    「自己是唯一间距」算，`gap: 6px` 不关就变成实际步距 `--step + 6px`。对方出牌点只有
 *    38% 宽（窄屏 ≈119px），5 张顺子于是越出预算盒（实测 5.8 / 7.4px），而
 *    `justify-content: center` 又把超出部分向两边均分 —— 两簇在中带互叠、左簇捅出毡面。
 * ② 未测量（SSR / 首帧）的回退必须是**同一档紧凑**（`-0.4 × 牌宽`，即每张露出 60%）：
 *    否则首帧先摊开、量完再跳成叠排。
 *
 * 几何本身由 `scripts/shot-auction.ts` 的 ⑦（牌不出预算）与 ⑩（间距不超紧凑上限）实测，
 * 这里守的是「两半没有各说各的」。注入实验（删掉 `gap: 0` 那条规则）见下面的反证用例。
 */
function clusterCssCheck(css: string): string | null {
  const src = code(css);
  if (!/\.cluster\[data-measured='true'\]\s*\{[^}]*gap:\s*0/.test(src)) {
    return '已测量的出牌堆没有关掉 flex 的 gap：实际步距会变成 --step + 6px（对方出牌点只有 38% 宽，牌堆会越出预算盒、两簇互叠）';
  }
  if (
    !/\.cluster\[data-measured='true'\]\s+\.card:not\(:first-child\)\s*\{[^}]*margin-left:\s*calc\(var\(--step/.test(
      src
    )
  ) {
    return '出牌堆的已测量间距公式（margin-left: calc(var(--step) - var(--cw))）不在了';
  }
  if (
    !/\.cluster\[data-measured='false'\]\s*\{[^}]*gap:\s*0/.test(src) ||
    !/\.cluster\[data-measured='false'\]\s+\.card:not\(:first-child\)\s*\{[^}]*\*\s*-0\.4/.test(src)
  ) {
    return '出牌堆未测量的回退间距不是同一档紧凑（-0.4 × 牌宽）：首帧会先摊开、量完再跳成叠排';
  }
  return null;
}

test('出牌堆的 CSS 契约：已测量时关掉 gap，未测量时与测量后同档紧凑', () => {
  const problem = clusterCssCheck(appCss);
  assert.equal(problem, null, problem ?? '');
});

test('反证：gap 不关 / 回退改成摊开，都必须被判出来', () => {
  assert.match(
    clusterCssCheck(appCss.replace(/\.cluster\[data-measured='true'\]\s*\{[^}]*\}/, '')) ?? '',
    /gap/,
    '把「已测量关掉 gap」那条规则删掉没有被判出来（这条守卫在空转）'
  );
  assert.match(
    clusterCssCheck(appCss.replace('calc(var(--cw, 56px) * -0.4)', '0')) ?? '',
    /紧凑/,
    '未测量的回退间距改回摊开没有被判出来'
  );
  assert.equal(
    clusterCssCheck(`.cluster[data-measured='true'] { gap: 0 }
.cluster[data-measured='true'] .card:not(:first-child) { margin-left: calc(var(--step, 0px) - var(--cw, 56px)); }
.cluster[data-measured='false'] { gap: 0 }
.cluster[data-measured='false'] .card:not(:first-child) { margin-left: calc(var(--cw, 56px) * -0.4); }`),
    null,
    '这条守卫对合规的最小片段也报错（过宽）'
  );
});
