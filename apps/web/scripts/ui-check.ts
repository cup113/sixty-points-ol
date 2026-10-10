/**
 * 界面结构守卫：抓「只能靠肉眼发现」的版面与文案缺陷。
 *
 * 三类断言：
 * 1. Tailwind 的 position 工具类不可叠加 —— 产物里 .relative 排在 .absolute 之后，
 *    同一元素同时带两者时 relative 胜出，座位卡会塌回文档流、三张叠在毡面左上角。
 *    （ADR-0020 之后毡面是三行格、顶行两张对手卡走正常文档流，所以「座位卡定位类唯一为
 *    absolute」那条判据改成了「顶行的对手卡**自己不许定位**」+「三个行钩子齐备且有序」。）
 * 2. 说明文案只允许活在「?」弹层里：页面上不得再出现已删除的常驻提示，
 *    并且每一阶段都必须有那个「?」入口（title 随阶段变化）。
 * 3. 邀请码必须是一个可点的按钮（点它复制邀请链接），且界面上一律用玩家名，
 *    不得再出现东/南/西方位称谓。
 * 4. 牌面：大小王的角落（大+王）与正中（大王）必须指向同一张牌；牌角不得再有任何装饰圆点
 *    —— 这一条抓的是**出货样式表**，不是源码（源码删了但产物没重建，一样会被抓到）。
 *    主牌只许改 `background`（浅金底），不许再改边框颜色；叫牌阶段另有 `.card.rank-hint`
 *    （比主牌再浅一档，标「点数可能成为级牌」的牌）。
 * 5. 叫品一律写「分数 + 花色字形」：页面文本里不许再出现 `40 C` 这种裸花色字母
 *    —— 回归的是「叫牌历史走引擎 bidLabel(40 梅花)、候选按钮走 strainGlyph(♣)」那种一物两写。
 * 6. 出牌按钮：必须带 `.play-btn`（36px 命中高度 + z-index 抬在毡面之上）。
 *    叫牌面板的可达性（判据在 src/lib/panel-guard.ts，源码守卫 test/bid-panel.test.ts 用同一份）：
 *    面板是 flex 列，**唯一可伸缩**的是叫牌历史的滚动区（min-h-0 + flex-1 + overflow-y-auto），
 *    「不叫」排在它后面、正常文档流、shrink-0 —— 页脚既不压住内容，也不会被裁掉或顶出面板。
 *    两代坏形状都被钉住：`overflow-hidden` 从底部裁掉最后一行（按钮再也滚不回来）、
 *    sticky 页脚浮在历史行上（压掉半行叫牌记录 —— 截图里那半行就是这么丢的）。
 * 6b. 叫牌面板的内容：头部只写「第 N 副」（发牌人文案已删 ——「发牌」对新手不透明，
 *    谁先叫由轮次 chip 说）、历史是**三列表格**（一行塞几个人不再由昵称长度决定）、
 *    候选叫品是**固定五槽**（♣ ♦ ♥ ♠ NT 恒定位；不可叫的花色留隐形占位、绝不补位 ——
 *    免得同一横向位置在不同档之间换了花色，判据 `checkBidSlots`）＋**跳叫显式化**
 *    （默认只摆非跳叫档，其余收在「▶ 跳叫」触发钮后面，点开后共五档；更大的跳叫走 API/MCP）。
 *    档位与触发形态的取值由 labels.ts 的 `bidTiers` 定（四场景表在 labels.test.ts）。
 *    「信息面 → 候选档位 → 历史（自己滚） → 页脚」这个顺序由源码守卫钉住。
 * 7. 底牌可见性：庄家的埋底页要有「拿上来的底牌」那一行（`data-taken-kitty` 钩子）；闲家与观战者
 *    的同一页不能出现它。这一条同时守着引擎 personalView 的规则（拿上来的底牌只给庄家）。
 *    埋底页也不再写「埋底 · 选 3 张扣入暗底 / 庄家埋底中」与底牌说明句（说明归「?」、动作提示归
 *    操作条），并且定约/庄已抓必须是大号数字 —— 这两条一起抓「文案与字号又回潮」。
 * 7b. **出牌阶段**（真的把牌打出去）：动作控件住在**操作条那一行**里（`data-action-row`，
 *    问号右边那一格）—— 它必须**在流内**（不许 `absolute` / `inset-0` / `z-30`：那正是早先
 *    那条 44px 动作带里的漂浮层，一旦浮起来就会压住毡面最后一行）、单行（`flex-nowrap`）
 *    且宽度取 max-content（`w-max`；被压缩时中文按钮会竖排，每个按钮还要自带 nowrap）。
 *    那一行用 `min-h-[2.6rem]` 保证「轮到我 / 轮空」之间零回流。中间那一格 `flex-1` + 居中：
 *    状态句与托盘互斥地住在同一格里（轮到我时状态句是 null），宽屏上它们因此都落在行中间。
 *    跟牌时手牌把**领出那一门**标成蓝框（数量必须等于该门在手里的张数，期望值从 `/view` 现算，
 *    不写死花色）；**没轮到的人也照样有蓝框**（拟选，ADR-0021），但他没有托盘 ——
 *    这正是「拟选」在出货页面上的证据。收墩后的徽标只说「庄 +N 分 / 闲 +N 分」，
 *    并且信息须「回溯」格里那枚「上一轮」按钮在收墩前是**灰的（disabled）**、收墩后可点
 *    （bot 出手太快时靠它把上一墩三家出的牌找回来；浮层默认关着，所以这里同时断言
 *    SSR 首帧里没有 `data-trick-review`）。
 * 7c. **「距上一步」计时**：未发牌的大厅页没有它（还没有牌局动作）；发牌后玩家页与观战页都有，
 *    并且**真的在走** —— 取两次（中间等 1.2 秒）秒数必须变大、且增幅合理（抓「冻住的时钟」与单位错）。
 *    它现在是一枚闹钟图标、秒数写在圆里：`title` 上那句完整文案与圆里那个数字**都要**跟着走
 *    （只查 title 的话，冻住的时钟照样能过）。
 * 8. 观战页面：满座第 4 个人看到的是公共信息 —— 不得出现开局/叫牌/埋底按钮，也不得渲染任何牌面。
 * 9. **页头只留必要信息**：`← 大厅`、邀请码，外加右上角那枚**桌况簇**（观战人数含 0 常显；
 *    在座给「离座」、不在座给「改名」+ 有空座才给「入座」）—— 战报/教程/叫牌/底牌/结算详情
 *    一律不许出现在页头，它们属于右侧的活页签抽屉；连接圆点也已下线（正常与首帧都不占像素，
 *    只有 SSE 断开时才在页头下方出一句话）。两次「页头爆满」堆进去的都是**查阅**入口，而桌况簇
 *    是有界的一枚人数加至多两枚小按钮（且都是有时间性的一步动作），所以它回到了页头；
 *    这条顺带守住那枚绿点不回来、也守住断线提示不变成常显。
 * 10. **活页签抽屉**：右边缘的页签条是 `战报 / 叫牌 / 底牌 / 牌桌` 四项、顺序固定；抽屉默认是关闭态
 *    （`inert` + 滑出屏幕）；而「牌桌」页的内容（改名 / 换身份、座位已满）在关闭时也必须留在
 *    SSR 里 —— 否则观战者那两条入口就又从「页面上真的在」退化成「标签名存在」。
 * 另外对 /rules 与 /learn 跑同一套 position 守卫 —— 新写的版面正是最容易踩坑的地方；
 * /learn 还额外守住幻灯机骨架（幻灯片语义、自动播放、每屏 aria-label、无裸花色字母）
 * 与深链（`?s=245-trick-8` 必须直接服务端渲染出那一墩的牌面，而不是先给封面再靠 JS 跳），
 * 以及牌局章「三家当前的牌」那条横条：叫牌 17/17/17 → 第 1 墩打完 13/13/13 → 末墩 0/0/0。
 *
 * 运行：BASE=http://127.0.0.1:5178 node scripts/ui-check.ts
 */
import { cardClass, cardKey, checkPlay, type Card, type TrumpModel } from '@sixty/engine';
import { checkBidPanelReachability, checkBidSlots } from '../src/lib/panel-guard.ts';

// BASE 优先取环境变量；没有 env 注入的场景（例如沙箱里通过 bridge 跑）可以直接把地址当参数传：
//   node scripts/ui-check.ts http://127.0.0.1:3000
// 只看 http(s) 开头的参数，这样 `pnpm run ui -- <url>` 多出来的 `--` 也不会被当成地址。
const BASE = process.env['BASE'] ?? process.argv.slice(2).find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:5178';

const POSITION_CLASSES = ['static', 'fixed', 'absolute', 'relative', 'sticky'] as const;

/** 已删除的常驻提示：任何页面都不该再出现 */
const REMOVED_HINTS = ['三人到齐后，任意一人点', '我的手牌 ·', '复制链接', '已入座 '] as const;

interface Credential {
  name: string;
  credential: string;
}

async function claim(name: string): Promise<Credential> {
  const response = await fetch(`${BASE}/api/auth/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(`注册失败：${response.status}`);
  return (await response.json()) as Credential;
}

async function page(path: string, credential?: string): Promise<string> {
  const response = await fetch(`${BASE}${path}`, {
    headers: credential === undefined ? {} : { cookie: `sixty_cred=${credential}` }
  });
  if (!response.ok) throw new Error(`GET ${path} → ${response.status}`);
  return response.text();
}

/** 用某个座位的身份推进一步（座位由服务端按身份推导） */
async function act(code: string, credential: string, action: unknown): Promise<void> {
  const response = await fetch(`${BASE}/api/tables/${code}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
    body: JSON.stringify({ action })
  });
  if (!response.ok) throw new Error(`动作失败（${response.status}）：${await response.text()}`);
}

/** 取页面里第一个样式表链接；抓不到就直接报错，绝不静默跳过（否则守卫会变成空转） */
function cssHrefOf(html: string): string {
  const match = /<link[^>]+href="([^"]+\.css)"/.exec(html);
  if (match === null || match[1] === undefined) throw new Error('页面里找不到样式表链接，无法校验出货 CSS');
  return match[1];
}

