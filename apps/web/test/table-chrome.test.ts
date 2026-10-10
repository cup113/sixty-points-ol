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
const infoRail = read('../src/lib/components/InfoRail.svelte');
const actionBar = read('../src/lib/components/ActionBar.svelte');
const actionTray = read('../src/lib/components/ActionTray.svelte');
const actionClock = read('../src/lib/components/ActionClock.svelte');
const kittyReveal = read('../src/lib/components/KittyReveal.svelte');
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
   * 判据用**顺序**表达：毡面四个行钩子按 rail → seats → slot → me 出现，且每个层组件都出现在
   * 它该住的那一行里（信息须在 rail、其余在 slot）。真正的像素由 `scripts/shot-auction.ts` 实测。
   */
  const feltRowIndex = (name: string): number => code(page).indexOf(`data-felt-row="${name}"`);
  const rows = ['rail', 'seats', 'slot', 'me'] as const;
  assert.deepEqual(
    rows.map(feltRowIndex).every((at, index, all) => at > 0 && (index === 0 || at > all[index - 1]!)),
    true,
    `毡面不是「信息须 / 顶卡 / 内容槽 / 我的底栏」四行格（钩子位置：${rows.map(feltRowIndex).join(', ')}）`
  );
  const railAt = feltRowIndex('rail');
  const slotsAt = feltRowIndex('slot');
  const meAt = feltRowIndex('me');
  // 信息须那一行里只有 InfoRail（台面级信息：定约 / 级牌 / 庄已抓 / 回溯）
  const railBlock = code(page).slice(railAt, slotsAt);
  assert.ok(
    /<InfoRail\b/.test(railBlock) && !/<(LobbyPanel|BuryPanel|BidPanel|TrickArea)\b/.test(railBlock),
    '信息须那一行里住进了「打这一墩」的层：它只放台面级信息，内容槽才是那些层的地方'
  );
  for (const layer of ['LobbyPanel', 'BuryPanel', 'BidPanel', 'TrickArea'] as const) {
    const at = code(page).indexOf(`<${layer}`);
    assert.ok(
      at > slotsAt && at < meAt,
      `${layer} 不在内容槽里（位置 ${at}，内容槽 ${slotsAt}–${meAt}）：它又成了各算各的偏移层，` +
        '会与别的层压在一起 —— 必须住在 data-felt-row="slot" 里'
    );
  }
  // 反过来：台面级信息（InfoRail）不许再回到内容槽里（那正是牌区上方悬着一层的旧形状）
  const slotBlock = code(page).slice(slotsAt, meAt);
  assert.equal(
    /<InfoRail\b/.test(slotBlock),
    false,
    'InfoRail 又出现在内容槽里：它该住在信息须那一行（rail），否则牌区上方又悬着一层'
  );

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
    ['InfoRail.svelte', infoRail, '定约'],
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
 * 正好压在暗底槽位上 —— 两处各算各的位置，谁也管不了谁。
 *
 * ADR-0020 修订之后，这条判据问的是**两样东西各自住在哪一行**：
 * - **信息须**（`InfoRail`）住在毡面第一行（`data-felt-row="rail"`）—— 它是台面级信息
 *   （定约 / 级牌 / 庄已抓 / 回溯），所以从内容槽里搬了出去；
 * - **埋底面板**住在内容槽里（`data-felt-row="slot"`）。
 * 两者都**不许自己写偏移**：位置由行给出。这条在无浏览器的环境里只能落到源头上
 * （真实像素由 `scripts/shot-auction.ts` 量）。
 */
function railRowFlow(pageSource: string, statusSource: string, burySource: string): string | null {
  const src = code(pageSource);
  const railAt = src.indexOf('data-felt-row="rail"');
  const slotsAt = src.indexOf('data-felt-row="slot"');
  const meAt = src.indexOf('data-felt-row="me"');
  if (railAt < 0 || slotsAt < 0 || meAt < 0) {
    return '毡面缺行钩子（rail / slot / me）：信息须、内容槽与底栏都必须由行给出位置';
  }
  if (!(railAt < slotsAt && slotsAt < meAt)) {
    return `毡面的行序不对（rail ${railAt} / slot ${slotsAt} / me ${meAt}）：信息须在顶卡之上、内容槽居中、底栏在最后`;
  }
  const railBlock = src.slice(railAt, slotsAt);
  if (!/<InfoRail\b/.test(railBlock)) {
    return 'InfoRail 不在信息须那一行里：它要么回到了内容槽（牌区上方又悬着一层），要么被渲染了两处';
  }
  const slotBlock = src.slice(slotsAt, meAt);
  if (!/<BuryPanel\b/.test(slotBlock)) {
    return 'BuryPanel 不在内容槽里：埋底面板必须住在 data-felt-row="slot" 里';
  }
  if (/<InfoRail\b/.test(slotBlock)) {
    return 'InfoRail 又出现在了内容槽里：它会与埋底面板各算各的位置（正是短屏上重叠的来源）';
  }
  // 两者都不许绝对定位 —— 位置由行给，不需要任何偏移
  if (/\babsolute\b/.test(code(statusSource))) {
    return 'InfoRail 自己绝对定位：它住在信息须那一行里，不该再算偏移';
  }
  if (/\babsolute\b/.test(code(burySource))) {
    return 'BuryPanel 自己绝对定位：它住在内容槽里，不该再算偏移';
  }
  if (/\btop-\[|\bbottom-\[/.test(code(statusSource))) {
    return 'InfoRail 里出现了魔数偏移：信息须的位置由毡面的行给出';
  }
  return null;
}

/**
 * 数值那一档自检：定约 / 级牌 / 庄已抓必须共用**同一档大号数字**（`num`），且那一档里不许
 * 出现 10px 小字。
 *
 * 这条判据的形状随 ADR-0020 修订变过一次：早先整条是并排的小 chip，所以当时**禁止整块出现
 * 10px**；现在它是一张类表格（表头 10px 小字 + 值 20/24px 大号），于是判据改成
 * 「**值那一档**必须是大号、且三格共用同一个 token」—— 表头的小字不再算违规，而
 * 「数字缩回小字」这件事仍然逃不掉（`num` 里出现 10px、或缺 text-2xl 都会红）。
 */
function railTypeCheck(statusSource: string): string | null {
  const src = code(statusSource);
  const num = /const num = '([^']*)'/.exec(src)?.[1];
  if (num === undefined) return '信息须里找不到数值那一档（const num）：定约 / 级牌 / 庄已抓没有共同的字号来源';
  if (!num.includes('text-2xl')) return '数值那一档没有 text-2xl：定约 / 级牌 / 庄已抓又缩回小字了';
  if (/text-\[10px\]/.test(num)) return '数值那一档里出现了 10px 小字（大字被缩回了小 chip）';
  const uses = src.split('class={num}').length - 1;
  if (uses < 3) {
    return `只有 ${uses} 处用 num：定约 / 级牌 / 庄已抓三个值必须共用同一档大号数字`;
  }
  if (!/data-rail-cell="contract"/.test(src)) {
    return '信息须里没有「定约」值格（data-rail-cell="contract"）：定约必须一直在牌面上';
  }
  return null;
}

