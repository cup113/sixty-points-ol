import { error, json } from '@sveltejs/kit';
import {
  credentialOf,
  findByName,
  normalizeName,
  rename,
  requireIdentity,
  setCredentialCookie
} from '$lib/server/auth';
import { seatedTableCode } from '$lib/server/tables';
import type { RequestHandler } from './$types';

/**
 * 改名字。
 *
 * 两条硬约束（见 ADR-0009）：
 * 1. **在座时不能改**：身份是全局的，所以只要还占着任何一张桌的座位就拒绝；
 * 2. 名字全局唯一，撞名直接 400。
 *
 * 凭据串里内嵌名字，所以**本地身份**改名后必须**回发新凭据串**并重设 cookie，否则
 * 调用方手里的旧串当场失效。**Gitee 身份没有凭据串**（ADR-0023）：会话 cookie 与名字
 * 无关，只改库里的名字、什么都不回发。
 */
export const POST: RequestHandler = async (event) => {
  const identity = requireIdentity(event);
  const body = (await event.request.json().catch(() => ({}))) as { name?: unknown };
  const name = normalizeName(body.name);
  if (name === null) error(400, '名字需为 1-12 个字符，且不含冒号');

  const held = seatedTableCode(identity.id);
  if (held !== null) error(400, `你还在牌桌 ${held} 的座位上，先离座再改名`);

  const taken = findByName(name);
  if (taken !== null && taken.id !== identity.id) error(400, '这个名字已被使用');

  const renamed = rename(identity, name);
  if (renamed.giteeId !== null) {
    return json({ name: renamed.name });
  }
  const credential = credentialOf(renamed);
  setCredentialCookie(event.cookies, credential);
  return json({ name: renamed.name, credential });
};
