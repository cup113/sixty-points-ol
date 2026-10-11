/**
 * Gitee 登录（ADR-0023）与管理员面（ADR-0024）的进程内回归测试。
 *
 * 覆盖三类必须钉住的东西：
 * 1. **身份与会话**：名字派生、首次登录幂等、会话生命周期与过期回收；
 * 2. **不泄漏**（ADR-0023 的核心不变量）：Gitee 身份的令牌不出现于任何响应 ——
 *    这条守卫**双向**断言（Gitee 侧没有、本地身份侧有），否则它可能是空转的；
 * 3. **管理员面**：名单判定、删用户级联（座位/会话/观战/主持桌）、删桌级联、强制离座。
 *
 * 沙箱内按包跑：`pnpm run test:web`。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

await import('./server-db.ts');

const {
  CREDENTIAL_COOKIE,
  SESSION_COOKIE,
  createGiteeIdentity,
  createIdentity,
  createSession,
  credentialOf,
  findByGiteeId,
  findBySessionToken,
  findByName,
  identityFrom,
  revokeSession
} = await import('../src/lib/server/auth.ts');
const { db } = await import('../src/lib/server/db.ts');
const { createTable, enterTable, getTableByCode, leaveSeat } = await import(
  '../src/lib/server/tables.ts'
);
const { giteeConfig, newGiteeStatePayload, signGiteeState, verifyGiteeState } = await import(
  '../src/lib/server/gitee.ts'
);
const {
  adminGiteeIds,
  adminTables,
  adminUsers,
  deleteTableById,
  deleteUser,
  forceLeaveSeat,
  isAdminIdentity
} = await import('../src/lib/server/admin.ts');
const renameRoute = await import('../src/routes/api/auth/rename/+server.ts');
const { load: lobbyLoad } = await import('../src/routes/+page.server.ts');

let seq = 0;
const stamp = (): string => `${Date.now() % 100000}${(seq += 1)}`;
const uniqueName = (prefix: string): string => `${prefix}${stamp()}`;
/** Gitee id 是数字字符串：给每个用例一个不可能撞的 */
const uniqueGiteeId = (): string => `9${stamp()}${seq}`;

function count(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...(params as never[])) as { n: number };
  return row.n;
}

/** load 与 action 的 event 共有形状（cookies + request[/url]） */
function eventWith(options: {
  credential?: string;
  session?: string;
  body?: unknown;
  url?: string;
}): never {
  const url = new URL(options.url ?? 'http://127.0.0.1/');
  return {
    url,
    params: {},
    locals: {},
    cookies: {
      get: (name: string): string | undefined => {
        if (name === CREDENTIAL_COOKIE) return options.credential;
        if (name === SESSION_COOKIE) return options.session;
        return undefined;
      },
      set: (): void => undefined,
      delete: (): void => undefined
    },
    request: new Request(url, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    })
  } as never;
}

function giteeIdentity(login = uniqueName('git')): { id: number; name: string; token: string } {
  const created = createGiteeIdentity(uniqueGiteeId(), login);
  assert.ok(created !== null, 'Gitee 身份应能建出来');
  return created;
}

// ---------------------------------------------------------------------------
// 1. 站内名派生
// ---------------------------------------------------------------------------

test('Gitee 名派生：login 原样用；超 12 字截断；撞名加 -2 后缀且整体仍 ≤12 字', () => {
  const short = uniqueName('gname');
  assert.equal(giteeIdentity(short).name, short, '不撞名时直接用 login');

  const long = createGiteeIdentity(uniqueGiteeId(), 'a'.repeat(20));
  assert.ok(long !== null);
  assert.equal(long.name, 'a'.repeat(12), '超长 login 截断到 12 字');

  // 撞名：本地身份先占掉一个 12 字的满长名字，Gitee 派生必须让出空间给后缀
  const taken = uniqueName('c'); // 例：c12345 6 字
  const squatter = createIdentity(taken);
  assert.ok(squatter !== null);
  const renamed = createGiteeIdentity(uniqueGiteeId(), taken);
  assert.ok(renamed !== null);
  assert.notEqual(renamed.name, taken, '不得顶掉已占用的名字');
  assert.ok(renamed.name.endsWith('-2'), `撞名应加 -2 后缀，实为 ${renamed.name}`);
  assert.ok(renamed.name.length <= 12, '带后缀的名字仍须 ≤12 字');

  // 满长撞名：截到 10 字 + `-2` 正好 12
  const twelve = 'b'.repeat(12);
  assert.ok(createIdentity(twelve) !== null);
  const full = createGiteeIdentity(uniqueGiteeId(), twelve);
  assert.ok(full !== null);
  assert.equal(full.name, `${'b'.repeat(10)}-2`);
  assert.equal(full.name.length, 12);
});

