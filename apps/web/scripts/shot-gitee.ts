/**
 * Gitee 登录与管理员面的**验收截图**（ADR-0023 / ADR-0024）：把新增的两块界面
 * 拍成 PNG 供人工验收（手机端为主，桌面端随后）。
 *
 * 为什么不是一个「打开页面截个图」的命令：这两块界面都**按身份渲染**，而 Gitee 身份
 * 拿不到凭据串、会话行只存在于服务端 —— 所以脚本自己起服务端 + 自己的库，直接往库里
 * 种一条 Gitee 身份与会话（令牌永不外发正是这个功能的核心，所以没法走「先在界面上登录」），
 * 再驱动无头 Chromium 逐屏截图。
 *
 * 顺带当 UI 守卫：身份卡上**不许**出现「复制凭据」、登出弹层必须给出「离开房间并登出」、
 * 管理面板必须带三个写操作入口 —— 每屏截图前都断言（截图给人看，断言防它悄悄坏掉）。
 *
 * 浏览器走 CDP 而不是 Playwright（仓库没有那个依赖，Node 24 自带 WebSocket），
 * Chromium 复用本机 playwright 装好的那份。骨架与 `shot-auction.ts` 同一套。
 *
 * 运行：pnpm shot:gitee
 * 产物：apps/web/.shots/gitee-*.png（目录已在 .gitignore 里）
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const webRoot = resolve(here, '..');
const outDir = resolve(webRoot, '.shots');
/** 运行期状态放系统临时目录（vite 会 watch 项目根，浏览器 profile 与 sqlite 的 -wal 一被 watch 就 EBUSY） */
const workDir = mkdtempSync(join(tmpdir(), 'sixty-shot-gitee-'));

let base = '';

/* ---------- 种数据（服务端起完、库建好之后） ---------- */

const GITEE_ID = '900001';
const GITEE_NAME = '阿六';
const SESSION = 'shotGiteeSessionToken000000000000000001';
const LOCAL_NAME = '本地小明';
const LOCAL_TOKEN = 'shotLocalToken';
const LOCAL_CREDENTIAL = Buffer.from(`${LOCAL_NAME}:${LOCAL_TOKEN}`, 'utf8').toString('base64url');

function seed(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();
  const far = iso(30 * 24 * 60 * 60 * 1000);
  const insertUser = db.prepare(
    'INSERT INTO users (name, token, created_at, is_bot, gitee_id) VALUES (?, ?, ?, 0, ?)'
  );
  const gitee = Number(insertUser.run(GITEE_NAME, 'shotGiteeToken', iso(), GITEE_ID).lastInsertRowid);
  const local = Number(insertUser.run(LOCAL_NAME, LOCAL_TOKEN, iso(), null).lastInsertRowid);
  const friend = Number(insertUser.run('牌友甲', 'shotTokenA', iso(), null).lastInsertRowid);
  const friend2 = Number(insertUser.run('牌友乙', 'shotTokenB', iso(), null).lastInsertRowid);
  const outsider = Number(insertUser.run('路人丙', 'shotTokenC', iso(), '900999').lastInsertRowid);

  const insertTable = db.prepare('INSERT INTO tables (code, host_user_id, created_at) VALUES (?, ?, ?)');
  const insertSeat = db.prepare(
    'INSERT INTO seats (table_id, seat, user_id, joined_at) VALUES (?, ?, ?, ?)'
  );
  // 本地小明的桌：登出弹层要用「在座」这个前提
  const localTable = Number(insertTable.run('TBLAAB', local, iso()).lastInsertRowid);
  insertSeat.run(localTable, 0, local, iso());
  insertSeat.run(localTable, 1, friend, iso());
  // Gitee 身份的桌：管理员页上看起来像真局
  const giteeTable = Number(insertTable.run('TBLCCD', gitee, iso()).lastInsertRowid);
  insertSeat.run(giteeTable, 0, gitee, iso());
  insertSeat.run(giteeTable, 1, friend2, iso());
  // 一张没人坐的旧桌（管理员页的「删桌」对象）
  insertTable.run('TBLEEF', outsider, iso());

  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    SESSION,
    gitee,
    iso(),
    far
  );
  db.close();
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function startServer(dbPath: string): Promise<ChildProcess> {
  const vite = realpathSync.native(resolve(webRoot, 'node_modules/vite/bin/vite.js'));
  if (!existsSync(vite)) throw new Error(`找不到 ${vite}：先在 apps/web 里 pnpm install`);
  const port = await freePort();
  const logPath = join(workDir, 'vite-dev.log');
  const logFd = openSync(logPath, 'w');
  // stdio 落文件而不是 pipe：沙箱里 piped stdio 会 EPERM，且起不来时报错要带上它自己的话
  const child = spawn(
    process.execPath,
    [vite, 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: webRoot,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        SIXTY_DB: dbPath,
        // Gitee 登录「已配置」才会渲染按钮/开回调；管理员名单里放种进去的那个 gitee id
        SIXTY_GITEE_CLIENT_ID: 'shot-client-id',
        SIXTY_GITEE_CLIENT_SECRET: 'shot-client-secret',
        SIXTY_ADMIN_GITEE_IDS: GITEE_ID
      }
    }
  );
  base = `http://127.0.0.1:${port}`;
  try {
    // 起完先热两次：首次请求会触发依赖预构建并重启 dev server
    let stable = 0;
    await waitFor(async () => {
      try {
        stable = (await fetch(`${base}/`)).ok ? stable + 1 : 0;
      } catch {
        stable = 0;
      }
      return stable >= 2;
    }, 'vite dev 启动');
  } catch (error) {
    child.kill();
    throw new Error(`${String(error)}\nvite dev 的输出在 ${logPath}`);
  }
  return child;
}

