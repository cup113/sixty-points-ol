/**
 * Gitee 回调错误代号 → 给人看的那句话。
 *
 * 放在 `src/lib`（客户端可导入）：callback 路由生成 `/?gitee_error=<代号>`，
 * 大厅页负责翻译成句子。代号在 `gitee.ts` 的 fail() 里产生，白名单校验在 loader。
 */
export const GITEE_ERROR_MESSAGES: Record<string, string> = {
  state: 'Gitee 登录校验失败（state 不匹配或已过期），请重试',
  denied: '你在 Gitee 那边拒绝了授权',
  exchange: 'Gitee 授权码换 token 失败，请稍后重试',
  profile: '读取 Gitee 用户信息失败，请稍后重试',
  name: 'Gitee 用户名派生站内名失败（撞名过多），请联系管理员'
};
