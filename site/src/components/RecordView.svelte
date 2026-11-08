<script lang="ts">
  import { onMount } from 'svelte';

  let { code }: { code: string } = $props();

  onMount(() => {
    try {
      const raw = localStorage.getItem('boss.recent');
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const prev = Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
      localStorage.setItem('boss.recent', JSON.stringify([code, ...prev.filter((c) => c !== code)].slice(0, 6)));
    } catch {
      /* storage unavailable */
    }
  });
</script>
