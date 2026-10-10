<script lang="ts">
  import { clockFace, formatElapsed } from '$lib/labels';

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

  const face = $derived(elapsed === null ? null : clockFace(elapsed));
  /** 完整那句话（`距上一步 12 分 34 秒`）：图标里放不下，进 `title` 与读屏用的 `aria-label` */
  const phrase = $derived(elapsed === null ? '' : `距上一步 ${formatElapsed(elapsed)}`);

  /**
   * 三档的字号（见 `labels.ts` 的 `clockFace`）：一位 / 两位数正常、三位数小一档、
   * 「停住了」那枚横杠回到正常字号（它只有一个字符）。
   */
  const size = $derived(
    face === null ? '' : face.tone === 'long' ? 'text-[8px]' : 'text-[10px]'
  );
  const ink = $derived(
    face === null
      ? ''
      : face.tone === 'stale'
        ? 'text-rose-300'
        : 'text-white/50'
  );
</script>

<!-- 「距上一步」计时：操作条右端一枚**闹钟图标**，秒数写在圆里（ADR-0020 修订）。
     为什么不写「距上一步 12 分 34 秒」那枚药丸了：它要占 ~110px 宽，而这一行现在还要放
     动作托盘（出牌 / 确认埋底 / 清空）—— 计时缩进一枚 22px 的图标之后，托盘才进得来，
     毡面顶部那条 44px 的常驻动作带也才能撤掉（那一带还给牌区）。完整那句进 `title` 与
     `aria-label`，鼠标停一下、读屏听一遍都拿得到。
     它只报「多久没人动」：`0..999` 秒照实写数，`≥1000` 秒（约 17 分钟）改成一枚红横杠 ——
     那时它读作「这张桌停住了」，而不是「谁想了多久」（见 labels.ts 的 clockFace）。
     非空即渲染：`null` 表示这一桌还没发过牌，那时没有「上个动作」可说。 -->
{#if face !== null && elapsed !== null}
  <span
    class={['inline-flex shrink-0', klass]}
    data-action-clock="true"
    data-clock-tone={face.tone}
    title={phrase}
    aria-label={phrase}
    role="timer"
  >
    <span
      class={[
        'relative inline-grid h-[22px] w-[22px] place-items-center rounded-full bg-black/35 ring-1',
        face.tone === 'stale' ? 'ring-rose-400/40' : 'ring-white/10'
      ]}
      aria-hidden="true"
    >
      <!-- 两只铃铛：闹钟的辨识特征，左上 / 右上各一枚小斜条（纯装饰，随主题色走） -->
      <i
        class={[
          'pointer-events-none absolute -top-[3px] left-px h-[4px] w-[7px] -rotate-[35deg] rounded-[1px]',
          face.tone === 'stale' ? 'bg-rose-400/50' : 'bg-white/25'
        ]}
      ></i>
      <i
        class={[
          'pointer-events-none absolute -top-[3px] right-px h-[4px] w-[7px] rotate-[35deg] rounded-[1px]',
          face.tone === 'stale' ? 'bg-rose-400/50' : 'bg-white/25'
        ]}
      ></i>
      <b class={['font-bold leading-none tabular-nums', size, ink]} data-clock-face="true">
        {face.text}
      </b>
    </span>
  </span>
{/if}