/** 本机 playwright 装好的 Chromium：版本号带后缀，取最新的那一份 */
function chromiumPath(): string {
  const root = join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright');
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .map((name) => join(root, name, 'chrome-win64', 'chrome.exe'))
    .filter((path) => existsSync(path));
  const newest = candidates[candidates.length - 1];
  if (newest === undefined) throw new Error(`在 ${root} 里找不到 Chromium`);
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
      '--force-prefers-reduced-motion',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(workDir, 'chrome-profile')}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 'Chromium 启动');
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
  await new Promise<void>((open, reject) => {
    socket.addEventListener('open', () => open(), { once: true });
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
    const wait = pending.get(message.id);
    if (wait === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) wait.reject(new Error(message.error.message ?? 'CDP 调用失败'));
    else wait.resolve(message.result);
  });
  return {
    send(method, params) {
      const id = (nextId += 1);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }));
      });
    },
    close: () => socket.close()
  };
}

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

/* ---------- 屏定义 ---------- */

interface Screen {
  readonly file: string;
  readonly url: string;
  readonly cookies?: readonly { readonly name: string; readonly value: string }[];
  readonly size: { readonly width: number; readonly height: number };
  /** 截图前在页面里跑的 JS（例如点开登出弹层） */
  readonly after?: string;
  readonly mustContain?: readonly string[];
  readonly mustNotContain?: readonly string[];
  /** 页面上看不见的东西按选择器断言（例如只有图标的 Gitee 入口，没有可见文字可查） */
  readonly probes?: readonly { readonly expression: string; readonly label: string }[];
  /** 拍整页而不是只拍视口（管理面板比一屏长，验收要看到全部） */
  readonly fullPage?: boolean;
}

const CLICK_LOGOUT = `(() => {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === '登出');
  if (button === undefined) return 'no-button';
  button.click();
  return 'clicked';
})()`;

/**
 * 登出确认必须是**弹窗**：`fixed` 且盖住整个视口。
 *
 * 这条探针来自一次真实的返工：第一版把它做成身份卡里内联的一块，看着像弹窗、
 * 实际会把下面的内容推下去。选择器与几何一起断言，退回内联就会被抓出来。
 */
const LOGOUT_MODAL_PROBE = {
  expression: `(() => {
    const el = document.querySelector('[data-logout-confirm]');
    if (el === null) return false;
    const rect = el.getBoundingClientRect();
    return getComputedStyle(el).position === 'fixed'
      && rect.width >= innerWidth - 1 && rect.height >= innerHeight - 1;
  })()`,
  label: '登出确认是覆盖全屏的 fixed 弹窗（不是卡片内联的一块）'
} as const;

/**
 * Gitee 入口是**一枚小图标**：链接存在、指向 start 路由、里面是内联 SVG（不是文字「G」）。
 * 三条一起断言，因为「改回一颗金色大按钮」和「把官标换成字母」是这类入口最常见的两次回潮。
 */
const GITEE_ENTRY_PROBE = {
  expression: `(() => {
    const link = document.querySelector('a[href^="/api/auth/gitee/start"]');
    if (link === null) return false;
    const mark = link.querySelector('svg');
    return mark !== null && mark.querySelector('path') !== null;
  })()`,
  label: 'Gitee 入口（官方 SVG 小图标）存在且指向 start 路由'
} as const;

