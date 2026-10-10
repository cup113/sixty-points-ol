/**
 * 竞叫面板**验收截图**：把叫牌面板的四种场景与「▶ 跳叫」展开态拍成 PNG，供人工验收。
 *
 * 为什么不是一个「打开页面截个图」的命令：
 * 1. 面板按**座位身份**渲染（个人视图走 cookie），而且场景要一步步叫出来 —— 没人叫 / 最高 40♥ /
 *    最高 40♠ / 最高 40NT 四种「前一个人叫什么」的状态，只能靠 REST 推动叫牌到那一步；
 * 2. 因此脚本自己起一个服务端（vite dev，SSR 与产物同源）→ 用 REST 把局面推到位 →
 *    驱动无头 Chromium 逐场景截图。
 *
 * 为什么不跑 build 产物：产物里 `esm-env` 这类 kit 的间接依赖在本机（pnpm 用 junction、Node 不
 * realpath）会被 external 化，`node build/index.js` 当场解析失败 —— 那是本机的解析环境问题，
 * 与 UI 无关；截图要的是渲染结果，dev 的 SSR 与产物逐字同源。
 *
 * 浏览器走 CDP 而不是 Playwright：仓库没有 Playwright 依赖，而 Node 24 自带 WebSocket，
 * 连 CDP 只需要几个命令（Network.setCookie / Page.navigate / Page.captureScreenshot），
 * 不值得为此给仓库加一个重依赖。Chromium 复用本机 playwright 装好的那份（自动找 newest）。
 *
 * 运行：pnpm shot                 （脚本自己拉一个 vite dev，截图写到 apps/web/.shots/）
 *       pnpm shot http://host:port （对着已经在跑的服务端截图）
 * 产物：apps/web/.shots/*.png（目录已在 .gitignore 里）
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardClass,
  cardKey,
  cardLevel,
  checkPlay,
  classOfSet,
  isRun,
  type Card,
  type TrumpModel
} from '@sixty/engine';
import { spotWidthPct } from '../src/lib/fan-layout.ts';

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const webRoot = resolve(here, '..'); // apps/web
/** 截图产物放这里（在 .gitignore 里），交付给人看的就是这些 PNG */
const outDir = resolve(webRoot, '.shots');
/**
 * 运行期状态（浏览器 profile、sqlite 库、服务端日志）一律放**系统临时目录**，不放 .shots：
 * vite 会 watch 整个项目根，而浏览器 profile 里的 Cookies 是被 Chrome 锁住的文件，
 * 一被 watch 到就 `EBUSY` 把 dev server 整根掀掉（实测：服务起来了、几秒后崩），
 * sqlite 的 -wal/-shm 同理一直在动。
 */
const workDir = mkdtempSync(join(tmpdir(), 'sixty-shot-'));

interface Credential {
  readonly name: string;
  readonly credential: string;
}

let base = '';

/**
 * 带重试的请求：vite dev 在**首次请求**时做依赖预构建，构建完会重启一次 dev server，
 * 正在飞的那条请求就被 reset（ECONNRESET）。所以起完服务先热两次（见 `warmUp`），
 * 之后仍允许重试 —— 这里的重试是安全的：库是 `.shots/` 下的一次性库，而 ECONNRESET 意味着
 * 请求死在了重启窗口里（服务端没处理它）。
 */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(`请求失败：${url}`);
}

/** 热启动：连续两次取到首页才算稳定（避开依赖预构建那次重启） */
async function warmUp(): Promise<void> {
  let stable = 0;
  for (let i = 0; i < 20 && stable < 2; i += 1) {
    try {
      stable = (await apiFetch(`${base}/`)).ok ? stable + 1 : 0;
    } catch {
      stable = 0;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (stable < 2) throw new Error(`服务端 ${base} 起不来或反复重启`);
}

/* ---------- 起服务端与浏览器 ---------- */

async function freePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolvePort(port) : reject(new Error('拿不到空闲端口'))));
    });
  });
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // 还没起来：继续等
    }
    if (Date.now() > deadline) throw new Error(`等待「${label}」超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** 断言：失败就把这一条版面判据连同实测数字一起报出来 */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 起服务端：脚本自己拉一个 vite dev（SSR 与产物同源），不依赖外部先把服务跑起来 */
async function startServer(): Promise<{ process: ChildProcess | null; port: number }> {
  const given = process.argv.slice(2).find((arg) => arg.startsWith('http'));
  if (given !== undefined) {
    base = given.replace(/\/$/, '');
    await warmUp();
    return { process: null, port: new URL(base).port === '' ? 80 : Number(new URL(base).port) };
  }
  // 起 vite 必须用**真实路径**：pnpm 在 node_modules 里放的是 junction，Node 从 junction 路径
  // 解析 vite 自己的依赖（rollup 等）时找不到（那些在 .pnpm/<pkg>/node_modules 下），
  // 报 ERR_MODULE_NOT_FOUND。realpath 之后解析链才是它们在磁盘上的真实位置。
  const vite = realpathSync.native(resolve(webRoot, 'node_modules/vite/bin/vite.js'));
  if (!existsSync(vite)) throw new Error(`找不到 ${vite}：先在 apps/web 里 pnpm install`);
  const port = await freePort();
  // 服务端的输出落到文件而不是 pipe：一是沙箱里 piped stdio 会 EPERM，二是起不来时
  // 报错必须能带上它自己的那句话（否则只剩「超时」这种没信息量的失败）。
  const logPath = join(workDir, 'vite-dev.log');
  const logFd = openSync(logPath, 'w');
  // --host 127.0.0.1：vite 的默认 host 是 `localhost`，在本机可能只绑到 ::1，
  // 而这里（以及后面的浏览器）一律用 127.0.0.1 —— 不显式钉住就会「服务起来了但连不上」。
  const child = spawn(
    process.execPath,
    [vite, 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: webRoot,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, SIXTY_DB: join(workDir, 'acceptance.db') }
    }
  );
  base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(async () => (await apiFetch(`${base}/`)).ok, 'vite dev 启动');
    await warmUp();
  } catch (error) {
    const tail = readFileSync(logPath, 'utf8').split('\n').slice(-25).join('\n');
    child.kill();
    throw new Error(`${String(error)}\nvite dev 的输出（${logPath}）：\n${tail}`);
  }
  return { process: child, port };
}

/** 本机 playwright 装好的 Chromium：版本号带后缀，取最新的那一份 */
function chromiumPath(): string {
  const root = join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright');
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .map((name) => join(root, name, 'chrome-win64', 'chrome.exe'))
    .filter((path) => existsSync(path));
  const newest = candidates[candidates.length - 1];
  if (newest === undefined) throw new Error(`在 ${root} 里找不到 Chromium（chrome-win64/chrome.exe）`);
  return newest;
}

async function startChrome(): Promise<{ process: ChildProcess; port: number }> {
  const port = await freePort();
  const child = spawn(
    chromiumPath(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      // 页面动画（pts-pop 等）会污染截图：统一按「减少动态效果」渲染
      '--force-prefers-reduced-motion',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(workDir, 'chrome-profile')}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok,
    'Chromium 启动'
  );
  return { process: child, port };
}

/* ---------- 最小 CDP 客户端 ---------- */

interface CdpSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', handler: () => void, options?: { once?: boolean }): void;
  addEventListener(type: 'error', handler: () => void, options?: { once?: boolean }): void;
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
}

interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

function socketCtor(): new (url: string) => CdpSocket {
  const ctor = (globalThis as { WebSocket?: new (url: string) => CdpSocket }).WebSocket;
  if (ctor === undefined) throw new Error('这个 Node 没有全局 WebSocket（需要 Node 22+）');
  return ctor;
}

async function connectCdp(wsUrl: string): Promise<Cdp> {
  const socket = new (socketCtor())(wsUrl);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`连不上 CDP：${wsUrl}`)), { once: true });
  });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (typeof message.id !== 'number') return;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) entry.reject(new Error(message.error.message ?? 'CDP 报错'));
    else entry.resolve(message.result);
  });
  return {
    send(method, params) {
      const id = (nextId += 1);
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { resolve: resolveCall, reject: rejectCall });
        socket.send(JSON.stringify({ id, method, params: params ?? {} }));
      });
    },
    close() {
      socket.close();
    }
  };
}

/* ---------- REST：把局面推到要拍的那一步 ---------- */

async function claim(name: string): Promise<Credential> {
  const response = await apiFetch(`${base}/api/auth/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(`注册失败：${response.status}`);
  return (await response.json()) as Credential;
}

