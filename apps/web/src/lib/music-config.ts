/**
 * 音乐旁挂服务的配置。
 *
 * 与 `server/bots.ts` 的 `botDelayRange(env)` 同一套路：**入参就是 env**，缺省即出厂行为，
 * 所以这些默认值能在 `node:test` 里逐条钉住，不依赖真实环境变量。
 *
 * 四个环境变量：
 * - `SIXTY_MUSIC`：`off` 时**整块功能下线** —— 不渲染悬浮窗、`/api/music/*` 一律 404。
 *   这是给「不想在这台机器上连网易云」的部署留的总闸（也让它与主功能彻底可分离）。
 * - `SIXTY_MUSIC_API`：ncm-api 边车的地址（docker compose 里是 `http://ncm:4000`）。
 * - `SIXTY_MUSIC_TIMEOUT_MS`：单次上游请求超时（默认 5 秒）。
 * - `SIXTY_MUSIC_LEVEL`：登录用户的音质偏好（`exhigh` / `lossless` / `hires` …）；
 *   匿名一律 `standard`，由 `qualityTierOf` 兜底 —— 配成 `lossless` 也不会让匿名播放全废。
 */

export interface MusicConfig {
  readonly enabled: boolean;
  /** 上游服务根地址（不带尾斜杠） */
  readonly apiBase: string;
  readonly timeoutMs: number;
  /** 登录用户的音质偏好；匿名会被降级成 standard */
  readonly level: string;
}

export const DEFAULT_API_BASE = 'http://127.0.0.1:4000';
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_LEVEL = 'exhigh';

/** 合理的超时区间：太短会在弱网下全军覆没，太长会让界面一直转圈 */
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 30_000;

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(value), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/** 去掉尾斜杠：`http://ncm:4000/` 与 `http://ncm:4000` 必须拼出同一个地址 */
function normalizeBase(raw: string): string {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/\/+$/, '');
  return stripped === '' ? DEFAULT_API_BASE : stripped;
}

export function musicConfig(env: Record<string, string | undefined> = process.env): MusicConfig {
  return {
    enabled: env['SIXTY_MUSIC'] !== 'off',
    apiBase: normalizeBase(env['SIXTY_MUSIC_API'] ?? DEFAULT_API_BASE),
    timeoutMs: parseTimeout(env['SIXTY_MUSIC_TIMEOUT_MS']),
    level: (env['SIXTY_MUSIC_LEVEL'] ?? DEFAULT_LEVEL).trim() || DEFAULT_LEVEL
  };
}
