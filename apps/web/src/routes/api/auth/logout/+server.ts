import { json } from '@sveltejs/kit';
import {
  clearCredentialCookie,
  clearSessionCookie,
  revokeSession,
  SESSION_COOKIE
} from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * 登出。两种身份都走这里，语义不同：
 * - 本地身份：清凭据 cookie（localStorage 那份由前端清）—— 凭据串本身不失效，
 *   复制保存过的串仍可再导入；
 * - Gitee 身份：**服务器端撤销会话行**（不只是清 cookie —— 被复制走的 cookie 值
 *   也一并失效；ADR-0023 的会话是可撤销的，这正是它与凭据串的差别）。
 */
export const POST: RequestHandler = async ({ cookies }) => {
  const session = cookies.get(SESSION_COOKIE);
  if (session !== undefined) revokeSession(session);
  clearSessionCookie(cookies);
  clearCredentialCookie(cookies);
  return json({ ok: true });
};
