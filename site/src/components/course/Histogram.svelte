<svelte:options css="injected" />
<script lang="ts">
  import type { SimResult } from '../../lib/sim';
  import { onMount } from 'svelte';
  import { eS } from './fmt';
  let { result, bid }: { result: SimResult; bid: number } = $props();

  let W = $state(340);
  let VH = $state(900);
  const H = $derived(W < 500 ? 84 : Math.round(Math.min(180, Math.max(110, VH * 0.14))));
  onMount(() => {
    const f = () => (VH = window.innerHeight / (parseFloat(getComputedStyle(document.documentElement).zoom) || 1));
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  });
  const L = 8, R = 8, T = 6, B = 20;
  const h = $derived(result.histogram);
  const n = $derived(h.counts.length);
  const max = $derived(Math.max(1, ...h.counts));
  const lo = $derived(h.startCents);
  const hi = $derived(h.startCents + n * h.binWidthCents);
  const sx = (c: number) => L + ((c - lo) / Math.max(1, hi - lo)) * (W - L - R);
  const bw = $derived(Math.max(1, (W - L - R) / Math.max(1, n) - 1));
  const mx = $derived(Math.min(W - R, Math.max(L, sx(bid))));
</script>

<div class="wrap" bind:clientWidth={W} style="--hh:{H}px">
<div class="cap">Where the bid needed lands <span class="key"><i></i>Your bid</span></div>
<svg width={W} height={H} viewBox="0 0 {W} {H}" role="img" aria-label="Bid needed distribution">
  {#each h.counts as c, i}
    {@const bh = (c / max) * (H - T - B)}
    <rect x={sx(lo + i * h.binWidthCents)} y={H - B - bh} width={bw} height={bh} class="bar" />
  {/each}
  <line x1={L} x2={W - R} y1={H - B} y2={H - B} class="base" />
  <line x1={mx} x2={mx} y1={T} y2={H - B} class="mark" />
  <text x={L} y={H - 5} class="ax num">{eS(lo)}</text>
  <text x={W - R} y={H - 5} class="ax num" text-anchor="end">{eS(hi)}</text>
</svg>
</div>

<style>
  .wrap { min-height: calc(var(--hh, 84px) + 24px); }
  .cap { display: flex; justify-content: space-between; font-size: 14px; color: var(--muted); margin-bottom: var(--s1); }
  .key { display: inline-flex; align-items: center; gap: 6px; }
  .key i { display: inline-block; width: 12px; height: 2px; background: var(--accent); }
  svg { max-width: 100%; display: block; }
  .bar { fill: var(--muted); opacity: 0.45; }
  .base { stroke: var(--rule-strong); stroke-width: 1; }
  .mark { stroke: var(--accent); stroke-width: 2; }
  .ax { fill: var(--muted); font-size: 13px; font-family: var(--font); font-variant-numeric: tabular-nums; }
</style>