test('定约 / 级牌 / 庄已抓共用同一档大号数字（不再是小号 chip）', () => {
  const problem = railTypeCheck(infoRail);
  assert.equal(problem, null, problem ?? '');
});

test('反证：旧的 10px chip 版面、以及数字缩回小字，都必须被判出来', () => {
  const OLD_STATUS = `<div class="flex flex-wrap justify-center gap-1.5 px-2 text-[10px] sm:text-[11px]">
  <span class="rounded-full bg-black/35 px-2.5 py-1">第 <b>{trickNo}</b> 轮</span>
  <span class="rounded-full bg-black/35 px-2.5 py-1">定约</span>
</div>`;
  assert.match(railTypeCheck(OLD_STATUS) ?? '', /数值那一档/, '旧版面没有被判出来');
  // 数值那一档被降成小字：这正是要抓的回潮
  assert.match(
    railTypeCheck(infoRail.replace("const num = 'text-xl font-black", "const num = 'text-[10px] font-black")) ?? '',
    /10px/,
    '数值那一档被改成 10px 没有被判出来'
  );
  // 三格里少用了一次 num（某一格自己写了别的字号）
  assert.match(
    railTypeCheck(infoRail.replace('<b class={num}>{declarerPoints}</b>', '<b>{declarerPoints}</b>')) ?? '',
    /num/,
    '有值格不再共用 num 没有被判出来'
  );
});

test('埋底阶段：状态条与暗底槽位同列流，短屏也不重叠', () => {
  const problem = railRowFlow(page, infoRail, buryPanel);
  assert.equal(problem, null, problem ?? '');
});

test('反证：状态条回内容槽 / 自己绝对定位的旧版面必须被判出来', () => {
  const OLD_PAGE = `<InfoRail {view} />\n<BuryPanel {client} />`;
  assert.ok(
    railRowFlow(OLD_PAGE, infoRail, buryPanel) !== null,
    '旧版面（状态条与埋底面板挤在一起）被判为合规：这条守卫是空转的'
  );
  assert.ok(
    railRowFlow(page, '<div class="absolute top-[5.5rem]">状态条</div>', buryPanel) !== null,
    '状态条自己绝对定位被判为合规'
  );
  // 把 InfoRail 从信息须那一行挪回内容槽（旧形状）：牌区上方又会悬着一层
  const backToSlot = code(page).replace(
    '{#if view !== null}\n        <InfoRail {view} onReviewTrick={() => (reviewOpen = true)} />',
    ''
  );
  assert.match(
    railRowFlow(`${backToSlot}\n<div data-felt-row="slot"><InfoRail {view} /><BuryPanel {client} /></div>`, infoRail, buryPanel) ?? '',
    /内容槽|不在信息须/,
    'InfoRail 回到内容槽没有被判出来'
  );
});

test('定约与庄已抓是大号数字（不再是小号 chip）', () => {
  const problem = railTypeCheck(infoRail);
  assert.equal(problem, null, problem ?? '');
});

test('反证：旧的 10px chip 版面必须被判出来', () => {
  const OLD_STATUS = `<div class="flex flex-wrap justify-center gap-1.5 px-2 text-[10px] sm:text-[11px]">
  <span class="rounded-full bg-black/35 px-2.5 py-1">第 <b>{trickNo}</b> 轮</span>
  <span class="rounded-full bg-black/35 px-2.5 py-1">定约</span>
</div>`;
  assert.match(railTypeCheck(OLD_STATUS) ?? '', /数值那一档/, '旧版面没有被判出来');
});

/**
 * 信息须那两格的**排版纪律**（两条都来自真机截图反馈，各对应一次真实缺陷）：
 *
 * ① **表头 11px + 上边距 6px**：早先表头 10px（手机上偏小）、上下内边距各 2px，
 *    第一行贴着整块的圆角边线 —— 「第一行太挤了」。表头是这张表**唯一**的说明
 *    （`回溯 / 定约 / 级牌 / 庄已抓` 四个词没有别的解释），读不清就等于表头不存在。
 * ② **不许折行**：`25` 与「分」之间是可断行处（数字与表意文字之间允许断行），
 *    320px 上这条被挤到 229px 时列宽不够，「分」掉到了第二行。
 *    `whitespace-nowrap` 去掉那个断点，而「到底放不放得下」由 `shot-auction.ts` 的 ⑭b
 *    当场量（不换行需要多宽 vs 这一格真有多宽）—— 所以 nowrap 不是把问题藏起来，
 *    而是把「悄悄折行」换成「量得到放不下」。
 */
function railBoxCheck(railSource: string): string | null {
  const src = code(railSource);
  const head = /const head = '([^']*)'/.exec(src)?.[1];
  if (head === undefined) return '信息须里找不到表头那一档（const head）：表头的字号与留白没有来源';
  if (head.includes('text-[10px]')) return '信息须表头又回到 10px 了：手机上读不清，等于表头不存在';
  if (!head.includes('text-[11px]')) {
    return `信息须表头的字号不是 11px（${head}）：表头是这张表唯一的说明`;
  }
  const padTop = /(?:^|\s)pt-(\d+(?:\.\d+)?)/.exec(head)?.[1];
  if (padTop === undefined || Number(padTop) < 1.5) {
    return '信息须表头的上边距不到 6px（缺 pt-1.5）：第一行会贴着整块的上边线（真机反馈过「太挤」）';
  }
  if (!head.includes('whitespace-nowrap')) {
    return '信息须表头没有 whitespace-nowrap：表头文字会折成两行，整块跟着长高';
  }
  const cell = /const cell = '([^']*)'/.exec(src)?.[1];
  if (cell === undefined) return '信息须里找不到值格那一档（const cell）';
  if (!cell.includes('whitespace-nowrap')) {
    return '信息须的值格没有 whitespace-nowrap：数字与「分」之间会断行（真机截图：25 下面单独一行「分」）';
  }
  return null;
}

