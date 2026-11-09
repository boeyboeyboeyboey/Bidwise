<script lang="ts">
  import { getContext } from 'svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import type { ForecastCtx } from './forecast-ctx';
  import { dropLine } from './dropText';

  const ctx = getContext<ForecastCtx>('forecast');
  const line = $derived(dropLine(ctx.drops, ctx.code));
</script>

{#if line}
  <p class="drop">
    <span>{line.text}</span>
    <InfoTip label="About the seat chance" lines={line.tip} anchor="drop-chance" linkText="How drop chance works" />
  </p>
{/if}

<style>
  .drop { margin: 0; display: flex; align-items: center; gap: var(--s2); color: var(--muted); font-size: var(--fs-sm); }
</style>
