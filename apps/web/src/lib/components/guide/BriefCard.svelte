<script lang="ts">
  /**
   * 概念简述屏：左侧要点 + 右侧挂件（挂件全部复用 `scenarios.ts` 里被引擎核对过的示例）。
   *
   * 与旧幻灯片那一屏是同一套排法（没有挂件时不启用两列，否则正文会被挤成窄条），
   * 少了的只是「翻页动作」——现在由课程壳的上一屏 / 下一屏接管。
   */
  import ConceptWidgetView from './ConceptWidgetView.svelte';
  import type { ConceptWidget } from '$lib/guide/types';

  let {
    title,
    points,
    widget = undefined
  }: {
    title: string;
    points: readonly string[];
    widget?: ConceptWidget;
  } = $props();

  /** 正文里用 **粗体** 标出关键结论；只做最小解析，不引 markdown 依赖 */
  function segments(text: string): string[] {
    return text.split('**');
  }
</script>

<div
  class={['grid gap-3', widget === undefined ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]']}
  data-brief
>
  <div class="space-y-2">
    <h2 class="text-sm font-bold text-ivory">{title}</h2>
    {#each points as point, index (index)}
      <p class="text-[13px] leading-relaxed text-white/70">
        {#each segments(point) as segment, part (part)}
          {#if part % 2 === 1}<b class="text-ivory">{segment}</b>{:else}{segment}{/if}
        {/each}
      </p>
    {/each}
  </div>
  {#if widget !== undefined}
    <ConceptWidgetView {widget} />
  {/if}
</div>