/**
 * 身份卡上**没有**「复制凭据」这颗按钮。
 *
 * 注意它是**按钮**探针，不是子串探针：Gitee 身份的说明句里正好写着
 * 「不能复制凭据用于驱动 MCP」—— 用 `mustNotContain: ['复制凭据']` 会把
 * **我们想保留的那句话**判成违规（真发生过一次）。要守的是「没有可点的复制入口」。
 */
const NO_COPY_BUTTON_PROBE = {
  expression: `![...document.querySelectorAll('button')].some(
    (el) => el.textContent.trim() === '复制凭据'
  )`,
  label: '身份卡上没有「复制凭据」按钮（说明句里提到这四个字不算）'
} as const;

/** 反向对照：本地身份那一屏**必须**有这颗按钮 —— 少了它，上面那条探针可能只是空转 */
const COPY_BUTTON_PRESENT_PROBE = {
  expression: `[...document.querySelectorAll('button')].some(
    (el) => el.textContent.trim() === '复制凭据'
  )`,
  label: '本地身份有「复制凭据」按钮（证明上面那条探针不是空转）'
} as const;

const SCREENS: readonly Screen[] = [
  {
    file: 'gitee-login-mobile',
    url: '/',
    size: { width: 390, height: 844 },
    // 统一说明里那句「跨平台同步」证明 Gitee 已配置；入口本身是图标，按选择器断言
    mustContain: ['跨平台同步'],
    probes: [GITEE_ENTRY_PROBE, NO_COPY_BUTTON_PROBE]
  },
  {
    file: 'gitee-local-identity-mobile',
    url: '/',
    cookies: [{ name: 'sixty_cred', value: LOCAL_CREDENTIAL }],
    size: { width: 390, height: 844 },
    // 本地身份：照旧有凭据串、照旧有复制按钮（Gitee 那两条改动的反向对照）
    mustContain: [LOCAL_NAME, '复制凭据'],
    probes: [COPY_BUTTON_PRESENT_PROBE]
  },
  {
    file: 'gitee-identity-mobile',
    url: '/',
    cookies: [{ name: 'sixty_session', value: SESSION }],
    size: { width: 390, height: 844 },
    // ADR-0023 的 UI 结果：Gitee 身份没有可复制的凭据，且页面**明说**它不能驱动 MCP
    mustContain: [GITEE_NAME, 'Gitee', '驱动 MCP'],
    probes: [NO_COPY_BUTTON_PROBE]
  },
  {
    file: 'gitee-logout-mobile',
    url: '/',
    cookies: [{ name: 'sixty_cred', value: LOCAL_CREDENTIAL }],
    size: { width: 390, height: 844 },
    after: CLICK_LOGOUT,
    mustContain: ['回不来了', '离开房间并登出', '直接登出'],
    probes: [LOGOUT_MODAL_PROBE]
  },
  {
    file: 'gitee-login-desktop',
    url: '/',
    size: { width: 1440, height: 900 },
    mustContain: ['跨平台同步'],
    probes: [GITEE_ENTRY_PROBE]
  },
  {
    file: 'gitee-identity-desktop',
    url: '/',
    cookies: [{ name: 'sixty_session', value: SESSION }],
    size: { width: 1440, height: 900 },
    mustContain: [GITEE_NAME, 'Gitee', '驱动 MCP'],
    probes: [NO_COPY_BUTTON_PROBE]
  },
  {
    file: 'gitee-admin-desktop',
    url: '/admin',
    cookies: [{ name: 'sixty_session', value: SESSION }],
    size: { width: 1440, height: 900 },
    fullPage: true,
    mustContain: ['管理面板', '强制离座', '删桌', '删用户']
  }
];

/** 整页截图的参数：按内容尺寸给 clip（只加 captureBeyondViewport 是不完整的） */
async function fullPageParams(cdp: Cdp): Promise<Record<string, unknown>> {
  const metrics = (await cdp.send('Page.getLayoutMetrics')) as {
    cssContentSize?: { width: number; height: number };
    contentSize?: { width: number; height: number };
  };
  const size = metrics.cssContentSize ?? metrics.contentSize;
  if (size === undefined) return {};
  return {
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 }
  };
}