test('Gitee 名派生失败时返回 null（含冒号的 login 永远过不了 normalizeName）', () => {
  assert.equal(createGiteeIdentity(uniqueGiteeId(), 'a:b'), null);
});

test('首次 Gitee 登录幂等：同一 gitee id 复用身份，不同 id 各建各的', () => {
  const gid = uniqueGiteeId();
  const login = uniqueName('same');
  const first = createGiteeIdentity(gid, login);
  const again = createGiteeIdentity(gid, login);
  assert.ok(first !== null && again !== null);
  assert.equal(again.id, first.id, '同一 gitee id 必须复用同一条身份');
  assert.equal(findByGiteeId(gid)?.id, first.id);

  const other = createGiteeIdentity(uniqueGiteeId(), login);
  assert.ok(other !== null);
  assert.notEqual(other.id, first.id, '不同 gitee id 是两个人');
  assert.notEqual(other.name, first.name, '撞名时第二个要换名');
});

// ---------------------------------------------------------------------------
// 2. 会话
// ---------------------------------------------------------------------------

test('会话：建/查/滚动续期/过期即删/机器人不可有', () => {
  const identity = giteeIdentity();
  const session = createSession(identity.id);
  const found = findBySessionToken(session);
  assert.equal(found?.id, identity.id);
  assert.equal(found?.giteeId, findByGiteeId(found!.giteeId!)?.giteeId, '会话要带出 gitee 绑定');

  // 滚动续期：把到期时间压到 1 小时后，再查一次，窗口必须往后推
  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(soon, session);
  assert.ok(findBySessionToken(session) !== null);
  const rolled = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(session) as {
    expires_at: string;
  };
  assert.ok(Date.parse(rolled.expires_at) > Date.parse(soon), '每用一次都要往后推');

  // 过期：查不到，且行被回收
  const past = new Date(Date.now() - 1000).toISOString();
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(past, session);
  assert.equal(findBySessionToken(session), null);
  assert.equal(count('SELECT COUNT(*) AS n FROM sessions WHERE token = ?', session), 0, '过期行应删掉');

  // 机器人：就算被塞了一行会话也认不出来
  const botName = `机器人·测试${stamp()}`;
  db.prepare('INSERT INTO users (name, token, created_at, is_bot) VALUES (?, ?, ?, 1)').run(
    botName,
    'bottoken',
    new Date().toISOString()
  );
  const botId = Number(
    (db.prepare('SELECT id FROM users WHERE name = ?').get(botName) as { id: number }).id
  );
  const botSession = createSession(botId);
  assert.equal(findBySessionToken(botSession), null, '机器人不该能靠会话认证');

  assert.equal(revokeSession(session), false, '已回收的会话撤销返回 false');
  const live = createSession(identity.id);
  assert.equal(revokeSession(live), true);
  assert.equal(findBySessionToken(live), null, '撤销后立刻失效');
});

test('identityFrom：会话 cookie 认得；凭据 cookie 与它同时存在时凭据优先', () => {
  const gitee = giteeIdentity();
  const session = createSession(gitee.id);
  const viaSession = identityFrom(eventWith({ session }));
  assert.equal(viaSession?.id, gitee.id, '会话 cookie 应解析出身份');

  const local = createIdentity(uniqueName('local'));
  assert.ok(local !== null);
  const both = identityFrom(eventWith({ credential: credentialOf(local), session }));
  assert.equal(both?.id, local.id, '两种 cookie 并存时凭据优先（本地身份行为不变）');
});

// ---------------------------------------------------------------------------
// 3. 不泄漏（ADR-0023 的核心不变量）
// ---------------------------------------------------------------------------

