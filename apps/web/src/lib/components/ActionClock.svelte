<script lang="ts">
  import { formatElapsed } from '$lib/labels';

  let { ageMs = null, class: klass = '' }: { ageMs?: number | null; class?: string } = $props();

  /**
   * 本地锚点：`null` = 还没接管（SSR 与首帧直接用服务端给的年龄）。
   * 每次负载更新（= 每一帧）都重新锚定一次，所以帧之间的走时完全由本地钟负责，
   * 而**真相始终来自服务端**：浏览器不需要、也不许拿自己的钟去对服务端的钟。
   */
  let anchorAt = $state<number | null>(null);
  let tick = $state(0);

  $effect(() => {
    if (ageMs === null) {
      anchorAt = null;
      return;
    }
    anchorAt = Date.now();
  });

  // ageMs 为 null（这一桌还没发过牌）时不走时：没有「上个动作」可计
  $effect(() => {
    if (ageMs === null) return;
    const id = setInterval(() => (tick += 1), 1000);
    return () => clearInterval(id);
  });

  const elapsed = $derived.by(() => {
    void tick; // 让下面这行随时钟重算（Date.now() 本身不是响应式的）
    if (ageMs === null) return null;
    return anchorAt === null ? ageMs : ageMs + Math.max(0, Date.now() - anchorAt);
  });
</script>

<!-- 「距上一步 NN 秒」：操作条右端的一枚**药丸**（与状态条、赢墩徽标同一套视觉）——
     外面那层底与描边让它从毡面纹理上浮起来，等宽数字让秒数跳动时不左右晃。
     它只报「多久没人动」，不做任何超时/催促/变色（见 CONTEXT.md 的「计时」）。
     非空即渲染：`null` 表示这一桌还没发过牌，那时没有「上个动作」可说。
     文案一字未改（`距上一步 M 分 SS 秒`）—— `ui-check` 的 clockSeconds 就按它取数，
     并断言这个数**真的在走**（抓冻住的时钟与单位错）。 -->
{#if elapsed !== null}
  <span
    class={[
      'inline-flex shrink-0 items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 text-[11px] tabular-nums text-white/45 ring-1 ring-white/10',
      klass
    ]}
    data-action-clock="true"
  >
    <span aria-hidden="true" class="text-[10px] leading-none text-white/35">⏱</span>
    距上一步 {formatElapsed(elapsed)}
  </span>
{/if}
