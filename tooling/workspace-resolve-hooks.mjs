/**
 * 工作区包在 `node --test` 里的解析钩子：`@sixty/<包>` → `packages/<包>/src/index.ts`。
 *
 * 为什么需要：Node 24 **拒绝对 `node_modules` 下的文件做类型擦除**
 * （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），而在 Windows 上 pnpm 给工作区包建的是
 * **junction** —— 于是 `@sixty/engine` 从兄弟包解析出来时，路径仍落在 `packages/<包>/node_modules/@sixty/engine`
 * 这一串里，装载阶段直接失败（Linux/CI 上是真 symlink，Node 会 realpath 到 `packages/engine/src`，
 * 所以那里本来就没问题 —— 这个钩子只是把 Windows 的行为对齐过去，映射到的**就是同一个文件**）。
 *
 * 用法（包自己的 test 脚本）：`node --import ../../tooling/workspace-resolve-hooks.mjs --test ...`
 * `apps/web` 另有一份带 `$lib/` 映射的钩子（`apps/web/test/resolve-hooks.mjs`），那条规则只有应用需要。
 */
const PACKAGES = new URL('../packages/', import.meta.url);

/** 只有这三个工作区包会被映射；其它 `@sixty/*` 一律交给 node 自己报错 */
const WORKSPACE = new Set(['engine', 'bot', 'mcp']);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@sixty/')) {
    const name = specifier.slice('@sixty/'.length);
    if (WORKSPACE.has(name)) {
      return next(new URL(`${name}/src/index.ts`, PACKAGES).href, context);
    }
  }
  return next(specifier, context);
}
