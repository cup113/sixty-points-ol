import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { identityFrom, type Identity } from '$lib/server/auth';
import {
  adminTables,
  adminUsers,
  deleteTableById,
  deleteUser,
  forceLeaveSeat,
  isAdminIdentity
} from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

/**
 * 管理员面板（ADR-0024）：**非管理员一律 404**（不泄露页面存在），
 * load 与每个 action 都各自过这道门 —— action 是独立入口，不能只靠 load 挡。
 * 参数取「load 与 action 的 event 共有」的最小形状（`ServerLoadEvent` 与 `RequestEvent`
 * 不是同一型，收窄到 cookies + request 两边都收）。
 */
function guard(event: Pick<RequestEvent, 'cookies' | 'request'>): Identity {
  const identity = identityFrom(event);
  if (identity === null || !isAdminIdentity(identity)) error(404, '页面不存在');
  return identity;
}

export const load: PageServerLoad = (event) => {
  guard(event);
  return { tables: adminTables(), users: adminUsers() };
};

function positiveInt(raw: FormDataEntryValue | null): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export const actions: Actions = {
  leave: async (event) => {
    guard(event);
    const data = await event.request.formData();
    const code = String(data.get('code') ?? '');
    const userId = positiveInt(data.get('userId'));
    if (code.length === 0 || userId === null) return fail(400, { message: '参数不合法' });
    const result = forceLeaveSeat(code, userId);
    if (!result.ok) return fail(400, { message: result.message ?? '操作失败' });
    return { message: `已让座位上的人离开牌桌 ${code}` };
  },
  delete_table: async (event) => {
    guard(event);
    const data = await event.request.formData();
    const tableId = positiveInt(data.get('tableId'));
    if (tableId === null) return fail(400, { message: '参数不合法' });
    if (!deleteTableById(tableId)) return fail(400, { message: '牌桌不存在' });
    return { message: `已删除牌桌 #${tableId}` };
  },
  delete_user: async (event) => {
    const identity = guard(event);
    const data = await event.request.formData();
    const userId = positiveInt(data.get('userId'));
    if (userId === null) return fail(400, { message: '参数不合法' });
    const result = deleteUser(userId, identity.id);
    if (!result.ok) return fail(400, { message: result.message ?? '操作失败' });
    return {
      message:
        `已删除用户 #${userId}` +
        (result.removedTableCodes.length > 0 ? `（随删空桌 ${result.removedTableCodes.join('、')}）` : '')
    };
  }
};
