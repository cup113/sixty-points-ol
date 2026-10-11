/**
 * `loader.mjs` 注册的解析钩子本体（单独一个文件是因为 `register()` 要的是一个模块 URL）。
 *
 * 三条规则，只补 node 缺的那部分：
 * 1. `$lib/x` → 应用源码的 `../src/lib/x`（SvelteKit 别名）；
 * 2. 相对/文件路径解析失败时，依次补 `.ts` 与 `/index.ts`（应用源码省略扩展名）。
 * 3. `@sixty/<包>` → `packages/<包>/src/index.ts`（工作区包的 `exports` 指的就是这个文件）。
 *    为什么要绕开 `node_modules` 里那个链接：Node 24 **拒绝对 node_modules 下的文件做类型擦除**
 *    （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），而 pnpm 在工作区里建的正是指向
 *    `packages/*` 的 junction —— 不映射的话，凡是运行时 import 引擎的测试（含既有测试）
 *    都会在装载阶段直接失败。
 *
 * 先原样交给 `next()`：能解析的一律不动，所以显式写 `./x.ts` 的老测试（引擎、mcp 包风格）
 * 走的是原生那条路。
 */
const LIB = new URL('../src/lib/', import.meta.url);
const PACKAGES = new URL('../../../packages/', import.meta.url);
/** 工作区包的名单：只映射这三个，其它 `@sixty/*` 一律交给 node 自己报错 */
const WORKSPACE = new Set(['engine', 'bot', 'mcp']);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@sixty/')) {
    const name = specifier.slice('@sixty/'.length);
    if (WORKSPACE.has(name)) {
      return next(new URL(`${name}/src/index.ts`, PACKAGES).href, context);
    }
  }
  const mapped = specifier.startsWith('$lib/')
    ? new URL(specifier.slice('$lib/'.length), LIB).href
    : specifier;
  try {
    return await next(mapped, context);
  } catch (error) {
    if (!mapped.startsWith('.') && !mapped.startsWith('file:')) throw error;
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await next(mapped + suffix, context);
      } catch {
        // 换下一个候选；全试完仍失败就抛最初那个错
      }
    }
    throw error;
  }
}
