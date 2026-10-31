import { initBots } from '$lib/server/bots';
import { initClaims } from '$lib/server/tables';

/**
 * 服务启动钩子（ADR-0015）：机器人调度器的定时器只在**进程内**（单实例，见 ADR-0001），
 * 重启后就没了。这里在模块加载时全量补扫一遍「有机器人座位的桌」——
 * 重启前停在机器人回合上的牌局因此自动续打，而不是等人来推一下。
 *
 * 幂等：`scheduleBots` 对「没轮到机器人」的桌什么都不排。
 */
initBots();

/**
 * 认赢的 30 秒窗口同理（ADR-0028）：重启前挂着的认赢必须接着走，
 * 已经超时的第一帧就判失败 —— 否则那一桌会停在一个永远不结束的表决上。
 */
initClaims();
