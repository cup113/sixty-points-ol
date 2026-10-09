<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { BOT_LIMIT } from '$lib/shared';
  import type { TableClient } from '$lib/client/table.svelte';
  import SeatActions from './SeatActions.svelte';
  import SeatCard from './SeatCard.svelte';

  /**
   * 「牌桌」页 = **这张桌现在什么样**：三家座位 + 我的身份。
   *
   * 为什么观战/离座/改名合成一页：它们是同一条领域规则的两面 —— CONTEXT.md 定死了
   * 「改名/换身份只允许在不在座时进行」，所以离座入口与身份表单应当同屏，
   * 「先离座再改名」才是一条能顺着走完的路。
   *
   * 页头右上角另外有一枚**桌况簇**（观战人数 + 离座/改名/入座，见 `TableHeaderActions`）：
   * 一步动作在页头，这里留的是**完整三态与说明**（为什么现在入不了座、离座之后会发生什么），
   * 两者刻意并存。观战人数只在页头显示一处，本页不重复。
   *
   * 在座时**不给**必定失败的按钮（服务端一律 400）：只说明原因并给出离座入口。
   *
   * 这一页在抽屉关闭时也留在 DOM 里（`inert`），所以「改名 / 换身份」与「座位已满」两处
   * 入口在观战页的 SSR 里始终存在 —— `ui-check` 与 `spectate-check` 守的正是它们。
   */
  let {
    client,
    onLeave,
    onRemoveBot
  }: {
    client: TableClient;
    onLeave?: () => void;
    /**
     * 请离机器人：**必须由页面处理** —— 确认弹窗（`BotRemoveConfirm`）挂在页面级，
     * 因为这个抽屉有 `transform`，会把 `fixed` 弹窗困在抽屉里（见 CONTEXT.md 的页头条目）。
     */
    onRemoveBot?: (seat: number) => void;
  } = $props();

  let name = $state('');
  let credential = $state('');
  let done = $state<string | null>(null);

  const view = $derived(client.view);
  const deal = $derived(view?.deal ?? null);
  const seats = $derived(client.table?.seats ?? []);
  const seated = $derived(client.you !== null);
  const mySeat = $derived(client.you?.seat ?? null);
  const free = $derived(seats.some((seat) => seat.userId === null));
  /**
   * 机器人只在**这一页**加/请离（毡面座位卡上的那一行按钮已撤走，见 ADR-0020）。
   *
   * 为什么撤到这里：那一行按钮比对手卡高出一整行，是毡面重叠的直接原因；而机器人动作本来
   * 就属于「这张桌现在什么样」——与入座/离座同一类，只是它改的是**空座**而不是我的座位。
   * 上限 2（至少留一个人类座位去按「开下一副」），在座人类才能加。
   */
  const botCount = $derived(seats.filter((seat) => seat.bot).length);
  const canBot = $derived(seated && botCount < BOT_LIMIT);

  const input =
    'min-w-0 flex-1 rounded-lg bg-black/50 px-2.5 py-1.5 text-xs outline-none ring-1 ring-white/15 transition focus:ring-gold';
  const gold =
    'rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-ink transition hover:brightness-110 disabled:opacity-40';
  const ghost =
    'rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-30';

  async function rename(): Promise<void> {
    done = null;
    const renamed = await client.rename(name.trim());
    if (renamed !== null) {
      name = '';
      done = `已改名为「${renamed}」，凭据串已更新`;
      await invalidateAll();
    }
  }

  async function swap(): Promise<void> {
    done = null;
    if (await client.switchIdentity(credential.trim())) {
      // 换身份后 cookie 已换人，而 SSE 连接是用旧 cookie 建立的：整页重载重新握手
      window.location.reload();
    }
  }
</script>

<div class="flex items-center gap-2">
  {#if seated}
    <span class="rounded-md bg-gold/20 px-2 py-0.5 text-[11px] font-bold text-gold">在座</span>
  {:else}
    <span class="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-white/70">观战中</span>
  {/if}
</div>

<div class="mt-3 space-y-1.5">
  {#each seats as seat (seat.seat)}
    <div class="flex items-center gap-2">
      <!-- 这一页的座位卡是**只读**的：位置在抽屉里、没有毡面的锚点语义，
           所以一律走 `card` 形态（底栏那条 `bar` 是毡面「我」专用的） -->
      <SeatCard
        name={seat.name}
        level={view?.levels[seat.seat] ?? null}
        online={seat.online}
        bot={seat.bot}
        isMe={mySeat === seat.seat}
        isDeclarer={deal?.declarerSeat === seat.seat}
      />
      <!-- 机器人动作就挂在这一行上：空座给「+ 机器人」、机器人座给「请离」。
           两者都不是「牌局动作」，所以放在抽屉里不违反「动作面不进抽屉」（那一条指的是
           叫品/埋底/出牌/结算 —— 改一次要点两步就太钝的那些）。 -->
      {#if seat.userId === null && canBot}
        <button
          type="button"
          class={ghost}
          disabled={client.busy}
          onclick={() => void client.addBot(seat.seat)}
        >
          + 机器人
        </button>
      {:else if seat.bot && seated}
        <button
          type="button"
          class={ghost}
          disabled={client.busy}
          onclick={() => onRemoveBot?.(seat.seat)}
        >
          请离
        </button>
      {/if}
    </div>
  {/each}
</div>

<div class="mt-3">
  <SeatActions {client} onLeave={onLeave} />
  <p class="mt-1.5 text-[11px] leading-relaxed text-white/45">
    {#if seated}
      离座后你成为这一桌的观战者，座位空出等补位；这个座位的级别与手牌由下一位入座者继承。
    {:else if free}
      有空座就能补上；这一副还没结算的话，你接下的是这个座位现有的级别与手牌。
    {:else}
      三人都在座：你只能观战，等有人离座再补位。
    {/if}
  </p>
</div>

<h3 class="mt-5 text-sm font-bold">改名 / 换身份</h3>

{#if seated}
  <p class="mt-2 text-[11px] leading-relaxed text-white/50">
    在座时改不了名字或身份 —— 名字与凭据串是这一桌的身份凭据，换掉会让桌上的人认不出你。
    先点上面的「离座」，就会变成观战者，那时这里就能改。
  </p>
{:else}
  <p class="mt-2 text-[11px] leading-relaxed text-white/50">
    名字全局唯一；改名后凭据串会重签（旧串当场失效），新串自动写回本机。
  </p>

  <form
    class="mt-3 flex gap-2"
    onsubmit={(event) => {
      event.preventDefault();
      void rename();
    }}
  >
    <input class={input} placeholder="新名字（1-12 字）" bind:value={name} maxlength="12" />
    <button type="submit" class={gold} disabled={client.busy || name.trim().length === 0}>改名</button>
  </form>

  <form
    class="mt-3 flex gap-2"
    onsubmit={(event) => {
      event.preventDefault();
      void swap();
    }}
  >
    <input class={input} placeholder="粘贴另一条凭据串换身份" bind:value={credential} />
    <button
      type="button"
      class={ghost}
      disabled={client.busy || credential.trim().length === 0}
      onclick={() => void swap()}
    >
      换身份
    </button>
  </form>
{/if}

{#if done}
  <p class="mt-3 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-200">{done}</p>
{/if}
{#if client.error}
  <p class="mt-2 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-200">{client.error}</p>
{/if}