test('信息须：表头 11px + 上边距 6px，两行都不许折行（「分」不掉下来）', () => {
  const problem = railBoxCheck(infoRail);
  assert.equal(problem, null, problem ?? '');
});

test('反证：表头缩回 10px / 上边距贴边 / 去掉 nowrap，都必须被判出来', () => {
  // 注入一律打在**剥掉注释的源码**上（`code()`）：这几句话在注释里也出现过，
  // 直接 replace 会打着注释、然后被 `code()` 剥掉 —— 那样反证会「看起来通过、其实没注入」。
  const src = code(infoRail);
  assert.match(
    railBoxCheck(src.replace('text-[11px]', 'text-[10px]')) ?? '',
    /10px/,
    '表头缩回 10px 没有被判出来'
  );
  assert.match(
    railBoxCheck(src.replace('pt-1.5 pb-0.5', 'py-0.5')) ?? '',
    /上边距/,
    '表头上下都只留 2px（第一行贴边）没有被判出来'
  );
  assert.match(
    railBoxCheck(src.replaceAll('whitespace-nowrap', '')) ?? '',
    /whitespace-nowrap/,
    '去掉 nowrap（「分」可以掉到第二行）没有被判出来'
  );
  assert.match(
    railBoxCheck(src.replace("const cell = 'whitespace-nowrap", "const cell = '")) ?? '',
    /whitespace-nowrap/,
    '只去掉值格的 nowrap 没有被判出来'
  );
  assert.equal(
    railBoxCheck(`<table data-info-rail="true"><tr><th class="pt-1.5 text-[11px] whitespace-nowrap">回溯</th></tr></table>
<script>const head = 'pt-1.5 pb-0.5 text-[11px] whitespace-nowrap'; const cell = 'whitespace-nowrap';</script>`),
    null,
    '这条守卫对合规的最小片段也报错（过宽）'
  );
});

/**
 * 毡面的**一个宽度尺度**：顶部信息须与底部「我」那条底栏必须取同一个变量（`--rail-w`）。
 *
 * 为什么值得一条守卫：两块一上一下、同宽居中才读得出是一个台面框，而**宽度不等不会报任何错**
 * —— 早先信息须按内容撑到 229–238px、底栏固定 256px，差 18–27px，只有肉眼在真机上才看得出来。
 * 变量本身也必须存在：`width: var(--rail-w)` 在变量丢了的时候会退化成 `auto`，
 * 两块又各自按内容撑开，而且谁都不会报错（出货样式表那一半由 `scripts/ui-check.ts` 断言）。
 */
function railScaleCheck(railSource: string, pageSource: string, cssSource: string): string | null {
  if (!code(railSource).includes('w-[var(--rail-w)]')) {
    return '信息须没有按 --rail-w 取宽（缺 w-[var(--rail-w)]）：它会按内容撑宽，与底栏对不齐';
  }
  if (!code(pageSource).includes('max-w-[var(--rail-w)]')) {
    return '「我」那条底栏没有按 --rail-w 取宽（缺 max-w-[var(--rail-w)]）：两块又不是同一个尺度了';
  }
  if (!/--rail-w:\s*16rem/.test(code(cssSource)) || !/--rail-w:\s*18rem/.test(code(cssSource))) {
    return (
      'app.css 里缺 --rail-w 的一档值（基准 16rem / sm 18rem）：两处的 width 会一起退化成 auto，' +
      '或者桌面档放不下最宽的内容（100♣ / 100 分，数字在 sm 上长到 24px）'
    );
  }
  return null;
}

test('信息须与「我」那条底栏取毡面的同一个宽度尺度（--rail-w）', () => {
  const problem = railScaleCheck(infoRail, page, appCss);
  assert.equal(problem, null, problem ?? '');
});