async function asset(href: string): Promise<string> {
  const url = href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
  // 显式要求未压缩的原始文件：产物目录里同时有 .gz/.br 兄弟文件，
  // 带上 accept-encoding 会让同一个 URL 返回三种可能的内容，守卫就不再确定。
  const response = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return response.text();
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 取页面上所有 class 属性值（含 Svelte 拼接后的结果） */
function classAttrs(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1] ?? '');
}

/** 一个 class 串里出现的 position 工具类（只认完整类名，避免 relative-x 误判） */
function positionClasses(classValue: string): string[] {
  const tokens = classValue.split(/\s+/);
  return POSITION_CLASSES.filter((p) => tokens.includes(p));
}

/** 通用守卫：任何元素都不得混用两个 position 工具类 */
function assertNoPositionMix(html: string, where: string): void {
  const offenders = classAttrs(html)
    .map((value) => ({ value, found: positionClasses(value) }))
    .filter((entry) => entry.found.length > 1);
  assert(
    offenders.length === 0,
    `${where}：有 ${offenders.length} 处元素混用 position 工具类（Tailwind 中后定义者胜出，布局会意外塌陷）：\n` +
      offenders.map((o) => `  [${o.found.join(' + ')}] ${o.value.slice(0, 120)}`).join('\n')
  );
}

/** 说明文案必须只活在「?」弹层：对应阶段的弹层标题必须在页面上 */
function assertHelpTrigger(html: string, title: string, where: string): void {
  assert(
    html.includes(`title="${title}"`) && html.includes('aria-expanded'),
    `${where}：找不到「${title}」的 ? 说明入口`
  );
}

function assertNoRemovedHints(html: string, where: string): void {
  for (const hint of REMOVED_HINTS) {
    assert(!html.includes(hint), `${where}：仍出现已删除的常驻提示「${hint}」`);
  }
}

function assertNoCompassLabels(html: string, where: string): void {
  assert(!/[东南西]家/.test(html), `${where}：仍出现方位称谓（应改用玩家名/「你」）`);
}

/** 页头切片：第一个 `<header>` 就是页头（抽屉自己那个 header 在 DOM 里排得更后） */
function headerOf(html: string): string {
  const match = /<header[\s\S]*?<\/header>/.exec(html);
  if (match === null) throw new Error('页面里找不到 <header>，无法校验页头内容');
  return match[0];
}

/**
 * 页头只留必要信息：大厅、邀请码，以及右上角那枚**桌况簇**（观战人数 + 一步动作）。
 * 其余一律在右侧活页签抽屉里 —— 这条守的是「手机端页头又爆满」这个已经发生过两次的回归；
 * 那两次堆进去的都是**查阅**入口（战报、教程、历史记录），而桌况簇是有界的一行。
 *
 * 连接状态也归在这里管：它不再是常驻指示器（绿点已下线），只在 SSE 断开时出声。
 * 抓的是**出货 SSR HTML**，所以后半条同时证明「提示条没有变成常显」——SSR 首帧的
 * `connection` 就是 `connecting`，若提示条在这个态出现，页头下方每次加载都会多一条并顶动牌桌。
 */
function assertLeanHeader(html: string, where: string): void {
  const header = headerOf(html);
  for (const stray of ['战报', '教程', '叫牌', '底牌', '结算详情']) {
    assert(!header.includes(stray), `${where}：页头里仍出现「${stray}」（它应当只在右侧活页签抽屉里）`);
  }
  assert(
    header.includes('人观战'),
    `${where}：页头右上角没有观战人数（含 0 常显，所以它任何时候都在）`
  );
  assert(header.includes('大厅'), `${where}：页头没有回大厅的入口`);
  assert(
    /<button[^>]*aria-label="复制邀请链接"/.test(header),
    `${where}：页头的邀请码不再是可点复制的按钮`
  );
  assert(
    !header.includes('连接状态') && !/h-2 w-2 rounded-full/.test(header),
    `${where}：页头又长出了常驻连接圆点（连接异常应当由页头下方那条提示条承担）`
  );
  assert(
    !html.includes('连接中断'),
    `${where}：首帧（connection=connecting）就出现了断线提示条 —— 它只该在 offline 时出现`
  );
}

/**
 * 页头右上角的桌况簇按「在不在座」换按钮：在座给「离座」、不在座给「改名」（有空座才多一枚「入座」）。
 * 这里是**出货 HTML** 上的证据；源码层那三条判据在 `test/table-chrome.test.ts` 的 `headerClusterCheck`。
 */
function assertHeaderSeatAction(html: string, where: string, label: '离座' | '改名'): void {
  const header = headerOf(html);
  assert(header.includes(label), `${where}：页头桌况簇里没有「${label}」（在座给离座、不在座给改名）`);
  const other = label === '离座' ? '改名' : '离座';
  assert(!header.includes(other), `${where}：页头桌况簇同时出现了「${label}」与「${other}」`);
}

/** 右边缘活页签条：四项、顺序固定（`lib/drawer-tabs.ts` 是唯一真相） */
function assertTabRail(html: string, where: string): void {
  const rail = /<div[^>]*role="tablist"[\s\S]*?<\/div>/.exec(html)?.[0];
  assert(rail !== undefined, `${where}：找不到右侧活页签条（role="tablist"）`);
  const labels = [...rail.matchAll(/<span class="\[writing-mode:vertical-rl\]">([^<]+)<\/span>/g)].map(
    (m) => m[1]
  );
  assert(
    JSON.stringify(labels) === JSON.stringify(['战报', '叫牌', '底牌', '牌桌']),
    `${where}：页签应为 战报/叫牌/底牌/牌桌 且顺序固定，实际 [${labels.join(', ')}]`
  );
}

/** 抽屉默认关闭：外壳仍在 DOM 里，但滑出屏幕且 inert（不可聚焦、不读屏） */
function assertDrawerClosed(html: string, where: string): void {
  // 只看 aside **自己的开标签**：整段子树里本来就含 inert（常驻的「牌桌」页带自己的 inert），
  // 对着子树断言会变成空转 —— 注入实验里 `inert={false}` 也能通过，就是这么被抓出来的。
  const tag = /<aside[^>]*>/.exec(html)?.[0];
  assert(tag !== undefined, `${where}：找不到抽屉外壳（aside）`);
  assert(tag.includes('translate-x-full'), `${where}：抽屉默认没有滑出屏幕（缺 translate-x-full）`);
  assert(/\binert\b/.test(tag), `${where}：抽屉关闭时没有 inert（关着的表单仍会被 Tab 聚焦到）`);
}

/** 叫品文本里的裸花色字母：`40 C` / `45 H` 这类（花色必须出字形 ♣♦♥♠） */
/**
 * 叫品文本里的裸花色字母：`40 C` / `45 H` 这类（花色必须出字形 ♣♦♥♠）。
 *
 * `ignore` 里的子串先从文本里删掉再匹配：**邀请码是随机 6 位码**（字母表含数字与 C/D/H/S），
 * 出现过 `34W29H` 这种恰好命中 `\d\d[CDHS]\b` 的码 —— 它一张牌都没叫，却让守卫红了一次。
 * 忽略已知的随机串，守卫才既能抓住真的 `40 C`，又不会按 1/120 的概率误报。
 */
function bareStrainLetters(html: string, ignore: readonly string[] = []): string[] {
  let text = html.replace(/<[^>]*>/g, ' ');
  for (const noise of ignore) {
    if (noise.length > 0) text = text.split(noise).join(' ');
  }
  return [...text.matchAll(/\d{2,3}\s?[CDHS]\b/g)].map((m) => m[0]);
}

/** 叫牌控件：必须有「不叫」，且叫品不许出现裸花色字母 */
function assertBidControls(html: string, where: string, ignore: readonly string[] = []): void {
  assert(html.includes('不叫'), `${where}：找不到「不叫」按钮`);
  const stray = bareStrainLetters(html, ignore);
  assert(
    stray.length === 0,
    `${where}：叫品里出现了裸花色字母（应走 strainGlyph/♣♦♥♠）：${stray.join(', ')}`
  );
}

/** 取叫牌面板 `<section data-bid-panel>` 的切片：面板里的断言只该看面板自己（不掺手牌与抽屉） */
function bidPanelMarkup(html: string): string {
  const marker = html.indexOf('data-bid-panel');
  assert(marker >= 0, '页面里找不到叫牌面板（缺 data-bid-panel）');
  const end = html.indexOf('</section>', marker);
  assert(end > marker, '叫牌面板的 <section> 没有闭合');
  return html.slice(marker, end);
}

/**
 * 信息须「回溯」格里那枚「上一轮」按钮：**它一直在**，只有「能不能点」会变。
 *
 * 两个状态各有判据（两个都抓过一次真实缺陷）：
 * - 收过墩 ⇒ 必须**可点**：它自己 `pointer-events-auto`（整块须是 `pointer-events-none`，
 *   横跨毡面要让座位卡上的「+ 机器人」/「请离」点得到），少了这一句按钮会看得见点不到
 *   —— `BuryPanel` 记过这个坑；
 * - 还没收墩（第一轮）⇒ 必须是 `disabled` 的灰按钮：整格空着会让四列表格缺一角
 *   （「空出一块太怪」），而它同时预告了「这里能回看上一轮」。
 *
 * 抓不到直接抛：按钮消失了不是「跳过一个可选项」，是缺陷。
 * 形状判据的源码那一半在 `test/table-chrome.test.ts` 的 `trickReviewCheck`，
 * 几何那一半在 `scripts/shot-auction.ts` 的 ⑭（那张表不折行、居中）。
 */
function reviewButton(
  html: string,
  where: string
): { readonly tag: string; readonly disabled: boolean } {
  const tag = /<button[^>]*>上一轮<\/button>/.exec(html)?.[0];
  assert(tag !== undefined, `${where}：信息须的「回溯」格里没有「上一轮」按钮（它应当一直在，没轮到就禁用）`);
  return { tag, disabled: /\bdisabled\b/.test(tag) };
}

