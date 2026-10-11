import type { PageLoad } from './$types';

/**
 * 让任意一步都能**直接链接**（`/learn?s=c2-follow-single`）。
 *
 * 为什么走查询参数而不是只认 `#hash`：hash 只在浏览器里有效，服务端渲染看不到它 ——
 * 那样每一步都只能先渲染第一步、再由 JS 跳过去（首屏闪一下，分享出去的链接也没有预览）。
 * 查询参数在 SSR 时就能读到，所以分享出去的链接直接就是那一步。
 */
export const load: PageLoad = ({ url }) => {
  return { step: url.searchParams.get('s') ?? '' };
};
