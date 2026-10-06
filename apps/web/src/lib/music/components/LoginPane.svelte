<script lang="ts">
  import Glyph from './Glyph.svelte';
  import type { PlaylistBrief, QrStatus } from '../types.ts';

  /**
   * 登录页：App 扫码。
   *
   * 为什么不放手机号验证码登录：那要求用户把手机号交给**这台自建服务器**，
   * 而扫码全程凭据只走「我们的服务端 → 网易云」这一跳，用户的账号密码/手机号一个都不经过我们。
   * 代价是必须开着网易云 App 扫一下（桌面端与 App 都在手边时这不是问题）。
   */
  interface Props {
    loggedIn: boolean;
    nickname: string | null;
    qrStatus: QrStatus | null;
    qrImage: string;
    onStart: () => void;
    onLogout: () => void;
  }

  let { loggedIn, nickname, qrStatus, qrImage, onStart, onLogout }: Props = $props();

  const HINTS: Readonly<Record<QrStatus, string>> = {
    waiting: '用网易云音乐 App 扫描二维码',
    scanned: '扫到了，请在手机上确认登录',
    confirmed: '登录成功',
    expired: '二维码过期了，点下面重新生成'
  };
</script>

<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-4" data-music-login="true">
  {#if loggedIn}
    <Glyph name="user" size={28} class="text-gold" />
    <p class="text-[13px] text-white/90">已登录：{nickname ?? '未知用户'}</p>
    <p class="text-center text-[11px] text-white/45">登录后可以用「我的喜欢 / 歌单 / 最近播放 / 日推」</p>
    <button
      type="button"
      class="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/5"
      onclick={onLogout}
      data-music-logout="true"
    >
      退出登录
    </button>
  {:else if qrStatus === null}
    <Glyph name="user" size={28} class="text-white/40" />
    <p class="text-center text-[12px] text-white/60">
      扫码登录后能听「我的喜欢」与自己的歌单；不登录也能搜索与播放
    </p>
    <button
      type="button"
      class="rounded-lg bg-gold/20 px-3 py-1.5 text-[12px] text-gold ring-1 ring-gold/30 hover:bg-gold/30"
      onclick={onStart}
      data-music-login-start="true"
    >
      生成登录二维码
    </button>
  {:else}
    {#if qrImage !== ''}
      <img src={qrImage} alt="网易云音乐登录二维码" class="h-40 w-40 rounded-lg bg-white p-1.5" />
    {/if}
    <p class="text-center text-[12px] text-white/70" data-music-qr-status={qrStatus}>{HINTS[qrStatus]}</p>
    {#if qrStatus === 'expired'}
      <button
        type="button"
        class="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/5"
        onclick={onStart}
      >
        重新生成
      </button>
    {/if}
  {/if}
</div>
