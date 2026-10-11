/**
 * Gitee OAuth 客户端（ADR-0023）。
 *
 * 三件事：读配置、签/验 state（防 CSRF，HMAC —— 单实例内存表会在重启时丢在途授权，
 * 而专用密钥是部署侧已经要配 OAuth 应用的顺手多一格）、换 token 与取用户。
 *
 * 网络只在 callback 路由里发生；本模块不碰数据库、不碰身份。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GiteeConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * 未配置（任一为空）→ null：Gitee 登录整体隐身（按钮不渲染、start/callback 404）。
 * 空串 = 没设 —— compose 里 `X=` 很常见，与 bots.ts 的延迟解析同一口径。
 */
export function giteeConfig(env: Record<string, string | undefined> = process.env): GiteeConfig | null {
  const clientId = env['SIXTY_GITEE_CLIENT_ID']?.trim();
  const clientSecret = env['SIXTY_GITEE_CLIENT_SECRET']?.trim();
  if (clientId === undefined || clientId.length === 0) return null;
  if (clientSecret === undefined || clientSecret.length === 0) return null;
  return { clientId, clientSecret };
}

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * state 的 HMAC 密钥：专用 `SIXTY_GITEE_STATE_SECRET` 优先（可独立轮换），
 * 未设时从 client secret 派生 —— 反正都是只在服务端停留的秘密，
 * 少一个必配项比「密钥用途分离」的洁癖更值钱（轮换 client secret 会让在途授权作废，
 * 窗口只有 10 分钟，可接受）。
 */
function stateKey(config: GiteeConfig, env: Record<string, string | undefined> = process.env): Buffer {
  const dedicated = env['SIXTY_GITEE_STATE_SECRET']?.trim();
  return Buffer.from(
    dedicated !== undefined && dedicated.length > 0 ? dedicated : config.clientSecret,
    'utf8'
  );
}

export interface GiteeStatePayload {
  /** 过期时刻（epoch ms）：state 只在 OAuth 一来一回之间有效 */
  readonly exp: number;
  /** 每次发起授权的随机串：两个标签页同时开始登录也不共用同一条 state */
  readonly nonce: string;
  /** 发起登录时带着的邀请码：过完 OAuth 圈继续「身份一到就回桌」（normalizeInvite 已校验） */
  readonly join: string | null;
}

export function signGiteeState(
  payload: GiteeStatePayload,
  config: GiteeConfig,
  env: Record<string, string | undefined> = process.env
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', stateKey(config, env)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** 验 state：签名不符 / 过期 / 形状不对一律 null。长度不等时 timingSafeEqual 会抛，先挡。 */
export function verifyGiteeState(
  raw: string | undefined,
  config: GiteeConfig,
  env: Record<string, string | undefined> = process.env
): GiteeStatePayload | null {
  if (typeof raw !== 'string') return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = createHmac('sha256', stateKey(config, env)).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<GiteeStatePayload>;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    if (payload.exp < Date.now()) return null;
    if (typeof payload.nonce !== 'string' || payload.nonce.length === 0) return null;
    if (payload.join !== null && typeof payload.join !== 'string') return null;
    return { exp: payload.exp, nonce: payload.nonce, join: payload.join ?? null };
  } catch {
    return null;
  }
}

export function newGiteeStatePayload(join: string | null): GiteeStatePayload {
  return { exp: Date.now() + STATE_TTL_MS, nonce: randomBytes(16).toString('base64url'), join };
}

const AUTHORIZE_URL = 'https://gitee.com/oauth/authorize';
const TOKEN_URL = 'https://gitee.com/oauth/token';
const USER_URL = 'https://gitee.com/api/v5/user';

export function giteeAuthorizeUrl(
  config: GiteeConfig,
  redirectUri: string,
  state: string
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

/** 换 access token：失败（网络/无效 code）返回 null，调用方按 `exchange` 错误回大厅。 */
export async function giteeExchangeCode(
  config: GiteeConfig,
  code: string,
  redirectUri: string
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri
      })
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  if (payload === null || typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    return null;
  }
  return payload.access_token;
}

export interface GiteeUser {
  /** Gitee 数字 id 的字符串形式：身份键（users.gitee_id） */
  readonly id: string;
  /** 登录名（Gitee 上唯一、稳定）：站内名从它派生 */
  readonly login: string;
}

/** 取用户：id 必须是数字、login 非空，否则视为失败（不把坏数据写进身份表）。 */
export async function giteeFetchUser(accessToken: string): Promise<GiteeUser | null> {
  let response: Response;
  try {
    response = await fetch(`${USER_URL}?access_token=${encodeURIComponent(accessToken)}`, {
      headers: { accept: 'application/json' }
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { id?: unknown; login?: unknown }
    | null;
  if (payload === null) return null;
  if (typeof payload.id !== 'number' || !Number.isInteger(payload.id) || payload.id <= 0) return null;
  if (typeof payload.login !== 'string' || payload.login.trim().length === 0) return null;
  return { id: String(payload.id), login: payload.login.trim() };
}

/** state 往返用的短期 cookie 名（start 设置、callback 比对后即删） */
export const GITEE_STATE_COOKIE = 'sixty_gitee_state';
