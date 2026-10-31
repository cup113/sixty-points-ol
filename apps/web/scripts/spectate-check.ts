/**
 * 观战 / 离座 / 改名换身份的端到端回归。
 *
 * 这个脚本守的是「只能靠真服务端才发现」的几件事：
 *   1. 满座时第 4 个人不再被 403，而是拿到**观战**负载（公共视图，没有手牌）；
 *   2. 观战负载里不得出现任何在座玩家的手牌（结构性检查，不是子串匹配）；
 *   3. 离座腾空座位后，发牌被拒、别人能看到空座，补位者**继承该座位的级别与手牌**；
 *   4. 观战者不能操作；在座时不能改名/换身份；改名后旧凭据失效、新凭据可用。
 *
 * 运行：BASE=http://127.0.0.1:5178 node scripts/spectate-check.ts
 */
const BASE = process.env['BASE'] ?? 'http://127.0.0.1:5178';

interface Credential {
  name: string;
  credential: string;
}

interface Card {
  suit?: string;
  rank?: number;
  joker?: string;
}

interface SeatInfo {
  seat: number;
  userId: number | null;
  name: string | null;
  online: boolean;
  bot: boolean;
}

interface TableView {
  code: string;
  seats: SeatInfo[];
  seatedCount: number;
  ready: boolean;
  spectatorCount: number;
}

interface DealView {
  phase: 'auction' | 'bury' | 'play' | 'scored';
  handCounts: number[];
  trickHistory: { plays: { cards: Card[] }[] }[];
  captured: { seat: number; cards: Card[] }[];
  summary: { kitty: Card[] } | null;
}

interface Payload {
  role: 'player' | 'spectator';
  view: {
    dealNo: number;
    levels: { rank: number; cycle: number }[];
    deal: DealView | null;
  } | null;
  you: { seat: number; hand: Card[]; isDeclarer: boolean } | null;
  table: TableView;
}

const PUBLIC_DEAL_FIELDS = [
  'phase',
  'dealNo',
  'dealerSeat',
  'auction',
  'highestBid',
  'auctionTurn',
  'contract',
  'trump',
  'trick',
  'playTurn',
  'trickHistory',
  'captured',
  'handCounts',
  'declarerSeat',
  'summary',
  'claim'
].sort();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function cardKey(card: Card): string {
  return card.joker ? (card.joker === 'small' ? 'j0' : 'j1') : `${card.suit}${card.rank}`;
}

/** 结构 walker：payload 里所有「像一张牌」的对象（不做子串匹配，避免 S1 命中 S14） */
function cardsIn(value: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(value)) {
    for (const item of value) cardsIn(item, out);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  const obj = value as Record<string, unknown>;
  if (obj['joker'] === 'small' || obj['joker'] === 'big') {
    out.push({ joker: obj['joker'] as string });
    return out;
  }
  if (typeof obj['suit'] === 'string' && typeof obj['rank'] === 'number') {
    out.push({ suit: obj['suit'], rank: obj['rank'] });
    return out;
  }
  for (const item of Object.values(obj)) cardsIn(item, out);
  return out;
}

async function claim(name: string): Promise<Credential> {
  const response = await fetch(`${BASE}/api/auth/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const payload = (await response.json().catch(() => null)) as (Credential & { message?: string }) | null;
  if (!response.ok) throw new Error(`注册 ${name} 失败：${response.status} ${payload?.message ?? ''}`);
  return payload!;
}

async function api(
  path: string,
  init: RequestInit = {},
  credential?: string
): Promise<{ status: number; payload: unknown }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (credential) headers['authorization'] = `Bearer ${credential}`;
  if (init.body) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, payload: text.length > 0 ? JSON.parse(text) : null };
}

async function payloadOf(code: string, credential: string): Promise<Payload> {
  const { status, payload } = await api(`/api/tables/${code}/view`, {}, credential);
  assert(status === 200, `取视图失败：${status}`);
  return payload as Payload;
}

async function page(path: string, credential: string): Promise<string> {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie: `sixty_cred=${credential}` } });
  assert(response.ok, `GET ${path} → ${response.status}`);
  return response.text();
}

interface Stream {
  /** 读下一帧（超时即报错，绝不静默挂住） */
  next: (timeoutMs?: number) => Promise<Payload>;
  close: () => void;
}

/**
 * 开一条 SSE 并按需逐帧读。
 *
 * 注意**不要按位置对齐帧**：连接时会先发一帧再立刻广播一帧（`stream/+server.ts`），
 * 所以「第 N 帧」并不稳定指向某个语义；按内容（版本号、role）判断才对。
 */
async function openStream(code: string, credential: string): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/api/tables/${code}/stream`, {
    headers: { authorization: `Bearer ${credential}` },
    signal: controller.signal
  });
  assert(response.ok, `SSE 连接失败：${response.status}`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const next = async (timeoutMs = 5000): Promise<Payload> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const line = block.split('\n').find((item) => item.startsWith('data: '));
        if (line) return JSON.parse(line.slice(6)) as Payload;
        continue;
      }
      if (Date.now() > deadline) throw new Error(`SSE 等待下一帧超时（${timeoutMs}ms）`);
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE 提前关闭');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };

  return {
    next,
    close: () => {
      controller.abort();
      void reader.cancel().catch(() => undefined);
    }
  };
}

