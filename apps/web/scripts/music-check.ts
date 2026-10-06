/**
 * 网易云音乐代理的**端到端回归**：真服务端 + 真 HTTP，只有网易云那一头是假的。
 *
 * 这个脚本守的是「只有起真服务端才发现」的几件事（纯函数测试盖不到）：
 *   1. 白名单真的在**路由**这一层生效（未知 op 404、参数错 400），不是只在纯函数里；
 *   2. `Origin` 跨站被 403 挡住（浏览器不给改 Origin，所以这条只能在服务端测）；
 *   3. **会话 cookie 走服务端**：上游的 `Set-Cookie` 变成我们的 httpOnly cookie，
 *      下一次请求把它作为 `cookie` 带给边车（前端从头到尾看不到 `MUSIC_U`）；
 *   4. 边车坏掉（503 / 非 JSON）时，`/api/music/*` 收敛成一条人话，而**牌桌页照常 200**；
 *   5. `SIXTY_MUSIC=off` 时整块功能下线（悬浮窗不出现、路由 404）。
 *
 * 假边车由本脚本用 `node:http` 起在进程内，所以 CI 里**不需要出网、不需要真账号**。
 * 想对着真边车验一遍（会真的打网易云）：
 *   SIXTY_MUSIC_API=http://127.0.0.1:4000 node scripts/music-check.ts
 * 这时脚本只跳过「假边车专用」的几条断言（见 `REAL_UPSTREAM`），其余照跑。
 *
 * 运行：BASE=http://127.0.0.1:5178 node scripts/music-check.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, rmSync } from 'node:fs';

const BUILT_SERVER = 'build/index.js';
const REAL_UPSTREAM = process.env['SIXTY_MUSIC_API'] ?? null;
const APP_PORT = Number(process.env['MUSIC_CHECK_APP_PORT'] ?? 5199);

/**
 * 给假边车挑一个空闲端口。
 *
 * 为什么不写死 4242：本地同时开着真边车、或上一轮脚本没退干净时，写死的端口会当场
 * `EADDRINUSE` 挂掉 —— 那看起来像功能坏了，其实只是端口撞了。绑 0 让内核给一个，问完就放掉。
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 4242;
      probe.close(() => resolve(port));
    });
  });
}

const STUB_PORT = await freePort();
const STUB_BASE = `http://127.0.0.1:${STUB_PORT}`;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- 假边车 ---------- */

interface StubHit {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly cookie: string | undefined;
}

/**
 * 假 ncm-api：只实现这个播放器真会调的端点，形状照上游文档。
 * `mode` 用来制造坏情况：`ok` / `error`（5xx）/ `html`（非 JSON）。
 */