/**
 * 信息须里「定约」那一格的值（`data-rail-cell="contract"`）的 HTML 切片：
 * 只为断言那个数字的字号够大（值必须是大号，不能缩回小字）。
 *
 * 早先这里抓的是 `ring-gold/25`（定约是一枚独立的金色描边药丸）—— 那条须改成**类表格**之后，
 * 定约是「定约」表头下面的一个值格，描边移到了整块上（ADR-0020 修订）。
 */
function contractMarkup(html: string): string {
  return railCellMarkup(html, 'contract');
}

/** 数表头格：`<thead` 也以 `<th` 开头，所以正则必须带定界符（空格或 `>`） */
function thCount(html: string): number {
  return (html.match(/<th[\s>]/g) ?? []).length;
}

/**
 * 动作托盘内容盒（`data-action-tray`）的**开标签切片**（ADR-0020 修订）。
 *
 * 托盘现在住在操作条那一行里（`data-action-row`），所以它必须**不是**绝对定位 ——
 * 早先它是钉在「毡面与操作条之间那条 44px 常驻带」里的一个漂浮层
 * （`absolute inset-0` + 居中 + `z-30`），而那 44px 已经还给牌区。
 * 形状判据的源码那一半在 `test/table-chrome.test.ts` 的 `trayRowCheck`。
 */
function actionTrayMarkup(html: string): string | null {
  return /<div[^>]*data-action-tray="true"[^>]*>/.exec(html)?.[0] ?? null;
}

/**
 * 信息须那张表里某一格的值（`data-rail-cell="<name>"`）的 HTML 切片。
 *
 * 抓不到直接抛：定约 / 级牌 / 庄已抓这三样必须一直在牌面上，没了就是缺陷（不是可跳过的情况）。
 * 早先这里抓的是 `ring-gold/25`（定约是一枚独立的描边药丸）—— 那条须改成类表格之后，
 * 定约是「定约」表头下面的一个值格，描边移到了整块上。
 */
function railCellMarkup(html: string, name: string): string {
  const start = html.indexOf(`data-rail-cell="${name}"`);
  assert(
    start >= 0,
    `页面里找不到信息须的「${name}」值格（data-rail-cell="${name}"）：定约 / 级牌 / 庄已抓必须一直在牌面上`
  );
  return html.slice(start, start + 400);
}

/**
 * 动作托盘的整块切片（开标签 → 闭合标签）：用来查按钮自己的 class —— 开标签只看得到根节点。
 * 托盘的子元素只有 `span` 与 `button`（错误气泡也是 `span`），所以第一个 `</div>` 就是它自己那个。
 */
function actionTrayBlock(html: string): string | null {
  return /<div[^>]*data-action-tray="true"[\s\S]*?<\/div>/.exec(html)?.[0] ?? null;
}

/**
 * 页面上的「距上一步」计时 → 秒数。抓的是**完整那句话**（`距上一步 12 秒`）——
 * 它现在挂在图标的 `title` / `aria-label` 上（图标里只写秒数，见 ActionClock）。
 * 抓不到直接抛：守卫绝不静默跳过。
 * 三档都要认（`12 秒` / `1 分 05 秒` / `2 小时 03 分`），否则等久了守卫会假红。
 */
function clockSeconds(html: string, where: string): number {
  const match = /距上一步 (?:(\d+) 小时 )?(?:(\d+) 分 )?(\d+) 秒/.exec(html);
  assert(match !== null, `${where}：找不到「距上一步」计时（时钟不见了，或文案/格式变了）`);
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3]);
}

/**
 * 闹钟图标圆里那个**看得见的**数字（`data-clock-face`）。
 *
 * 为什么要单独抓它：`clockSeconds` 读的是 `title`，而属性写在那儿不代表**圆里的数字**也在跳
 * —— 这一条正是抓「时钟冻住」的那一半。`≥1000` 秒时它写的是红横杠（那时不写数，
 * 见 labels.ts 的 `clockFace`），所以这里按字符取，不做数字转换。
 */
function clockFaceText(html: string, where: string): string {
  const match = /data-clock-face="true"[^>]*>([^<]*)</.exec(html);
  assert(match !== null, `${where}：找不到计时图标里的数字（data-clock-face 不见了）`);
  return (match[1] ?? '').trim();
}

/** `/api/tables/<code>/view` 的载荷（在座拿到个人视图；牌面就是引擎的 Card 对象） */
interface RestPayload {
  view: { deal: RestDeal | null };
  you: { seat: number; hand: readonly Card[] } | null;
}

interface RestDeal {
  phase: string;
  trump: TrumpModel | null;
  declarerSeat: number | null;
  playTurn: number | null;
  trick: { leaderSeat: number; plays: readonly { seat: number; cards: readonly Card[] }[] } | null;
}

async function viewOf(code: string, credential: string): Promise<RestPayload> {
  const response = await fetch(`${BASE}/api/tables/${code}/view`, {
    headers: { authorization: `Bearer ${credential}` }
  });
  if (!response.ok) throw new Error(`取视图失败：${response.status}`);
  return (await response.json()) as RestPayload;
}

