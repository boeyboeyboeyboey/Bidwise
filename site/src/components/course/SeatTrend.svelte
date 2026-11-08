<svelte:options css="injected" />
<script lang="ts">
  import type { Section } from '../../lib/data/types';
  import { deltaMarker, lastScanText, sparkline } from '../../lib/data/seatDeltas';
  import { seatChange } from './seatLabel';

  let { section, openScanAt = null }: { section: Section; openScanAt?: string | null } = $props();
  const W = 120;
  const H = 28;
  const hist = $derived(section.live?.source === 'live' ? section.live.history : undefined);
  const spark = $derived(sparkline(hist, W, H));
  const m = $derived(deltaMarker(section, openScanAt));
  const changeText = $derived(seatChange(section));
  const last = $derived(lastScanText(section));
</script>

{#if spark}
  <div class="trend">
    <p class="t">Seats left this window{#if m && changeText}<span class="num" class:up={m.tone === 'up'} class:down={m.tone === 'down'}>&nbsp;· {changeText}</span>{/if}{#if last}<span class="num mu">&nbsp;· {last}</span>{/if}</p>
    <svg class="spark" viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label={`Seats left across ${spark.count} scans, from ${spark.first} to ${spark.last}`}>
      <polyline points={spark.points} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
    <p class="mu num">{spark.first} → {spark.last} {spark.last === 1 ? 'seat' : 'seats'}</p>
  </div>
{/if}

<style>
  .trend { display: grid; gap: var(--s1); color: var(--accent); }
  .t { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .mu { margin: 0; font-size: 13px; font-weight: 400; color: var(--muted); }
  .spark { max-width: 100%; }
  .up { color: var(--up); }
  .down { color: var(--down); }
</style>