test('反证：任何一处不走 --rail-w / 变量没定义，都必须被判出来', () => {
  // 同样打在剥掉注释的源码上：`+page.svelte` 的说明文字里就写着那个类名，
  // 直接注入会打在注释上（`code()` 一剥就没了），反证于是假通过。
  assert.match(
    railScaleCheck(code(infoRail).replace('w-[var(--rail-w)]', 'w-auto'), page, appCss) ?? '',
    /--rail-w/,
    '信息须自己写宽度没有被判出来'
  );
  assert.match(
    railScaleCheck(infoRail, code(page).replace('max-w-[var(--rail-w)]', 'max-w-3xs'), appCss) ?? '',
    /--rail-w/,
    '底栏自己写宽度没有被判出来'
  );
  assert.match(
    railScaleCheck(infoRail, page, code(appCss).replace('--rail-w: 16rem', '')) ?? '',
    /--rail-w/,
    'app.css 里丢掉 --rail-w 没有被判出来'
  );
  assert.equal(
    railScaleCheck(
      '<table class="w-[var(--rail-w)]"></table>',
      '<div class="max-w-[var(--rail-w)]"></div>',
      ':root { --rail-w: 16rem } @media (min-width: 640px) { :root { --rail-w: 18rem } }'
    ),
    null,
    '这条守卫对合规的最小片段也报错（过宽）'
  );
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
 * 动作控件（已选张数 / 出牌 / 清空 / 确认埋底）住在**操作条那一行**里（ADR-0020 修订）。
 * 每条要求都对应一次真实返工：
 *
 * ① **在流内**：`ActionTray` 渲染在 `ActionBar` 那一行里（`data-action-row`），自己**不许**
 *    `absolute` / `inset-0` / `z-30`。早先它是「毡面与操作条之间那条 44px 常驻带」里的漂浮层；
 *    再早先它钉在操作条上沿（`bottom-full`），而那 40px 整根落在毡面的最后 40px 里：
 *    手机 375px 上与自己的座位卡竖直重叠 32px、水平重叠 84px（截图里的 #4）。
 *    在流内之后，「浮起来压住毡面」在结构上不可能（几何判据见 shot 的 ⑥/⑧）。
 * ② **零回流靠行高**：那一行必须 `min-h-[2.6rem]` —— 托盘与状态句来回换内容时行高不变，
 *    而毡面是 `flex-1`，行高一变毡面就跟着动。这是撤掉动作带的**前提**，所以要钉住。
 * ③ **中间那一格 `flex-1` + 居中**：状态句与托盘互斥地住在同一格里，宽屏上它们因此落在行中间
 *    （早先托盘在带子里居中、状态句在最左，是两个不同的位置）。
 * ④ `flex-nowrap`：早先是 `flex-wrap`，窄屏上「清空」与红字各自挤出一行，托盘被撑到近 180px 高。
 * ⑤ `w-max` + 每个 class 常量的 `whitespace-nowrap`：宽度被压成半个容器时 shrink-to-fit 会让
 *    子项压缩，CJK 于是竖排（「出 牌」写成两行 —— 截图里那一次返工）。
 * ⑥ 旧锚不许回来：`bottom-full` / `-translate-y-1/2`。
 */
function trayCoupling(pageSource: string, barSource: string, traySource: string): string | null {
  const bar = code(barSource);
  const tray = code(traySource);
  // ① 落点：托盘在 ActionBar 里（页面自己不再有第二个落点 —— 那条动作带已经撤掉）
  if (/data-action-band/.test(code(pageSource))) {
    return '牌桌页又有了一条独立动作带（data-action-band）：托盘应当住在操作条那一行里（那 44px 已经还给牌区）';
  }
  if (!/<ActionTray\b/.test(bar)) {
    return 'ActionBar 里没有渲染 ActionTray：动作控件又没了落点（或又被挪回毡面里）';
  }
  if (!/<div[^>]*data-action-row="true"[^>]*>[\s\S]*?<ActionTray\b/.test(bar)) {
    return 'ActionTray 不在带 `data-action-row` 的那一行里：它会浮起来压住毡面最后一行';
  }
  // ② 行高：托盘与状态句换内容时毡面零回流的前提
  if (!/min-h-\[2\.6rem\]/.test(bar)) {
    return '操作条那一行丢了 min-h-[2.6rem]：托盘与状态句换内容时行高会变，毡面跟着动';
  }
  // ③ 中间那一格：占满剩余宽度 + 内容居中
  const middle = /<div class="([^"]*)"[^>]*>\s*\{#if status\}[\s\S]*?<ActionTray\b/.exec(bar)?.[1] ?? '';
  if (middle === '') {
    return '操作条里找不到「状态句 / 托盘」那一格：两者必须住在同一个占位格里（互斥地换内容）';
  }
  for (const cls of ['flex-1', 'justify-center', 'items-center']) {
    if (!middle.includes(cls)) {
      return `中间那一格缺少 ${cls}：宽屏上状态句与托盘会挤在「?」旁边，右半边空一大片`;
    }
  }
  if (!middle.includes('min-w-0')) {
    return '中间那一格缺少 min-w-0：极窄屏上它会把整行撑出容器';
  }
  // ④⑤ 托盘自己的形状
  const root = /<div[^>]*data-action-tray="true"[^>]*>/.exec(tray)?.[0] ?? '';
  if (root === '') return 'ActionTray 丢了 data-action-tray 钩子：ui-check 靠它认出这一层';
  for (const cls of ['absolute', 'inset-0', 'z-30']) {
    if (root.includes(cls)) {
      return `ActionTray 又浮起来了（根节点带 ${cls}）：它必须留在操作条那一行的流里（否则会压住毡面最后一行）`;
    }
  }
  if (root.includes('bottom-full') || root.includes('-translate-y-1/2')) {
    return 'ActionTray 又回到旧锚（bottom-full / 垂直居中）：那就又是「悬在毡面最后 40px 里」';
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
  // 取**根开标签**判断宽度：只扫全文会被错误气泡那枚 w-max 蒙混过去
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

test('出牌阶段：动作控件住在操作条那一行里，且不再是一条独立的动作带', () => {
  const problem = trayCoupling(page, actionBar, actionTray);
  assert.equal(problem, null, problem ?? '');
});

test('反证：托盘浮起来 / 回到旧锚 / 行动格不居中 / 行高丢了 / 允许换行，都必须被判出来', () => {
  assert.ok(
    trayCoupling(page, actionBar, '<div class="flex gap-2">出 牌</div>') !== null,
    '没有 data-action-tray 钩子的托盘被判为合规：这条守卫是空转的'
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
    trayCoupling(page, '<ActionBar {client} />\n<ActionTray {client} />', actionTray) !== null,
    '托盘不在操作条那一行里（页面上第二个落点）被判为合规'
  );
  // 那条 44px 动作带不许回来：它是被这一版撤掉的
  assert.match(
    trayCoupling(
      `<div data-action-band="true"><ActionTray {client} /></div>\n${page}`,
      actionBar,
      actionTray
    ) ?? '',
    /动作带/,
    '动作带回潮（页面里又有 data-action-band）没有被判出来'
  );
  // 中间那一格不再居中：宽屏上状态句与托盘又会挤到「?」旁边
  assert.match(
    trayCoupling(
      page,
      actionBar.replace('flex min-w-0 flex-1 items-center justify-center gap-2', 'flex gap-2'),
      actionTray
    ) ?? '',
    /flex-1|justify-center/,
    '中间那一格不再占满并居中没有被判出来'
  );
  // 行高：托盘与状态句换内容时毡面会跟着动
  assert.match(
    trayCoupling(page, actionBar.replace(' min-h-[2.6rem]', ''), actionTray) ?? '',
    /min-h/,
    '操作条丢掉 min-h-[2.6rem] 没有被判出来'
  );
  // 截图里那一次：托盘浮回毡面里（整根落在最后 40px 上，压住「我」那条底栏）
  const FLOATING = actionTray.replace(
    'relative flex w-max flex-nowrap',
    'absolute inset-0 z-30 flex w-max flex-nowrap'
  );
  assert.match(
    trayCoupling(page, actionBar, FLOATING) ?? '',
    /浮起来/,
    '托盘又变成漂浮的一层没有被判出来'
  );
  // 更早那一次：钉在操作条上沿
  const OLD_ANCHOR = actionTray.replace('relative flex w-max', 'relative bottom-full flex w-max');
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
 *
 * ADR-0020 修订后它是一枚**闹钟图标**、秒数写在圆里，所以判据多了两条：
 * ③ 表面必须来自 `labels.ts` 的 `clockFace`（`0..99` 正常 / `100..999` 小一档 / `≥1000` 红横杠），
 *    完整那句 `formatElapsed` 挂到 `title` 与 `aria-label` 上 —— 图标里放不下「距上一步 12 分 34 秒」；
 * ④ `data-clock-face` 挂在**那个看得见的数字**上：ui-check 靠它断言圆里的数字真的在跳
 *    （只查 `title` 的话，冻住的时钟照样能过）。
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
  // 要的是**调用**（`clockFace(...)`），不是标识符：`import { clockFace }` 一直都在，
  // 只查标识符的话「把调用换掉、自己拼表面」会被 import 蒙混过去（反证用例正是这么踩的）。
  if (!/clockFace\(/.test(clock)) {
    return '计时组件没有调用 clockFace：三档表面（写数 / 小一档 / 红横杠）会各写各的';
  }
  if (!clock.includes('formatElapsed')) return '计时组件没有用 formatElapsed 写完整那句时长';
  if (!/title=\{phrase\}/.test(clock) || !/aria-label=\{phrase\}/.test(clock)) {
    return '完整那句「距上一步 …」没有挂到 title / aria-label 上：图标里只剩一个数字，读屏与鼠标都读不到它是什么意思';
  }
  if (!clock.includes('setInterval')) return '计时组件不会走时（缺 setInterval）：那只是一张静止的截图';
  if (!clock.includes('data-action-clock')) return '计时组件丢了 data-action-clock 钩子：ui-check 靠它认这个元素';
  if (!clock.includes('data-clock-face')) {
    return '计时组件丢了 data-clock-face 钩子：ui-check 再也无法断言圆里的数字真的在跳';
  }
  if (!/elapsed !== null/.test(clock)) return '计时组件在还没有牌局（ageMs 为 null）时也会渲染：大厅里没有「上个动作」可说';
  return null;
}

test('「距上一步」计时读负载里的年龄，并且真的在走', () => {
  const problem = clockWiring(actionBar, actionClock);
  assert.equal(problem, null, problem ?? '');
});

test('反证：计时不渲染 / 从页面打开计时 / 不走时 / 丢掉看得见的数字，都必须被判出来', () => {
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
  assert.match(
    clockWiring(actionBar, actionClock.replace('data-clock-face="true"', '')) ?? '',
    /data-clock-face/,
    '丢掉「看得见的数字」那个钩子没有被判出来'
  );
  assert.match(
    clockWiring(
      actionBar,
      actionClock.replaceAll('title={phrase}', '').replaceAll('aria-label={phrase}', '')
    ) ?? '',
    /title|aria-label/,
    '完整那句时长没挂到 title / aria-label 上没有被判出来'
  );
  assert.match(
    clockWiring(actionBar, actionClock.replace('clockFace(elapsed)', 'formatElapsed(elapsed)')) ?? '',
    /clockFace/,
    '不用 clockFace 而自己拼表面没有被判出来'
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
 * - **入口**（`InfoRail`）：收过墩才出现，且必须 `pointer-events-auto` —— 整条状态条是
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

  // ① 入口：信息须「回溯」那一格里、收过墩才**能点**、可点时自己接回点击
  if (!status.includes('上一轮</button')) {
    return '信息须里没有「上一轮」回看入口：上一墩的牌又只剩毡面上那一瞬';
  }
  if (!status.includes('onReviewTrick')) {
    return '信息须里没有「上一轮」回看入口（onReviewTrick）：上一墩的牌又只剩毡面上那一瞬';
  }
  if (!status.includes('trickHistory')) {
    return '「上一轮」入口不看 trickHistory：还没收过墩（叫牌/埋底/刚换副）也会**可点**';
  }
  if (!status.includes('pointer-events-auto')) {
    return '「上一轮」入口缺 pointer-events-auto：外层让开点击，按钮会看得见点不到';
  }
  // 首轮那颗灰按钮（用户明确要的）：`disabled` 必须绑在 `!canReview` 上 ——
  // 少了它，要么第一轮那一格空着（四列表格缺一角），要么指向一墩不存在的牌。
  if (!/disabled=\{!canReview\}/.test(status)) {
    return '「上一轮」按钮没有绑 `disabled={!canReview}`：第一轮那颗灰按钮（或收墩后该能点）会失效';
  }
  // 位置：这张表的**列序**就是这一条的形状（回溯 → 定约 → 级牌 → 庄已抓），
  // 而且值格必须与表头同序 —— 否则「回溯」那一格会跑到右边去。
  // 为什么删掉了「第 N 轮」：它在这里没有信息量 —— 打到第几轮由毡面上那墩牌自己说明，
  // 唯一需要说清轮次的地方是**回看浮层**的标题（「上一轮 · 第 N 轮」）。
  const heads = ['回溯', '定约', '级牌', '庄已抓'];
  let cursor = -1;
  for (const name of heads) {
    const at = status.indexOf(name);
    if (at < 0 || at < cursor) {
      return `信息须的表头不是「${heads.join(' / ')}」这个顺序（缺「${name}」或位置不对）`;
    }
    cursor = at;
  }
  const cellAt = ['review', 'contract', 'level', 'points'].map((name) =>
    status.indexOf(`data-rail-cell="${name}"`)
  );
  if (cellAt.some((at, index) => at < 0 || (index > 0 && at < cellAt[index - 1]!))) {
    return '信息须的值格与表头不同序（review → contract → level → points）：回溯那一格会跑到右边';
  }
  // 「回溯」那一格必须**装的就是这枚按钮**：按格子切片来判断，而不是数它后面多少字符 ——
  // 窗口写小了会在加了注释之后悄悄失效（而反证用例全都拿真实源码跑，于是会一起假绿）。
  const reviewCellAt = status.indexOf('data-rail-cell="review"');
  const reviewCellEnd = status.indexOf('</td>', reviewCellAt);
  const reviewCell = reviewCellAt < 0 ? '' : status.slice(reviewCellAt, reviewCellEnd < 0 ? undefined : reviewCellEnd);
  if (!/上一轮<\/button\s*>/.test(reviewCell)) {
    return '「上一轮」按钮不在「回溯」那一格里：它会被算进别的列（或那一列空着）';
  }
  if ((status.match(/轮/g) ?? []).length !== 1) {
    return '信息须里又长出了「第 N 轮」（或轮次号换了个写法）：轮次只有回看浮层的标题该说';
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

test('「上一轮」回看：入口在信息须的「回溯」格里、浮层只在毡面内、复用同一份牌面与徽标', () => {
  const problem = trickReviewCheck(page, infoRail, trickReview, trickArea);
  assert.equal(problem, null, problem ?? '');
});

test('反证：入口点不动 / 表头乱序 / 按钮跑出回溯格 / 默认就开着 / 浮层整屏 / 丢掉让开点击 / 自拼牌堆 / 少了关闭路径 / 第二份「上一轮」，都必须被判出来', () => {
  const cases: readonly (readonly [string, string | null, RegExp])[] = [
    [
      '入口丢掉 pointer-events-auto',
      trickReviewCheck(page, infoRail.replaceAll('pointer-events-auto', 'pointer-events-none'), trickReview, trickArea),
      /pointer-events-auto/
    ],
    [
      '入口不看 trickHistory',
      trickReviewCheck(page, infoRail.replaceAll('trickHistory', 'hands'), trickReview, trickArea),
      /trickHistory/
    ],
    [
      '首轮那颗灰按钮丢了 disabled 绑定',
      trickReviewCheck(page, infoRail.replace('disabled={!canReview}', ''), trickReview, trickArea),
      /disabled/
    ],
    [
      '表头乱序（庄已抓跑到定约前面）',
      trickReviewCheck(
        page,
        infoRail
          .replace('>级牌</th>', '>级牌X</th>')
          .replace('>庄已抓</th>', '>级牌</th>')
          .replace('>级牌X</th>', '>庄已抓</th>'),
        trickReview,
        trickArea
      ),
      /表头/
    ],
    [
      '「上一轮」按钮被挪出「回溯」那一格',
      trickReviewCheck(
        page,
        (() => {
          const block = /<button[\s\S]*?上一轮<\/button\s*>/.exec(infoRail)?.[0] ?? '';
          return infoRail.replace(block, '') + '\n' + block;
        })(),
        trickReview,
        trickArea
      ),
      /回溯/
    ],
    [
      '「第 N 轮」chip 又回来了',
      trickReviewCheck(
        page,
        `<span>第 <b class="tabular-nums">{trickNo}</b> 轮</span>` + infoRail,
        trickReview,
        trickArea
      ),
      /第 N 轮/
    ],
    [
      '回看默认就开着（SSR 首帧出现浮层）',
      trickReviewCheck(page.replace('let reviewOpen = $state(false)', 'let reviewOpen = $state(true)'), infoRail, trickReview, trickArea),
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
        infoRail,
        trickReview,
        trickArea
      ),
      /毡面里/
    ],
    [
      '浮层改成整屏 fixed（盖住手牌）',
      trickReviewCheck(page, infoRail, trickReview.replace('absolute inset-0 z-20', 'fixed inset-0 z-20'), trickArea),
      /fixed/
    ],
    [
      '浮层根节点不再让开点击',
      trickReviewCheck(page, infoRail, trickReview.replace('pointer-events-none absolute inset-0', 'absolute inset-0'), trickArea),
      /pointer-events-none/
    ],
    [
      '浮层自己拼牌堆',
      trickReviewCheck(page, infoRail, trickReview + '\n<CardView card={play.cards[0]} />', trickArea),
      /CardView/
    ],
    [
      '少了 Esc 关闭',
      trickReviewCheck(page, infoRail, trickReview.replace(/Escape/g, 'Enter'), trickArea),
      /Esc/
    ],
    [
      '出牌区退回自己那一份「上一轮」',
      trickReviewCheck(page, infoRail, trickReview, trickArea.replace('lastCompletedTrick(deal)', 'deal.trickHistory[deal.trickHistory.length - 1]')),
      /lastCompletedTrick/
    ]
  ];
  for (const [name, problem, pattern] of cases) {
    assert.match(problem ?? '', pattern, `${name}：没有被判出来（守卫空转）`);
  }
});

/* ---------- 一副结束时的三拍（ADR-0022） ---------- */

/**
 * 末墩收墩之后的三拍：看清末墩（2.0s）→ 亮底牌（3.2s）→ 弹结算。
 *
 * 为什么需要守卫：改动前 `summary !== null` **就**弹窗，而结算弹窗是 `fixed inset-0 z-50`
 * —— 一帧之内盖住毡面。末墩三家出的什么、庄家埋了什么，玩家根本来不及看，而这两样恰好
 * 是这一副最该看清的（末墩决定底牌倍数、底牌决定保底还是抠底）。所以这条守卫的**核心**
 * 是第 ① 条：弹窗只能由**第三拍**驱动。
 *
 * 另外三条各有一次具体的坏法：
 * - ② 定时器不清理 ⇒ 换副/离桌之后它们还会叫醒一次（把新一副的状态推起来）；
 * - ③ 跳过按钮住进毡面 ⇒ 它必然压住 3 个出牌点或「我」那一点（那一格已经满了）；
 * - ④ 锁只上在一处 ⇒ 两处按钮里剩下那一个成了后门，跳过就能提前换副（全桌节奏当场失效）。
 *
 * 真实时间轴（哪一拍真的出现在屏幕上、亮底牌与三个出牌点不相交）由
 * `scripts/shot-auction.ts` 的 ⑱/⑲ 与 `scripts/ui-check.ts` 的出货 HTML 断言，
 * 这一层守的是「形状与接线」。
 */
function scoredPacingCheck(
  pageSource: string,
  barSource: string,
  summarySource: string,
  revealSource: string
): string | null {
  const page = code(pageSource);
  const bar = code(barSource);
  const modal = code(summarySource);
  const reveal = code(revealSource);

  // ① 弹窗由第三拍驱动（不是「summary 一到就弹」）
  if (!/scoredStep === 'summary'/.test(page)) {
    return '结算弹窗没有受第三拍约束（缺 scoredStep === "summary"）：一收墩就弹，末墩与底牌都被盖住';
  }
  if (!(page.includes('scoredStepAt(') && page.includes('nextDealUnlocked('))) {
    return '页面没有用 scoredStepAt / nextDealUnlocked 算这一拍与那把锁：三拍会各写各的时长';
  }
  if (/\b(2000|3200|5200)\b/.test(page)) {
    return '页面里出现了裸的时长数字（2000 / 3200 / 5200）：时长只许由 labels.ts 的常量给出';
  }
  // ② 叫醒时钟：状态只由本地时钟一处给出，而且它敢停、也会停
  const wakeStart = page.indexOf('$effect(() => {\n    void pacingTick;');
  if (wakeStart < 0) {
    return '页面里找不到三拍的「叫醒」effect（它应当以 `void pacingTick;` 开头）';
  }
  const wakeBody = page.slice(wakeStart, page.indexOf('});', wakeStart));
  if (!wakeBody.includes('clearInterval')) {
    return '三拍的叫醒时钟没有清理（缺 clearInterval）：解锁之后它会一直跳下去';
  }
  if (!/return;/.test(wakeBody)) {
    return '叫醒 effect 没有停止条件（缺 `if (scoredAt === 0 || nextDealReady) return;`）：解锁之后时钟会一直跳';
  }
  // 跳过必须**一次点一拍**（`nextStep`）：一次点到底会把亮底牌那一拍整个吃掉，
  // 而那颗按钮在第一拍写的正是「看底牌 »」。两个动作也要接得上（`laterStep` 只许往前）。
  if (!/nextStep\(scoredStep\)/.test(page)) {
    return '「跳过」没有接到 nextStep(scoredStep) 上：一次点击会连跳两拍，亮底牌被你跳过去了';
  }
  if (!/laterStep\(/.test(page)) {
    return '页面没有用 laterStep 合并「时钟」与「手动提前」两路：点完可能被时钟反超退回去';
  }
  // ②b 起算那个 effect **不许**返回清理函数：它每一帧都会重跑（`summary` 每帧都是新对象），
  //     带清理的写法会在重跑时掐掉定时器、而早退分支不会再建 —— 三拍永远停在第一拍。
  //     （这个坑是 shot 的时间轴判据抓出来的：采样 112 帧、三拍一步没动。）
  const pacingStart = page.indexOf('$effect(() => {\n    const no = summary?.dealNo');
  if (pacingStart < 0) {
    return '页面里找不到三拍的「起算」effect（它应当以 `const no = summary?.dealNo` 开头）';
  }
  const effectBody = page.slice(pacingStart, page.indexOf('});', pacingStart));
  if (/clearInterval|clearTimeout/.test(effectBody)) {
    return (
      '三拍的起算 effect 返回了清理函数：它每一帧都会重跑（summary 每帧都是新对象），' +
      '重跑时清理会掐掉叫醒时钟、而早退分支不会再建 —— 三拍会永远停在第一拍'
    );
  }
  // ③ 亮底牌那一层：两个钩子分挂两层（外壳 = 定位壳，牌匾 = 要被量的那一块），
  //    让开点击，且只摊公开的那 3 张
  if (!reveal.includes('data-kitty-layer')) {
    return '亮底牌那一层丢了外层钩子 data-kitty-layer：量的时候会误把整格当成「亮出来的那一块」';
  }
  if (!reveal.includes('data-kitty-reveal')) {
    return '亮底牌那一层丢了 data-kitty-reveal 钩子：实测与出货 HTML 都认不出它';
  }
  const layerTag = /<div[^>]*data-kitty-layer[^>]*>/.exec(reveal)?.[0] ?? '';
  const plaqueTag = /<div[^>]*data-kitty-reveal[^>]*>/.exec(reveal)?.[0] ?? '';
  if (layerTag === '' || plaqueTag === '') {
    return '亮底牌那一层的两个钩子不在两个不同的 div 上（一个定位壳 + 一块牌匾）';
  }
  if (plaqueTag.includes('inset-0')) {
    return '牌匾自己写成了 `absolute inset-0`：它会被量成整格，几何判据等于空转';
  }
  if (!layerTag.includes('pointer-events-none')) {
    return '亮底牌那一层没有让开点击：毡面内容槽里只剩它，它会吃掉整格的点击';
  }
  if (/<button|<a\b/.test(reveal)) {
    return '亮底牌那一层里出现了可点元素：动作面归操作条那一行（「跳过」在那里）';
  }
  if (!page.includes('scoredStep === \'kitty\'')) {
    return '亮底牌那一层不是只在第二拍渲染：它要么一直挂着，要么永远不出现';
  }
  if (!page.includes('summary.kitty')) {
    return '亮底牌那一层摊的不是 summary.kitty（结算时公开的埋下的底牌）：它可能摊错了那 3 张';
  }
  // ④ 锁必须在**两处**都上：操作条那一行 + 结算弹窗
  if (!bar.includes('!nextDealReady')) {
    return '操作条那一行的「下一副 / 开新对局」没有上锁：跳过就能提前换副（切开别人的亮底牌）';
  }
  if (!modal.includes('!nextDealReady')) {
    return '结算弹窗里的「下一副 / 开新对局」没有上锁：弹窗那条路成了后门';
  }
  if (!(page.includes('<ActionBar') && /nextDealReady/.test(page.slice(page.indexOf('<ActionBar'))))) {
    return '页面没有把 nextDealReady 传给操作条那一行：那把锁悬空了';
  }
  if (!/nextDealReady/.test(page.slice(page.indexOf('<DealSummary')))) {
    return '页面没有把 nextDealReady 传给结算弹窗：那把锁悬空了';
  }
  // 跳过按钮住操作条那一行，只在结算阶段出现（与状态句/托盘同一个位置，互斥）
  if (!bar.includes('data-pacing-skip')) {
    return '操作条那一行里没有「看底牌 / 看结算」按钮：跳过没地方点';
  }
  if (!/phase === 'scored'/.test(bar.slice(bar.indexOf('data-pacing-skip') - 400))) {
    return '跳过按钮不是只在结算阶段出现：它在别的阶段会挤掉状态句或托盘';
  }
  return null;
}

test('一副结束时的三拍：弹窗只在第三拍弹、跳过在操作条行、换副的锁两处都上', () => {
  const problem = scoredPacingCheck(page, actionBar, dealSummary, kittyReveal);
  assert.equal(problem, null, problem ?? '');
});

test('反证：一收墩就弹 / 锁只上一处 / 亮底牌层截获点击 / 定时器不清理，都必须被判出来', () => {
  // 注入一律打在**剥掉注释**的源码上（`code()`）：这几句话在注释里也出现过，
  // 直接 replace 会打着注释、然后被 `code()` 剥掉 —— 反证会「看起来通过、其实没注入」。
  const p = code(page);
  const b = code(actionBar);
  const m = code(dealSummary);
  const r = code(kittyReveal);
  assert.match(
    scoredPacingCheck(p.replace("scoredStep === 'summary' && ", ''), b, m, r) ?? '',
    /第三拍/,
    '「一收墩就弹」被判成合规：这条守卫是空转的'
  );
  assert.match(
    scoredPacingCheck(p.replace("scoredStep === 'kitty' && ", ''), b, m, r) ?? '',
    /第二拍/,
    '「亮底牌不经第二拍」没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p, b.replaceAll('!nextDealReady', 'false'), m, r) ?? '',
    /操作条/,
    '操作条那一行的锁被摘掉没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p, b, m.replaceAll('!nextDealReady', 'false'), r) ?? '',
    /弹窗/,
    '结算弹窗里的锁被摘掉没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p, b, m, r.replace('pointer-events-none', '')) ?? '',
    /让开点击/,
    '亮底牌那一层截获点击没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p, b, m, r.replace('data-kitty-reveal="true"', 'data-kitty-reveal="true" inset-0')) ?? '',
    /inset-0|空转/,
    '牌匾被写成整格大小（几何判据会空转）没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p.replace('clearInterval', 'void 0'), b, m, r) ?? '',
    /清理/,
    '叫醒时钟不清理没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p.replace('if (scoredAt === 0 || nextDealReady) return;', ''), b, m, r) ?? '',
    /停止条件/,
    '叫醒 effect 没有停止条件（解锁后一直跳）没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p.replace('scoredAt = Date.now();', 'scoredAt = Date.now(); return () => clearInterval(1);'), b, m, r) ?? '',
    /起算/,
    '起算 effect 里长出清理函数（那正是「三拍永远停在第一拍」那个坑）没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p.replace('nextStep(scoredStep)', 'scoredStep'), b, m, r) ?? '',
    /nextStep/,
    '跳过不再「一次一拍」（会连跳两拍）没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p.replace('laterStep(manualStep, scoredStepAt(scoredElapsed))', 'manualStep'), b, m, r) ?? '',
    /laterStep/,
    '两路状态没有合并（手动提前可能被时钟反超）没有被判出来'
  );
  assert.match(
    scoredPacingCheck(`${p}\nconst dur = 2000;`, b, m, r) ?? '',
    /裸的时长/,
    '把时长写成裸数字没有被判出来'
  );
  assert.match(
    scoredPacingCheck(p, b, m, r + '\n<button type="button">跳过</button>') ?? '',
    /可点元素/,
    '亮底牌那一层里长出按钮没有被判出来'
  );
  assert.equal(
    scoredPacingCheck(
      `${p}`,
      `${b}`,
      `${m}`,
      `${r}`
    ),
    null,
    '这是对真实源码的自检：上面那条用例已经断言它合规，这里只确认守卫本身不抖'
  );
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

/* ---------- 出牌点的宽度预算（两翼按张数自适应，两侧同宽） ---------- */

/**
 * 左右两个出牌点的宽度必须**按张数算出来**（`spotBox`，见 `fan-layout.ts`），不能再写死 38%。
 *
 * 为什么写死是错的：宽度是这一簇唯一的可支配资源，而「够不够」只由张数决定 ——
 * 一张牌要一张牌宽，五张牌要 `牌宽 × 3.4`。写死 38% 时，少牌时盒子过宽（这一簇在盒内居中，
 * 于是离中线远、桌面留出一大块空），多牌时又不够（≥9 张压过角标可读下限）。
 *
 * 两条要求缺一不可：① 宽度来自 `spotBox`；② 两翼取**同一个值**（两家张数的较大者）——
 * 宽度不等就会把两翼的中点推出中线（几何判据是 `shot-auction.ts` 的 ⑨ / ⑰）。
 */
function spotWidthCheck(trickAreaSource: string): string | null {
  const src = code(trickAreaSource);
  if (!src.includes('spotBox(')) {
    return '出牌点的宽度不按张数算（缺 spotBox(…)）：又会退回写死的 38%';
  }
  if (!/Math\.max\(\.\.\.counts\)/.test(src)) {
    return '两翼没有取两家张数的较大者：宽度不等会让两翼的中点偏出中线';
  }
  if (/w-\[38%\]/.test(src)) {
    return '出牌点里又出现了写死的 w-[38%]：宽度必须由张数算出来（内联样式）';
  }
  if (!/spot\.insetPct/.test(src) || !/spot\.widthPct/.test(src)) {
    return '出牌点的位置没有用 spotBox 给的两个数（insetPct / widthPct）：内外两侧会各说各的';
  }
  return null;
}

test('两翼出牌点的宽度按张数自适应（spotBox），且两侧同宽', () => {
  const problem = spotWidthCheck(trickArea);
  assert.equal(problem, null, problem ?? '');
});

test('反证：写死 38% / 不取两家较大者 / 丢掉内缩，都必须被判出来', () => {
  const src = code(trickArea);
  assert.match(
    spotWidthCheck(src.replace('spotBox(wingCount)', '{ widthPct: 38, insetPct: 10 }')) ?? '',
    /spotBox/,
    '宽度改回写死没有被判出来'
  );
  assert.match(
    spotWidthCheck(src.replace('Math.max(...counts)', 'counts[0]')) ?? '',
    /较大者/,
    '两翼不取同一个宽度（各家算各家的）没有被判出来'
  );
  assert.match(
    spotWidthCheck(`${src}\n<div class="absolute left-[10%] w-[38%] top-0"></div>`) ?? '',
    /38%/,
    '写死的 38% 又回来了没有被判出来'
  );
  assert.match(
    spotWidthCheck(src.replace('spot.insetPct', '10')) ?? '',
    /insetPct|widthPct/,
    '出牌点的位置不取 spotBox 给的两个数没有被判出来'
  );
  assert.equal(
    spotWidthCheck(
      `const counts = plays.map((play) => play.cards.length);
const spot = spotBox(Math.max(...counts));
const style = \`left:\${spot.insetPct}%;width:\${spot.widthPct}%\`;`
    ),
    null,
    '这条守卫对合规的最小片段也报错（过宽）'
  );
});