async function act(code: string, credential: string, action: unknown): Promise<void> {
  const response = await apiFetch(`${base}/api/tables/${code}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
    body: JSON.stringify({ action })
  });
  if (!response.ok) throw new Error(`动作失败（${response.status}）：${await response.text()}`);
}

interface SeatView {
  readonly view: {
    readonly deal: {
      readonly dealerSeat: number;
      readonly phase: string;
      readonly trump: TrumpModel | null;
      readonly playTurn: number | null;
      readonly trick: { readonly plays: readonly { readonly seat: number; readonly cards: readonly Card[] }[] } | null;
    } | null;
  };
  readonly you: { readonly seat: number; readonly hand: readonly Card[] } | null;
}

async function viewOf(code: string, credential: string): Promise<SeatView> {
  const response = await apiFetch(`${base}/api/tables/${code}/view`, {
    headers: { authorization: `Bearer ${credential}` }
  });
  if (!response.ok) throw new Error(`取视图失败：${response.status}`);
  return (await response.json()) as SeatView;
}

/* ---------- 截图 ---------- */

interface Shot {
  /** 文件名（不带扩展名） */
  readonly file: string;
  /** 场景说明：打印在结尾的清单里 */
  readonly label: string;
  /** 依次出手的叫品，按叫牌顺序；'pass' 表示不叫。空数组 = 刚发完牌 */
  readonly bids: readonly (string | { readonly points: number; readonly strain: string })[];
  /** 拍第几位叫牌人（0 = 发牌人）—— 恒拍「当前轮到他」的那一位，面板才有候选 */
  readonly captureIndex: 0 | 1 | 2;
  /** 点开之后才有的形态（如展开「▶ 跳叫」） */
  readonly clicks?: readonly string[];
  /**
   * 把局面推到「一墩已经打了几张」再拍（见 driveTrick，用来量出牌点与托盘）。
   *
   * - `'three-clusters'`：三家都出过牌 ⇒ 引擎已收墩、`trick` 复位，出牌区改显示上一墩，
   *   于是毡面上留着**三个出牌点**（量预算与相交）；
   * - `'two-played'`：只出了两张 ⇒ 第三位正好轮到他出牌，**托盘在**（量它是否落在毡面之外）；
   * - `'run-clusters'`：三家各出 `runLength` 张（庄家领顺子、两家跟同样张数）——
   *   **只有这一条能验到多张出牌堆**：单张会让 `computeClusterStep` 走早退分支（不写 `--step`），
   *   于是「多张牌堆的宽度预算」从来没有被任何守卫执行过（5 张顺子把两簇挤到一起、
   *   还捅出毡面，而所有判据全绿的根因就在这里）。
   */
  readonly trick?: 'three-clusters' | 'two-played' | 'run-clusters';
  /** `'run-clusters'` 要打的顺子长度（默认 5）：出牌堆张数只能由顺子长度带出来 */
  readonly runLength?: number;
  /** panel = 只拍叫牌面板那一块；viewport = 整屏（给上下文） */
  readonly mode: 'panel' | 'viewport';
  readonly size: { readonly width: number; readonly height: number };
}

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
/**
 * 窄屏（360×780）：**不是可有可无的第二档**。
 *
 * 候选区那一排「数字 + 五格 + 触发钮」在 390px 上刚好放得下，所以档位被 flex 压窄那个缺陷
 * 在 390 的截图里**量不出来**（实测最大差 0.00px）。它只在更窄的视口上出现 ——
 * 360px 上内宽比内容少约 15px，五个槽位各被压掉约 3px，于是两行的 NT 就不再同宽。
 * 因此「档位对齐」这条判据必须有一屏跑在 360px 上，否则它会安静地空转。
 */
const MOBILE_NARROW = { width: 360, height: 780 };

/**
 * 最窄机型（320×640，老 iPhone SE 那档）：**不是可有可无的第三档**。
 *
 * 三件事只有在这一屏上才可能红，360 与 390 上都会安静地全绿：
 * ① 信息须是**定宽**一块（`--rail-w` = 256px），而毡面内宽只有 272px —— 边距只剩 8px，
 *    「四列不折行、不越出毡面」这条判据在这里最紧（视口下限约 304px，320 是项目实测的最低机型）；
 * ② 两翼出牌点的宽度是按内容槽的百分比算的，槽越窄、两个盒子越容易顶到一起
 *    （撤掉动作带之前，两个对手的出牌点与「我」那一点在这里相交过 207px²）；
 * ③ 5 张顺子在 38% 的盒子里要收到约 16px 的步距 —— 全项目最挤的一档。
 */
const MOBILE_MIN = { width: 320, height: 640 };

function sceneFor(captureIndex: 0 | 1 | 2, bids: Shot['bids']): Pick<Shot, 'captureIndex' | 'bids'> {
  return { captureIndex, bids };
}

const SHOTS: readonly Shot[] = [
  {
    file: '01-nobody-bid',
    label: '没人叫：40 全五格 + 整行「▶ 跳叫」',
    ...sceneFor(0, []),
    mode: 'panel',
    size: MOBILE
  },
  {
    file: '02-highest-40h',
    label: '最高 40♥：40 行只亮 ♠ NT（♣♦♥ 隐形占位）+ 45 全行 + 行末「▶ 跳叫」',
    ...sceneFor(1, [{ points: 40, strain: 'H' }]),
    mode: 'panel',
    size: MOBILE
  },
  {
    file: '02b-narrow-highest-40h',
    label: '同上但窄屏 360px：档位行放不下，五格被 flex 压窄（两行 NT 不再同宽）',
    ...sceneFor(1, [{ points: 40, strain: 'H' }]),
    mode: 'panel',
    size: MOBILE_NARROW
  },
  {
    file: '03-highest-40s',
    label: '最高 40♠：40 行只亮 NT + 45 全行 + 行末「▶ 跳叫」',
    ...sceneFor(2, [{ points: 40, strain: 'H' }, { points: 40, strain: 'S' }]),
    mode: 'panel',
    size: MOBILE
  },
  {
    file: '04-highest-40nt',
    label: '最高 40NT：只给 45 一行 + 整行「▶ 跳叫」（同分已无可压花色）',
    ...sceneFor(2, [{ points: 40, strain: 'C' }, { points: 40, strain: 'NT' }]),
    mode: 'panel',
    size: MOBILE
  },
  {
    file: '05-expanded',
    label: '展开后：40–60 共五档，触发钮消失',
    ...sceneFor(1, [{ points: 40, strain: 'H' }]),
    clicks: ['[data-bid-jump]'],
    mode: 'panel',
    size: MOBILE
  },
  {
    file: '06-desktop-highest-40h',
    label: '同一场景在桌面宽度（sm 断点）下的面板',
    ...sceneFor(1, [{ points: 40, strain: 'H' }]),
    mode: 'panel',
    size: DESKTOP
  },
  {
    file: '07-page-context',
    label: '整屏上下文：手机宽度下的牌桌与面板位置',
    ...sceneFor(0, []),
    mode: 'viewport',
    size: MOBILE
  },
  {
    file: '08-contract-40nt-status',
    label: '成交 40NT 后：信息须与顶部大字都写 NT（无主不再写成「无主」）',
    ...sceneFor(1, [
      { points: 40, strain: 'C' },
      { points: 40, strain: 'NT' },
      'pass',
      'pass'
    ]),
    mode: 'viewport',
    size: MOBILE
  },
  {
    file: '09-trick-three-clusters',
    label: '出牌阶段：一墩打完、毡面上留着三家三堆（桌面宽度，量三个出牌点的预算与相交）',
    ...sceneFor(0, [{ points: 40, strain: 'C' }, 'pass', 'pass']),
    trick: 'three-clusters',
    mode: 'viewport',
    size: DESKTOP
  },
  {
    file: '10-narrow-play-turn',
    label: '窄屏 360px、轮到我出牌：托盘与动作带（量托盘是否整个落在毡面之外）',
    ...sceneFor(2, [{ points: 40, strain: 'C' }, 'pass', 'pass']),
    trick: 'two-played',
    mode: 'viewport',
    size: MOBILE_NARROW
  },
  {
    file: '11-narrow-run-five',
    label: '窄屏 360px、一墩打完且三家各出 5 张顺子：出牌堆紧凑叠排、互不相撞、不出预算（截图 #1 的直接回归）',
    ...sceneFor(0, [{ points: 40, strain: 'C' }, 'pass', 'pass']),
    trick: 'run-clusters',
    runLength: 5,
    mode: 'viewport',
    size: MOBILE_NARROW
  },
  {
    file: '12-desktop-run-five',
    label: '桌面宽度下同一局面：两个对手出牌点的中点居中、「我」那条底栏限宽居中、信息须不折行',
    ...sceneFor(0, [{ points: 40, strain: 'C' }, 'pass', 'pass']),
    trick: 'run-clusters',
    runLength: 5,
    mode: 'viewport',
    size: DESKTOP
  },
  {
    file: '13-narrow-rail-320',
    label: '最窄机型 320px、收过墩：信息须四列（上一轮 / 40♣ / 2 / N 分）互不相叠、都与底栏同宽且落在毡面内',
    ...sceneFor(0, [{ points: 40, strain: 'C' }, 'pass', 'pass']),
    trick: 'three-clusters',
    mode: 'viewport',
    size: MOBILE_MIN
  },
  {
    file: '14-narrow-run-five-320',
    label:
      '最窄机型 320px、三家各出 5 张顺子：两翼预算按 5 张取 38%、严格互不相撞、牌不出预算（多张出牌堆在最低机型上的回归）',
    ...sceneFor(0, [{ points: 40, strain: 'C' }, 'pass', 'pass']),
    trick: 'run-clusters',
    runLength: 5,
    mode: 'viewport',
    size: MOBILE_MIN
  }
];

/**
 * `'run-clusters'` 的重发上限：一副牌里庄家那 20 张（17 + 拿上来的底牌 3）出现 ≥k 张顺子的概率
 * 是**量出来的**，不是猜的 —— 20000 次发牌抽样：≥2 84.9%、≥3 44.3%、≥4 17.3%、**≥5 5.9%**、≥6 1.9%。
 * 所以 5 张顺子的场景必须整桌重发；上限 120 次时一次都撞不上的概率约 0.07%。
 */
const RUN_ATTEMPTS = 120;

/**
 * 毡面那条宽度尺度（`app.css` 的 `--rail-w`）的两个值：基准 16rem = 256px、
 * `sm`（640px）以上 18rem = 288px。**两块**（顶部信息须与底部「我」底栏）都取它，
 * 所以这一条判据从「底栏不超过 256px」升级成「**两块同宽**」（见 ⑯）——
 * 早先信息须由内容撑到 229–238px、底栏 256px，一上一下差 18–27px，上下框对不齐，
 * 而那正是「统一尺度」这条决定要治的东西，只量上限是量不到它的。
 *
 * 为什么有两个值：定宽必须容得下最宽的内容（`100♣ / 100 分`），而那是按数字字号算的 ——
 * 值那一档在 `sm` 上从 20px 变成 24px。实测桌面场景里最紧的一格（「回溯」按钮）
 * 在 256px 下只剩 **0.0px** 余量，所以桌面档加宽到 288px；基准档的账见 `app.css`。
 */
const RAIL_W_BASE = 256;
const RAIL_W_SM = 288;

/** 这一屏该用哪一档尺度（与 `app.css` 的媒体查询同一个断点） */
function railScaleOf(viewportWidth: number): number {
  return viewportWidth >= 640 ? RAIL_W_SM : RAIL_W_BASE;
}

/**
 * 闹钟圆里的两档字号，**从 `ActionClock.svelte` 的源码里读出来**，不在这边另抄一份。
 *
 * 为什么要读源码而不是写死：这一条判据要量的是「三位数在那个小一档的字号下放不放得下
 * 22px 的圆」，而那个字号是组件里的一个字面量。脚本里再抄一个 8px 的话，改组件时这里
 * 会**安静地量着旧字号**（判据不红、也没意义）。读源码之后，改字号会立刻反映到测量里；
 * 万一那行代码的形状变了（正则匹配不上），这里**报错退出**而不是退回一个默认值。
 *
 * 比对的是 `ActionClock` 里那行三元：
 *   `face.tone === 'long' ? 'text-[9px]' : 'text-[10px]'`
 */
const CLOCK_TIERS: { readonly long: number; readonly plain: number } = (() => {
  const source = readFileSync(resolve(webRoot, 'src/lib/components/ActionClock.svelte'), 'utf8');
  const match = /face\.tone === 'long' \? 'text-\[([\d.]+)px\]' : 'text-\[([\d.]+)px\]'/.exec(source);
  if (match === null) {
    throw new Error(
      'ActionClock.svelte 里读不出闹钟的两档字号（`size` 那行的形状变了）：' +
        '⑮ 那条判据量的就是这两个字号，读不到就不能瞎猜一个默认值'
    );
  }
  return { long: Number(match[1]), plain: Number(match[2]) };
})();

async function joinTarget(port: number): Promise<{ id: string; wsUrl: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`开不了新的浏览器页面：${response.status}`);
  const target = (await response.json()) as { id: string; webSocketDebuggerUrl: string };
  return { id: target.id, wsUrl: target.webSocketDebuggerUrl };
}

async function evaluate<T>(cdp: Cdp, expression: string): Promise<T | null> {
  const result = (await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })) as { result?: { value?: T } };
  return result.result?.value ?? null;
}

/* ---------- 版面几何：量出来再断言 ---------- */
/**
 * 源码守卫看不见几何 —— 这一节补的就是那一段。
 *
 * 起因是一处**真实缺陷**：叫牌候选区里第 2 档多一枚「▶ 跳叫」，整行内容超过面板内宽，
 * 而五个槽位没写 `shrink-0`（`w-9` 只是基准宽），于是 flex 把它们一起压窄 ——
 * 实测第 1 档的 NT 右边缘 272.5px、第 2 档 269.0px，**差 3.5px**，宽 36.0 vs 33.5。
 * 这种量级只能靠测量抓住，所以它在这里被钉成断言，而不是写在注释里。
 */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
}

interface MeasuredSlot extends Rect {
  /** legal | invisible（隐形占位也占宽，所以它同样进对齐比较） */
  readonly kind: string;
}

interface MeasuredRow {
  readonly points: number;
  readonly slots: readonly MeasuredSlot[];
}

interface MeasuredSpot {
  readonly seat: number;
  readonly rect: Rect;
  readonly cards: readonly Rect[];
}

/**
 * 信息须里的一格（表头 `th` 或值格 `td`）：
 *
 * - `needed`：把这一格的**内容原样**（`innerHTML`，带着字号 / 边距 / 按钮）塞进一个
 *   `white-space: nowrap` 的探针里量出来的宽度 —— 也就是「不换行需要多宽」。
 *   为什么不数文本行数：一格里混着 24px 的数字与 11px 的「分」，同一个行盒里两个
 *   元素的盒子顶边本来就不一样，「按顶边数行」会把正常的一行判成两行。
 * - `available`：这一格真正可用的内容宽度（格子宽 − 左右内边距）。
 * - `padTop`：上内边距（表头那一行的留白，真机反馈过「第一行太挤」）。
 *
 * `needed > available` ⇒ 内容放不下：要么折行（「分」掉下来），要么被 nowrap 顶出去。
 */
interface RailCellBox {
  readonly name: string;
  readonly rect: Rect;
  readonly needed: number;
  readonly available: number;
  readonly padTop: number;
}

interface Measurement {
  readonly panel: Rect | null;
  readonly rows: readonly MeasuredRow[];
  readonly spots: readonly MeasuredSpot[];
  readonly history: {
    /** 已经渲染出来的记录条数 */
    readonly total: number;
    /** 一条记录的高度（没有记录时为 0） */
    readonly rowHeight: number;
    readonly box: Rect | null;
  };
  readonly feltRows: readonly { readonly name: string; readonly rect: Rect }[];
  readonly felt: Rect | null;
  /** 毡面的**直接子元素**（行与行外的层都算）：用来抓「有层跑到内容槽外面去了」 */
  readonly feltChildren: readonly {
    readonly tag: string;
    readonly row: string | null;
    readonly review: boolean;
    readonly rect: Rect;
  }[];
  /** 操作条那一行（`data-action-row`）：托盘现在住在它里面，所以它必须与毡面零相交 */
  readonly actionRow: Rect | null;
  /** 动作托盘：只在「这一手归你动」时存在（现在在操作条那一行里，不再是一条独立的带） */
  readonly tray: Rect | null;
  /**
   * 信息须那块**类表格**（`InfoRail` 根节点，`data-info-rail`）与它的直接子元素。
   * 折行判据看子元素的**竖直中线**而不是高度阈值：一行里的格子高矮本来就不同
   * （回溯那格是按钮、其余三格是大字），只有「折到第二行」才会让中线错开。
   */
  readonly railBlock: Rect | null;
  /**
   * 信息须那块**类表格**的四个值格（`data-rail-cell="review|contract|level|points"`）。
   * 它们必须都落在毡面内、互不相叠，而**整块必须居中在毡面中线上** ——
   * 四个值格的宽度不等（按钮 / `40♣` / `2` / `0 分`），若靠左或靠右排，整块就会偏。
   */
  /**
   * 信息须那张表的**四个值格**（`data-rail-cell="review|contract|level|points"`）与
   * **四个表头格**（`th`）。它们必须都落在毡面内、互不相叠，而**整块必须居中在毡面中线上** ——
   * 四个值格的宽度不等（按钮 / `40♣` / `2` / `0 分`），若靠左或靠右排，整块就会偏。
   *
   * 每一格还带两个宽度读数（`needed` / `available`）：真机上「庄已抓」那格的「分」
   * 曾掉到第二行（窄屏把这条挤到 229px 时列宽不够），而「四格互不相叠」是量不到折行的 ——
   * 折行只让那一行变高，格子之间照样不重叠（见 ⑭b）。
   */
  readonly railCells: readonly RailCellBox[];
  readonly railHeads: readonly RailCellBox[];
  /** 「我」那条底栏（`SeatCard` 的 `bar` 形态）：限宽、居中、与信息须同宽都在它身上量 */
  readonly seatBar: Rect | null;
  /**
   * 闹钟（`data-clock-face`）那枚圆里的读数：⑮ 用它量「三位数放不放得下」。
   *
   * `threeDigitsPx` 是**当场量出来的**：拿真实字体的字体族 / 字重 / 等宽数字，
   * 在圆里临时插一个 `888` 的探针（`position:absolute; left:-9999px`，不影响版面）。
   * `doubleSizePx` 是同一串数字在两倍字号下的宽度 —— 尺子是否真的按字号在量，靠它证。
   */
  readonly clock: {
    /** 当下的档位（`data-clock-tone`：plain | long | stale） */
    readonly tone: string;
    /** 圆里那颗字**实际**算出来的字号 */
    readonly liveFontPx: number;
    /** 组件源码里的两档字号（`CLOCK_TIERS`） */
    readonly tierPx: { readonly long: number; readonly plain: number };
    readonly threeDigitsPx: number;
    readonly doubleSizePx: number;
    /** 圆的宽度（22px）：可用的就是它减去左右各 1px */
    readonly circleWidth: number;
  } | null;
}

const MEASURE = `(() => {
  const rect = (el) => { const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
  const one = (sel) => { const el = document.querySelector(sel); return el === null ? null : rect(el); };
  const rows = [...document.querySelectorAll('[data-bid-row]')].map((row) => ({
    points: Number(row.getAttribute('data-bid-row') ?? 0),
    slots: [...row.querySelectorAll('[data-bid-slot]')].map((s) => ({ kind: s.getAttribute('data-bid-slot') ?? '', ...rect(s) }))
  }));
  const spots = [...document.querySelectorAll('[data-trick-spot]')].map((el) => ({
    seat: Number(el.getAttribute('data-trick-spot') ?? -1),
    rect: rect(el),
    cards: [...el.querySelectorAll('.card')].map(rect)
  }));
  const hbox = document.querySelector('[data-bid-history]');
  const history = { total: 0, rowHeight: 0, box: hbox === null ? null : rect(hbox) };
  if (hbox !== null) {
    const trs = [...hbox.querySelectorAll('tbody tr')];
    history.total = trs.length;
    history.rowHeight = trs.length === 0 ? 0 : trs[0].getBoundingClientRect().height;
  }
  const cellInfo = (el) => {
    const box = rect(el);
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;';
    probe.innerHTML = el.innerHTML;
    el.appendChild(probe);
    const needed = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      name: el.getAttribute('data-rail-cell') ?? (el.textContent ?? '').trim(),
      rect: box,
      needed,
      available: box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      padTop: parseFloat(cs.paddingTop)
    };
  };
  return {
    panel: one('[data-bid-panel]'),
    rows,
    spots,
    history,
    feltRows: [...document.querySelectorAll('[data-felt-row]')].map((el) => ({
      name: el.getAttribute('data-felt-row') ?? '', rect: rect(el)
    })),
    felt: one('.felt'),
    feltChildren: [...document.querySelectorAll('.felt > *')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      row: el.getAttribute('data-felt-row'),
      review: el.hasAttribute('data-trick-review'),
      rect: rect(el)
    })),
    actionRow: one('[data-action-row]'),
    tray: one('[data-action-tray]'),
    railBlock: one('[data-info-rail]'),
    railCells: [...document.querySelectorAll('[data-rail-cell]')].map(cellInfo),
    railHeads: [...document.querySelectorAll('[data-info-rail] th')].map(cellInfo),
    seatBar: one('[data-seat-bar]'),
    clock: (() => {
      const face = document.querySelector('[data-clock-face="true"]');
      if (face === null) return null;
      const circle = face.parentElement;
      const box = rect(circle);
      const cs = getComputedStyle(face);
      const holder = face.closest('[data-clock-tone]');
      const tone = holder === null ? 'plain' : (holder.getAttribute('data-clock-tone') ?? 'plain');
      const probe = (px, text) => {
        const el = document.createElement('span');
        el.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;'
          + 'font-family:' + cs.fontFamily + ';font-weight:' + cs.fontWeight
          + ';font-variant-numeric:tabular-nums;font-size:' + px + 'px;';
        el.textContent = text;
        circle.appendChild(el);
        const width = el.getBoundingClientRect().width;
        el.remove();
        return width;
      };
      return {
        tone,
        liveFontPx: parseFloat(cs.fontSize),
        tierPx: { long: ${CLOCK_TIERS.long}, plain: ${CLOCK_TIERS.plain} },
        threeDigitsPx: probe(${CLOCK_TIERS.long}, '888'),
        doubleSizePx: probe(${CLOCK_TIERS.long} * 2, '888'),
        circleWidth: box.width
      };
    })()
  };
})()`;

/** 相交面积；相邻但不重叠的盒子之间会有亚像素接触，所以 1px 以内不算相交 */
function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  return width > 1 && height > 1 ? width * height : 0;
}

function boxOf(r: Rect): string {
  return `x ${r.x.toFixed(1)}–${r.right.toFixed(1)}, y ${r.y.toFixed(1)}–${r.bottom.toFixed(1)}`;
}

/** 一个盒子是否被另一个包住（留 0.5px 的亚像素余量） */
function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.bottom <= outer.bottom + 0.5
  );
}

/**
 * 一次收齐这一屏里所有不过的判据（不抛，返回给调用方）。
 *
 * 为什么不在这里直接抛：这个脚本一次跑 9 个场景，而每条判据要看的场景不同
 * （档位对齐要有两行、出牌点要有三家出牌）。第一处失败就抛的话，
 * 一次只能看见一个红点、修一条才发现下一条 —— 于是改成「每个场景各自收齐、
 * 截完图继续跑下一个场景，最后由 main 把全部问题一起报出来」。
 */
function assertLayout(
  m: Measurement,
  file: string,
  viewportWidth: number
): { readonly summary: string; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };

  // ① 档位行的槽逐列对齐：按**列号**比（隐形占位也占宽，所以列号可对齐）
  const head = m.rows[0];
  let worstDelta = 0;
  if (head !== undefined) {
    for (const row of m.rows.slice(1)) {
      const cols = Math.min(head.slots.length, row.slots.length);
      for (let i = 0; i < cols; i += 1) {
        const a = head.slots[i]!;
        const b = row.slots[i]!;
        const delta = Math.max(Math.abs(a.right - b.right), Math.abs(a.x - b.x), Math.abs(a.width - b.width));
        worstDelta = Math.max(worstDelta, delta);
        if (delta > 0.5) {
          fail(
            `候选区第 ${head.points} 档第 ${i + 1} 格与第 ${row.points} 档第 ${i + 1} 格没对齐` +
              `（左 ${a.x.toFixed(1)} / ${b.x.toFixed(1)}，宽 ${a.width.toFixed(1)} / ${b.width.toFixed(1)}，` +
              `右 ${a.right.toFixed(1)} / ${b.right.toFixed(1)}，最大差 ${delta.toFixed(1)}px）：` +
              '槽位又被这一行的内容压窄了（缺 shrink-0，或触发器又挤回了档位行）'
          );
        }
      }
    }
  }

  // ② 叫牌历史的**容量**：不滚动至少读得到 3 行。
  //
  //    判据写成「容量 ≥ 3 行」而不是「可见行数 ≥ 3」：叫牌刚开始时历史里只有 1 条记录，
  //    那时没有任何页面能满足「可见 3 行」—— 那种断言是**做不成**的（第一版就写成那样，
  //    于是它对着一个 275px 高的历史区报「只能读到 1/1 行」，把「容量充足」误报成失败）。
  //    行高取渲染出来的第一条记录；一条记录都没有时按 24px 估（约等于一行 12px 字 + 内边距）。
  if (m.history.box !== null) {
    const rowHeight = m.history.rowHeight > 0 ? m.history.rowHeight : 24;
    const capacity = Math.floor(m.history.box.height / rowHeight);
    if (capacity < 3) {
      fail(
        `叫牌历史区只装得下约 ${capacity} 行（至少 3 行）：固定块把历史挤没了` +
          `（历史区高 ${m.history.box.height.toFixed(1)}px，行高 ${rowHeight.toFixed(1)}px）`
      );
    }
  }

  // ③ 毡面必须是四行格 —— 信息须 / 顶卡 / 内容槽 / 我的底栏
  const names = m.feltRows.map((row) => row.name);
  if (JSON.stringify(names) !== JSON.stringify(['rail', 'seats', 'slot', 'me'])) {
    fail(`毡面不是「信息须 / 顶卡 / 内容槽 / 我的底栏」四行格（实际 [${names.join(', ')}]）`);
  }
  const rail = m.feltRows[0]?.rect;
  const slot = m.feltRows[2]?.rect;
  if (slot === undefined) fail('毡面里找不到内容槽那一行（缺 [data-felt-row="slot"]）');

  // ④ 三行互不相交
  for (let i = 0; i < m.feltRows.length; i += 1) {
    for (let j = i + 1; j < m.feltRows.length; j += 1) {
      const a = m.feltRows[i]!;
      const b = m.feltRows[j]!;
      const area = overlapArea(a.rect, b.rect);
      if (area > 0) fail(`毡面的「${a.name}」与「${b.name}」两行相交 ${area.toFixed(0)}px²`);
    }
  }

  // ⑤ 非座位层必须在内容槽里（叫牌面板与三个出牌点）
  if (slot !== undefined) {
    const layers: { readonly label: string; readonly rect: Rect | null }[] = [
      { label: '叫牌面板', rect: m.panel },
      ...m.spots.map((spot) => ({ label: `座位 ${spot.seat} 的出牌点`, rect: spot.rect }))
    ];
    for (const layer of layers) {
      if (layer.rect === null) continue;
      if (!contains(slot, layer.rect)) {
        fail(`${layer.label}越出了内容槽（${boxOf(layer.rect)} 不在 ${boxOf(slot)} 里）`);
      }
    }

    // ⑤b 逐个子元素穷举：毡面的直接子元素只许是**三行**与那张有意做成模态的回看浮层。
    //     上面 ⑤ 只查「我点名的那几个层」，于是「又有人往毡面上放了一层」会漏过去 ——
    //     这正是注入实验 C 抓出来的：把一个状态条塞回毡面最后一行，上面几条全绿。
    for (const child of m.feltChildren) {
      if (child.row !== null || child.review) continue;
      if (!contains(slot, child.rect)) {
        fail(
          `毡面里有一个「不属于任何一行」的 ${child.tag} 越出了内容槽` +
            `（${boxOf(child.rect)} 不在 ${boxOf(slot)} 里）：非座位层只能住在 data-felt-row="slot" 里，` +
            '否则它又会自己算偏移、与别的层压在一起（截图里的 #3 #5 就是这么来的）'
        );
      }
    }
  }

  // ⑥ 操作条那一行必须在毡面**之外**（它现在装着动作托盘 —— 托盘进毡面就是 #4：压住「我」那条底栏）
  if (m.actionRow === null) {
    fail('页面里找不到操作条那一行（缺 [data-action-row]）');
  } else if (m.felt !== null) {
    const area = overlapArea(m.actionRow, m.felt);
    if (area > 0) fail(`操作条压在毡面上 ${area.toFixed(0)}px²（那一行里的托盘会盖住「我」那条底栏）`);
  }

  // ⑦ 出牌区的各点互不相交；每张牌都在自己那一点的预算里，且不同点的牌互相不叠。
  //
  //    「在自己的预算里」**横向严格、纵向放宽 4px**：横向才是算法的错处所在（步距算错就把牌
  //    推出盒子）；纵向要容下装饰性变换 —— 第 2/3 张牌带 4°/−3° 旋转与 translateY(-2px)，
  //    包围盒天然比布局盒大出 1–2px，那是「错落的墩」本身的设计，不是宽度预算的问题。
  for (let i = 0; i < m.spots.length; i += 1) {
    const spot = m.spots[i]!;
    for (const card of spot.cards) {
      if (card.x < spot.rect.x - 0.5 || card.right > spot.rect.right + 0.5) {
        fail(
          `座位 ${spot.seat} 的出牌点里有牌横向越出预算（牌 ${boxOf(card)} 不在 ${boxOf(spot.rect)} 里）：` +
            '多张牌堆的步距必须按预算算，不能靠 justify-content 溢出'
        );
      }
      if (card.y < spot.rect.y - 4 || card.bottom > spot.rect.bottom + 4) {
        fail(`座位 ${spot.seat} 的出牌点里有牌纵向越出预算（牌 ${boxOf(card)} 不在 ${boxOf(spot.rect)} 里）`);
      }
    }
    for (let j = i + 1; j < m.spots.length; j += 1) {
      const other = m.spots[j]!;
      const area = overlapArea(spot.rect, other.rect);
      if (area > 0) fail(`座位 ${spot.seat} 与座位 ${other.seat} 的出牌点相交 ${area.toFixed(0)}px²`);
      for (const card of spot.cards) {
        for (const otherCard of other.cards) {
          const crossed = overlapArea(card, otherCard);
          if (crossed > 0) {
            fail(
              `座位 ${spot.seat} 与座位 ${other.seat} 出的牌互相叠了 ${crossed.toFixed(0)}px²` +
                `（${boxOf(card)} 与 ${boxOf(otherCard)}）：出牌点必须有各自的宽度预算，不能靠错位碰运气`
            );
          }
        }
      }
    }
  }

  // ⑧ 托盘必须整个落在操作条那一行里 —— 这是 #4（托盘压住「我」那条底栏）的结构化判据：
  //    托盘 ⊆ 操作条行，且操作条行 ∩ 毡面 = ∅ ⇒ 托盘 ∩ 毡面 = ∅。
  //    （唯一有意压在毡面上的东西是那枚**错误气泡**：它 `absolute` 浮在行上方、几秒即散，
  //      所以它不在这条判据的范围内 —— 判的是托盘本体。）
  if (m.tray !== null) {
    if (m.actionRow === null) {
      fail('动作托盘出现了，但页面上没有操作条那一行可容纳它（托盘又会压在毡面上）');
    } else if (!contains(m.actionRow, m.tray)) {
      fail(`动作托盘越出了操作条那一行（托盘 ${boxOf(m.tray)} 不在行 ${boxOf(m.actionRow)} 里）`);
    }
  }

  // ⑨ 两个对手出牌点的**中点必须落在内容槽中线上**（截图 #2「两个对手牌中央的中点偏左」）。
  //    旧布局：左点 `left-0 w-[38%]`（中心 19%）+ 右点 `right-[20%] w-[38%]`（中心 61%）
  //    ⇒ 中点 40%，整组偏左 10%（窄屏实测约 31px）—— 而「我」那一点与信息须都在中线上，
  //    于是三家看起来是歪的。判据按「左右两翼 + 一条通栏」的分工认三个点：
  //    通栏那一条是我方点（`inset-x-0`），两翼各占 38%。
  if (slot !== undefined && m.spots.length === 3) {
    const slotCenter = slot.x + slot.width / 2;
    const wings = m.spots.filter((spot) => spot.rect.width <= slot.width * 0.5);
    if (wings.length !== 2) {
      fail(
        `三个出牌点里认不出「左右两翼 + 一条通栏」的分工：宽度 ${m.spots
          .map((spot) => spot.rect.width.toFixed(0))
          .join(' / ')}px（内容槽 ${slot.width.toFixed(0)}px）`
      );
    } else {
      const centers = wings.map((spot) => spot.rect.x + spot.rect.width / 2);
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
      if (Math.abs(mid - slotCenter) > 1) {
        fail(
          `两个对手出牌点的中点没在内容槽中线上（中点 ${mid.toFixed(1)} vs 中线 ${slotCenter.toFixed(1)}，` +
            `偏 ${(mid - slotCenter).toFixed(1)}px）：左右两点的宽度预算必须对称（各 10% 内缩）`
        );
      }
      const margins = wings.map((spot) => [
        spot.rect.x - slot.x,
        slot.right - spot.rect.right
      ]);
      const leftInner = Math.min(...margins.map((pair) => pair[0]!));
      const rightInner = Math.min(...margins.map((pair) => pair[1]!));
      if (Math.abs(leftInner - rightInner) > 1) {
        fail(
          `两个对手出牌点到内容槽左右的边距不对称（${leftInner.toFixed(1)}px vs ${rightInner.toFixed(1)}px）：` +
            '只挪一边就会把中点推偏'
        );
      }

      // ⑰ 两翼的宽度预算**按张数算**（`spotWidthPct`），而且**两侧同宽**。
      //    宽度是这一簇唯一的可支配资源：写死 38% 时，少牌时盒子过宽（这一簇离中线远、
      //    桌面空出一大块），多牌时又不够（≥9 张压过角标可读下限）。这一条把「实际量到的宽度」
      //    与「按这一侧张数算出来的宽度」钉在一起 —— 只断言「互不相交」是量不到自适应有没有生效的。
      for (const wing of wings) {
        const expected = (slot.width * spotWidthPct(wing.cards.length)) / 100;
        if (Math.abs(wing.rect.width - expected) > 1) {
          fail(
            `座位 ${wing.seat} 的出牌点宽 ${wing.rect.width.toFixed(1)}px，而按 ${wing.cards.length} 张算` +
              `应当是 ${expected.toFixed(1)}px（内容槽 ${slot.width.toFixed(1)}px × ` +
              `${spotWidthPct(wing.cards.length)}%）：两翼的宽度必须由张数算出来`
          );
        }
      }
      const sortedWings = [...wings].sort((a, b) => a.rect.x - b.rect.x);
      const centerGap = sortedWings[1]!.rect.x - sortedWings[0]!.rect.right;
      if (centerGap < slot.width * 0.03) {
        fail(
          `两个对手出牌点之间只剩 ${centerGap.toFixed(1)}px 空带（应当 ≥ 内容槽的 3% = ` +
            `${(slot.width * 0.03).toFixed(1)}px）：宽度越界就会把两簇挤到一起`
        );
      }
    }
  }

  // ⑩ 出牌堆**不许被拉伸**（截图 #1「5 张顺子时己方牌间距被拉伸」的判据）。
  //    紧凑上限 = 每张露出 0.6 × 牌宽（`CLUSTER_STRIP_RATIO`）；+3px 容纳 2/3 两张牌那 4°/−3°
  //    旋转变换带来的包围盒位移。旧的「自然间距」是 牌宽+6（完全摊开），而 CSS 的 `gap: 6px`
  //    又没在已测量态关掉 ⇒ 实际步距 = 牌宽+12，窄屏 38px 牌上等于两张之间空出一半牌宽。
  for (const spot of m.spots) {
    if (spot.cards.length < 2) continue;
    const cardWidth = spot.cards[0]!.width;
    const sorted = [...spot.cards].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i += 1) {
      const delta = sorted[i]!.x - sorted[i - 1]!.x;
      const limit = cardWidth * 0.6 + 3;
      if (delta > limit) {
        fail(
          `座位 ${spot.seat} 的出牌堆被拉伸了：相邻两张牌左缘间距 ${delta.toFixed(1)}px > 紧凑上限 ` +
            `${limit.toFixed(1)}px（牌宽 ${cardWidth.toFixed(1)}px，共 ${spot.cards.length} 张）—— ` +
            '放得下就该紧凑叠排，不该摊满整行'
        );
      }
    }
  }

  // ⑫ 「我」那条底栏**限宽并居中**（`max-w-[var(--rail-w)]`：基准 256px、桌面 288px）。
  //    窄毡面上它本来就整宽（判据自动成立），所以桌面场景另加一条「毡面必须比上限宽」——
  //    少了它，这条判据在桌面宽度下会安静地空转。
  const railScale = railScaleOf(viewportWidth);
  if (viewportWidth >= 1000 && (m.felt === null || m.felt.width <= railScale + 40)) {
    fail(
      `这一屏是桌面宽度（${viewportWidth}px）却没验到「我」栏限宽：毡面宽 ` +
        `${m.felt?.width.toFixed(1) ?? '—'}px 未超过上限 ${railScale + 40}px，⑫ 这条判据会空转`
    );
  }
  if (m.seatBar !== null && m.felt !== null) {
    if (m.seatBar.width > railScale + 1) {
      fail(
        `「我」那条底栏宽 ${m.seatBar.width.toFixed(1)}px，超过这一屏的尺度 ${railScale}px：` +
          '会横贯整幅毡面（名字长一点更明显）'
      );
    }
    const barCenter = m.seatBar.x + m.seatBar.width / 2;
    const feltCenter = m.felt.x + m.felt.width / 2;
    if (Math.abs(barCenter - feltCenter) > 1) {
      fail(
        `「我」那条底栏没有居中（中心 ${barCenter.toFixed(1)} vs 毡面中心 ${feltCenter.toFixed(1)}）`
      );
    }
  }

  // ⑬ 信息须那块表**只许两行**（表头 + 值）：值格里的数字一旦被挤到换行，这一条就会变三行、
   //    把毡面顶部撑高。判据是四个值格的**竖直中线必须齐平** ——
  //    标签在表头那行、值在下面那行，所以齐平就意味着四个值格真的在同一行里。
  if (m.railCells.length > 1) {
    const centersY = m.railCells.map((cell) => cell.rect.y + cell.rect.height / 2);
    const spread = Math.max(...centersY) - Math.min(...centersY);
    if (spread > 1) {
      fail(
        `信息须的四个值格没有排在同一个表行里（中线差 ${spread.toFixed(1)}px）：` +
          '某一格的数字被挤得换了行，毡面顶部会多出一行'
      );
    }
  }

  // ⑭ 信息须那块表的几何（ADR-0020 修订）：各值格都在毡面内、互不相叠、**整块居中在中线上**。
  //    三条约束各对应一次真实的坏法：
  //    - 「都在毡面内 / 互不相叠」＝ 窄屏放不下时四列会挤在一起（320px 上实测过：药丸版把
  //      「庄已抓」挤成竖排两行）；
  //    - 「整块居中」＝ 四格的宽度天然不等（按钮 / `40♣` / `2` / `0 分`），靠左排就会偏 ——
  //      而它上面写的是这一副最该稳的两个数。
  if (m.felt !== null && m.railCells.length === 4 && m.railBlock !== null) {
    const feltCenter = m.felt.x + m.felt.width / 2;
    const rowCenter = m.railBlock.x + m.railBlock.width / 2;
    if (Math.abs(rowCenter - feltCenter) > 1) {
      fail(
        `信息须那块表没居中（中心 ${rowCenter.toFixed(1)} vs 毡面中心 ${feltCenter.toFixed(1)}）：` +
          '它要 `mx-auto` + 与「我」那条底栏同一个尺度（`--rail-w`），靠左排会在宽屏上歪到一边'
      );
    }
    for (const cell of m.railCells) {
      if (!contains(m.felt, cell.rect)) {
        fail(
          `信息须的「${cell.name}」格越出了毡面（${boxOf(cell.rect)} 不在 ${boxOf(m.felt)} 里）：` +
            '四列必须都落在毡面的内边距之内'
        );
      }
    }
    for (let i = 0; i < m.railCells.length; i += 1) {
      for (let j = i + 1; j < m.railCells.length; j += 1) {
        const a = m.railCells[i]!;
        const b = m.railCells[j]!;
        const area = overlapArea(a.rect, b.rect);
        if (area > 0) {
          fail(
            `信息须的「${a.name}」与「${b.name}」两格叠了 ${area.toFixed(0)}px²` +
              `（${boxOf(a.rect)} 与 ${boxOf(b.rect)}）：这一屏太窄，列宽 / 内边距要各收一档`
          );
        }
      }
    }
    // 两行的形状：四个值格必须**整体落在表头那一行下面**（表头在上、值在下）。
    // 用「上下关系」而不是「块高 / 格高」估行数：后者是个比值，内边距一动就会漂
    // （表头加了上边距之后它离 2 更近，再动几次就会假红）。
    if (m.railHeads.length > 0) {
      const headBottom = Math.max(...m.railHeads.map((head) => head.rect.bottom));
      const valueTop = Math.min(...m.railCells.map((cell) => cell.rect.y));
      if (valueTop < headBottom - 0.5) {
        fail(
          `信息须的表头与值没有分成两行（表头底 ${headBottom.toFixed(1)}px、值顶 ${valueTop.toFixed(1)}px）：` +
            '表头在上、值在下一行就是这一块的形状'
        );
      }
    }
    // 它必须真的**在信息须那一行里**（不是在毡面上自由漂浮的一层）
    if (rail !== undefined && !contains(rail, m.railBlock)) {
      fail(
        `信息须那块表不在 [data-felt-row="rail"] 那一行里（表 ${boxOf(m.railBlock)} 不在 ` +
          `${boxOf(rail)} 里）：它必须由毡面的行给出位置，不能自己算偏移`
      );
    }
  }

  // ⑭b 信息须里每一格的内容都必须**放得下一行**（真机截图：「庄已抓」那格的「分」掉到了
  //     第二行，`25` 下面孤零零一个「分」）。
  //     判据是「不换行时需要多宽」（把内容原样塞进一个 nowrap 探针量）vs「这一格真有多宽」——
  //     不写死任何数字，所以字号、文案、机型怎么变都能量。
  //     为什么不能只靠「四格互不相叠」：折行只让那一行变高，格子之间照样不重叠（⑭ 全绿），
  //     而它已经发生过了；也不能只靠「值格中线齐平」（⑬）：表格一行里所有格子同高，
  //     折行的那一格高了，整行的中线照样齐平。
  for (const cell of [...m.railHeads, ...m.railCells]) {
    if (cell.needed > cell.available + 0.5) {
      fail(
        `信息须的「${cell.name}」格放不下：不换行需要 ${cell.needed.toFixed(1)}px，` +
          `这一格只有 ${cell.available.toFixed(1)}px（格子宽 ${cell.rect.width.toFixed(1)}px）—— ` +
          '内容会折行（「庄已抓」那格的「分」就是这样掉到第二行的）或被顶出格子'
      );
    }
  }

  // ⑭c 表头那行与整块的上边线之间要有留白（真机反馈「第一行太挤」：早先上下各只有 2px，
  //     表头贴着圆角边线）。量的是**出货页面上的上内边距**，不是源码里的类名。
  for (const head of m.railHeads) {
    if (head.padTop < 4) {
      fail(
        `信息须表头「${head.name}」的上边距只有 ${head.padTop}px（至少 4px）：第一行贴着整块的上边线`
      );
    }
  }

  // ⑮ 闹钟圆里的三位数：**量**它在「小一档」那颗字号下要占多宽（第 6 条决定：先量再定）。
  //    三件事各对应一次真实的坏法：
  //    - 圆里那颗字的字号与组件源码里那一档**对不上** ⇒ 下面那条宽度判据量的是另一个字号；
  //    - 探针不随字号变宽 ⇒ 尺子坏了（那种情况下「放得下」永远成立）；
  //    - 三位数**真的**放不下 ⇒ 数字溢出那个圆（所以左右各留 1px 余量）。
  //    为什么必须有它：圆是 22px、三位数是 9px 那一档，而**这一档从来没有被渲染出来量过** ——
  //    场景跑起来时「距上一步」都是几秒，走不到 100 秒，也就永远走不进这一档。
  //    第一次量出来的结论（省掉了一次凭感觉的调整）：8px 下三位数只占 14.8px、圆有 22px，
  //    于是把小档提到 9px（约 16.7px）—— 既不加圆径、也不必砍掉这一档。
  if (m.clock === null) {
    fail('这一屏有牌局却量不到闹钟的读数（找不到 [data-clock-face]）：计时图标不见了');
  } else {
    const clock = m.clock;
    const expected = clock.tone === 'long' ? clock.tierPx.long : clock.tierPx.plain;
    if (Math.abs(clock.liveFontPx - expected) > 0.5) {
      fail(
        `闹钟圆里那颗字的字号是 ${clock.liveFontPx}px，与组件源码里「${clock.tone}」那一档` +
          `（${expected}px）对不上：⑮ 的宽度判据就量错了字号`
      );
    }
    if (clock.doubleSizePx <= clock.threeDigitsPx) {
      fail(
        `闹钟的探针不随字号变宽（${clock.tierPx.long}px ⇒ ${clock.threeDigitsPx.toFixed(1)}px、` +
          `${clock.tierPx.long * 2}px ⇒ ${clock.doubleSizePx.toFixed(1)}px）：这把尺子坏了，` +
          '「放得下」会永远成立'
      );
    }
    const usable = clock.circleWidth - 2;
    if (clock.threeDigitsPx > usable) {
      fail(
        `闹钟里三位数（888）在 ${clock.tierPx.long}px 下要 ${clock.threeDigitsPx.toFixed(1)}px，` +
          `而圆只有 ${clock.circleWidth.toFixed(1)}px（可用 ${usable.toFixed(1)}px）：` +
          '要么把圆放大，要么三位数换一档更小的字'
      );
    }
  }

  // ⑯ 信息须与「我」那条底栏**同宽**（毡面的一个尺度 `--rail-w`，见 app.css / InfoRail）。
  //    早先信息须由内容撑到 229–238px、底栏固定 256px：一上一下差 18–27px，读起来是两个尺度
  //    —— 而 ⑫ 只管底栏的上限，量不到这条「统一尺度」。
  if (m.railBlock !== null) {
    if (m.seatBar === null) {
      fail('信息须在，但「我」那条底栏不在：⑯ 这条同宽判据会空转（这一屏应当有我在座）');
    } else {
      const delta = Math.abs(m.railBlock.width - m.seatBar.width);
      if (delta > 1) {
        fail(
          `信息须宽 ${m.railBlock.width.toFixed(1)}px、「我」那条底栏宽 ${m.seatBar.width.toFixed(1)}px，` +
            `差 ${delta.toFixed(1)}px：两块取的是同一个尺度（--rail-w），宽度必须相等`
        );
      }
      // 同宽还不够：两块**一起**漂窄/漂宽也满足「相等」，所以再与这一屏该有的尺度比一次。
      if (Math.abs(m.railBlock.width - railScale) > 1) {
        fail(
          `信息须宽 ${m.railBlock.width.toFixed(1)}px，而这一屏的尺度（--rail-w）是 ${railScale}px：` +
            '两块同宽但一起偏了（媒体查询或变量没生效）'
        );
      }
    }
  }

  const rowHeight = m.history.rowHeight > 0 ? m.history.rowHeight : 24;
  const capacity = m.history.box === null ? 0 : Math.floor(m.history.box.height / rowHeight);
  /** 信息须里最紧的一格（需要宽度 − 可用宽度最大者）：负得越多越宽松 */
  const tightestRailCell = [...m.railHeads, ...m.railCells].reduce<RailCellBox | null>(
    (worst, cell) =>
      worst === null || cell.needed - cell.available > worst.needed - worst.available ? cell : worst,
    null
  );
  const wings = slot === undefined ? [] : m.spots.filter((spot) => spot.rect.width <= slot.width * 0.5);
  const wingMid =
    wings.length === 2
      ? (Math.min(...wings.map((s) => s.rect.x + s.rect.width / 2)) +
          Math.max(...wings.map((s) => s.rect.x + s.rect.width / 2))) /
        2
      : null;
  const midDelta =
    wingMid !== null && slot !== undefined ? wingMid - (slot.x + slot.width / 2) : null;
  const summary =
    `档位对齐最大差 ${worstDelta.toFixed(2)}px；历史容量 ${capacity} 行（已录 ${m.history.total} 条）；` +
    `内容槽 ${slot?.height.toFixed(0) ?? '—'}px；出牌点张数 ${m.spots.map((spot) => `${spot.seat}:${spot.cards.length}`).join(' ') || '（本场景无出牌）'}` +
    `；中点偏差 ${midDelta === null ? '—' : `${midDelta.toFixed(1)}px`}` +
    `；毡面 ${m.felt?.width.toFixed(0) ?? '—'}px / 尺度 ${railScale}px / 「我」栏 ${m.seatBar?.width.toFixed(0) ?? '—'}px` +
    `；信息须 ${m.railBlock?.width.toFixed(0) ?? '—'}×${m.railBlock?.height.toFixed(0) ?? '—'}px（${m.railCells.length} 格` +
    (tightestRailCell === null
      ? '）'
      : `，最紧一格「${tightestRailCell.name}」需要 ${tightestRailCell.needed.toFixed(1)} / 可用 ` +
        `${tightestRailCell.available.toFixed(1)}px，表头上边距 ${m.railHeads[0]?.padTop.toFixed(1) ?? '—'}px）`) +
    (m.clock === null
      ? '；闹钟 —'
      : `；闹钟三位数 ${m.clock.threeDigitsPx.toFixed(1)}px / 圆 ${m.clock.circleWidth.toFixed(0)}px` +
        ` @${m.clock.tierPx.long}px（${m.clock.tone}，实际字号 ${m.clock.liveFontPx}px）`);
  return { summary, problems };
}

async function shoot(
  shot: Shot,
  port: number,
  cookie: { code: string; credential: string }
): Promise<{ readonly path: string; readonly summary: string; readonly problems: readonly string[] }> {
  const target = await joinTarget(port);
  const cdp = await connectCdp(target.wsUrl);
  const outPath = join(outDir, `${shot.file}.png`);
  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCookie', {
      name: 'sixty_cred',
      value: cookie.credential,
      url: base
    });
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: shot.size.width,
      height: shot.size.height,
      deviceScaleFactor: 2,
      mobile: false
    });
    await cdp.send('Page.navigate', { url: `${base}/table/${cookie.code}` });
    // 等**牌桌页**真的加载完：只等 readyState 会在 navigate 提交之前读到 about:blank 的
    // 'complete'，于是截到一张空白页 —— 所以同时要求路径已经是 /table/<码>。
    await waitFor(
      async () => {
        const state = await evaluate<{ ready: string; path: string }>(
          cdp,
          `({ ready: document.readyState, path: location.pathname })`
        );
        return state !== null && state.ready === 'complete' && state.path.startsWith('/table/');
      },
      '页面加载'
    );
    // SSE 首帧 + 字体就绪：面板的候选档位由服务端首帧就给出，这里只是等排版稳定
    await evaluate(cdp, 'document.fonts ? document.fonts.ready.then(() => true) : true');
    for (const selector of shot.clicks ?? []) {
      const clicked = await evaluate<boolean>(
        cdp,
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`
      );
      if (clicked !== true) throw new Error(`${shot.file}：页面上找不到要点开的东西 ${selector}`);
      await new Promise((r) => setTimeout(r, 350));
    }
    await new Promise((r) => setTimeout(r, 400));

    const box =
      shot.mode === 'panel'
        ? await evaluate<Rect | null>(
            cdp,
            `(() => { const el = document.querySelector('[data-bid-panel]');
               if (!el) return null; const r = el.getBoundingClientRect();
               return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
          )
        : null;
    if (shot.mode === 'panel' && box === null) {
      throw new Error(`${shot.file}：页面上没有 [data-bid-panel]（不在叫牌阶段，或没轮到他）`);
    }
    const pad = 12;
    const clip =
      box === null
        ? undefined
        : {
            x: Math.max(0, Math.round(box.x - pad)),
            y: Math.max(0, Math.round(box.y - pad)),
            width: Math.round(box.width + pad * 2),
            height: Math.round(box.height + pad * 2),
            scale: 1
          };
    // 版面几何：**先量再拍**（量的是视口坐标，与截图无关）。不过判据也照拍 ——
    // 那张 PNG 正是「哪里不对」的证据，最后与文字一起报出来。
    const measurement = await evaluate<Measurement>(cdp, MEASURE);
    if (measurement === null) throw new Error(`${shot.file}：取不到版面测量结果（页面还没渲染完？）`);
    const layout = assertLayout(measurement, shot.file, shot.size.width);

    const capture = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: box !== null,
      ...(clip === undefined ? {} : { clip })
    })) as { data: string };
    writeFileSync(outPath, Buffer.from(capture.data, 'base64'));
    console.log(`    ↳ ${layout.summary}`);
    if (layout.problems.length > 0) {
      console.log(`    ✗ ${layout.problems.length} 条版面判据不过：`);
      for (const problem of layout.problems) console.log(`      - ${problem}`);
    }
    return { path: outPath, summary: layout.summary, problems: layout.problems };
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => undefined);
  }
}

/* ---------- 每个场景：新开一桌，把叫牌推到那一步，再拍 ---------- */

/**
 * 把局面推到「这一墩已经出了几张牌」：埋底 → 领出 → 跟牌。
 *
 * 牌面是随机发的，所以每一步都从 `/view` 现算一张合法牌（写死花色只在某一种发牌下通过 = 空转），
 * 判据用的是引擎的 `checkPlay`，与界面同一份规则。
 *
 * 出三张之后赢家要领出下一轮，而那需要它自己出手 —— 这三个座位都是脚本驱动的身份（不是机器人），
 * 所以画面会停在「三家都出过、等赢家领出」这一帧。
 */
async function driveTrick(
  code: string,
  seats: readonly Credential[],
  declarerSeat: number,
  plays: number
): Promise<void> {
  // 本脚本的场景都是「一叫两 pass」，所以庄家 = 第一个叫牌的那位（= 发牌人，不一定是座位 0）
  const declarer = seats[declarerSeat]!;
  const opening = await viewOf(code, declarer.credential);
  const hand = opening.you?.hand ?? [];
  if (opening.view.deal === null || hand.length === 0) throw new Error('出牌场景：庄家还没有手牌视图');
  await act(code, declarer.credential, { type: 'bury', cards: hand.slice(0, 3) });

  for (let step = 0; step < plays; step += 1) {
    const turn = (await viewOf(code, declarer.credential)).view.deal?.playTurn ?? null;
    if (turn === null) throw new Error(`出牌场景：该出第 ${step + 1} 张牌时没有人轮得到`);
    const state = await viewOf(code, seats[turn]!.credential);
    const deal = state.view.deal;
    const own = state.you?.hand ?? [];
    if (deal === null || deal.trump === null || own.length === 0) {
      throw new Error(`出牌场景：座位 ${turn} 看不到自己该出的牌`);
    }
    const plays = deal.trick?.plays ?? [];
    const lead = plays.length > 0 ? plays[0]!.cards : null;
    const card = own.find((candidate) => checkPlay(own, [candidate], deal.trump, lead) === null);
    if (card === undefined) throw new Error(`出牌场景：座位 ${turn} 手里找不到一张合法出牌`);
    await act(code, seats[turn]!.credential, { type: 'play', cards: [card] });
  }
}

/**
 * 从手牌里找一条**合法**顺子（同门连续段），长度取找得到的最大值、上限 `want`。
 *
 * 层号口径用引擎的 `cardLevel`（跳过级牌、主牌门合并），但**判定一律回到引擎自己**
 * （`isRun` + `classOfSet`）—— 这里写错只会「找不到」，不会造出非法的牌。
 */
function findRun(hand: readonly Card[], trump: TrumpModel, want: number): Card[] | null {
  const groups = new Map<string, Map<number, Card[]>>();
  for (const card of hand) {
    const cls = cardClass(card, trump);
    const level = cardLevel(card, trump);
    const group = groups.get(cls) ?? new Map<number, Card[]>();
    const bucket = group.get(level) ?? [];
    bucket.push(card);
    group.set(level, bucket);
    groups.set(cls, group);
  }
  let best: Card[] = [];
  for (const group of groups.values()) {
    const levels = [...group.keys()].sort((a, b) => a - b);
    // 一条链的起点必是「前一个层号不连续」处，所以走一遍连续段就够了（与 engine 的 segments 同构）
    let i = 0;
    while (i < levels.length) {
      const chain: Card[] = [group.get(levels[i]!)![0]!];
      let j = i;
      while (j + 1 < levels.length && levels[j + 1] === levels[j]! + 1) {
        j += 1;
        chain.push(group.get(levels[j]!)![0]!);
      }
      if (chain.length > best.length) best = chain;
      i = j + 1;
    }
  }
  const picked = best.slice(0, want);
  // 长度不达标就当没有：调用方靠这个 null 决定「整桌重发」，而不是拿一条 3 张的顺子顶替 5 张
  if (picked.length < want) return null;
  return isRun(picked, trump) && classOfSet(picked, trump) !== null ? picked : null;
}

/**
 * 组合枚举 + **引擎判定**，找第一组合法的 `size` 张出牌。
 *
 * 为什么不自己写跟牌规则：跟牌有两条约束（该门够 ⇒ 必须全出该门且连续段分解字典序最大；
 * 该门不够 ⇒ 必须先出完该门、其余自由垫），自己复述一遍迟早与引擎漂移 —— 这里只负责枚举，
 * 合法性一律问 `checkPlay`（界面与 MCP 用的是同一份）。
 */
function findLegalCombo(
  hand: readonly Card[],
  size: number,
  trump: TrumpModel,
  lead: readonly Card[]
): Card[] | null {
  const n = hand.length;
  if (size > n || size < 1) return null;
  const idx = Array.from({ length: size }, (_, i) => i);
  const picked: Card[] = [];
  let tried = 0;
  for (;;) {
    picked.length = 0;
    for (const i of idx) picked.push(hand[i]!);
    tried += 1;
    if (checkPlay(hand, picked, trump, lead) === null) return [...picked];
    if (tried > 40_000) return null;
    let k = size - 1;
    while (k >= 0 && idx[k] === n - size + k) k -= 1;
    if (k < 0) return null;
    idx[k] += 1;
    for (let j = k + 1; j < size; j += 1) idx[j] = idx[j - 1]! + 1;
  }
}

/**
 * 把局面推到「一墩三家各出 `runLength` 张」：庄家领出一条顺子，两家各跟同样张数。
 *
 * 为什么非要有这一条：`driveTrick` 只出**单张**，而单张会让 `computeClusterStep` 走早退分支
 * （count ≤ 1 ⇒ 不写 `--step`、走 CSS 默认间距）—— 于是「多张出牌堆的宽度预算」这条路径
 * 从来没有被任何守卫执行过：实测 5 张顺子把两簇挤到一起、还捅出毡面，而全部判据都是绿的。
 *
 * 埋底要**避开**那条顺子（顺子得留在手上领出）；三家固定各出 `runLength` 张，
 * 所以三家都会渲染多张出牌堆 —— 这正是要量的东西。
 */
async function driveRunTrick(
  code: string,
  seats: readonly Credential[],
  declarerSeat: number,
  runLength: number
): Promise<void> {
  const declarer = seats[declarerSeat]!;
  const opening = await viewOf(code, declarer.credential);
  const deal = opening.view.deal;
  const hand = opening.you?.hand ?? [];
  if (deal === null || deal.trump === null || hand.length === 0) {
    throw new Error('顺子场景：庄家还没有手牌视图');
  }
  const run = findRun(hand, deal.trump, runLength);
  if (run === null) throw new Error(`顺子场景：庄家手上没有 ${runLength} 张顺子`);
  const used = new Set(run.map(cardKey));
  const rest = hand.filter((card) => !used.has(cardKey(card)));
  if (rest.length < 3) throw new Error('顺子场景：顺子之外凑不够 3 张底牌');
  await act(code, declarer.credential, { type: 'bury', cards: rest.slice(0, 3) });
  await act(code, declarer.credential, { type: 'play', cards: run });

  for (let step = 1; step < 3; step += 1) {
    const turn = (await viewOf(code, declarer.credential)).view.deal?.playTurn ?? null;
    if (turn === null) throw new Error(`顺子场景：跟第 ${step} 家时没有人轮得到`);
    const state = await viewOf(code, seats[turn]!.credential);
    const trump = state.view.deal?.trump ?? null;
    const own = state.you?.hand ?? [];
    if (trump === null || own.length === 0) {
      throw new Error(`顺子场景：座位 ${turn} 看不到自己该出的牌`);
    }
    const lead = state.view.deal?.trick?.plays[0]?.cards ?? run;
    const combo = findLegalCombo(own, run.length, trump, lead);
    if (combo === null) {
      throw new Error(`顺子场景：座位 ${turn} 找不到合法的 ${run.length} 张跟牌`);
    }
    await act(code, seats[turn]!.credential, { type: 'play', cards: combo });
  }
}

/**
 * 开一桌并把叫牌推到成交。**顺子场景要能整桌重来**（5 张顺子只有约 6% 的发牌里有），
 * 所以「开桌 → 发牌 → 叫牌」从 `runShot` 里抽出来成为可重复调用的一步。
 *
 * `declarerSeat` 由发牌人现取（首副发牌人是随机的），而本脚本的叫牌模式都是「一叫两 pass」，
 * 所以庄家 = 发牌人 = `order[0]`。
 */
async function setupTable(
  seats: readonly Credential[],
  bids: Shot['bids']
): Promise<{ readonly code: string; readonly order: readonly Credential[]; readonly declarerSeat: number }> {
  const created = (await apiFetch(`${base}/api/tables`, {
    method: 'POST',
    headers: { authorization: `Bearer ${seats[0]!.credential}` }
  }).then((r) => r.json())) as { code: string };
  const code = created.code;
  for (const seat of seats.slice(1)) {
    const response = await apiFetch(`${base}/api/tables/${code}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${seat.credential}` }
    });
    if (!response.ok) throw new Error(`入座失败：${response.status}`);
  }
  await act(code, seats[0]!.credential, { type: 'deal' });

  // 叫牌顺序：发牌人起顺时针 —— 从视图里取，首副发牌人是随机的
  const declarerSeat = (await viewOf(code, seats[0]!.credential)).view.deal?.dealerSeat ?? 0;
  const order = [0, 1, 2].map((step) => seats[(declarerSeat + step) % 3]!);
  for (let i = 0; i < bids.length; i += 1) {
    // 叫牌严格按座位轮转，超过三个人就绕回第一位（成交前那一轮 pass 会绕回来）
    await act(code, order[i % 3]!.credential, { type: 'bid', call: bids[i]! });
  }
  return { code, order, declarerSeat };
}

async function runShot(
  shot: Shot,
  port: number,
  stamp: number,
  index: number
): Promise<{ readonly path: string; readonly summary: string; readonly problems: readonly string[] }> {
  const seats = await Promise.all(
    [0, 1, 2].map((i) => claim(`验收${index}${i}-${stamp}`))
  );
  const runLength = shot.runLength ?? 5;
  const attempts = shot.trick === 'run-clusters' ? RUN_ATTEMPTS : 1;
  let table: Awaited<ReturnType<typeof setupTable>> | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidate = await setupTable(seats, shot.bids);
    if (shot.trick !== 'run-clusters') {
      table = candidate;
      break;
    }
    // 顺子场景：庄家（= 发牌人 = 第一个叫牌人）手上得有 runLength 张顺子，否则整桌重发。
    // 顺带核对「他确实是庄家」：庄家才有 20 张手牌（17 + 拿上来的底牌 3），
    // 少了这一步，搜索会在 17 张上做而场景名说的是 20 张那一副。
    const leader = candidate.order[0]!;
    const view = await viewOf(candidate.code, leader.credential);
    const deal = view.view.deal;
    const viewHand = view.you?.hand ?? [];
    if (deal === null || deal.trump === null || deal.phase !== 'bury' || viewHand.length < 20) {
      throw new Error(
        `顺子场景：第一个叫牌人不是庄家（阶段 ${deal?.phase ?? '—'}、手牌 ${viewHand.length} 张）：` +
          '场景的 bids 必须是「一叫两 pass」'
      );
    }
    if (findRun(viewHand, deal.trump, runLength) !== null) {
      table = candidate;
      break;
    }
    if (attempt === attempts) {
      throw new Error(
        `顺子场景：重发 ${attempts} 次都没等到一副有 ${runLength} 张顺子的牌（实测概率约 5.9%/副，` +
          '这个上限不该撞上：真撞上了说明牌堆或规则变了）'
      );
    }
  }
  if (table === null) throw new Error('顺子场景：没能开出可用的牌桌');

  if (shot.trick === 'run-clusters') {
    await driveRunTrick(table.code, seats, table.declarerSeat, runLength);
  } else if (shot.trick !== undefined) {
    await driveTrick(table.code, seats, table.declarerSeat, shot.trick === 'two-played' ? 2 : 3);
  }
  const actor = table.order[shot.captureIndex]!;
  return await shoot(shot, port, { code: table.code, credential: actor.credential });
}

async function main(): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const server = await startServer();
  const chrome = await startChrome();
  const stamp = Date.now() % 100000;
  const written: { file: string; label: string; summary: string }[] = [];
  /** 全部场景的问题攒到最后一起报：第一处失败就退出的话，一次只能看见一个红点 */
  const failures: string[] = [];
  try {
    for (const [index, shot] of SHOTS.entries()) {
      const result = await runShot(shot, chrome.port, stamp, index);
      written.push({ file: result.path, label: shot.label, summary: result.summary });
      console.log(`✔ ${shot.file}.png  ${shot.label}`);
      for (const problem of result.problems) failures.push(`${shot.file}：${problem}`);
    }
  } finally {
    chrome.process.kill();
    server.process?.kill();
  }
  console.log(`\n共 ${written.length} 张，写在 ${outDir}`);
  for (const item of written) console.log(` - ${item.file}\n   ${item.summary}`);
  if (failures.length > 0) {
    throw new Error(`版面判据不过 ${failures.length} 条：\n  - ${failures.join('\n  - ')}`);
  }
}

await main();
