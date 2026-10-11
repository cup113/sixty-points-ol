import { error, redirect } from '@sveltejs/kit';
import { identityFrom } from '$lib/server/auth';
import { giteeAuthorizeUrl, giteeConfig, newGiteeStatePayload, signGiteeState, GITEE_STATE_COOKIE } from '$lib/server/gitee';
import { normalizeInvite } from '$lib/invite';
import type { RequestHandler } from './$types';

/**
 * 发起 Gitee 登录：签 state、设短期 cookie、302 到 Gitee 授权页。
 *
 * 两条门（都服务端执行，按钮只是 UI）：
 * - 未配置 → 404，与 callback 一致 —— 功能整体隐身；
 * - 已有身份 → 302 回大厅：Gitee 登录只在**登出态**可用（ADR-0023），
 *   「在座换 Gitee 身份」这条幽灵占位路径不存在。
 *
 * `?join=` 邀请码（normalizeInvite 校验后）签进 state，过完 OAuth 圈回来继续
 * 「身份一到就回桌」的既有路径。纯链接（无 JS）也能走。
 */
export const GET: RequestHandler = (event) => {
  const config = giteeConfig();
  if (config === null) error(404, 'Gitee 登录未配置');

  if (identityFrom(event) !== null) redirect(302, '/');

  const join = normalizeInvite(event.url.searchParams.get('join') ?? '');
  const state = signGiteeState(newGiteeStatePayload(join), config);
  event.cookies.set(GITEE_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600
  });
  const redirectUri = new URL('api/auth/gitee/callback', event.url.origin).toString();
  redirect(302, giteeAuthorizeUrl(config, redirectUri, state));
};
