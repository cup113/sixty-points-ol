<script lang="ts">
  /**
   * 概念简述屏：左侧要点 + 右侧挂件（挂件全部复用 `scenarios.ts` 里被引擎核对过的示例）。
   *
   * 与旧幻灯片那一屏是同一套排法（没有挂件时不启用两列，否则正文会被挤成窄条），
   * 少了的只是「翻页动作」——现在由课程壳的上一屏 / 下一屏接管。
   */
  import ConceptWidgetView from './ConceptWidgetView.svelte';
  import RichText from './RichText.svelte';
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
</script>

<div
  class={['grid gap-3', widget === undefined ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]']}
  data-brief
>
  <div class="space-y-2.5">
    <h2 class="text-xl font-black text-ivory">{title}</h2>
    {#each points as point, index (index)}
      <div class="flex items-start gap-2.5">
        <span
          class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gold/15 text-xs font-bold text-gold"
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <p class="text-[15px] leading-relaxed text-white/75">
          <RichText text={point} boldClass="text-ivory" />
        </p>
      </div>
    {/each}
  </div>
  {#if widget !== undefined}
    <ConceptWidgetView {widget} />
  {/if}
</div>
