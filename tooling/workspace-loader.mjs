/**
 * `tooling/workspace-resolve-hooks.mjs` 的注册器（`register()` 要的是一个模块 URL）。
 *
 * 用法（包自己的 test 脚本）：`node --import ../../tooling/workspace-loader.mjs --test ...`
 * 与 `apps/web/test/loader.mjs` 同一个形状 —— 只在 `--import` 的模块里 export `resolve` 是不生效的，
 * 必须走 `module.register()`。
 */
import { register } from 'node:module';

register('./workspace-resolve-hooks.mjs', import.meta.url);
