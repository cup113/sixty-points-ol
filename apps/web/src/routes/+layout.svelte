<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import { bootShell } from '$lib/native-shell';

  let { children } = $props();

  // Service Worker 的注册在这里（不是框架自动注入）：壳里必须不注册，见 ADR-0027
  onMount(bootShell);
</script>

{@render children()}
