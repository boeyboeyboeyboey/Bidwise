<svelte:options css="injected" />
<script lang="ts">
  import { eS } from './fmt';
  import { shortWindow, type WindowPoint } from './history';

  let { points, term }: { points: WindowPoint[]; term: string } = $props();

  let W = $state(340);
  const H = 200;
  const L = 64, R = 20, T = 12;
  const n = $derived(points.length);
  const step = $derived(n < 2 ? W : (W - L - R) / (n - 1));
  // Labels turn sideways when they would touch.
  const tilt = $derived(n > 1 && step < 46);
  const B = $derived(tilt ? 56 : 30);
  const top = $derived.by(() => {
    const v = points.flatMap((p) => [p.median, p.min]).filter((c): c is number => c !== null);
    const m = v.length ? Math.max(...v) : 1000;
    const s = m > 6000 ? 2000 : m > 2500 ? 1000 : 500;
    return Math.ceil(m / s) * s;
  });
  const ticks = $derived([0, top / 2, top]);
  const sx = (i: number) => (n < 2 ? (L + W - R) / 2 : L + i * step);
  const sy = (c: number) => T + (1 - c / top) * (H - T - B);
  const line = (k: 'median' | 'min') => {
    let d = '';
    let gap = true;
    points.forEach((p, i) => {
      const v = p[k];
      if (v === null) { gap = true; return; }
      d += `${gap ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
      gap = false;
    });
    return d;
  };
  const tip = (p: WindowPoint, what: string, c: number) => `${term}, ${p.window}\n${what} ${eS(c)}`;
</script>

<div class="wrap" bind:clientWidth={W}>
  <svg width={W} height={H} viewBox="0 0 {W} {H}" role="img" aria-label={`Median and lowest winning bid by window, ${term}`}>
    {#each ticks as t}
      <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} class="grid" />
      <text x={L - 6} y={sy(t) + 4} text-anchor="end" class="ax num">{eS(t)}</text>
    {/each}
    <path d={line('min')} class="min" />
    <path d={line('median')} class="med" />
    {#each points as p, i}
      {#if p.min !== null}<circle cx={sx(i)} cy={sy(p.min)} r="3.5" class="mdot"><title>{tip(p, 'Lowest winning bid', p.min)}</title></circle>{/if}
      {#if p.median !== null}<circle cx={sx(i)} cy={sy(p.median)} r="3.5" class="dot"><title>{tip(p, 'Median bid', p.median)}</title></circle>{/if}
      {#if p.median === null && p.min === null}<circle cx={sx(i)} cy={sy(0)} r="3.5" class="nobid"><title>{`${term}, ${p.window}\nNo winning bid`}</title></circle>{/if}
      {#if tilt}
        <text x={sx(i) + 4} y={H - B + 16} text-anchor="end" transform="rotate(-40 {sx(i) + 4} {H - B + 16})" class="ax num">{shortWindow(p.window)}</text>
      {:else}
        <text x={sx(i)} y={H - 10} text-anchor="middle" class="ax num">{shortWindow(p.window)}</text>
      {/if}
    {/each}
  </svg>
  <ul class="legend">
    <li><i class="k med"></i>Median bid</li>
    <li><i class="k min"></i>Lowest winning bid</li>
    {#if points.some((p) => p.median === null && p.min === null)}<li><i class="k no"></i>No winning bid</li>{/if}
  </ul>
</div>

<style>
  .wrap { min-width: 0; }
  svg { display: block; max-width: 100%; }
  .grid { stroke: var(--rule); stroke-width: 1; }
  .ax { fill: var(--muted); font-size: 13px; font-family: var(--font); }
  .med { fill: none; stroke: var(--text); stroke-width: 2; }
  .min { fill: none; stroke: var(--muted); stroke-width: 2; stroke-dasharray: 4 3; }
  .dot { fill: var(--text); }
  .nobid { fill: var(--surface); stroke: var(--muted); stroke-width: 1.5; }
  .mdot { fill: var(--surface); stroke: var(--muted); stroke-width: 2; }
  .legend { display: flex; flex-wrap: wrap; gap: var(--s1) var(--s4); font-size: 13px; color: var(--muted); margin-top: var(--s2); }
  .legend li { display: inline-flex; align-items: center; gap: var(--s2); }
  .k { display: inline-block; width: 14px; height: 0; border-top: 2px solid; }
  .k.med { border-color: var(--text); }
  .k.no { width: 8px; height: 8px; border: 1.5px solid var(--muted); border-radius: 50%; background: var(--surface); }
  .k.min { border-color: var(--muted); border-top-style: dashed; }
</style>
