<script lang="ts">
  /**
   * 引导文案的**粗体**渲染（全仓库唯一一份最小解析，不引 markdown 依赖）。
   *
   * 课程与引导局数据里随手写 `**关键结论**`（生成物 `docs/guide/*.json` 原样带过来），
   * 任何把这类文案端上屏的面 —— 概念简述、座位气泡、教练栏、复盘屏 —— 都过这一个组件，
   * 不许各写各的 `split('**')`（BriefCard 早先那份内联解析就是被它收编的）。
   * 解析规则：按 `**` 切段，奇数段为粗体；不成对的星号属数据错误，不在这里修。
   */
  let {
    text,
    /** 粗体那几段的额外类（默认只加重）；正文色由调用处的容器给 */
    boldClass = ''
  }: {
    text: string;
    boldClass?: string;
  } = $props();

  const parts = $derived(text.split('**'));
</script>

{#each parts as segment, part (part)}
  {#if part % 2 === 1}<b class={boldClass}>{segment}</b>{:else}{segment}{/if}
{/each}
