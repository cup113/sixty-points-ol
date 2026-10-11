<script lang="ts">
  import GiteeMark from '$lib/components/GiteeMark.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const card = 'rounded-2xl bg-black/30 p-4 ring-1 ring-white/10';
  const primary =
    'rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-ink transition hover:brightness-110 active:scale-95 disabled:opacity-40';
  const danger =
    'rounded-lg px-3 py-1.5 text-xs font-semibold text-red-200 ring-1 ring-red-400/40 transition hover:bg-red-500/20 disabled:opacity-40';
  const ghost =
    'rounded-lg px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/20 transition hover:bg-white/10 disabled:opacity-40';

  const seatLabel = (seat: { name: string; bot: boolean } | null): string => {
    if (seat === null) return '空座';
    return seat.bot ? `${seat.name}（机器人）` : seat.name;
  };

  /** 时间戳按本地钟写成 `MM-DD HH:mm`：ISO 原文（2026-10-11T11:11:12.058Z）在这张表上纯噪声 */
  const stamp = (iso: string | null): string => {
    if (iso === null) return '—';
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  };
</script>

<main class="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
  <header class="flex items-baseline justify-between">
    <h1 class="text-2xl font-black tracking-widest text-ivory">管理面板</h1>
    <a class="text-xs text-white/60 underline underline-offset-4 hover:text-white" href="/">← 回大厅</a>
  </header>

  {#if form?.message}
    <p class="rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200 ring-1 ring-emerald-400/30">
      {form.message}
    </p>
  {/if}

  <section class={card}>
    <h2 class="text-sm font-bold text-white/70">牌桌（{data.tables.length}）</h2>
    <div class="mt-3 flex flex-col gap-2">
      {#each data.tables as table (table.id)}
        <div class="rounded-xl bg-black/30 px-3 py-2 ring-1 ring-white/10">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-mono tracking-widest text-gold">{table.code}</span>
            <span class="text-white/50">#{table.id}</span>
            <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
              {table.phase ?? '未开局'}
            </span>
            <span class="text-white/40">{stamp(table.updatedAt ?? table.createdAt)}</span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2">
            {#each table.seats as seat, index (index)}
              {#if seat === null}
                <span class="rounded-lg bg-black/30 px-2 py-1 text-[11px] text-white/35">空座</span>
              {:else}
                <form
                  class="flex items-center gap-1"
                  method="POST"
                  action="?/leave"
                  onsubmit={(event) => {
                    if (!confirm(`让 ${seat!.name} 离开牌桌 ${table.code}？座位空出等补位。`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="code" value={table.code} />
                  <input type="hidden" name="userId" value={seat!.userId} />
                  <span class="rounded-lg bg-black/30 px-2 py-1 text-[11px] text-white/70">
                    {seatLabel(seat)}
                  </span>
                  <button class={ghost} type="submit">强制离座</button>
                </form>
              {/if}
            {/each}
            <!-- 行级操作单独一条栏：与座位组之间用发丝线分开（宽屏上 ml-auto 拉出的空隙
                 读起来像「漏了一格」，而不是「操作在这一侧」） -->
            <form
              class="ml-auto"
              method="POST"
              action="?/delete_table"
              onsubmit={(event) => {
                if (!confirm(`删除牌桌 ${table.code}？连同座位、牌局、事件与重演一起删，不可恢复。`)) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="tableId" value={table.id} />
              <button class={danger} type="submit">删桌</button>
            </form>
          </div>
        </div>
      {:else}
        <p class="text-xs text-white/40">没有牌桌</p>
      {/each}
    </div>
  </section>

  <section class={card}>
    <h2 class="text-sm font-bold text-white/70">用户（最近 {data.users.length}）</h2>
    <div class="mt-3 flex flex-col gap-1.5">
      {#each data.users as user (user.id)}
        <div class="flex flex-wrap items-center gap-2 rounded-xl bg-black/30 px-3 py-2 text-xs ring-1 ring-white/10">
          <span class="font-semibold text-white/85">{user.name}</span>
          <span class="text-white/40">#{user.id}</span>
          {#if user.gitee}
            <span class="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold text-gold">
              <GiteeMark size={11} />Gitee
            </span>
          {/if}
          {#if user.bot}
            <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">机器人</span>
          {/if}
          {#if user.seatedCount > 0}
            <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
              在座 {user.seatedCount} 桌
            </span>
          {/if}
          <span class="ml-auto text-white/35">{stamp(user.createdAt)}</span>
          <form
            method="POST"
            action="?/delete_user"
            onsubmit={(event) => {
              if (
                !confirm(
                  `删除用户 ${user.name}？在座的座位全部空出、名字回池、Gitee 会话撤销${user.seatedCount > 0 ? '（含进行中的牌局停在空座）' : ''}，不可恢复。`
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="userId" value={user.id} />
            <button class={danger} type="submit">删用户</button>
          </form>
        </div>
      {/each}
    </div>
  </section>

  <p class="text-center text-[10px] text-white/30">
    门禁：环境变量名单里的 Gitee 身份（ADR-0024）；写操作只有强制离座、删桌、删用户。
  </p>
</main>