test('Gitee 身份的令牌不出现在任何响应里（改名 / 大厅 load），本地身份照旧有凭据', async () => {
  const gitee = giteeIdentity();
  const session = createSession(gitee.id);

  // 改名：Gitee 身份只回名字，绝不回发凭据串
  const renameResponse = (await (renameRoute.POST as (event: never) => Promise<Response>)(
    eventWith({ session, body: { name: uniqueName('改名后') } })
  )) as Response;
  const renameBody = (await renameResponse.json()) as { name?: string; credential?: string };
  assert.equal(renameBody.name?.startsWith('改名后'), true, '改名应成功');
  assert.equal(renameBody.credential, undefined, 'Gitee 身份不该拿到凭据串');
  assert.equal(
    JSON.stringify(renameBody).includes(gitee.token),
    false,
    '响应里不得出现令牌本体'
  );

  // 大厅 load：credential 为 null，且 me 上带 gitee 标记
  const lobby = (await (lobbyLoad as (event: never) => Promise<Record<string, unknown>>)(
    eventWith({ session })
  )) as { credential: string | null; me: { name: string; gitee: boolean } | null };
  assert.equal(lobby.credential, null, 'Gitee 身份在大厅拿不到凭据串');
  assert.equal(lobby.me?.gitee, true, 'me 要标出这是 Gitee 身份');

  // 反向断言（守卫非空）：同一条路对本地身份**必须**给凭据串
  const local = createIdentity(uniqueName('凭证'));
  assert.ok(local !== null);
  const localLobby = (await (lobbyLoad as (event: never) => Promise<Record<string, unknown>>)(
    eventWith({ credential: credentialOf(local) })
  )) as { credential: string | null; me: { gitee: boolean } | null };
  assert.equal(localLobby.credential, credentialOf(local), '本地身份的凭据串必须照常给出');
  assert.equal(localLobby.me?.gitee, false);
});

// ---------------------------------------------------------------------------
// 4. OAuth state 与配置
// ---------------------------------------------------------------------------

test('state：签名往返带 join；篡改/过期一律拒；专用密钥与派生密钥互不通用', () => {
  const config = { clientId: 'cid', clientSecret: 'csecret' };
  const state = signGiteeState(newGiteeStatePayload('ABC123'), config);
  assert.equal(verifyGiteeState(state, config)?.join, 'ABC123', 'join 要原样带回来');
  assert.equal(verifyGiteeState(state, config)?.exp !== undefined, true);

  const tampered = `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`;
  assert.equal(verifyGiteeState(tampered, config), null, '签名不符必须拒');
  assert.equal(verifyGiteeState(undefined, config), null, '没带 state 必须拒');
  assert.equal(verifyGiteeState('garbage', config), null, '形状不对必须拒');

  const expired = signGiteeState({ exp: Date.now() - 1, nonce: 'n', join: null }, config);
  assert.equal(verifyGiteeState(expired, config), null, '过期必须拒');

  // 专用密钥：用它签的 state 在只有 client secret 的环境里验不过（反之亦然）
  const withSecret = signGiteeState(newGiteeStatePayload(null), config, {
    SIXTY_GITEE_STATE_SECRET: 'dedicated'
  });
  assert.equal(verifyGiteeState(withSecret, config), null, '换了密钥就不该验得过');
  assert.equal(
    verifyGiteeState(withSecret, config, { SIXTY_GITEE_STATE_SECRET: 'dedicated' })?.join,
    null,
    '同一把专用密钥应当验得过'
  );

  // 配置：缺一不可，空串 = 没设
  assert.equal(giteeConfig({}), null);
  assert.equal(giteeConfig({ SIXTY_GITEE_CLIENT_ID: 'a' }), null);
  assert.equal(giteeConfig({ SIXTY_GITEE_CLIENT_ID: 'a', SIXTY_GITEE_CLIENT_SECRET: '' }), null);
  assert.deepEqual(giteeConfig({ SIXTY_GITEE_CLIENT_ID: 'a', SIXTY_GITEE_CLIENT_SECRET: 'b' }), {
    clientId: 'a',
    clientSecret: 'b'
  });
});

