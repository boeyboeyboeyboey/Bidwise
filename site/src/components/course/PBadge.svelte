<script lang="ts">
  import { pct } from './fmt';
  let { p }: { p: number | null } = $props();
  const low = $derived(p !== null && p < 0.35);
</script>

<span
  class="pb num"
  class:low
  aria-label={p === null ? 'Chance it fills up, loading' : `Chance it fills up ${pct(p)}`}
>
  {#if p === null}<span class="sk"></span>{:else}<span class="n">{pct(p)}</span>{/if}
  <span class="bar" aria-hidden="true"><span style:width="{p === null ? 0 : Math.round(p * 100)}%"></span></span>
</span>

<style>
  .pb { display: flex; align-items: center; justify-content: flex-end; gap: var(--s2); font-weight: 600; }
  .pb.low { color: var(--muted); }
  .sk { display: block; width: 3ch; height: 14px; border-radius: 3px; background: var(--rule); }
  .bar { flex: none; display: block; width: 48px; height: 4px; border-radius: 2px; background: var(--rule); overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--text); }
  .pb.low .bar > span { background: var(--muted); }
</style>
