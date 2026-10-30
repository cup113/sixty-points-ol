import { error, json } from '@sveltejs/kit';
import { requireIdentity } from '$lib/server/auth';
import { postAnnouncement } from '$lib/server/tables';
import { parseSocialPost } from '$lib/social';
import type { RequestHandler } from './$types';

/**
 * 发一条桌边消息（ADR-0028）：`{ kind: 'emote', key }` / `{ kind: 'text', text }` / `{ kind: 'away', minutes }`。
 *
 * 座位一律由服务端按身份推导；这里只做 JSON 形状与档位校验，
 * 「在不在座 / 是不是发得太快 / 寿命多长」都在 `postAnnouncement` 里判（与动作路由同一层）。
 */
export const POST: RequestHandler = async (event) => {
  const identity = requireIdentity(event);
  const parsed = parseSocialPost(await event.request.json().catch(() => null));
  if (!parsed.ok) error(400, parsed.error);

  const result = postAnnouncement(event.params.code, identity.id, parsed.post);
  if (!result.ok) error(result.status ?? 400, result.message);
  return json({ ok: true });
};