// ---------------------------------------------------------------------------
// 5. 管理员判定
// ---------------------------------------------------------------------------

test('管理员判定：只有名单内的 Gitee 身份是；本地身份、未配置、名单外一律不是', () => {
  const env = { SIXTY_ADMIN_GITEE_IDS: ' 111 , 222 ,' };
  assert.deepEqual([...adminGiteeIds(env)].sort(), ['111', '222'], '逗号分隔、忽略空白');

  const insideId = uniqueGiteeId();
  const outsideId = uniqueGiteeId();
  const admin = createGiteeIdentity(insideId, uniqueName('管'));
  const outsider = createGiteeIdentity(outsideId, uniqueName('客'));
  const local = createIdentity(uniqueName('本地'));
  assert.ok(admin !== null && outsider !== null && local !== null);

  const list = { SIXTY_ADMIN_GITEE_IDS: `${insideId},${outsideId}x` };
  assert.equal(isAdminIdentity(admin, list), true);
  assert.equal(isAdminIdentity(outsider, list), false, '名单外的 Gitee 身份不是管理员');
  assert.equal(isAdminIdentity(local, { SIXTY_ADMIN_GITEE_IDS: `${insideId}` }), false, '本地身份永远不是管理员');
  assert.equal(isAdminIdentity(admin, {}), false, '未配置名单 = 没有管理员');
  assert.equal(isAdminIdentity(null, { SIXTY_ADMIN_GITEE_IDS: insideId }), false, '未登录不是管理员');
});

// ---------------------------------------------------------------------------
// 6. 删用户（级联删座）与删桌
// ---------------------------------------------------------------------------

test('删用户：座位/会话/观战记录一并清，主持的桌改由在座者接手，名字回池', () => {
  const actor = createIdentity(uniqueName('执行者'));
  assert.ok(actor !== null);

  const victim = giteeIdentity(uniqueName('被删'));
  const second = createIdentity(uniqueName('留下'));
  const other = createIdentity(uniqueName('别桌'));
  assert.ok(second !== null && other !== null);

  const table = createTable(victim.id); // 他主持并坐在 0 号位
  enterTable(table.code, second.id);
  const otherTable = createTable(other.id);
  leaveSeat(otherTable.code, victim.id); // 他在别桌留了观战记录
  const session = createSession(victim.id);

  const victimName = victim.name;
  const result = deleteUser(victim.id, actor.id);
  assert.equal(result.ok, true, result.message);

  assert.equal(count('SELECT COUNT(*) AS n FROM seats WHERE user_id = ?', victim.id), 0, '座位要清掉');
  assert.equal(count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', victim.id), 0, '会话要清掉');
  assert.equal(count('SELECT COUNT(*) AS n FROM spectators WHERE user_id = ?', victim.id), 0, '观战记录要清掉');
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', victim.id), 0, '用户行要清掉');
  assert.equal(findByName(victimName), null, '按名字再也查不到');
  assert.equal(findBySessionToken(session), null, '他手里的会话立刻失效');

  const survived = getTableByCode(table.code);
  assert.ok(survived !== null, '还有人坐的桌必须留下');
  assert.equal(survived.hostUserId, second.id, '主持位交给还在座的人');
  assert.equal(count('SELECT COUNT(*) AS n FROM seats WHERE table_id = ?', table.id), 1, '只少了他那一个座位');
  assert.equal(result.removedTableCodes.length, 0);

  assert.notEqual(createIdentity(victimName), null, '名字回池，可再次注册');
});

test('删用户：主持的桌一座不剩则整桌级联删（牌局/事件/重演一起走）', () => {
  const actor = createIdentity(uniqueName('执行者2'));
  const owner = createIdentity(uniqueName('孤桌主'));
  assert.ok(actor !== null && owner !== null);
  const table = createTable(owner.id); // 只有他一个座位

  db.prepare('INSERT INTO games (table_id, state, updated_at) VALUES (?, ?, ?)').run(
    table.id,
    '{}',
    new Date().toISOString()
  );
  db.prepare('INSERT INTO events (table_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    table.id,
    1,
    'dealStarted',
    '{}',
    new Date().toISOString()
  );
  db.prepare('INSERT INTO replays (table_id, deal_no, result, created_at) VALUES (?, ?, ?, ?)').run(
    table.id,
    1,
    '{}',
    new Date().toISOString()
  );

  const result = deleteUser(owner.id, actor.id);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.removedTableCodes, [table.code], '空桌要随删并报出邀请码');
  assert.equal(getTableByCode(table.code), null, '桌没了');
  for (const sql of [
    'SELECT COUNT(*) AS n FROM seats WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM games WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM events WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM replays WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM spectators WHERE table_id = ?'
  ]) {
    assert.equal(count(sql, table.id), 0, `${sql} 应清空`);
  }
});