async function main(): Promise<void> {
  const stamp = Date.now() % 100000;
  const players = await Promise.all([0, 1, 2].map((i) => claim(`界面${i}-${stamp}`)));

  const created = (await fetch(`${BASE}/api/tables`, {
    method: 'POST',
    headers: { authorization: `Bearer ${players[0]!.credential}` }
  }).then((r) => r.json())) as { code: string };
  const code = created.code;

  for (const player of players.slice(1)) {
    const response = await fetch(`${BASE}/api/tables/${code}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${player!.credential}` }
    });
    assert(response.ok, `入座失败：${response.status}`);
  }

  const lobby = await page(`/table/${code}`, players[0]!.credential);

  // 1) 大厅可开局（沿用 lobby-check 的口径，保证重构没弄丢入口）
  assert(lobby.includes('开始第一副'), '未开局页面没有渲染「开始第一副」按钮');

  // 2) 邀请码是可点按钮（点它复制邀请链接），不再有独立的「复制链接」按钮
  assert(lobby.includes('title="点击复制邀请链接"'), '邀请码不是可点的复制按钮');
  assert(
    /<button[^>]*aria-label="复制邀请链接"/.test(lobby),
    '邀请码的复制按钮缺少 aria-label'
  );

  // 3) 文案收敛：常驻提示已删，阶段说明只能从「?」进
  assertNoRemovedHints(lobby, '未开局页面');
  assertNoCompassLabels(lobby, '未开局页面');
  assertHelpTrigger(lobby, '准备阶段', '未开局页面');
  assertLeanHeader(lobby, '未开局页面');
  assertHeaderSeatAction(lobby, '未开局页面', '离座');
  assertTabRail(lobby, '未开局页面');
  assertDrawerClosed(lobby, '未开局页面');
  assert(
    lobby.includes('改名 / 换身份'),
    '未开局页面：常驻的「牌桌」页不见了（改名入口应当始终在页面上）'
  );

  // 4) 毡面必须是**四行格**（ADR-0020 及其修订）：
  //    ① 信息须（`data-felt-row="rail"`：定约 / 级牌 / 庄已抓 / 回溯那张类表格，No deal 时整块不渲染）；
  //    ② 顶行两张对手卡（`flex justify-between`，卡宽 w-36 / sm:w-44）；
  //    ③ 内容槽（`data-felt-row="slot"`，`min-h-0`，非座位层只能住在它里面）；
  //    ④ 底行的「我」那条底栏（`data-seat-bar="true"`，限宽 256px 居中）。
  //
  //    为什么不再断言「三张卡钉在四角且类是 absolute」：那是旧形状，三个 `top-*` 各算各的偏移，
  //    于是手机短屏上状态条压住埋底槽位、叫牌面板压住座位卡、托盘压住我的卡（ADR-0020）。
  //    现在「非座位层不会与座位行重叠」由四行格**结构**保证，几何由 shot 脚本实测。
  const feltRows = [...lobby.matchAll(/data-felt-row="([a-z]+)"/g)].map((match) => match[1]);
  assert(
    JSON.stringify(feltRows) === JSON.stringify(['rail', 'seats', 'slot', 'me']),
    `毡面不是「信息须 / 顶卡 / 内容槽 / 我的底栏」四行格，实际 [${feltRows.join(', ')}]`
  );
  const topRow = /<div[^>]*data-felt-row="seats"[\s\S]*?(?=<div[^>]*data-felt-row="slot")/.exec(lobby)?.[0] ?? '';
  const topCards = classAttrs(topRow).filter((value) => value.includes('rounded-2xl'));
  assert(
    topCards.length === 2,
    `毡面顶行应是两张对手卡，实际 ${topCards.length} 张：${topCards.map((c) => c.slice(0, 80)).join(' | ')}`
  );
  for (const value of topCards) {
    const found = positionClasses(value);
    assert(
      found.length === 0,
      `顶行的对手卡又自己定位了（[${found.join(' + ')}]）：它们是三行格的第一行，走正常文档流` +
        `（旧形状的三个 top-* 正是 #3 #5 那些重叠的来源）—— ${value.slice(0, 120)}`
    );
    assert(value.includes('w-36'), `顶行的对手卡没了固定宽度（缺 w-36）：${value.slice(0, 120)}`);
  }
  assert(
    (lobby.match(/data-seat-bar="true"/g) ?? []).length === 1,
    '毡面里应当恰好有一条「我」的底栏（data-seat-bar）'
  );
  assertNoPositionMix(lobby, '未开局页面');

  // 4b) 座位卡上的名字不许被裁剪。实测：名字与 36px 头像 + 级别徽标同处一行时，
  //     176px 的卡只剩 23.6px、`w-36` 的手机卡只剩 0px，而「机器人·小六」需要 76px ——
  //     卡上于是只画出「机…」，手机上干脆什么都看不到。这里只有 fetch、量不到几何（几何由浏览器
  //     走查量），所以守渲染出来的**形状**：**卡形态**的名字节点是
  //     `<p class="break-words text-sm font-semibold leading-tight">`，它的 class 里不许出现裁切类。
  //     （底栏形态是跨宽一行，用的是 `min-w-0 truncate` —— 那里截断是对的，所以不在这条判据里。）
  //     整页有 5 个卡形态的名字节点：毡面顶行 2 张 + 抽屉「牌桌」页里同款组件的 3 张（那一页常驻 DOM）。
  //     两边是同一份组件、同一条判据，所以一起断言；计数只做下限——判据一变就没人可查，守卫会空转。
  const nameNodesOf = (html: string): string[][] =>
    [...html.matchAll(/<p class="([^"]*)">([^<]{1,24})<\/p>/g)]
      .map((match) => [match[1] ?? '', match[2] ?? ''])
      .filter(([cls]) => /\btext-sm font-semibold leading-tight\b/.test(cls));
  const nameNodes = nameNodesOf(lobby);
  assert(
    nameNodes.length >= 2,
    `卡形态的座位名字节点应至少有 2 个（毡面顶行两张对手卡），实际 ${nameNodes.length} 个：` +
      '判据（类名组合）变了，这条守卫会空转'
  );
  for (const [cls, text] of nameNodes) {
    for (const forbidden of ['truncate', 'line-clamp', 'whitespace-nowrap', 'overflow-hidden']) {
      assert(
        !cls.includes(forbidden),
        `座位卡上的名字带了 ${forbidden}：窄卡上会被裁成「机…」（实测「机器人·小六」需要 76px）—— [${cls}] ${text}`
      );
    }
  }

  // 4c) 机器人座位：名字节点里必须是**全名**（带「机器人·」前缀），头像上是那枚内联 SVG。
  //     HTML 里一直是全名（当年被裁掉的是 CSS），所以这条抓的是**显示名被改短**，
  //     4b 抓的是**被裁**。机器人的那两个动作用不着在这一页断言 —— 它们搬进了抽屉的「牌桌」页
  //     （ADR-0020），由 `table-chrome.test.ts` 的源码守卫钉住。
  const botTable = (await fetch(`${BASE}/api/tables`, {
    method: 'POST',
    headers: { authorization: `Bearer ${players[0]!.credential}` }
  }).then((response) => response.json())) as { code: string };
  const botAdded = await fetch(`${BASE}/api/tables/${botTable.code}/bot`, {
    method: 'POST',
    headers: { authorization: `Bearer ${players[0]!.credential}` }
  });
  assert(botAdded.ok, `加机器人失败：${botAdded.status}`);
  const botLobby = await page(`/table/${botTable.code}`, players[0]!.credential);
  const botNames = nameNodesOf(botLobby).map(([, text]) => text ?? '');
  const botName = botNames.find((text) => text.startsWith('机器人'));
  assert(
    botName?.startsWith('机器人·') === true,
    `机器人卡上的名字不是全名（座位卡不许把「机器人·」前缀吃掉）：${JSON.stringify(botNames)}`
  );
  // 机器人的身份标记现在是**头像上那枚内联 SVG**（早先另有一行「机器人」徽标，那一行正是
  // 卡片偏高、进而压住状态条的原因，见 ADR-0020）。判据落在 SVG 与它的 aria-label 上。
  assert(
    botLobby.includes('aria-label="机器人"'),
    '机器人头像里没有那枚内联 SVG（aria-label="机器人"）：机器人身份就没有标记了'
  );
  assert(
    !botLobby.includes('>机器人</span>'),
    '座位卡又长出了「机器人」徽标行：它让卡片高出一整行（毡面重叠的来源）'
  );
  // 「请离」只该出现在抽屉「牌桌」页那一份里（常量 DOM），不该在毡面的座位卡上
  // —— 毡面里 2 张对手卡 + 1 条底栏共 3 处座位卡，抽屉里另有 3 处。
  assert(
    botLobby.includes('请离'),
    '整页里都找不到「请离」了：机器人没法请离（它应当只在抽屉「牌桌」页那一份里）'
  );
  console.log(
    `界面结构：毡面是「顶卡 / 内容槽 / 我的底栏」三行格，${nameNodes.length} 个卡形态名字节点都不裁剪，` +
      `机器人卡上是全名「${botName}」且头像是那枚内联 SVG`
  );

  // 5) 发牌后：仍是同一个「?」入口，但内容换成叫牌阶段；等待类提示与方位称谓都不该出现
  const dealt = await fetch(`${BASE}/api/tables/${code}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${players[0]!.credential}` },
    body: JSON.stringify({ action: { type: 'deal' } })
  });
  assert(dealt.ok, `发牌失败：${dealt.status}`);
  const auction = await page(`/table/${code}`, players[0]!.credential);
  assert(auction.includes('叫牌'), '发牌后页面没有进入叫牌界面');
  assertHelpTrigger(auction, '叫牌：定庄、定主', '叫牌页面');
  assertLeanHeader(auction, '叫牌页面');
  assertHeaderSeatAction(auction, '叫牌页面', '离座');
  assertTabRail(auction, '叫牌页面');
  assertDrawerClosed(auction, '叫牌页面');
  assertNoRemovedHints(auction, '叫牌页面');
  assertNoCompassLabels(auction, '叫牌页面');
  assert(!auction.includes('等待'), '叫牌页面仍有「等待」式常驻提示');
  assertNoPositionMix(auction, '叫牌页面');

  // 5a) 未发牌的大厅页没有计时（还没有「上个动作」可说），发牌后就有了，而且**真的在走**。
  //     走时这一条同时抓两件事：时钟冻住（恒 0）、单位写错（把毫秒当秒 → 一取就跳到几百秒）。
  assert(
    !lobby.includes('data-action-clock'),
    '未发牌的大厅页出现了「距上一步」计时：这一桌还没有任何牌局动作'
  );
  const beforeWait = clockSeconds(auction, '叫牌页面');
  const beforeFace = clockFaceText(auction, '叫牌页面');
  assert(beforeWait < 60, `刚发完牌就显示等了 ${beforeWait} 秒：计时没有从动作那一刻起算`);
  assert(
    beforeFace === String(beforeWait),
    `图标里的数字与那句话对不上：圆里写「${beforeFace}」，那句话读作 ${beforeWait} 秒`
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const laterPage = await page(`/table/${code}`, players[0]!.credential);
  const afterWait = clockSeconds(laterPage, '叫牌页面（1.2 秒后）');
  const afterFace = clockFaceText(laterPage, '叫牌页面（1.2 秒后）');
  assert(
    afterWait > beforeWait,
    `计时没有在走：1.2 秒前是 ${beforeWait} 秒，之后还是 ${afterWait} 秒（时钟冻住了？）`
  );
  assert(
    afterWait - beforeWait <= 5,
    `计时跳得太快：1.2 秒里从 ${beforeWait} 秒变成 ${afterWait} 秒（单位错了？）`
  );
  // 圆里那个**看得见的**数字也要跟着走 —— 只查 title 的话，冻住的时钟照样能过
  assert(
    afterFace !== beforeFace && afterFace === String(afterWait),
    `图标圆里的数字没有跟着走（前「${beforeFace}」后「${afterFace}」，那句话读到 ${afterWait} 秒）`
  );
  // 5b) 叫牌面板：还没人叫时有顶部大字位；头部只写「第 N 副」（发牌人文案已删 ——
  //     「发牌」这个词本身对新手不透明，谁先叫由轮次 chip 说清楚）。
  assert(auction.includes('还没人叫'), '叫牌面板顶部没有「还没人叫」大字位');
  assert(auction.includes('第 1 副'), '叫牌面板头部没有「第 1 副」');
  assert(
    !auction.includes('发牌'),
    '叫牌页面仍在写「发牌」：发牌人信息已从界面删除（谁先叫由「X 叫牌中 / 轮到你」表达）'
  );
  // 发牌人从**视图**里取而不是从文案里反查名字：首副发牌人是随机的，下面的叫牌脚本必须按它出手。
  const seatView = (await fetch(`${BASE}/api/tables/${code}/view`, {
    headers: { authorization: `Bearer ${players[0]!.credential}` }
  }).then((response) => response.json())) as { view: { deal: { dealerSeat: number } } };
  const dealerIndex = seatView.view.deal.dealerSeat;
  assert(
    auction.includes('叫牌中') || auction.includes('轮到你'),
    '叫牌面板没有标出当前轮到谁'
  );
  // 历史必须是三列表格：一行塞几个人不再由昵称长度决定
  const panelIdle = bidPanelMarkup(auction);
  assert(panelIdle.includes('<table'), '叫牌历史不是表格（昵称长度会决定一行塞几个人）');
  assert(
    thCount(panelIdle) === 3,
    `叫牌历史表头应是 3 列（三位玩家），实际 ${thCount(panelIdle)} 列`
  );
  // 此刻不一定是自己的轮次（发牌人随机），所以只看面板本身、不要求「不叫」在页面上
  const panelIdleReach = checkBidPanelReachability(auction, { requirePassButton: false });
  assert(panelIdleReach.ok, `叫牌面板不可达：${panelIdleReach.reason}`);

  // 5c) 轮到自己时：候选按钮是花色字形、「不叫」在页面里；随后 1 叫 + 2 pass 成交
  const dealerCred = players[dealerIndex]!.credential;
  const nextIndex = (dealerIndex + 1) % 3;
  await act(code, dealerCred, { type: 'bid', call: { points: 40, strain: 'C' } });
  const secondBidder = await page(`/table/${code}`, players[nextIndex]!.credential);
  assert(secondBidder.includes('轮到你'), '第二位叫牌人的页面没有「轮到你」');
  assertBidControls(secondBidder, '叫牌页面（轮到你）', [code]);
  // 「不叫」必须是历史滚动区之后、正常文档流里的页脚：不压住任何一行，也不会被顶出面板
  const panelMineReach = checkBidPanelReachability(secondBidder);
  assert(panelMineReach.ok, `轮到自己时「不叫」不可达：${panelMineReach.reason}`);
  for (const glyph of ['♣', '♦', '♥', '♠']) {
    assert(secondBidder.includes(glyph), `叫牌候选按钮里缺花色字形 ${glyph}`);
  }
  assert(secondBidder.includes('40♣'), `叫牌历史里应看到「40♣」，实际页面里没有`);
  // 候选区：**固定五槽**（♣ ♦ ♥ ♠ NT，不可叫的花色隐形占位、不补位）+ 跳叫触发钮。
  // 此刻最高叫品是 40♣（花色）⇒ 非跳叫档是 40、45 两档，第二档行末一枚「▶ 跳叫」；
  // 50 起属于跳叫，点开之前不出现在页面上（那张页面的 HTML 是未展开态）。
  const panelMine = bidPanelMarkup(secondBidder);
  for (const points of ['>40<', '>45<']) {
    assert(panelMine.includes(points), `候选档位缺 ${points}（最高 40♣ 时应摆 40、45 两档非跳叫）`);
  }
  assert(!panelMine.includes('>50<'), '候选区出现了 >50<：跳叫档位不该在点开触发钮之前出现');
  assert(
    panelMine.includes('data-bid-trigger="line"'),
    '候选区的触发形态不是 line（跳叫必须独立成行：挤在档位行里会把那一行的五个槽压窄）'
  );
  assert(panelMine.includes('▶ 跳叫'), '候选区没有跳叫触发钮（「▶ 跳叫」）');
  assert(panelMine.includes('>NT<'), '候选区第 5 槽不是 NT 字形（无主必须写成 NT）');
  const slotGuard = checkBidSlots(panelMine);
  assert(slotGuard.ok, `候选区固定五槽守卫没过：${slotGuard.reason}`);
  // 40♣ 之下：40 档只有 ♣ 不可叫（1 个隐形占位），其余 4 格 + 45 档 5 格 = 9 个可叫档位。
  // 数目对不上就说明槽位在补位（少一格）或多出了不存在的档位。
  const invisibleSlots = (panelMine.match(/data-bid-slot="invisible"/g) ?? []).length;
  assert(invisibleSlots === 1, `40♣ 之下应恰好 1 个隐形占位（40 档的 ♣），实际 ${invisibleSlots}`);
  const legalSlots = (panelMine.match(/data-bid-slot="legal"/g) ?? []).length;
  assert(legalSlots === 9, `固定五槽下应是 4 + 5 = 9 个可叫档位，实际 ${legalSlots}`);
  assert(thCount(panelMine) === 3, '叫牌历史表头不是 3 列（三位玩家）');
  await act(code, players[nextIndex]!.credential, { type: 'bid', call: 'pass' });
  await act(code, players[(dealerIndex + 2) % 3]!.credential, { type: 'bid', call: 'pass' });

  // 6) 埋底：庄家（= 发牌人）看得到「拿上来的底牌」那一行
  const bury = await page(`/table/${code}`, dealerCred);
  assert(bury.includes('确认埋底'), '成交后庄家页面没有进入埋底界面（缺「确认埋底」）');
  assert(
    clockSeconds(bury, '埋底页面') < 60,
    '埋底页面上的「距上一步」不是刚成交的那个动作（计时没跟着动作重置）'
  );
  assert(
    bury.includes('data-taken-kitty="true"'),
    '埋底页面没有把「拿上来的底牌」单独摆出来（底牌并进 20 张手牌后庄家认不出是哪三张）'
  );
  for (const glyph of ['♣', '♦', '♥', '♠']) {
    assert(bury.includes(glyph), `埋底页面缺花色字形 ${glyph}`);
  }
  const marked = (bury.match(/data-marked="true"/g) ?? []).length;
  // 手牌里 3 张标记 + 底牌行 3 张标记 = 6
  assert(marked === 6, `庄家埋底页面应有 6 处底牌标记（手牌 3 + 底牌行 3），实际 ${marked}`);
  const prow = (bury.match(/底牌 [123]/g) ?? []).length;
  assert(prow === 3, `底牌行应有 3 个可点按钮，实际 ${prow}`);
  // 6c) 埋底页的文案已经收敛：那三句都不再出现（说明在「?」里、动作提示在操作条上）
  for (const gone of ['你拿上来的底牌', '选 3 张扣入暗底', '庄家埋底中']) {
    assert(!bury.includes(gone), `埋底页面仍在写「${gone}」：这句已删`);
  }
  // 6d) 定约 / 级牌 / 庄已抓三个值都是**大号金数字**（小号 chip 被判为不显眼）
  const contractCell = contractMarkup(bury);
  assert(
    contractCell.includes('text-2xl'),
    `定约数字又缩回小号了（缺 text-2xl）：${contractCell.slice(0, 120)}`
  );
  // 「庄已抓」那一格：按**值格切片**判断（早先是「庄已抓」三个字往后数 200 字符 ——
  // 表格形状下那段距离里还有表头与另外两格，窗口判据会假红也会假绿）。
  const pointsCell = railCellMarkup(bury, 'points');
  assert(
    pointsCell.includes('text-2xl'),
    `「庄已抓」的分数不是大号数字（缺 text-2xl）：${pointsCell.slice(0, 120)}`
  );
  // 「分」不许掉到第二行（真机截图：25 下面单独一行「分」）：值格必须 nowrap
  assert(
    pointsCell.includes('whitespace-nowrap'),
    `「庄已抓」那一格没有 whitespace-nowrap：数字与「分」之间会断行（真机截过 25 下面单独一行「分」）：` +
      pointsCell.slice(0, 160)
  );
  const levelCell = railCellMarkup(bury, 'level');
  assert(
    levelCell.includes('text-2xl'),
    `「级牌」那一格不是大号数字（缺 text-2xl）：${levelCell.slice(0, 120)}`
  );
  // 6d2) 表头那行小字**不许回到 10px**：它是这张表唯一的说明（`回溯 / 定约 / 级牌 / 庄已抓`），
  //      10px 在手机上是可读下限之下；判据落在**出货的表头格**上，不是源码里那个常量。
  //      同一条里还要两样：上边距（第一行贴着圆角边线太挤，真机反馈过）与 nowrap
  //      （表头文字折成两行会让整块长高）。
  const headCell = /<th[\s>][^>]*>/.exec(bury)?.[0] ?? '';
  assert(headCell !== '', `页面里找不到信息须的表头格（<th>）：${headCell}`);
  assert(
    headCell.includes('text-[11px]'),
    `信息须的表头字号不是 11px（读不清等于表头不存在）：${headCell}`
  );
  assert(
    headCell.includes('pt-1.5'),
    `信息须的表头上边距不是 6px（第一行会贴着整块的上边线）：${headCell}`
  );
  assert(
    headCell.includes('whitespace-nowrap'),
    `信息须的表头没有 whitespace-nowrap（表头会折成两行）：${headCell}`
  );

  // 6d3) 信息须与「我」那条底栏取**同一个尺度**（`--rail-w`）：两块的宽度类都引用同一个变量，
  //      而那个变量在出货样式表里真的有值 —— 只断言其中一半（比如「底栏 ≤ 256px」）是量不到
  //      「两块一样宽」的，而两块宽度不等时上下框只是看起来差一点，不会报任何错。
  const railTag = /<table[^>]*data-info-rail[^>]*>/.exec(bury)?.[0] ?? '';
  assert(railTag !== '', `页面里找不到信息须那张表（data-info-rail）：${railTag}`);
  assert(
    railTag.includes('w-[var(--rail-w)]'),
    `信息须不是按 --rail-w 取宽的（缺 w-[var(--rail-w)]）：${railTag}`
  );
  const barTag = /<[a-z]+[^>]*data-seat-bar[^>]*>/.exec(bury)?.[0] ?? '';
  assert(barTag !== '', `页面里找不到「我」那条底栏（data-seat-bar）：${barTag}`);
  assert(
    barTag.includes('max-w-[var(--rail-w)]'),
    `「我」那条底栏不是按 --rail-w 取宽的（缺 max-w-[var(--rail-w)]）：${barTag}`
  );

  // 6b) 闲家看不到底牌：同一页没有底牌行，也没有任何标记
  const defenderIndex = nextIndex === dealerIndex ? (dealerIndex + 2) % 3 : nextIndex;
  const defender = await page(`/table/${code}`, players[defenderIndex]!.credential);
  assert(
    !defender.includes('data-taken-kitty="true"'),
    '闲家页面不该出现「拿上来的底牌」那一行（它对闲家必须是 null）'
  );
  assert(
    !defender.includes('data-marked="true"'),
    '闲家页面不该有任何底牌标记（拿上来的底牌对闲家必须是 null）'
  );

  // 7) 观战：满座后第 4 个人进入观战视图（同一套守卫，且不得出现任何玩家操作）
  //    此刻三人都在座（正在埋底），是最严格的时点：连底牌都不能漏出去
  const guest = await claim(`观战-${stamp}`);
  const refused = await fetch(`${BASE}/api/tables/${code}/seat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${guest.credential}` }
  });
  assert(refused.status === 400, `满座入座应被拒，实际 ${refused.status}`);
  const watching = await page(`/table/${code}`, guest.credential);
  assert(watching.includes('观战中'), '满座第 4 个人没有进入观战视图');
  assert(!watching.includes('开始第一副'), '观战页面仍渲染了开局按钮');
  assert(!watching.includes('不叫'), '观战页面出现了叫牌按钮');
  assert(!watching.includes('确认埋底'), '观战页面出现了埋底按钮');
  assert(
    !watching.includes('data-taken-kitty="true"'),
    '观战页面出现了庄家私有的「拿上来的底牌」那一行'
  );
  assert(!watching.includes('data-marked="true"'), '观战页面出现了底牌标记');
  assert(!/class="card[ "]/.test(watching), '观战页面渲染了牌（手牌或其他人的牌）');
  assert(watching.includes('改名 / 换身份'), '观战页面没有身份快捷编辑入口');
  assert(!watching.includes('补进了空座'), '观战页面出现了「接下手牌」提示（那是补位玩家的）');
  assertHelpTrigger(watching, '观战', '观战页面');
  assertLeanHeader(watching, '观战页面');
  assertHeaderSeatAction(watching, '观战页面', '改名');
  assertTabRail(watching, '观战页面');
  assertDrawerClosed(watching, '观战页面');
  assert(watching.includes('座位已满'), '观战页面没有说清座位已满（常驻的「牌桌」页里应当有）');
  assertNoRemovedHints(watching, '观战页面');
  assertNoCompassLabels(watching, '观战页面');
  assertNoPositionMix(watching, '观战页面');
  // 观战者：毡面的**行**一个不少（四行），但最后那一行里没有东西 —— 观战者没有座位，
  // 所以「我」那条底栏不渲染（行本身留着，行的顺序因此对谁都不变；空的 auto 行高度为 0）。
  const watchFeltRows = [...watching.matchAll(/data-felt-row="([a-z]+)"/g)].map((match) => match[1]);
  assert(
    JSON.stringify(watchFeltRows) === JSON.stringify(['rail', 'seats', 'slot', 'me']),
    `观战页面的毡面不是四行格（实际 [${watchFeltRows.join(', ')}]）：行的顺序对谁都不该变`
  );
  const watchTopRow =
    /<div[^>]*data-felt-row="seats"[\s\S]*?(?=<div[^>]*data-felt-row="slot")/.exec(watching)?.[0] ?? '';
  const watchCards = classAttrs(watchTopRow).filter((value) => value.includes('rounded-2xl'));
  assert(
    watchCards.length === 2,
    `观战页面顶行应是两张对手卡，实际 ${watchCards.length} 张：观战者没有座位，不该有「我」那张卡`
  );
  assert(
    (watching.match(/data-seat-bar="true"/g) ?? []).length === 0,
    '观战页面出现了「我」的底栏：观战者没有座位'
  );
  console.log('观战页面：无操作按钮、无牌面、无底牌标记，毡面仍是三行格但没有「我」那条底栏，「?」给的是观战说明');

  // 7b) 出牌阶段：动作托盘 / 跟牌蓝框 / 赢墩徽标 ---------------------------------
  //     埋底后由庄家领出、下家跟牌。牌面是随机发的，所以期望值一律从 `/view` 现算 ——
  //     写死花色的断言只能在某一种发牌下通过（等于空转）。
  const beforeBury = await viewOf(code, dealerCred);
  const buryDeal = beforeBury.view.deal;
  if (buryDeal === null) throw new Error('庄家此刻还没有牌局，无法进入出牌阶段');
  assert(buryDeal.phase === 'bury', `庄家此刻应处于埋底阶段，实际 ${buryDeal.phase}`);
  const trump = buryDeal.trump;
  if (trump === null) throw new Error('埋底阶段应当已经有将牌模型（定约已成交）');
  const own = beforeBury.you?.hand ?? [];
  const followerHand = (await viewOf(code, players[nextIndex]!.credential)).you?.hand ?? [];
  const countIn = (cls: string): number =>
    followerHand.filter((card) => cardClass(card, trump) === cls).length;
  // 领出「下家手上有牌」的那一门：既贴近真实打法，也让下面「蓝框数 = 该门张数」不落空
  const lead = [...own].sort((a, b) => countIn(cardClass(b, trump)) - countIn(cardClass(a, trump)))[0]!;
  const ledClass = cardClass(lead, trump);
  const expectedMarks = countIn(ledClass);
  assert(
    expectedMarks > 0,
    `下家在能领的每一门上都缺门（极罕见的发牌，${ledClass} 一张没有）：这次验证不了跟牌蓝框，重跑即可`
  );

  /** 替「该出牌的那个座位」出一张合法牌：座位从视图现算，牌面走引擎的 checkPlay（与界面同一份规则） */
  async function playOneLegalCard(): Promise<void> {
    const turn = (await viewOf(code, dealerCred)).view.deal?.playTurn ?? null;
    assert(turn !== null, '当前不在出牌阶段（playTurn 为 null）');
    const credential = players[turn]!.credential;
    const state = await viewOf(code, credential);
    const hand = state.you?.hand ?? [];
    const plays = state.view.deal?.trick?.plays ?? [];
    const leadCards = plays.length > 0 ? plays[0]!.cards : null;
    const card = hand.find((candidate) => checkPlay(hand, [candidate], trump, leadCards) === null);
    assert(card !== undefined, `座位 ${turn} 手里找不到一张合法出牌`);
    await act(code, credential, { type: 'play', cards: [card] });
  }

  // 埋底时避开要领出的那张，再打出它（单张领出恒合法）
  await act(code, dealerCred, {
    type: 'bury',
    cards: own.filter((card) => cardKey(card) !== cardKey(lead)).slice(0, 3)
  });
  await act(code, dealerCred, { type: 'play', cards: [lead] });

  const follower = await page(`/table/${code}`, players[nextIndex]!.credential);
  const tray = actionTrayMarkup(follower);
  assert(
    tray !== null,
    '跟牌者页面没有动作托盘（`data-action-tray`）：托盘要么丢了，要么被包回了别的层'
  );
  // 形状守卫：托盘**在流内**、单行、宽度取 max-content。旧形状（外层 `absolute inset-0` +
  // 居中 + z-30，钉在操作条上方那条 44px 带子里）已经撤掉（ADR-0020 修订）——
  // 它现在住在操作条那一行里，所以**必须不是**绝对定位：一旦浮起来就会压住毡面最后一行。
  assert(
    !tray.includes('absolute') && !tray.includes('inset-0') && !tray.includes('z-30'),
    `动作托盘又变成漂浮的一层（absolute / inset-0 / z-30）：它会压住毡面最后一行（「我」那条底栏）——${tray.slice(0, 160)}`
  );
  assert(
    !tray.includes('bottom-full') && !tray.includes('-translate-y-1/2'),
    `动作托盘又回到旧锚（bottom-full / 垂直居中）了：它会压在毡面的最后 40px 里盖住「我」那条底栏 ——${tray.slice(0, 160)}`
  );
  // 宽度：宽度 auto 时 shrink-to-fit 只有半个容器可用，flex 子项被压缩，
  // 而 CJK 可以在任意字间断行 ——「出 牌」「清 空」于是竖排（截图里那次返工）。
  assert(
    follower.includes('w-max'),
    `动作托盘的根节点缺少 w-max：宽度会被压成半个容器，子项被压缩后「出 牌」会竖排 ——${tray.slice(0, 160)}`
  );
  // 操作条那一行：托盘住在它里面，所以它必须带钩子、且与毡面零相交（几何那半在 shot 里量）
  assert(
    /data-action-row="true"/.test(follower),
    '页面里没有操作条那一行的钩子（data-action-row）：托盘没了落点'
  );
  const trayBlock = actionTrayBlock(follower);
  assert(trayBlock !== null, '取不到动作托盘的整块 HTML（data-action-tray 那一层）');
  const trayButtons = (trayBlock ?? '').match(/<button[^>]*>/g) ?? [];
  assert(
    trayButtons.length >= 2,
    `动作托盘里只有 ${trayButtons.length} 个按钮：出牌与清空都该在这一条里`
  );
  for (const button of trayButtons) {
    assert(
      button.includes('whitespace-nowrap'),
      `动作托盘的按钮没有 whitespace-nowrap：被压缩时「出 牌」「清空」会竖排成两行 ——${button.slice(0, 140)}`
    );
  }
  assert(follower.includes('出 牌'), '跟牌者页面没有出牌按钮');
  // 徽标只报「这 N 分归庄方还是闲方」，不许回潮成「上一轮 · 赢墩 +N 分」。
  // 判的是**那一句徽标文案**，不是「上一轮」这四个字 —— 它另有正当去处：信息须上那枚回看入口
  // （收墩后出现，见下面两条）。把整页的「上一轮」一律禁掉会让新入口一起被判红。
  for (const gone of ['上一轮 · 赢墩', '赢墩 +']) {
    assert(!follower.includes(gone), `出牌页面还在写「${gone}」：徽标只报这 N 分归庄方还是闲方`);
  }
  // 还没收墩 ⇒ 没有「上一轮」可回看：那枚按钮必须**在**（表格不缺一角），但必须是禁用的灰按钮
  const earlyReview = reviewButton(follower, '跟牌者页面（首轮）');
  assert(earlyReview.disabled, '还没收墩时「上一轮」按钮是可点的：它指向一墩不存在的牌');
  assert(
    !earlyReview.tag.includes('pointer-events-auto'),
    '还没收墩时那枚灰按钮还带着 pointer-events-auto：它会让禁用态看起来像能点'
  );
  const marks = (follower.match(/data-marked="true"/g) ?? []).length;
  assert(
    marks === expectedMarks,
    `跟牌蓝框数不对：页面 ${marks} 处，下家手里领出门 ${ledClass} 实为 ${expectedMarks} 张`
  );

  // 不是自己回合的人：没有托盘，但**照样有该跟那一门的蓝框** —— 这是**拟选**（ADR-0021）：
  // 有人领出之后，在座的每个人都能提前点牌想好要出什么，而「该跟哪一门」正是要提前看的事。
  // 第三家手里的领出门张数从 `/view` 现算（与上面那条同一套算法，不写死花色）。
  const idleCred = players[(nextIndex + 1) % 3]!.credential;
  const idleHand = (await viewOf(code, idleCred)).you?.hand ?? [];
  const idleMarks = (await page(`/table/${code}`, idleCred)).match(/data-marked="true"/g) ?? [];
  const idle = await page(`/table/${code}`, idleCred);
  assert(!idle.includes('data-action-tray="true"'), '没轮到的人页面上出现了动作托盘（托盘只该在该你出手时出现）');
  const idleExpected = expectedMarks === 0 ? 0 : idleHand.filter((card) => cardClass(card, trump) === ledClass).length;
  assert(
    idleMarks.length === idleExpected,
    `没轮到的人（第三家）手上的蓝框数不对：页面 ${idleMarks.length} 处，他手里领出门 ${ledClass} 实为 ${idleExpected} 张` +
      '（拟选要求「有人领出后，在座的人都能看到该跟哪一门」）'
  );
  assert(idle.includes('出牌中'), '没轮到的人页面上没有「X 出牌中」的状态句');
  // 拟选还要能**点得动**：手牌容器必须带 selectable（否则点了没有任何反应）
  assert(
    idle.includes('fan selectable'),
    '没轮到的人的手牌不是可点的（缺 `.fan.selectable`）：拟选点了没反应'
  );

  // 观战者在出牌阶段也拿不到蓝框（那是手牌信息），但「距上一步」是公开的，观战者照样看得到
  const watchPlay = await page(`/table/${code}`, guest.credential);
  assert(!watchPlay.includes('data-marked="true"'), '观战页面在出牌阶段出现了手牌标记');
  assert(!watchPlay.includes('data-action-tray="true"'), '观战页面出现了动作托盘');
  assert(
    clockSeconds(watchPlay, '观战页面（出牌阶段）') < 60,
    '观战页面的「距上一步」不是刚领出的那个动作：计时对观战者不生效或没跟着动作走'
  );

  // 收完这一墩：徽标只说这 N 分归哪一方 —— 「庄 +N 分」或「闲 +N 分」
  await playOneLegalCard();
  await playOneLegalCard();
  const afterTrick = await page(`/table/${code}`, dealerCred);
  const badge = /(庄|闲) \+\d+ 分/.exec(afterTrick);
  assert(badge !== null, '收墩后没有出现「庄/闲 +N 分」的赢墩徽标');
  assert(!afterTrick.includes('赢墩'), '收墩后的徽标里又出现了「赢墩」');
  // 收墩后必须能回看这一墩：bot 出手只有 0.5–1.5 秒，赢家立刻领出下一轮，毡面出牌区只剩当前墩
  // —— 上一墩的三家出牌只有这枚入口找得回来（浮层本身是客户端那一帧才渲染的，见源码守卫）。
  const lateReview = reviewButton(afterTrick, '收墩后');
  assert(!lateReview.disabled, '收墩后「上一轮」按钮仍然是禁用的：回看入口点不动了');
  assert(
    lateReview.tag.includes('pointer-events-auto'),
    '收墩后的「上一轮」按钮缺 pointer-events-auto：整块须让开点击，按钮会看得见点不到'
  );
  assert(
    !afterTrick.includes('data-trick-review'),
    '回看浮层出现在 SSR 首帧：它默认应当是关闭的（否则每次进桌都盖住毡面）'
  );
  console.log(
    '出牌阶段：动作托盘住在操作条那一行里（在流内、单行、宽度 max-content —— 不再有 44px 动作带）；'
      + `跟牌蓝框 ${marks} 处 = 下家领出门张数；收墩徽标「${badge[0]}」；`
      + '收墩后信息须上出现「上一轮」回看入口（浮层默认关着）'
  );

  // 7e) 一副结束时的三拍（ADR-0022）：把这一副**打完**，在出货产物上验第一拍。
  //
  //     为什么必须打到结算：改动前 `summary !== null` 就弹窗，而弹窗是 `fixed inset-0 z-50`
  //     —— 一收墩就盖住毡面，末墩与底牌都来不及看。第一拍（看清末墩的 2.0 秒）里，
  //     出货 HTML 必须**没有**那个弹窗、**没有**亮底牌那一层，而操作条那一行里要有
  //     「看底牌 »」这个入口，并且「下一副」是**禁用**的（`nextDealReady` 在首帧为假）。
  //     真实时间轴（2.0s → 3.2s → 弹窗）由 `scripts/shot-auction.ts` 的带浏览器场景实测，
  //     这一层只能看首帧那一份 HTML，所以它守的是「首帧不是弹窗」与「锁上的按钮真的是禁用的」。
  for (let step = 0; step < 80; step += 1) {
    const state = await viewOf(code, dealerCred);
    if (state.view.deal?.phase !== 'play') break;
    await playOneLegalCard();
    if (step === 79) assert(false, '打了 80 张牌还没结算：出牌循环没有收敛');
  }
  const scoredPage = await page(`/table/${code}`, dealerCred);
  assert(scoredPage.includes('data-pacing-skip'), '结算阶段的出货 HTML 里没有三拍的入口（缺 data-pacing-skip）');
  assert(
    scoredPage.includes('看底牌 »'),
    '结算首帧的跳过按钮写的是别的字：第一拍该是「看底牌 »」（第二拍才是「看结算 »」）'
  );
  assert(
    !scoredPage.includes('data-kitty-reveal'),
    '结算首帧就摊开了底牌：第二拍（3.2 秒）被吃掉，底牌与末墩挤在同一拍里'
  );
  assert(
    !scoredPage.includes('data-deal-summary'),
    '结算弹窗出现在首帧：一收墩就弹，末墩与底牌都被弹窗盖住（这正是 ADR-0022 要修的）'
  );
  assert(scoredPage.includes('结算详情'), '结算阶段没有「结算详情」入口：弹窗关掉之后玩家读不到结算');
  const nextDeal = /<button[^>]*data-next-deal="true"[^>]*>/.exec(scoredPage)?.[0];
  assert(nextDeal !== undefined, '结算阶段的操作条行里没有「下一副」（缺 data-next-deal）');
  assert(
    /\bdisabled\b/.test(nextDeal),
    '结算首帧「下一副」就是可点的：跳过的人能在 ~0 秒开下一副，把别人正在看的末墩与底牌切走'
  );
  console.log(
    `结算三拍（出货 HTML）：首帧有「看底牌 »」入口、无亮底牌层、无弹窗，`
      + `且「下一副」带 disabled=${/\bdisabled\b/.test(nextDeal)}`
  );

  // 8) 教程页：新版面跑同一套 position 守卫，且小节与真实牌面都在
  const rules = await page('/rules');
  assertNoPositionMix(rules, '教程页');
  assert(!/[东南西]/.test(rules), '教程页仍出现方位称谓');
  for (const id of ['start', 'points', 'trump', 'auction', 'bury', 'play', 'inference', 'scoring', 'spectate']) {
    assert(rules.includes(`id="${id}"`), `教程页缺小节 ${id}`);
  }
  const ruleCards = (rules.match(/class="card[ "]/g) ?? []).length;
  assert(ruleCards >= 20, `教程页渲染的真实牌面过少（${ruleCards} 张），教程应复用牌组件而不是画方块`);

  // 8) 王牌面：牌名只出现在两处角落索引里，正中是一枚图案（☀ / ☾）。
  //    两次反例都守在这里：角落里写「大/小」而正中只写一个「王」（读成两张牌），
  //    以及角落与正中都写名字（一张牌上「小王」重复三遍）。
  for (const [name, rank, pip] of [
    ['小王', '小', '☾'],
    ['大王', '大', '☀']
  ] as const) {
    const at = rules.indexOf(`aria-label="${name}"`);
    assert(at >= 0, `教程页没有渲染「${name}」的牌面`);
    const card = rules.slice(at, rules.indexOf('</button>', at));
    assert(
      new RegExp(`<span class="pip joker">${pip}</span>`).test(card),
      `${name} 的牌面正中不是图案 ${pip}：${card.slice(0, 160)}`
    );
    // 左上角与右下角（镜像）索引都必须把名字写全，否则单看角标认不出这张牌
    const corners = card.match(/<span class="idx(?: br)?"><span>[^<]+<\/span>\s*<i>[^<]+<\/i><\/span>/g) ?? [];
    assert(
      corners.length === 2,
      `${name} 应有 2 处角落索引（左上 + 右下镜像），实际 ${corners.length} 处：${card.slice(0, 200)}`
    );
    for (const corner of corners) {
      assert(
        corner.includes(`<span>${rank}</span>`) && corner.includes('<i>王</i>'),
        `${name} 的角落索引没有写出「${rank}王」：${corner}`
      );
    }
  }
  assert(
    !/<span class="pip joker">[^<]*[大小王][^<]*<\/span>/.test(rules),
    '王牌正中又出现了文字名（回归：一张牌上重复三遍名字）'
  );
  // 两张王的图案必须不同，否则一眼分不出大小
  const jokerPips = new Set((rules.match(/<span class="pip joker">([^<]+)<\/span>/g) ?? []).map((s) => s));
  assert(jokerPips.size === 2, `王牌正中的图案应有 ☀ 与 ☾ 两种，实际 ${jokerPips.size} 种`);

  // 9) 角点已从出货产物里消失：牌角不再有装饰圆点；主牌改成**浅金底**，叫牌阶段另有更浅一档的级牌候选
  const cssHref = cssHrefOf(rules);
  const css = await asset(cssHref);
  // 信息须与「我」那条底栏的那个**共同尺度**必须在出货样式表里真有值：
  // 两边的类都引用 `var(--rail-w)`（上面 6d3 已断言），但如果变量本身丢了，
  // `width: var(--rail-w)` 会退化成 `auto` —— 两块又各自按内容撑开，而且谁都不会报错。
  // **两档都要在**：值那一档数字在 `sm` 上从 20px 长到 24px，最宽的内容（`100♣ / 100 分`）
  // 只有在桌面档（18rem）里才放得下；少一档就会有某一屏把「分」挤出去。
  assert(
    /--rail-w:\s*16rem/.test(css) && /--rail-w:\s*18rem/.test(css),
    `出货样式表里缺少 --rail-w 的两档值（基准 16rem / sm 18rem）：${cssHref}`
  );
  assert(css.includes('.card.trump'), `样式表里找不到 .card.trump（抓到的可能不是牌面样式：${cssHref}）`);
  assert(css.includes('.card .pip'), '样式表里找不到 .card .pip（正对照失败）');
  assert(!css.includes('.card.pt'), '出货样式表里仍有分牌角点 .card.pt');
  assert(!/\.card\.trump:{1,2}after/.test(css), '出货样式表里仍有主牌角点 .card.trump::after');
  // 2.4) 主牌的金边已改成底色：`.card.trump` 只许改 background，不许再动边框颜色
  const trumpRule = /\.card\.trump\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert(trumpRule.includes('background'), `.card.trump 没有底色（主牌应走浅金底）：${trumpRule}`);
  assert(
    !trumpRule.includes('border-color'),
    `.card.trump 仍在改边框颜色（主牌金边应已全部改成底色）：${trumpRule}`
  );
  assert(
    css.includes('.card.rank-hint'),
    '样式表里找不到 .card.rank-hint（叫牌阶段「可能成为级牌」的更浅一档金底）'
  );
  // 9b) 出牌按钮与底牌标记的样式必须真的出货（源码改了但产物没重建，一样会漏）
  assert(css.includes('.play-btn'), '出货样式表里找不到 .play-btn（出牌按钮没有防遮挡层级）');
  assert(/\.play-btn\{[^}]*z-index:20/.test(css), '出货样式表里 .play-btn 没有 z-index:20（会被上浮的手牌盖住）');
  assert(
    /\.play-btn\{[^}]*min-height:36px/.test(css),
    '出货样式表里 .play-btn 不是 36px 命中高度（又回到又高又胖的 44px，或缩成点不中的细条）'
  );
  assert(
    css.includes("[data-marked='true']") || css.includes('[data-marked=true]'),
    '出货样式表里找不到底牌标记 [data-marked]'
  );
  // 9c) 悬停上浮只能是鼠标设备的规则（手指设备上 :hover 会粘住，看起来像牌收不回去）
  assert(
    /@media\(hover:hover\)and \(pointer:fine\)[^{]*\{\.fan\.selectable \.card:hover/.test(css),
    '悬停上浮没有包在 @media (hover:hover) and (pointer:fine) 里'
  );
  // `transition: none` 不算位移过渡 —— 「减少动态效果」那一块正是要把它关掉；
  // 会动的值（transform / box-shadow…）才必须待在鼠标设备的媒体查询里。
  assert(
    !/(^|})\s*\.card\{[^}]*transition\s*:\s*(?!none)/.test(css),
    '卡片位移过渡没有限定在鼠标设备（手指设备上点选会有残留位移）'
  );
  // 9d) 活页签抽屉的样式必须真的出货：抽屉靠 translate-x-full 滑出屏幕、页签靠 writing-mode 竖排。
  //     HTML 里带着这个类名**不等于**产物里有这条规则 —— 少了前者抽屉会一直盖在牌桌上，
  //     少了后者四个页签会横排、把右边缘撑破。这一条守的是「产物没重建 / 规则没生成」。
  assert(
    /\.translate-x-full\{[^}]*translate:/.test(css),
    '出货样式表里 .translate-x-full 没有位移规则（抽屉关不上，会一直盖着牌桌）'
  );
  assert(
    /\.\\\[writing-mode\\:vertical-rl\\\]\{[^}]*writing-mode:vertical-rl/.test(css),
    '出货样式表里没有 writing-mode:vertical-rl（页签会横排，撑破右边缘）'
  );
  // 9e) 断线提示条的底色也必须真的出货。它只活在 offline 态 —— SSR 守卫抓不到那个态
  //     （只能断言它**不**出现），所以配色这一半只能守样式表：少了这条规则，提示条会
  //     退化成一段没有底色的浅色文字，而「牌桌为什么冻住了」就没人说了。
  assert(
    /\.bg-amber-400\\\/15\{/.test(css),
    '出货样式表里找不到断线提示条的底色 .bg-amber-400/15（提示会失去告警观感）'
  );

  // 10) 规则演示页（/learn）：新版面同样跑 position 守卫，并守住幻灯机的骨架与牌局章
  const learn = await page('/learn');
  assertNoPositionMix(learn, '规则演示页');
  assert(!/[东南西]/.test(learn), '规则演示页出现方位称谓');
  assert(learn.includes('aria-roledescription="幻灯片"'), '演示页缺少「幻灯片」语义');
  assert(learn.includes('自动播放'), '演示页没有自动播放按钮');
  assert(learn.includes('规则演示'), '演示页没有章节入口');
  assert(learn.includes('href="/rules"'), '演示页没有指向文字教程的入口');
  assert(
    /aria-label="第 \d+ 屏，共 \d+ 屏/.test(learn),
    `演示页每屏没有「第 n 屏，共 N 屏」的 aria-label：${learn.slice(0, 200)}`
  );
  assert(bareStrainLetters(learn).length === 0, `演示页出现裸花色字母：${bareStrainLetters(learn).join(', ')}`);

  /** 三家手牌横条上报的张数（服务端渲染出来的 `data-seat-total`） */
  const seatTotals = (html: string): number[] =>
    [...html.matchAll(/data-seat-total="(\d+)"/g)].map((match) => Number(match[1]));

  // 10b) 深链直接落在牌局某一墩：必须带着真实牌面服务端渲染出来（不是先给封面再靠 JS 跳）
  const trickSlide = await page('/learn?s=245-trick-8');
  assert(trickSlide.includes('第 8 墩'), '深链没有直接渲染出指定的那一屏');
  const trickCards = (trickSlide.match(/class="card[ "]/g) ?? []).length;
  assert(trickCards >= 6, `深链的那一墩至少要有 6 张牌面（三家各一手 + 底牌），实际 ${trickCards}`);
  assert(trickSlide.includes('本墩'), '牌局章没有写出这一墩的信息');
  assertNoPositionMix(trickSlide, '牌局章深链页');
  // 结算屏也是深链：必须把算式与升级都渲染出来
  const settleSlide = await page('/learn?s=245-settle');
  assert(settleSlide.includes('打成') || settleSlide.includes('打输'), '结算屏没有写打成/打输');
  assert(/升 \d+ 级/.test(settleSlide), '结算屏没有写升级级数');

  // 10c) 三家当前的牌：叫牌屏与出牌屏都要能看到，且张数随出牌递减到 0
  const same = (values: readonly number[], expected: readonly number[]): boolean =>
    values.length === expected.length && values.every((value, index) => value === expected[index]);
  const bidSlide = await page('/learn?s=245-bid-1');
  assert(same(seatTotals(bidSlide), [17, 17, 17]), `叫牌屏三家应当各 17 张：${seatTotals(bidSlide).join(', ')}`);
  const earlySlide = await page('/learn?s=245-trick-1');
  assert(
    same(seatTotals(earlySlide), [13, 13, 13]),
    `第 1 墩打完三家应当各剩 13 张：${seatTotals(earlySlide).join(', ')}`
  );
  assert(
    same(seatTotals(trickSlide), [0, 0, 0]),
    `最后一墩打完三家应当空了：${seatTotals(trickSlide).join(', ')}`
  );
  assert(trickSlide.includes('牌就出完了'), '最后一墩没有说明这副牌的牌已经出完');
  // 单位不能丢：写成「主 3」也能过 `主 \d+`，读者却不知道那是「3 张」
  assert(/主 \d+ 张/.test(bidSlide), `手牌横条没有写清主牌张数（要带「张」）：${bidSlide.match(/主\s*\d+\s*张?/)?.[0]}`);
  assert(bidSlide.includes('叫牌阶段'), '叫牌屏没有说明这是叫牌阶段的手牌');

  // 11) 入口：大厅指向演示页，教程页指向演示页（互链不能单边）
  const home = await page('/', players[0]!.credential);
  assert(home.includes('href="/learn"'), '大厅没有指向规则演示的入口');
  assert(rules.includes('href="/learn"'), '文字教程页没有指向规则演示的入口');

  console.log('界面结构：position 工具类无混用，毡面是「顶卡 / 内容槽 / 我的底栏」三行格（顶行两张对手卡，不再各自绝对定位）');
  console.log('文案：邀请码可点复制，常驻提示已清空，? 按阶段给说明，界面无方位称谓');
  console.log(`教程：9 个小节齐备（含观战与离座），渲染 ${ruleCards} 张真实牌面；大小王牌面自洽（名字只在角落，正中是 ☀/☾）`);
  console.log(`牌面：出货样式表 ${cssHref} 已无角点（.card.pt / .card.trump::after），主牌走浅金底、级牌候选更浅一档`);
  console.log(
    '叫牌：叫品一律花色字形（无裸字母）、顶部有最高叫品大字、历史表是面板里唯一的滚动区，'
      + '「不叫」排在它之后的正常文档流里（不是 sticky：sticky 会浮在最后一行叫牌上）'
  );
  console.log('底牌：庄家埋底页有「拿上来的底牌」那一行 + 6 处标记；闲家与观战页 0 处标记');
  console.log('触控：悬停上浮只在鼠标设备生效；出牌按钮 .play-btn 带 z-index:20');
  console.log('页头：大厅 / 邀请码 + 右上角桌况簇（观战人数含 0 常显；在座离座、不在座改名+入座），连接圆点已下线、断线提示不在首帧出现；战报/叫牌/底牌/牌桌 四项页签常驻右边缘，抽屉默认 inert');
  console.log('抽屉：查阅面进抽屉、动作面留桌面；「牌桌」页常驻 SSR（改名/换身份与座位已满始终在页面上）');
  console.log(`演示：/learn 有幻灯片语义与自动播放；深链 ?s=245-trick-8 直接渲染出 ${trickCards} 张真实牌面；大厅与文字教程都指向它`);
  console.log(`牌局章：三家当前的牌随出牌递减（叫牌 17/17/17 → 第 1 墩 13/13/13 → 末墩 0/0/0），出牌与手牌之间有配对过渡`);
  console.log('UI OK');
}

main().catch((error: unknown) => {
  console.error('UI FAILED:', error instanceof Error ? error.message : error);
  // 用 exitCode 而非 process.exit：后者在 Windows 上可能打断仍在收尾的 async 句柄
  process.exitCode = 1;
});
