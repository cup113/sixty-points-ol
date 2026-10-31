import { error, json } from '@sveltejs/kit';
import { requireIdentity } from '$lib/server/auth';
import { applyTableAction, isCallShape, isCardShape, type TableAction } from '$lib/server/tables';
import type { RequestHandler } from './$types';

interface Body {
  action?: {
    type?: unknown;
    call?: unknown;
    cards?: unknown;
    lastTrick?: unknown;
    agree?: unknown;
  };
}

/** 座位号不接受客户端输入：由服务端按身份推导 */
function toAction(body: Body): TableAction {
  const raw = body.action;
  if (!raw || typeof raw.type !== 'string') error(400, '缺少动作');
  switch (raw.type) {
    case 'deal':
      return { type: 'deal' };
    case 'newGame':
      return { type: 'newGame' };
    case 'bid':
      if (!isCallShape(raw.call)) error(400, '叫品格式不正确');
      return { type: 'bid', seat: 0, call: raw.call };
    case 'bury':
      if (!Array.isArray(raw.cards) || raw.cards.length !== 3 || !raw.cards.every(isCardShape)) {
        error(400, '埋底必须恰好 3 张合法牌');
      }
      return { type: 'bury', seat: 0, cards: raw.cards };
    case 'play':
      if (!Array.isArray(raw.cards) || raw.cards.length === 0 || !raw.cards.every(isCardShape)) {
        error(400, '出牌必须是非空的合法牌');
      }
      return { type: 'play', seat: 0, cards: raw.cards };
    // 认赢：截止时刻由服务端盖（`applyTableAction`），这里只收「末轮张数」
    case 'claim':
      if (typeof raw.lastTrick !== 'number' || !Number.isInteger(raw.lastTrick)) {
        error(400, '末轮张数必须是整数');
      }
      return { type: 'claim', seat: 0, lastTrick: raw.lastTrick };
    case 'claimAnswer':
      if (typeof raw.agree !== 'boolean') error(400, '表态必须是同意或不同意');
      return { type: 'claimAnswer', seat: 0, agree: raw.agree };
    default:
      error(400, '未知动作');
  }
}

export const POST: RequestHandler = async (event) => {
  const identity = requireIdentity(event);
  const body = (await event.request.json().catch(() => ({}))) as Body;
  const action = toAction(body);
  const result = applyTableAction(event.params.code, identity.id, action);
  if (!result.ok) error(400, result.message);
  return json({ ok: true });
};