test('不能删除自己当前登录的身份；删不存在的用户报错', () => {
  const admin = createIdentity(uniqueName('自删'));
  assert.ok(admin !== null);
  const self = deleteUser(admin.id, admin.id);
  assert.equal(self.ok, false);
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', admin.id), 1, '自己还在');

  const missing = deleteUser(999999999, admin.id);
  assert.equal(missing.ok, false);
});

test('删牌桌：座位/牌局/事件/重演/观战五张从表一起清，重复删返回 false', () => {
  const owner = createIdentity(uniqueName('桌主'));
  const watcher = createIdentity(uniqueName('旁观'));
  assert.ok(owner !== null && watcher !== null);
  const table = createTable(owner.id);
  leaveSeat(table.code, watcher.id); // 留下观战记录
  db.prepare('INSERT INTO games (table_id, state, updated_at) VALUES (?, ?, ?)').run(
    table.id,
    '{}',
    new Date().toISOString()
  );
  db.prepare('INSERT INTO replays (table_id, deal_no, result, created_at) VALUES (?, ?, ?, ?)').run(
    table.id,
    1,
    '{}',
    new Date().toISOString()
  );

  assert.equal(deleteTableById(table.id), true);
  for (const sql of [
    'SELECT COUNT(*) AS n FROM tables WHERE id = ?',
    'SELECT COUNT(*) AS n FROM seats WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM games WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM events WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM replays WHERE table_id = ?',
    'SELECT COUNT(*) AS n FROM spectators WHERE table_id = ?'
  ]) {
    assert.equal(count(sql, table.id), 0, `${sql} 应清空`);
  }
  assert.equal(deleteTableById(table.id), false, '再删一次返回 false');
});

test('强制离座 = 离座语义：座位空出、本人转为观战者', () => {
  const host = createIdentity(uniqueName('强离主'));
  const target = createIdentity(uniqueName('强离客'));
  assert.ok(host !== null && target !== null);
  const table = createTable(host.id);
  enterTable(table.code, target.id);
  assert.equal(count('SELECT COUNT(*) AS n FROM seats WHERE table_id = ? AND user_id = ?', table.id, target.id), 1);

  const result = forceLeaveSeat(table.code, target.id);
  assert.equal(result.ok, true, result.message);
  assert.equal(count('SELECT COUNT(*) AS n FROM seats WHERE table_id = ? AND user_id = ?', table.id, target.id), 0);
  assert.equal(
    count('SELECT COUNT(*) AS n FROM spectators WHERE table_id = ? AND user_id = ?', table.id, target.id),
    1,
    '离座后留观战记录（刷新不会被自动塞回座位）'
  );
});

test('管理员只读装载：桌列表带座位与阶段，用户列表带标记与在座数', () => {
  const owner = createIdentity(uniqueName('装载'));
  assert.ok(owner !== null);
  const table = createTable(owner.id);

  const tables = adminTables();
  const mine = tables.find((row) => row.code === table.code);
  assert.ok(mine !== undefined, '刚建的桌应在列表里');
  assert.equal(mine.phase, null, '还没发牌 = 没有阶段');
  assert.deepEqual(
    mine.seats.map((seat) => seat?.name ?? null),
    [owner.name, null, null]
  );

  const users = adminUsers();
  const row = users.find((user) => user.id === owner.id);
  assert.ok(row !== undefined, '刚建的用户应在列表里');
  assert.equal(row.gitee, false);
  assert.equal(row.bot, false);
  assert.equal(row.seatedCount, 1);
});
