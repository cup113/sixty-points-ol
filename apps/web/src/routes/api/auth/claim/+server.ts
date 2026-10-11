import { error, json } from '@sveltejs/kit';
import {
  credentialOf,
  createIdentity,
  findByName,
  findByCredential,
  identityFrom,
  normalizeName,
  clearSessionCookie,
  setCredentialCookie
} from '$lib/server/auth';
import { seatedTableCode } from '$lib/server/tables';
import type { RequestHandler } from './$types';

/** 创建身份（传 name）或导入身份（传 credential）；两者都会下发凭据 cookie */
export const POST: RequestHandler = async (event) => {
  const { request, cookies } = event;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; credential?: unknown };
  const current = identityFrom(event);

  if (typeof body.credential === 'string' && body.credential.trim().length > 0) {
    const identity = findByCredential(body.credential);
    if (identity === null) error(400, '凭据无效，请检查是否完整复制');
    // 换身份前必须先离座：否则旧身份继续占着座位，变成没人认领的幽灵占位（见 ADR-0009）
    if (current !== null && current.id !== identity.id) {
      const held = seatedTableCode(current.id);
      if (held !== null) error(400, `你的身份还坐在牌桌 ${held} 的座位上，先离座再换身份`);
    }
    const credential = credentialOf(identity);
    setCredentialCookie(cookies, credential);
    // 凭据与会话互斥（ADR-0023）：导入本地身份即退出 Gitee 会话
    clearSessionCookie(cookies);
    return json({ name: identity.name, credential });
  }

  const name = normalizeName(body.name);
  if (name === null) error(400, '名字需为 1-12 个字符，且不含冒号');
  const existing = findByName(name);
  // 自己的名字再进一次是幂等的；别人的名字一律拒绝——绝不再签发那条身份（否则等于冒名入座）
  if (existing !== null && (current === null || existing.id !== current.id)) {
    error(400, '这个名字已被使用，请换一个，或用凭据串导入你的身份');
  }
  const identity = existing ?? createIdentity(name);
  if (identity === null) error(400, '这个名字已被使用，请换一个，或用凭据串导入你的身份');
  const credential = credentialOf(identity);
  setCredentialCookie(cookies, credential);
  return json({ name: identity.name, credential });
};
