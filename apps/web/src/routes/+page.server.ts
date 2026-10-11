import { redirect } from '@sveltejs/kit';
import { credentialOf, identityFrom } from '$lib/server/auth';
import { giteeConfig } from '$lib/server/gitee';
import { myTablesDetailed, type MyTableDetailed } from '$lib/server/tables';
import { normalizeInvite } from '$lib/invite';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  // 从邀请链接被带到大厅时带着邀请码：注册/导入身份后自动回到那张桌
  const join = normalizeInvite(event.url.searchParams.get('join') ?? '');
  // Gitee 回调失败时带回的错误代号（白名单校验，防任意文案注入）
  const giteeErrorRaw = event.url.searchParams.get('gitee_error') ?? '';
  const giteeError = giteeErrorRaw.length > 0 && /^[a-z]+$/.test(giteeErrorRaw) ? giteeErrorRaw : null;
  const identity = identityFrom(event);
  if (identity === null) {
    return {
      me: null,
      credential: null,
      myTables: [] as MyTableDetailed[],
      join,
      giteeError,
      giteeEnabled: giteeConfig() !== null
    };
  }
  return {
    me: { name: identity.name, gitee: identity.giteeId !== null },
    // Gitee 身份没有凭据串（ADR-0023）：任何响应都不出现它 —— 「复制凭据」按钮随之不渲染
    credential: identity.giteeId === null ? credentialOf(identity) : null,
    myTables: myTablesDetailed(identity.id),
    join,
    giteeError,
    giteeEnabled: giteeConfig() !== null
  };
};

export const actions = {
  logout: async (event) => {
    const { clearCredentialCookie } = await import('$lib/server/auth');
    clearCredentialCookie(event.cookies);
    redirect(303, '/');
  }
};
