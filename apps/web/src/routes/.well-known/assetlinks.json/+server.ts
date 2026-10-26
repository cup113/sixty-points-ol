import { error, json } from '@sveltejs/kit';
import { assetLinks, twaConfig } from '$lib/server/assetlinks';
import type { RequestHandler } from './$types';

/**
 * TWA 的信任声明（ADR-0026）：没配 `SIXTY_TWA_PACKAGE` / `SIXTY_TWA_FINGERPRINTS` 就 404 ——
 * 与 Gitee 登录「不配即隐身」同一口径，也不给缓存层留下一个会被记住的空声明。
 *
 * 配了但写错（包名不合法、指纹不是 SHA-256）会抛，于是这一条返回 500 ——
 * 这正是想要的方向：写错的部署必须看得见，否则 APK 会静默退化成带地址栏的形态。
 */
export const GET: RequestHandler = () => {
  const config = twaConfig();
  if (config === null) error(404, '未启用 Android 安装包信任声明');

  return json(assetLinks(config), {
    headers: { 'cache-control': 'public, max-age=300' }
  });
};
