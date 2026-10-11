<script lang="ts">
  /**
   * 本地身份的登出确认（**弹窗**，不是卡片里内联的一块）。
   *
   * 存在的理由：登出会同时删掉本机保存的凭据串（`/api/auth/logout` + `clearCredential`），
   * 而这个身份无密码、无找回 —— 没在别处保存就永远回不来了（ADR-0003）。
   * 在座时还多一层：「离开房间并登出」先把座位退掉、把邀请码复制带走，
   * 这样之后用**新身份**凭邀请码补位回来（幽灵占位那条路因此不存在）。
   *
   * 形状与 `LeaveConfirm` / `BotRemoveConfirm` 一致（`fixed inset-0 z-50` + 遮罩 + 22rem 卡片）；
   * 与它们同理必须挂在**页面级**：抽屉靠 transform 位移，任何 transform 都会成为 `fixed` 后代的
   * 包含块，弹窗塞进抽屉就会被限制在 22rem 的盒子里。
   *
   * Gitee 身份不走这里：它随时能再登一次 Gitee 回来，没有「回不来」这回事。
   */
  let {
    open = false,
    seatedCodes = [],
    roomLinks = null,
    busy = false,
    error = null,
    onCancel,
    onLeaveRoom,
    onLogout
  }: {
    open?: boolean;
    /** 我在座的桌的邀请码：非空才给「离开房间并登出」 */
    seatedCodes?: readonly string[];
    /** 剪贴板不可用时就地列出邀请码序列，供手抄 */
    roomLinks?: readonly string[] | null;
    busy?: boolean;
    error?: string | null;
    onCancel?: () => void;
    onLeaveRoom?: () => void;
    onLogout?: () => void;
  } = $props();

  const ghost = 'rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10';
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    data-logout-confirm
  >
    <div class="w-[22rem] max-w-[94vw] rounded-2xl bg-felt-800 p-4 ring-1 ring-gold/30 sm:p-5">
      <h2 class="text-sm font-bold">登出？</h2>
      <ul class="mt-3 space-y-1.5 text-xs leading-relaxed text-white/70">
        <li>登出后，若没有把凭据串保存在别处，这个身份就回不来了（无密码、无找回）。</li>
        {#if seatedCodes.length > 0}
          <li>
            你还在 {seatedCodes.length} 张桌的座位上。「离开房间并登出」会先退掉这些座位
            （进行中的一副停在空座等补位），并把邀请码复制到剪贴板 ——
            之后用新身份凭邀请码补位回来。
          </li>
        {:else}
          <li>你没有坐在任何座位上，随时可以用新身份重新进来。</li>
        {/if}
      </ul>

      {#if roomLinks !== null}
        <p class="mt-3 text-[10px] text-white/40">此环境无法自动复制，请手动记下这些桌的链接：</p>
        <code
          class="mt-1 block break-all rounded-lg bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/60 ring-1 ring-white/10"
        >
          {roomLinks.join('\n')}
        </code>
      {/if}

      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" class={ghost} disabled={busy} onclick={() => onCancel?.()}>取消</button>
        {#if seatedCodes.length > 0}
          <button
            type="button"
            class="rounded-md bg-gold px-4 py-1 text-xs font-bold text-ink transition hover:brightness-110 disabled:opacity-40"
            disabled={busy}
            onclick={() => onLeaveRoom?.()}
          >
            {busy ? '处理中…' : '离开房间并登出'}
          </button>
        {/if}
        <button type="button" class={ghost} disabled={busy} onclick={() => onLogout?.()}>直接登出</button>
      </div>

      {#if error !== null}
        <p class="mt-2 rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200">{error}</p>
      {/if}
    </div>
  </div>
{/if}
