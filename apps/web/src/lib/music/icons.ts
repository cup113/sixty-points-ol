/**
 * 音乐悬浮窗用到的几个字形。
 *
 * 只放**音乐这一块**需要的：全部是 24×24 的描边字形，`stroke-width` 由使用处给
 * （悬浮窗在深色毡面上，需要比 /rules 那种正文里的图标更亮一点）。
 * 不引第三方图标包：这一个功能的图标总共不到二十个，为它们加一个依赖不划算。
 */
export interface Icon {
  /** SVG 路径数据（可能多条，各是一条 `d`） */
  readonly d: readonly string[];
  /** 需要填充而不是描边的字形（播放三角、静音喇叭）。省略 = 描边。 */
  readonly filled?: true;
}

const SET = {
  play: { d: ['M8 5.5v13l11-6.5-11-6.5Z'], filled: true },
  pause: { d: ['M9 5.5v13', 'M15 5.5v13'] },
  previous: { d: ['M18.5 6v12L9 12l9.5-6Z', 'M5.5 5.5v13'], filled: true },
  next: { d: ['M5.5 6v12L15 12 5.5 6Z', 'M18.5 5.5v13'], filled: true },
  volume: { d: ['M4 9.5h3.5L12 6v12l-4.5-3.5H4v-5Z'], filled: true },
  mute: { d: ['M4 9.5h3.5L12 6v12l-4.5-3.5H4v-5Z', 'M15.5 9.5l5 5', 'M20.5 9.5l-5 5'], filled: true },
  modeList: { d: ['M4 7h12', 'M4 12h12', 'M4 17h12', 'M18.5 15l1.5 2 1.5-2', 'M20 17V7'] },
  modeOne: { d: ['M4 7h12', 'M4 12h12', 'M4 17h12', 'M18 15l1.5 2 1.5-2', 'M20 17V7', 'M20 9.5v0'] },
  modeShuffle: { d: ['M4 7h4l8 10h4', 'M4 17h4l8-10h4', 'M17 4.5l3 2.5-3 2.5', 'M17 14.5l3 2.5-3 2.5'] },
  search: { d: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M15.8 15.8 20 20'] },
  queue: { d: ['M4 6h11', 'M4 12h11', 'M4 18h7', 'M18 12v7', 'M14.5 15.5h7'] },
  lyrics: { d: ['M5 5h14v14H5z', 'M8 9h8', 'M8 12.5h8', 'M8 16h4'] },
  like: { d: ['M12 19s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 4.7-7 9-7 9Z'] },
  user: { d: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 20a7.5 7.5 0 0 1 15 0'] },
  minimize: { d: ['M6 12h12'] },
  close: { d: ['M6 6l12 12', 'M18 6 6 18'] },
  plus: { d: ['M12 6v12', 'M6 12h12'] },
  refresh: { d: ['M20 12a8 8 0 1 1-2.3-5.6', 'M20 4v4h-4'] }
} as const satisfies Record<string, Icon>;

/**
 * 对外只露这一张表（`IconName` 由它推出）。
 *
 * 上面用 `satisfies` 而不是 `: Record<string, Icon>` 是为了保住字面量类型（图标名拼错要报错），
 * 代价是没写 `filled` 的那几条在类型上没有这个属性 —— 这里显式再标一次 `Record<IconName, Icon>`
 * 把它们统一成同一个形状（`Icon` 里 `filled` 是可选的）。
 */
export const ICONS: Record<keyof typeof SET, Icon> = SET;

export type IconName = keyof typeof SET;
