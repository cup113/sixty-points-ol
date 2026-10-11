import { error, redirect } from '@sveltejs/kit';
import {
  clearCredentialCookie,
  createGiteeIdentity,
  createSession,
  setSessionCookie
} from '$lib/server/auth';
import {
  giteeConfig,
  giteeExchangeCode,
  giteeFetchUser,
  verifyGiteeState,
  GITEE_STATE_COOKIE
} from '$lib/server/gitee';
import { GITEE_ERROR_MESSAGES } from '$lib/gitee-errors';
import type { RequestHandler } from './$types';

function fail(code: keyof typeof GITEE_ERROR_MESSAGES & string): never {
  redirect(302, `/?gitee_error=${code}`);
}

/**
 * Gitee 回调：验 state → 换 token → 取用户 → 建身份（或取既有）→ 建会话。
 *
 * 会话 cookie 与凭据 cookie 互斥：这里清 `sixty_cred`，claim 导入分支反向清
 * `sixty_session` —— 一个浏览器同一时刻只有一个身份。
 * state cookie 用完即删（防重放）。
 */
export const GET: RequestHandler = async (event) => {
  const config = giteeConfig();
  if (config === null) error(404, 'Gitee 登录未配置');

  const cookieState = event.cookies.get(GITEE_STATE_COOKIE);
  event.cookies.delete(GITEE_STATE_COOKIE, { path: '/' });
  const payload = verifyGiteeState(cookieState, config);
  if (payload === null) fail('state');

  if (event.url.searchParams.has('error')) fail('denied');
  const code = event.url.searchParams.get('code');
  if (code === null || code.length === 0) fail('denied');

  const redirectUri = new URL('api/auth/gitee/callback', event.url.origin).toString();
  const accessToken = await giteeExchangeCode(config, code, redirectUri);
  if (accessToken === null) fail('exchange');

  const user = await giteeFetchUser(accessToken);
  if (user === null) fail('profile');

  const identity = createGiteeIdentity(user.id, user.login);
  if (identity === null) fail('name');

  setSessionCookie(event.cookies, createSession(identity.id));
  clearCredentialCookie(event.cookies);
  redirect(302, payload.join === null ? '/' : `/?join=${payload.join}`);
};