async function main(): Promise<void> {
  const stamp = Date.now() % 100000;
  const players = await Promise.all([0, 1, 2].map((i) => claim(`观战甲${i}-${stamp}`)));
  const guest = await claim(`旁观-${stamp}`);
  const names = players.map((p) => p.name);

  const created = (await api('/api/tables', { method: 'POST' }, players[0]!.credential)).payload as {
    code: string;
  };
  const code = created.code;
  for (const player of players.slice(1)) {
    const { status } = await api(`/api/tables/${code}/join`, { method: 'POST' }, player.credential);
    assert(status === 200, `入座失败：${status}`);
  }
  await api(`/api/tables/${code}/action`, { method: 'POST', body: JSON.stringify({ action: { type: 'deal' } }) }, players[0]!.credential);
  const dealt = await payloadOf(code, players[0]!.credential);
  assert(dealt.view?.deal?.phase === 'auction', `发牌后应处在叫牌阶段，实际 ${dealt.view?.deal?.phase}`);
  console.log(`同桌 ${code} 已发牌（第 ${dealt.view.dealNo} 副，${names.join(' / ')}）`);

  // 1) 满座时第 4 个人：入座被拒，但进入同桌页拿到观战视图
  const full = await api(`/api/tables/${code}/seat`, { method: 'POST' }, guest.credential);
  assert(full.status === 400, `满座入座应被拒，实际 ${full.status}`);
  const lobby = await page(`/table/${code}`, guest.credential);
  assert(lobby.includes('观战中'), '满座进入同桌页没有进入观战视图');
  assert(!lobby.includes('开始第一副'), '观战页面仍然渲染了「开始第一副」按钮');
  assert(lobby.includes('改名 / 换身份'), '观战页面没有身份快捷编辑入口');
  assert(lobby.includes('座位已满'), '满座时观战页面没有说明座位已满');
  for (const name of names) assert(lobby.includes(name), `观战页面没有列出在座玩家 ${name}`);
  console.log('满座第 4 人：入座被拒，页面进入观战视图');

  // 2) 观战负载：公共视图 + 不得含任何在座手牌
  const spectator = await payloadOf(code, guest.credential);
  assert(spectator.role === 'spectator', `第 4 人应为观战者，实际 ${spectator.role}`);
  assert(spectator.you === null, '观战者不该拿到手牌');
  assert(
    JSON.stringify(Object.keys(spectator.view!.deal!).sort()) === JSON.stringify(PUBLIC_DEAL_FIELDS),
    '观战视图的 deal 字段不再是白名单'
  );

  const hands = new Set<string>();
  for (const player of players) {
    const mine = await payloadOf(code, player.credential);
    assert(mine.role === 'player' && mine.you !== null, `${player.name} 应当拿到个人视图`);
    for (const card of mine.you.hand) hands.add(cardKey(card));
  }
  assert(hands.size === 51, `叫牌阶段三家手牌应共 51 张，实际 ${hands.size}`);
  const leaked = [...new Set(cardsIn(spectator).map(cardKey))].filter((key) => hands.has(key));
  assert(leaked.length === 0, `观战负载里出现了在座手牌：${leaked.join(',')}`);

  // 3) 观战 SSE：观战者第一帧就是公共视图；玩家看得到「N 人观战」；
  //    并且**玩家会因为别人连上而收到一帧同版本的「无关帧」** —— 这正是客户端不该无条件清空选牌的原因
  //    （`lib/selection.ts` 的 shouldResetSelection 就是为它写的，客户端没清空才叫修好）。
  const playerStream = await openStream(code, players[1]!.credential);
  const playerBefore = await playerStream.next();
  const versionBefore = playerBefore.view?.version ?? null;

  const frame = await openStream(code, guest.credential);
  const spectatorFrame = await frame.next();
  assert(spectatorFrame.role === 'spectator', '观战 SSE 第一帧不是观战负载');

  const watched = await payloadOf(code, players[1]!.credential);
  assert(watched.table.spectatorCount === 1, `观战人数徽标应为 1，实际 ${watched.table.spectatorCount}`);

  const rosterFrame = await playerStream.next();
  assert(
    rosterFrame.role === 'player' && (rosterFrame.view?.version ?? null) === versionBefore,
    `玩家应因「有人连上」收到一帧同版本的名单帧（版本 ${versionBefore} → ${rosterFrame.view?.version}）；` +
      '若这一帧消失了，观战者的在线点与人数就不会更新'
  );
  playerStream.close();
  frame.close();
  console.log('观战负载只有公共信息，SSE 正常，玩家侧观战人数 = 1（并确认存在同版本的无关帧）');

  // 4) 观战者不能操作
  const denied = await api(
    `/api/tables/${code}/action`,
    { method: 'POST', body: JSON.stringify({ action: { type: 'deal' } }) },
    guest.credential
  );
  assert(denied.status >= 400, `观战者发牌应被拒，实际 ${denied.status}`);

  // 5) 离座：座位空出、本人转观战、三人未满时开不了下一副
  const before = await payloadOf(code, players[0]!.credential);
  const seatLevel = JSON.stringify(before.view!.levels[0]);
  const seatHand = [...before.you!.hand].map(cardKey).sort();
  const left = await api(`/api/tables/${code}/seat`, { method: 'DELETE' }, players[0]!.credential);
  assert(left.status === 200, `离座失败：${left.status}`);
  const afterLeave = await payloadOf(code, players[0]!.credential);
  assert(afterLeave.role === 'spectator' && afterLeave.you === null, '离座后应转为观战者');
  const others = await payloadOf(code, players[1]!.credential);
  assert(others.table.seats[0]!.userId === null, '离座后座位没有空出来');
  assert(others.table.ready === false, '空座时不应是「三人到齐」');
  const early = await api(
    `/api/tables/${code}/action`,
    { method: 'POST', body: JSON.stringify({ action: { type: 'deal' } }) },
    players[1]!.credential
  );
  assert(early.status === 400, `三人未满时发牌应被拒，实际 ${early.status}`);
  // 必须由「人数不足」这道守卫拦下：牌局进行中也会 400（当前牌局尚未结束），
  // 只看状态码的话，这条断言在没有人数守卫时同样是绿的（空转）。
  const earlyMessage = (early.payload as { message?: string } | null)?.message ?? '';
  assert(
    earlyMessage.includes('还差'),
    `三人未满发牌应由人数守卫拦下，实际提示「${earlyMessage}」`
  );
  const reload = await page(`/table/${code}`, players[0]!.credential);
  assert(reload.includes('观战中'), '离座者刷新后被自动塞回了座位（观战记录没生效）');
  console.log('离座：座位空出、本人转观战、刷新不回座、三人未满开不了下一副');

  // 6) 中途补位：接下的是别人的手牌与进度，界面必须先说一声
  //    6a. 直接点「入座」（POST /seat）—— 响应里的 inherited 告诉前端要不要提示
  const walkin = await claim(`路过-${stamp}`);
  const walkinPage = await page(`/table/${code}`, walkin.credential);
  assert(walkinPage.includes('补进了空座'), '中途到达被自动补位时，页面没有提示「接下了别人的牌」');
  assert(!walkinPage.includes('观战中'), '自动补位后仍显示观战');
  const giveBack = await api(`/api/tables/${code}/seat`, { method: 'DELETE' }, walkin.credential);
  assert(giveBack.status === 200, '让出座位失败，后续补位断言没法继续');
  console.log('中途到达即补位：页面提示「补进了空座、接下 N 张牌继续打完」');

  //    6b. 观战者点「入座」：座位、级别、那一手牌逐张继承，且响应标出 inherited
  const sit = await api(`/api/tables/${code}/seat`, { method: 'POST' }, guest.credential);
  assert(sit.status === 200, `补位入座失败：${sit.status} ${JSON.stringify(sit.payload)}`);
  assert(
    (sit.payload as { inherited?: boolean }).inherited === true,
    '这一副正在进行时入座，响应没有标记 inherited（界面就不会提示接下了别人的手牌）'
  );
  const again = await api(`/api/tables/${code}/seat`, { method: 'POST' }, guest.credential);
  assert(
    (again.payload as { inherited?: boolean }).inherited === false,
    '已经在座时重复入座不该再报 inherited（那不是「补位」，是幂等）'
  );
  const seated = await payloadOf(code, guest.credential);
  assert(seated.role === 'player' && seated.you !== null, '补位后应拿到个人视图');
  assert(seated.you.seat === 0, `补位者应坐在空出来的 0 号座，实际 ${seated.you.seat}`);
  assert(JSON.stringify(seated.view!.levels[0]) === seatLevel, '补位者没有继承该座位的级别');
  assert(
    JSON.stringify([...seated.you.hand].map(cardKey).sort()) === JSON.stringify(seatHand),
    '补位者拿到的手牌与该座位原来的手牌不一致：补位没有接下这个座位的进度'
  );
  console.log(`补位：0 号座的级别 ${seatLevel} 与原来的 ${seatHand.length} 张手牌都由补位者继承`);

  // 7) 在座时不能改名 / 换身份
  const seatedRename = await api(
    '/api/auth/rename',
    { method: 'POST', body: JSON.stringify({ name: `改名-${stamp}` }) },
    guest.credential
  );
  assert(seatedRename.status === 400, `在座时改名应被拒，实际 ${seatedRename.status}`);
  const seatedSwitch = await api(
    '/api/auth/claim',
    { method: 'POST', body: JSON.stringify({ credential: players[2]!.credential }) },
    guest.credential
  );
  assert(seatedSwitch.status === 400, `在座时换身份应被拒，实际 ${seatedSwitch.status}`);
  console.log('在座时：改名与换身份都被拒');

  // 8) 名字不可冒名：拿别人的名字注册必须失败
  const squat = await api('/api/auth/claim', {
    method: 'POST',
    body: JSON.stringify({ name: players[1]!.name })
  });
  assert(squat.status === 400, `用别人的名字注册应被拒（否则等于冒名入座），实际 ${squat.status}`);
  console.log('名字占用：冒名注册被拒');

  // 9) 离座后改名：旧凭据失效、新凭据可用；大厅列出这张观战的桌；再入座时别人看到新名字
  const leaveAgain = await api(`/api/tables/${code}/seat`, { method: 'DELETE' }, guest.credential);
  assert(leaveAgain.status === 200, `再次离座失败：${leaveAgain.status}`);
  const newName = `观战改名-${stamp}`;
  const renamed = await api(
    '/api/auth/rename',
    { method: 'POST', body: JSON.stringify({ name: newName }) },
    guest.credential
  );
  assert(renamed.status === 200, `离座后改名失败：${renamed.status}`);
  const fresh = renamed.payload as Credential;
  const oldCredential = await api(`/api/tables/${code}/view`, {}, guest.credential);
  assert(oldCredential.status === 401, `改名后旧凭据应失效，实际 ${oldCredential.status}`);
  const newCredential = await api(`/api/tables/${code}/view`, {}, fresh.credential);
  assert(newCredential.status === 200, `改名后新凭据应可用，实际 ${newCredential.status}`);

  // 大厅的「我的同桌」要把观战的桌列出来：离座之后不该只能靠重新找链接回桌
  const home = await page('/', fresh.credential);
  assert(home.includes('观战中'), '大厅的「我的同桌」没有列出观战的桌');

  const reseat = await api(`/api/tables/${code}/seat`, { method: 'POST' }, fresh.credential);
  assert(reseat.status === 200, `改名后再入座失败：${reseat.status}`);
  const seen = await payloadOf(code, players[1]!.credential);
  assert(
    seen.table.seats.some((seat) => seat.name === newName),
    `改名后座位卡没有显示新名字「${newName}」`
  );
  console.log(`改名：旧凭据 401、新凭据可用、大厅列出观战桌、座位卡显示「${newName}」`);

  console.log('SPECTATE OK');
}

main().catch((error: unknown) => {
  console.error('SPECTATE FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
