/**
 * stdio 入口的**启动契约**：参数不全或服务器不可达时，必须当场以非 0 退出并说清原因，
 * 而不是静静地等着第一次工具调用才失败（那对宿主来说只是一个莫名其妙的工具错误）。
 *
 * **凭据是可选的**（ADR-0014）：没有 `SIXTY_CREDENTIAL` 是**无身份会话**（只有 read_rules 与 claim 能用），
 * 不再是退出理由 —— 判定抽成了纯函数 `startupOf`，所以这里能在进程内断言，不必全靠 spawn 去猜。
 * 唯一还会当场退出的仍然是「地址写错 / 服务没起」。
 *
 * 进程级那条要 spawn 真子进程 —— 受限沙箱下 piped stdio 必 EPERM（AGENTS 规则 5），
 * 所以被拒绝时**显式跳过并说明**，而不是假装通过：CI 与本机（非受限）会真跑。
 *
 * 完整的 stdio 一副牌端到端在 scripts/mcp-check.ts（需要服务端在跑）。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { DEFAULT_BASE_URL, startupOf } from '../src/bootstrap.ts';

const ENTRY = fileURLToPath(new URL('../src/stdio.ts', import.meta.url));
/**
 * 子进程也要拿到工作区解析钩子：Windows 上 pnpm 把工作区包做成 **junction**，Node 24 于是拒绝对
 * `node_modules/...` 下的文件做类型擦除（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），
 * 子进程会在 import 阶段就死掉、根本走不到「连不上」那一步。走 `NODE_OPTIONS` 与包自己的
 * test 脚本同一招；CI 的软链布局下它只是把同一份文件重定向一次，没有副作用。
 */
const LOADER = pathToFileURL(
  fileURLToPath(new URL('../../../tooling/workspace-loader.mjs', import.meta.url))
).href;
/** 一个必然连不上的地址：连接被拒是即时的，不吃超时 */
const DEAD_BASE = 'http://127.0.0.1:1';

interface RunResult {
  readonly code: number | null;
  readonly stderr: string;
}

function runStdio(env: Record<string, string>): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const nodeOptions = [process.env['NODE_OPTIONS'], `--import=${LOADER}`].filter(Boolean).join(' ');
    const child = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, ...env, NODE_OPTIONS: nodeOptions },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function isSpawnDenied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

// ---------------------------------------------------------------- 纯函数：凭据可选

test('启动判定：没有凭据是「无身份会话」，不是错误', () => {
  assert.deepEqual(startupOf({}), { mode: 'anonymous', baseUrl: DEFAULT_BASE_URL });
  assert.deepEqual(startupOf({ SIXTY_CREDENTIAL: '   ' }), { mode: 'anonymous', baseUrl: DEFAULT_BASE_URL });
  // 空串与「没设置」同义；写错成空地址也不该拼出一个空 base
  assert.deepEqual(startupOf({ SIXTY_BASE_URL: '' }), { mode: 'anonymous', baseUrl: DEFAULT_BASE_URL });
  assert.deepEqual(startupOf({ SIXTY_BASE_URL: 'https://game.example.com///' }), {
    mode: 'anonymous',
    baseUrl: 'https://game.example.com'
  });
  assert.deepEqual(startupOf({ SIXTY_CREDENTIAL: ' abc ', SIXTY_BASE_URL: 'http://x:1' }), {
    mode: 'authenticated',
    baseUrl: 'http://x:1',
    credential: 'abc'
  });
});

// ---------------------------------------------------------------- 真子进程：仍然 fail-fast

test('stdio 入口：地址写错/服务没起时立刻失败（有没有凭据都一样）', async (t) => {
  let anonymous: RunResult;
  try {
    // 无凭据 + 连不上：**必须**仍然以非 0 退出（否则「地址写错」会静默变成一个永远连不上的会话）
    anonymous = await runStdio({ SIXTY_CREDENTIAL: '', SIXTY_BASE_URL: DEAD_BASE });
  } catch (error) {
    if (isSpawnDenied(error)) {
      t.skip('受限沙箱不允许 spawn 子进程（piped stdio EPERM）；这一条在 CI 与本机真跑');
      return;
    }
    throw error;
  }

  assert.equal(anonymous.code, 1, '服务器不可达必须以非 0 退出');
  assert.match(anonymous.stderr, /连不上/, '服务器不可达时没有说清是连不上');
  assert.match(anonymous.stderr, /\[sixty-mcp\]/, '错误信息没有前缀，宿主里看不出是谁在报错');

  // base64url("test:token")：凭据格式合法但服务器不可达
  const unreachable = await runStdio({ SIXTY_CREDENTIAL: 'dGVzdDp0b2tlbg', SIXTY_BASE_URL: DEAD_BASE });
  assert.equal(unreachable.code, 1, '服务器不可达必须以非 0 退出');
  assert.match(unreachable.stderr, /连不上/, '服务器不可达时没有说清是连不上');
  assert.match(unreachable.stderr, /凭据无效/, '带凭据那条路要同时提「凭据可能无效」');
});
