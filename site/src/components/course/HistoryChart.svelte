<svelte:options css="injected" />
<script lang="ts">
  import type { HistoryRow } from '../../lib/data/types';
  import { sameInstructor } from '../../lib/data/format';
  import { byTerm } from './history';
  import { eS } from './fmt';

  let { rows, instructor = null }: { rows: HistoryRow[]; instructor?: string | null } = $props();

  let W = $state(340);
  const H = $derived(W < 500 ? 190 : 240);
  const L = 48, R = 30, T = 12, B = 44;
  const pts = $derived(byTerm(rows));
  const top = $derived.by(() => {
    const v = rows.flatMap((r) => [r.medianCents, r.minCents]).filter((c): c is number => c !== null);
    const m = v.length ? Math.max(...v) : 1000;
    const step = m > 6000 ? 2000 : m > 2500 ? 1000 : 500;
    return Math.ceil(m / step) * step;
  });
  const ticks = $derived([0, top / 2, top]);
  const sx = (i: number) => (pts.length < 2 ? (L + W - R) / 2 : L + (i / (pts.length - 1)) * (W - L - R));
  const sy = (c: number) => T + (1 - c / top) * (H - T - B);
  const line = (k: 'median' | 'min') => {
    let d = '';
    pts.forEach((p, i) => {
      const v = p[k];
      if (v !== null) d += `${d ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
    });
    return d;
  };
  const yr = (t: string) => t.split(' ')[0];
  const tm = (t: string) => t.slice(t.indexOf(' ') + 1);
  const mine = (r: HistoryRow) => !!instructor && sameInstructor(r.instructor, instructor);
  const tip = (r: HistoryRow, what: string, c: number) => `${r.term}, ${r.window}\n${r.section} ${r.instructor}\n${what} ${eS(c)}`;
</script>

<div class="wrap" bind:clientWidth={W}>
  <svg width={W} height={H} viewBox="0 0 {W} {H}" role="img" aria-label="Median and lowest winning bid by term">
    {#each ticks as t}
      <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} class="grid" />
      <text x={L - 6} y={sy(t) + 4} text-anchor="end" class="ax num">{eS(t)}</text>
    {/each}
    <path d={line('min')} class="min" />
    <path d={line('median')} class="med" />
    {#each pts as p, i}
      {#each p.rows as r}
        {#if r.minCents !== null}<circle cx={sx(i)} cy={sy(r.minCents)} r="3.5" class="mdot" class:mine={mine(r)}><title>{tip(r, 'Lowest winning bid', r.minCents)}</title></circle>{/if}
        {#if r.medianCents !== null}<circle cx={sx(i)} cy={sy(r.medianCents)} r="3.5" class="dot" class:mine={mine(r)}><title>{tip(r, 'Median bid', r.medianCents)}</title></circle>{/if}
      {/each}
      {#if p.median === null}<text x={sx(i)} y={sy(0) - 6} text-anchor="middle" class="ax none">No bids</text>{/if}
      <text x={sx(i)} y={H - 24} text-anchor="middle" class="ax num">{yr(p.term)}</text>
      <text x={sx(i)} y={H - 10} text-anchor="middle" class="ax num">{tm(p.term)}</text>
    {/each}
  </svg>
  <ul class="legend">
    <li><i class="k med"></i>Median bid</li>
    <li><i class="k min"></i>Lowest winning bid</li>
    {#if instructor}<li><i class="k acc"></i>Same instructor</li>{/if}
  </ul>
</div>

<style>
  .wrap { min-width: 0; }
  svg { display: block; max-width: 100%; }
  .grid { stroke: var(--rule); stroke-width: 1; }
  .ax { fill: var(--muted); font-size: 13px; font-family: var(--font); }
  .none { font-size: 13px; }
  .med { fill: none; stroke: var(--text); stroke-width: 2; }
  .min { fill: none; stroke: var(--muted); stroke-width: 2; stroke-dasharray: 4 3; }
  .dot { fill: var(--text); }
  .mdot { fill: var(--surface); stroke: var(--muted); stroke-width: 2; }
  .dot.mine { fill: var(--accent); }
  .mdot.mine { stroke: var(--accent); }
  .legend { display: flex; flex-wrap: wrap; gap: var(--s1) var(--s4); font-size: 13px; color: var(--muted); margin-top: var(--s2); }
  .legend li { display: inline-flex; align-items: center; gap: var(--s2); }
  .k { display: inline-block; width: 14px; height: 0; border-top: 2px solid; }
  .k.med { border-color: var(--text); }
  .k.min { border-color: var(--muted); border-top-style: dashed; }
  .k.acc { width: 8px; height: 8px; border: 0; border-radius: 50%; background: var(--accent); }
</style>
