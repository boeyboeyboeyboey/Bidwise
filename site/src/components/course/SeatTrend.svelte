<svelte:options css="injected" />
<script lang="ts">
  import type { Section } from '../../lib/data/types';
  import { deltaMarker, lastScanText, sparkline } from '../../lib/data/seatDeltas';
  import { seatChange } from './seatLabel';

  let { section, openScanAt = null }: { section: Section; openScanAt?: string | null } = $props();
  const W = 120;
  const H = 28;
  const hist = $derived(section.live?.source === 'live' ? section.live.history : undefined);
  const vals = $derived((hist ?? []).filter((p) => p && Number.isFinite(p.available)).map((p) => p.available));
  const distinct = $derived(new Set(vals).size);
  // Two different counts make a trend; a flat history is shown as one line instead.
  const spark = $derived(distinct >= 2 ? sparkline(hist, W, H, 4) : null);
  // Two scans are only a start and an end: a line through them looks like a stray mark, so the chart needs three.
  const chart = $derived(!!spark && spark.count >= 3);
  const ends = $derived.by(() => {
    const p = spark?.points.split(' ') ?? [];
    return p.length ? { a: p[0].split(','), b: p[p.length - 1].split(',') } : null;
  });
  const still = $derived(vals.length >= 2 && distinct === 1);
  const now = $derived(vals.length ? vals[vals.length - 1] : null);
  const m = $derived(deltaMarker(section, openScanAt));
  const changeText = $derived(seatChange(section));
  const last = $derived(lastScanText(section));
</script>

{#if spark}
  <div class="trend">
    <p class="t">Seats left this window{#if m && changeText}<span class="num" class:up={m.tone === 'up'} class:down={m.tone === 'down'}>&nbsp;· {changeText}</span>{/if}{#if last}<span class="num mu">&nbsp;· {last}</span>{/if}</p>
    {#if chart && ends}
      <svg class="spark" viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label={`Seats left across ${spark.count} scans, from ${spark.first} to ${spark.last}`}>
        <line x1="0" x2={W} y1={H - 1} y2={H - 1} class="base" />
        <polyline points={spark.points} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx={ends.a[0]} cy={ends.a[1]} r="3" class="from" />
        <circle cx={ends.b[0]} cy={ends.b[1]} r="3" class="to" />
      </svg>
    {/if}
    <p class="mu num">{spark.first} → {spark.last} {spark.last === 1 ? 'seat' : 'seats'}</p>
  </div>
{:else if now !== null}
  <p class="t num">{now} {now === 1 ? 'seat' : 'seats'} left{still ? ' · no change since opening' : ''}</p>
{/if}

<style>
  .trend { display: grid; gap: var(--s1); color: var(--accent); }
  .t { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .mu { margin: 0; font-size: 13px; font-weight: 400; color: var(--muted); }
  .spark { max-width: 100%; }
  .base { stroke: var(--rule); stroke-width: 1; }
  .from { fill: var(--surface); stroke: currentColor; stroke-width: 1.5; }
  .to { fill: currentColor; }
  .up { color: var(--up); }
  .down { color: var(--down); }
</style>