function startStub(): { server: Server; hits: StubHit[]; mode: () => string; setMode: (next: string) => void } {
  const hits: StubHit[] = [];
  let mode = 'ok';
  const server = createServer((request, response) => {
    // 必须把请求体读掉（哪怕用不上）：不读干净，`keep-alive` 连接上的下一个请求会被卡住
    // ——「喜欢」那条 POST 曾经因此拿到 503（代理把连接断开当成了上游故障）。
    request.resume();
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${STUB_PORT}`);
    hits.push({ path: url.pathname, query: url.searchParams, cookie: request.headers.cookie });
    if (mode === 'error') {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 503, msg: '边车炸了' }));
      return;
    }
    if (mode === 'html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>not json</html>');
      return;
    }

    const send = (body: unknown): void => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    switch (url.pathname) {
      case '/cloudsearch':
        send({
          result: {
            songCount: 1,
            songs: [
              {
                id: 347230,
                name: '海阔天空',
                ar: [{ name: 'BEYOND' }],
                al: { name: '乐与怒', picUrl: 'http://stub/cover.jpg' },
                dt: 326_000,
                fee: 0
              }
            ]
          }
        });
        return;
      case '/song/url/v1':
        send({ data: [{ id: Number(url.searchParams.get('id')), url: 'http://stub/song.mp3', freeTrialInfo: null, fee: 0 }] });
        return;
      case '/lyric':
        send({ lrc: { lyric: '[00:01.00]今天我\n[00:03.00]寒夜里看雪飘过' }, tlyric: { lyric: '[00:01.00]Today I' } });
        return;
      case '/login/qr/key':
        send({ data: { unikey: 'stub-key' }, code: 200 });
        return;
      case '/login/qr/create':
        send({ data: { qrurl: 'https://music.163.com/login?codekey=stub-key', qrimg: 'data:image/png;base64,AAA' }, code: 200 });
        return;
      case '/login/qr/check':
        // 第一次「等待扫码」，第二次「确认登录」并带上会话 cookie（模拟真边车）
        if (hits.filter((hit) => hit.path === '/login/qr/check').length < 2) {
          send({ code: 801, message: '等待扫码' });
          return;
        }
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'MUSIC_U=stub-session; Path=/; HttpOnly'
        });
        response.end(JSON.stringify({ code: 803, message: '授权成功' }));
        return;
      case '/login/status':
        send({ data: { account: { id: 42 }, profile: { userId: 42, nickname: '假用户', vipType: 0 } } });
        return;
      case '/likelist':
        send({ ids: [347230] });
        return;
      case '/song/like':
        send({ code: 200, playlistId: 0 });
        return;
      case '/logout':
        send({ code: 200 });
        return;
      default:
        process.stderr.write(`[stub] 没有实现的端点：${url.pathname}\n`);
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: 404, msg: '没有这个端点' }));
    }
  });
  return { server, hits, mode: () => mode, setMode: (next) => void (mode = next) };
}

/* ---------- 起真服务端 ---------- */

interface AppHandle {
  readonly process: ChildProcess;
  readonly base: string;
  stop(): Promise<void>;
}

async function startApp(port: number, env: Record<string, string>): Promise<AppHandle> {
  const child = spawn(process.execPath, [BUILT_SERVER], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) break;
    } catch {
      // 还没起来
    }
    await sleep(200);
  }
  const probe = await fetch(`${base}/`).catch(() => null);
  if (probe === null || !probe.ok) throw new Error(`服务端没起来（端口 ${port}）：\n${log}`);

  return {
    process: child,
    base,
    stop: async () => {
      child.kill('SIGTERM');
      await sleep(300);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  };
}

/* ---------- 用到的几个小工具 ---------- */

async function claim(base: string, name: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(`注册失败：${response.status}`);
  return ((await response.json()) as { credential: string }).credential;
}

async function music(
  base: string,
  op: string,
  params: Record<string, string> = {},
  init: { cookie?: string; origin?: string; method?: 'GET' | 'POST' } = {}
): Promise<{ status: number; body: any; response: Response }> {
  const method = init.method ?? 'GET';
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${base}/api/music/${op}${method === 'GET' && query !== '' ? `?${query}` : ''}`, {
    method,
    headers: {
      ...(init.origin === undefined ? {} : { origin: init.origin }),
      ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {})
    },
    ...(method === 'POST' ? { body: JSON.stringify(params) } : {})
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, response };
}

/* ---------- 主流程 ---------- */

async function main(): Promise<void> {
  if (!existsSync(BUILT_SERVER)) {
    throw new Error(`找不到 ${BUILT_SERVER}：先跑 \`pnpm build\`（这个脚本打的是构建产物）`);
  }

  /**
   * 每次跑都用一个独立的库文件，跑完删掉。
   *
   * 不删的后果实测过一次：连续跑几轮之后 `/tmp` 里堆着一串 `sixty-music-check-*.db`
   * 没人认领（SQLite 还会捎带 `-wal` / `-shm`）。这个脚本是给别人反复跑的，
   * 收尾就该由它自己负责。
   */
  const dbPath = `/tmp/sixty-music-check-${Date.now() % 1e6}.db`;
  const dropDb = (): void => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        // 删不掉不影响结论：这是收尾，不是断言
      }
    }
  };

  const stub = startStub();
  await new Promise<void>((resolve) => stub.server.listen(STUB_PORT, '127.0.0.1', resolve));
  const app = await startApp(APP_PORT, { SIXTY_MUSIC_API: STUB_BASE, SIXTY_DB: dbPath });
  const base = app.base;

  try {
    const stamp = Date.now() % 100000;
    const credential = await claim(base, `音乐${stamp}`);
    const created = (await fetch(`${base}/api/tables`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}` }
    }).then((r) => r.json())) as { code: string };

    // ① 牌桌页仍然正常，且**首帧**里没有悬浮窗（组件在 onMount 之后才渲染）
    const pageHtml = await fetch(`${base}/table/${created.code}`, { headers: { cookie: `sixty_cred=${credential}` } }).then(
      (r) => r.text()
    );
    assert(!pageHtml.includes('data-music-dock'), '牌桌页的首帧 HTML 里出现了音乐悬浮窗（SSR 不该渲染它）');
    assert(!pageHtml.includes('data-music-audio'), '牌桌页的首帧 HTML 里出现了 <audio>');

    // ② 搜索：走真服务端 → 假边车，曲目形状正常
    const search = await music(base, 'search', { keywords: '海阔天空' });
    assert(search.status === 200, `搜索应当 200，实际 ${search.status}`);
    assert(search.body?.ok === true, '搜索没有回 { ok: true }');
    const songs = search.body.data.result.songs as { name: string }[];
    assert(songs.length === 1 && songs[0]!.name === '海阔天空', '搜索结果的曲目不对');
    const searchHit = stub.hits.find((hit) => hit.path === '/cloudsearch');
    assert(searchHit !== undefined, '假边车没收到 /cloudsearch');
    assert(searchHit.query.get('keywords') === '海阔天空', 'keywords 没传对');
    assert(searchHit.query.get('noCookie') === 'true', '读操作应当带 noCookie');

    // ③ 播放地址：匿名必须是 standard（配置里写的是 lossless 也不能用）
    const ticket = await music(base, 'songUrl', { id: '347230' });
    assert(ticket.status === 200 && ticket.body.data.data[0].url === 'http://stub/song.mp3', '拿不到播放地址');
    const urlHit = stub.hits.filter((hit) => hit.path === '/song/url/v1').at(-1)!;
    assert(urlHit.query.get('level') === 'standard', `匿名音质应当是 standard，实际 ${urlHit.query.get('level')}`);

    // ④ 歌词：解析成行（前端 `parseLrc` 的输入就是这一段文本）
    const lyric = await music(base, 'lyric', { id: '347230' });
    assert(lyric.status === 200 && typeof lyric.body.data.lrc.lyric === 'string', '歌词形状不对');
    assert(lyric.body.data.tlyric.lyric.includes('Today'), '翻译没带回来');

    // ⑤ 白名单与参数：未知 op 404、缺参数 400 —— 都在路由这一层
    const unknown = await music(base, 'playlist%2Fupdate', { name: 'x' });
    assert(unknown.status === 404, `未知 op 应当 404，实际 ${unknown.status}`);
    const bad = await music(base, 'songUrl', {});
    assert(bad.status === 400, `缺参数应当 400，实际 ${bad.status}`);
    const badType = await music(base, 'search', { keywords: 'x', type: '7' });
    assert(badType.status === 400, `非法搜索类型应当 400，实际 ${badType.status}`);
    const hitsBefore = stub.hits.length;
    await music(base, 'user%2Fplaylist', { uid: '1' });
    assert(stub.hits.length === hitsBefore, '被挡下的请求竟然打到了边车');

    // ⑥ Origin 跨站：403（只有服务端这一层能挡住）
    const crossSite = await music(base, 'search', { keywords: 'x' }, { origin: 'https://evil.example' });
    assert(crossSite.status === 403, `跨站 Origin 应当 403，实际 ${crossSite.status}`);
    // 同站 Origin 放行
    const sameSite = await music(base, 'search', { keywords: 'x' }, { origin: base });
    assert(sameSite.status === 200, `同站 Origin 应当放行，实际 ${sameSite.status}`);

    // ⑦ 扫码登录 → 会话落到我们的 httpOnly cookie → 后续请求把它带给边车
    if (REAL_UPSTREAM === null) {
      const key = await music(base, 'loginQrKey');
      assert(key.status === 200 && key.body.data.data.unikey === 'stub-key', '拿不到二维码 key');
      const created2 = await music(base, 'loginQrCreate', { key: 'stub-key', qrimg: 'true' });
      assert(created2.body.data.data.qrimg.startsWith('data:image/png'), '二维码图片形状不对');

      const waiting = await music(base, 'loginQrCheck', { key: 'stub-key' });
      assert(waiting.body.data.code === 801, '第一次轮询应当是「等待扫码」');
      const confirmed = await music(base, 'loginQrCheck', { key: 'stub-key' });
      assert(confirmed.body.data.code === 803, '第二次轮询应当是「授权成功」');
      const setCookie = confirmed.response.headers.getSetCookie().join('; ');
      assert(setCookie.includes('sixty.music.session='), `上游会话没有变成我们的 cookie：${setCookie}`);
      assert(setCookie.includes('HttpOnly'), '会话 cookie 必须是 httpOnly（前端不该看到它）');
      const sessionCookie = setCookie
        .split(/,\s*/)
        .map((piece) => piece.split(';', 1)[0]!)
        .find((piece) => piece.startsWith('sixty.music.session='))!;

      assert(!confirmed.body.data.cookie?.includes('stub-session'), '代理把上游凭据原样回给了浏览器');

      // 登录态：昵称来自上游 profile
      const status = await music(base, 'loginStatus', {}, { cookie: sessionCookie });
      assert(status.body.data.data.profile.nickname === '假用户', '登录态没读到昵称');

      // 写操作（喜欢）：POST + 带上会话 + **不带 noCookie**
      const like = await music(base, 'songLike', { id: '347230', uid: '42', like: 'true' }, { cookie: sessionCookie, method: 'POST' });
      assert(like.status === 200, `喜欢应当 200，实际 ${like.status}：${JSON.stringify(like.body)}`);
      const likeHit = stub.hits.filter((hit) => hit.path === '/song/like').at(-1)!;
      assert(likeHit.cookie === 'MUSIC_U=stub-session', `写操作没带上会话 cookie：${likeHit.cookie}`);
      assert(likeHit.query.get('noCookie') === null, '写操作不该带 noCookie（Set-Cookie 要留下来）');

      // 登录后音质升到配置档位（默认 exhigh）
      await music(base, 'songUrl', { id: '347230' }, { cookie: sessionCookie });
      const vipHit = stub.hits.filter((hit) => hit.path === '/song/url/v1').at(-1)!;
      assert(vipHit.query.get('level') === 'exhigh', `登录用户音质应当是 exhigh，实际 ${vipHit.query.get('level')}`);
    } else {
      // 对着真边车：只验它认这些 op（不保证一定有播放权限）
      const real = await music(base, 'search', { keywords: '海阔天空' });
      assert(real.status === 200, `真边车搜索应当 200，实际 ${real.status}`);
      console.log('（对着真边车跑：扫码与「喜欢」那几条断言已跳过）');
    }

    // ⑧ 边车 5xx：收敛成 503 + 一句人话；牌桌页照样 200
    stub.setMode('error');
    const offline = await music(base, 'search', { keywords: 'x' });
    assert(offline.status === 503, `边车 503 时应当收敛成 503，实际 ${offline.status}`);
    assert(offline.body?.ok === false && typeof offline.body.error.message === 'string', '失败没有归一成 { ok:false, error }');
    const stillPlayable = await fetch(`${base}/table/${created.code}`, { headers: { cookie: `sixty_cred=${credential}` } });
    assert(stillPlayable.ok, `边车坏掉时牌桌页也挂了（${stillPlayable.status}）`);

    // ⑨ 边车回 HTML（反代错误页）：也说人话，不把 HTML 塞进界面
    stub.setMode('html');
    const garbage = await music(base, 'search', { keywords: 'x' });
    assert(garbage.status === 503, `非 JSON 应当收敛成 503，实际 ${garbage.status}`);
    assert(String(garbage.body?.error?.message ?? '').includes('看不懂'), '非 JSON 的提示不可读');
    stub.setMode('ok');
  } finally {
    await app.stop();
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    dropDb();
  }

  // ⑩ SIXTY_MUSIC=off：整块功能下线（路由 404 + 页面里没有悬浮窗）
  // 关掉开关：换一个进程（配置在进程启动时读一次）
  const off = await startApp(APP_PORT + 1, { SIXTY_MUSIC: 'off', SIXTY_MUSIC_API: STUB_BASE });
  try {
    const closed = await music(off.base, 'search', { keywords: 'x' });
    assert(closed.status === 404, `SIXTY_MUSIC=off 时应当 404，实际 ${closed.status}`);
    const credential = await claim(off.base, `关掉${Date.now() % 100000}`);
    const created = (await fetch(`${off.base}/api/tables`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}` }
    }).then((r) => r.json())) as { code: string };
    const html = await fetch(`${off.base}/table/${created.code}`, { headers: { cookie: `sixty_cred=${credential}` } }).then((r) =>
      r.text()
    );
    assert(!html.includes('data-music-dock'), 'SIXTY_MUSIC=off 时牌桌页不该有音乐悬浮窗');
    assert(html.includes('felt'), '牌桌页本身应当照常渲染');
  } finally {
    await off.stop();
  }

  console.log('音乐代理回归通过：白名单 / Origin / 会话 cookie / 音质 / 失败收敛 / 关闭开关');
}

await main();
