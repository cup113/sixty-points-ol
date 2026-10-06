<script lang="ts">
  import { ICONS, type IconName } from '../icons.ts';

  /**
   * 一枚字形：`$lib/music/icons.ts` 里的路径 → 内联 SVG。
   *
   * `currentColor` + 无固定尺寸（由 class 给），所以按钮 hover、禁用、高亮都能只靠文字的
   * 颜色与大小表达，不必给每个状态准备一套图标。
   */
  interface Props {
    name: IconName;
    size?: number;
    class?: string;
  }

  let { name, size = 20, class: cls = '' }: Props = $props();
  const icon = $derived(ICONS[name]);
</script>

<svg
  class={cls}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={icon.filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width={icon.filled ? 0 : 1.7}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each icon.d as path (path)}
    <path d={path} />
  {/each}
</svg>