async function capture(chromePort: number, screen: Screen): Promise<string> {
  const target = await joinTarget(chromePort);
  const cdp = await connectCdp(target.wsUrl);
  const outPath = join(outDir, `${screen.file}.png`);
  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCookies');
    for (const cookie of screen.cookies ?? []) {
      await cdp.send('Network.setCookie', { name: cookie.name, value: cookie.value, url: base });
    }
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: screen.size.width,
      height: screen.size.height,
      deviceScaleFactor: 2,
      mobile: screen.size.width < 600
    });
    await cdp.send('Page.navigate', { url: `${base}${screen.url}` });
    const path = screen.url.split('?')[0]!;
    await waitFor(async () => {
      const state = await evaluate<{ ready: string; path: string }>(
        cdp,
        `({ ready: document.readyState, path: location.pathname })`
      );
      return state !== null && state.ready === 'complete' && state.path === path;
    }, `${screen.file} 页面加载`);
    await evaluate(cdp, 'document.fonts ? document.fonts.ready.then(() => true) : true');
    if (screen.after !== undefined) {
      // 点击是同步派发的，而 Svelte 的事件处理器要等**水合**才挂上 —— 固定睡几百毫秒会偶发失败
      // （第一次就是这么栽的：点了没反应、弹层没开）。所以点到**有效果**为止；
      // 代价是 `after` 必须幂等（重复点不出副作用），登出这种只开不关的正合适。
      await waitFor(async () => {
        const result = await evaluate<string>(cdp, screen.after!);
        if (result === 'no-button') return false;
        const now = (await evaluate<string>(cdp, 'document.body.innerText')) ?? '';
        return (screen.mustContain ?? []).every((needle) => now.includes(needle));
      }, `${screen.file}：交互生效`, 10_000);
    } else {
      // 没有交互的屏：等这一屏该有的文案出现（同样比固定睡眠可靠）
      await waitFor(async () => {
        const now = (await evaluate<string>(cdp, 'document.body.innerText')) ?? '';
        return (screen.mustContain ?? []).every((needle) => now.includes(needle));
      }, `${screen.file}：内容就绪`, 10_000);
    }
    await sleep(250);

    const text = (await evaluate<string>(cdp, 'document.body.innerText')) ?? '';
    const snippet = text.replace(/\s+/g, ' ').slice(0, 500);
    for (const needle of screen.mustContain ?? []) {
      if (!text.includes(needle)) {
        throw new Error(`${screen.file}：页面上没有「${needle}」；实渲染：${snippet}`);
      }
    }
    for (const needle of screen.mustNotContain ?? []) {
      if (text.includes(needle)) {
        throw new Error(`${screen.file}：页面上不该有「${needle}」；实渲染：${snippet}`);
      }
    }
    for (const probe of screen.probes ?? []) {
      if ((await evaluate<boolean>(cdp, probe.expression)) !== true) {
        throw new Error(`${screen.file}：${probe.label} 不成立；实渲染：${snippet}`);
      }
    }

    const capture = (await cdp.send('Page.captureScreenshot', {
      format: 'png',
      ...(screen.fullPage === true ? await fullPageParams(cdp) : {})
    })) as { data: string };
    writeFileSync(outPath, Buffer.from(capture.data, 'base64'));
    return outPath;
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${chromePort}/json/close/${target.id}`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const dbPath = join(workDir, 'shot-gitee.db');
  const server = await startServer(dbPath);
  let chrome: { process: ChildProcess; port: number } | null = null;
  try {
    seed(dbPath);
    chrome = await startChrome();
    const written: string[] = [];
    for (const screen of SCREENS) {
      const path = await capture(chrome.port, screen);
      written.push(path.replace(`${webRoot}\\`, ''));
      console.log(`✔ ${screen.file}  ${screen.size.width}×${screen.size.height}`);
    }
    console.log(`\n截图产物（${written.length} 张）：`);
    for (const path of written) console.log(`  ${path}`);
  } catch (error) {
    // 失败时把 vite dev 的日志尾巴带出来：否则只剩一句「超时」或一句断言，看不出为什么
    const logPath = join(workDir, 'vite-dev.log');
    const tail = existsSync(logPath)
      ? readFileSync(logPath, 'utf8').split('\n').slice(-25).join('\n')
      : '(没有日志)';
    throw new Error(`${String(error)}\n--- vite dev 日志尾 ---\n${tail}`);
  } finally {
    // 收尾一律尽力而为：Chromium 松手前后删 profile 目录会 EPERM，
    // 而清理失败**绝不能**盖掉真正的错误（第一次就是这么把真因吞掉的）
    try {
      chrome?.process.kill();
    } catch {
      // 已经退了
    }
    try {
      server.kill();
    } catch {
      // 已经退了
    }
    await sleep(300);
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // 临时目录留给系统回收
    }
  }
}

await main();
