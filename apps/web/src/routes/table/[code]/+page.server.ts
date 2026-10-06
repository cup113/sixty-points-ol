import { error, redirect } from '@sveltejs/kit';
import { identityFrom } from '$lib/server/auth';
import { enterTable, payloadFor } from '$lib/server/tables';
import { normalizeInvite } from '$lib/invite';
import { musicConfig } from '$lib/music-config.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const identity = identityFrom(event);
  if (identity === null) {
    // 还没注册：把邀请码一起带去大厅，注册或导入身份后大厅会自动回到这张桌。
    // 直接 redirect('/') 会把邀请码丢掉，用户得重新点一次链接（回归过的坑）。
    const invited = normalizeInvite(event.params.code);
    redirect(307, invited === null ? '/' : `/?join=${invited}`);
  }

  const code = event.params.code.toUpperCase();
  // 进入即到达：有空座自动入座，满座（或本人刚离座）则以观战身份进入
  const entered = enterTable(code, identity.id);
  if ('error' in entered) error(404, '牌桌不存在，请确认邀请码');

  // 音乐悬浮窗是**旁挂**功能（见 docs/adr/0019）：这里只带一个开关与一个音质偏好，
  // 牌局相关的字段一个都没动。`SIXTY_MUSIC=off` 时组件整块不渲染。
  const music = musicConfig();

  return {
    code: entered.table.code,
    // 入座时这一副正在进行 ⇒ 接下的是别人的进度，界面上要说一声
    inherited: entered.role === 'player' ? entered.inherited : false,
    musicEnabled: music.enabled,
    musicLevel: music.level,
    ...payloadFor(entered.table, identity.id)
  };
};
