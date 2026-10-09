<script lang="ts">
  import type { Level } from '@sixty/engine';
  import LevelBadge from './LevelBadge.svelte';

  /**
   * 座位卡。两种形态：
   *
   * - `card`（默认）：两张**对手**卡，钉在毡面顶行两角；纯展示。
   * - `bar`：「我」那一条**底栏**（跨宽、一行），住在毡面第三行 —— 位置本身就是「这是我」，
   *   所以不再画「我」徽标。
   *
   * **动作面不在这里**：早先卡片底下有一整行「+ 机器人 / 请离」，那是它比对手卡高出一整行、
   * 进而压住状态条与叫牌面板上沿的直接原因（见 ADR-0020）。机器人那两个动作现在只在
   * 抽屉的「牌桌」页（`TablePanel`），毡面因此只剩身份信息。
   *
   * 调用方必须自己给定位类（`class`）：Tailwind 产物里 `.relative` 排在 `.absolute` 之后，
   * 同一元素混用两者时 relative 胜出，座位卡会塌回文档流、全挤在毡面左上角。
   */
  let {
    name,
    level = null,
    isMe = false,
    isDeclarer = false,
    isTurn = false,
    online = false,
    bot = false,
    variant = 'card',
    class: klass = ''
  }: {
    name: string | null;
    level?: Level | null;
    isMe?: boolean;
    isDeclarer?: boolean;
    isTurn?: boolean;
    online?: boolean;
    /** 这个座位是机器人（服务器代打的无凭据身份，见 ADR-0015） */
    bot?: boolean;
    /** card = 顶行两角的对手卡；bar = 毡面底部「我」那一条 */
    variant?: 'card' | 'bar';
    class?: string;
  } = $props();

  const empty = $derived(name === null);
</script>

{#snippet mask()}
  <!-- 头像：人是名字首字，机器人是一枚**内联 SVG**。
       为什么不用 emoji（🤖）：各平台的字体不同、有的还会把它渲染成彩色图片，尺寸与基线
       在 36px 的圆里对不齐；内联 SVG 在任何机器上都是同一张图。
       为什么不再单列一行「机器人」徽标：头像自己已经说清了，而那一行正是座位卡偏高的原因
       （名字前缀「机器人·」是**身份名**，照旧保留）。 -->
  <div class="relative shrink-0">
    <div
      class={[
        'grid h-9 w-9 place-items-center rounded-full text-sm font-bold ring-2',
        isMe ? 'bg-gold/90 text-ink ring-gold/60' : 'bg-felt-600 ring-white/15',
        isTurn && 'turn-ring animate-pulse'
      ]}
      title={bot ? '机器人：由服务器代打（没有凭据串，不可能被人冒充）' : undefined}
    >
      {#if empty}
        空
      {:else if bot}
        <svg viewBox="0 0 24 24" class="h-5 w-5 text-ivory" aria-label="机器人" role="img">
          <path
            d="M11.25 1.6a.75.75 0 0 1 1.5 0v1.03h1.6a.9.9 0 0 1 0 1.8H9.65a.9.9 0 0 1 0-1.8h1.6z"
            fill="currentColor"
          />
          <rect x="3.6" y="5.5" width="16.8" height="12.6" rx="3.4" fill="currentColor" />
          <circle cx="9" cy="11.6" r="1.45" fill="var(--color-felt-800)" />
          <circle cx="15" cy="11.6" r="1.45" fill="var(--color-felt-800)" />
          <rect x="8.6" y="14.8" width="6.8" height="1.4" rx=".7" fill="var(--color-felt-800)" />
        </svg>
      {:else}
        <!-- `name ?? ''` 而不是直接 `name.slice`：`empty` 是派生值，TS 在这里收窄不到它 -->
        {(name ?? '').slice(0, 1)}
      {/if}
    </div>
    {#if !empty}
      <span class={['status-dot', online ? 'online' : 'offline']} title={online ? '在线' : '离线'}></span>
    {/if}
  </div>
{/snippet}

{#snippet crown()}
  <span title="庄家" class="shrink-0 text-lg leading-none text-gold drop-shadow-[0_1px_2px_rgba(0,0,0,.9)]"
    >♛</span
  >
{/snippet}

{#if variant === 'bar'}
  <!-- 「我」那一条：一行装完身份（庄冠 / 头像 / 名字 / 级别徽标）。
       跨宽且**只有一个高度**，所以它占的空间是常数 —— 底下的内容槽因此可以固定算出可用高度。 -->
  <div
    data-seat-bar="true"
    class={[
      'flex h-10 items-center gap-2 rounded-2xl px-2.5 ring-1 backdrop-blur-sm',
      isMe ? 'bg-gold/10 ring-gold/40' : 'bg-black/30 ring-white/10',
      empty && 'opacity-60',
      klass
    ]}
  >
    {#if isDeclarer}
      {@render crown()}
    {/if}
    {@render mask()}
    <p class="min-w-0 truncate text-sm font-semibold">{name ?? '空座'}</p>
    {#if level}
      <LevelBadge {level} class="ml-auto" />
    {/if}
  </div>
{:else}
  <div
    class={[
      'rounded-2xl p-2.5 ring-1 backdrop-blur-sm sm:p-3',
      isMe ? 'bg-gold/10 ring-gold/40' : 'bg-black/30 ring-white/10',
      empty && 'opacity-60',
      klass.length > 0 ? klass : 'relative'
    ]}
  >
    {#if isDeclarer}
      <span class="absolute -top-3 left-3">{@render crown()}</span>
    {/if}
    {#if isMe}
      <span
        class="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-gold text-[10px] font-bold text-ink shadow"
        >我</span
      >
    {/if}

    <!--
      名字独占一列，装饰不许与它抢同一行。同一行里只有名字是 flex-1、其余全是 shrink-0，宽度会被
      吃干净：实测 176px 的卡能给名字的只剩 23.6px（`w-36` 的手机卡是 0px），而「机器人·小六」
      需要 76px —— 于是机器人只画出「机…」，手机上干脆什么都看不到（人类名「截图玩家」也只剩
      0.4px 余量）。所以：名字进 `min-w-0 flex-1` 的列、去掉 `truncate`（改 `break-words`，
      宁可折行也不隐藏，合法名字上限 12 字）。

      卡高在 ≥640px 时不变：级别徽标实测 40px 高，而「名字 18px」≈ 40px ——
      那一行「机器人」徽标已删（头像自己就是标记，见 mask），这一行现在是卡上唯一一行。
      `gap-2`（而非 2.5）也是量出来的：名字列 79.6px ≥ 76px，全名正好一行放得下。
      加宽卡片不是替代方案 —— 容下这一行要 ≈240px，640px 视口下会撞上居中的大厅面板。
    -->
    <div class="flex items-center gap-2">
      {@render mask()}
      <div class="min-w-0 flex-1">
        <p class="break-words text-sm font-semibold leading-tight">{name ?? '空座'}</p>
      </div>
      {#if level}
        <LevelBadge {level} class="shrink-0" />
      {/if}
    </div>
  </div>
{/if}
