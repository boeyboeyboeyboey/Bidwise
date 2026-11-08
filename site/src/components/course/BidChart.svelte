<svelte:options css="injected" />
<script lang="ts">
  import type { SimResult } from '../../lib/sim';
  import { onMount } from 'svelte';
  import { eS, pct } from './fmt';

  let {
    result,
    bid = $bindable(),
    pIn,
  }: { result: SimResult; bid: number; pIn: number } = $props();

  let W = $state(340);
  let VH = $state(900);
  const H = $derived(W < 500 ? 150 : Math.round(Math.min(240, Math.max(150, VH * 0.2))));
  const L = 8, R = 8, T = 10, B = 22;
  const iw = $derived(W - L - R), ih = $derived(H - T - B);
  const xs = $derived(result.curve.bidCents);
  const x0 = $derived(xs[0] ?? 0);
  const x1 = $derived(xs[xs.length - 1] ?? 1);
  const sx = (c: number) => L + ((c - x0) / Math.max(1, x1 - x0)) * iw;
  const sy = (p: number) => T + (1 - p) * ih;
  const path = $derived(
    xs.map((c, i) => `${i ? 'L' : 'M'}${sx(c).toFixed(1)},${sy(result.curve.pIn[i]).toFixed(1)}`).join(''),
  );
  const hx = $derived(sx(bid));
  const hy = $derived(sy(pIn));

  const nudge = (d: number) => (bid = Math.min(x1, Math.max(x0, bid + d)));
  function step(e: MouseEvent, dir: number) {
    nudge(dir * (e.shiftKey ? 1 : 50));
  }
  function onBidField(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) bid = Math.min(x1, Math.max(x0, Math.round(v * 100)));
    el.value = (bid / 100).toFixed(2);
  }

  onMount(() => {
    const f = () => (VH = window.innerHeight / (parseFloat(getComputedStyle(document.documentElement).zoom) || 1));
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  });

  let svg: SVGSVGElement;
  let dragging = false;

  function setFromEvent(e: PointerEvent) {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const c = x0 + ((vx - L) / iw) * (x1 - x0);
    bid = Math.round(Math.min(x1, Math.max(x0, c)));
  }
  function down(e: PointerEvent) {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    setFromEvent(e);
  }
  function move(e: PointerEvent) {
    if (dragging) setFromEvent(e);
  }
  function up() {
    dragging = false;
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 100 : e.altKey ? 1000 : 1;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
    else if (e.key === 'PageUp') d = 1000;
    else if (e.key === 'PageDown') d = -1000;
    else if (e.key === 'Home') bid = x0;
    else if (e.key === 'End') bid = x1;
    else return;
    e.preventDefault();
    if (d) bid = Math.min(x1, Math.max(x0, bid + d));
  }
</script>

<div class="wrap" bind:clientWidth={W} style="--ch:{H}px">
  <div class="bidrow">
    <div class="ctl">
      <span class="lab">Your bid</span>
      <div class="ctlrow">
        <button type="button" class="btn btn-icon" aria-label="Decrease bid" onclick={(e) => step(e, -1)}>−</button>
        <input class="field num" type="number" inputmode="decimal" aria-label="Your bid in e$" step="0.01" min={x0 / 100} max={x1 / 100} value={(bid / 100).toFixed(2)} onchange={onBidField} />
        <button type="button" class="btn btn-icon" aria-label="Increase bid" onclick={(e) => step(e, 1)}>+</button>
      </div>
    </div>
    <div class="readout num" aria-live="polite">
      <span class="lab">Your chance of a seat</span><b>~{pct(pIn)}</b>
    </div>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg
    aria-label="Your chance of a seat by bid"
    bind:this={svg}
    width={W} height={H} viewBox="0 0 {W} {H}"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    {#each [0, 0.5, 1] as g}
      <line x1={L} x2={W - R} y1={sy(g)} y2={sy(g)} class="grid" />
    {/each}
    <path d={path} class="curve" />
    <line x1={hx} x2={hx} y1={T} y2={H - B} class="guide" />
    <text x={L} y={H - 6} class="ax num">{eS(x0)}</text>
    <text x={W - R} y={H - 6} class="ax num" text-anchor="end">{eS(x1)}</text>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <g
      role="slider"
      tabindex="0"
      aria-label="Bid"
      aria-valuemin={x0}
      aria-valuemax={x1}
      aria-valuenow={bid}
      aria-valuetext="{eS(bid)}, about {pct(pIn)}"
      onkeydown={key}
      class="handle"
    >
      <circle cx={hx} cy={hy} r="18" class="hit" />
      <circle cx={hx} cy={hy} r="8" class="dot" />
    </g>
  </svg>
</div>

<style>
  .wrap { container-type: inline-size; display: grid; gap: var(--s2); min-height: calc(var(--ch, 150px) + 72px); }
  .bidrow { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s3); flex-wrap: nowrap; min-height: 56px; }
  .ctlrow .btn-icon { width: 40px; height: 40px; min-width: 40px; min-height: 40px; padding: 0; }
  .ctl { display: grid; }
  .ctlrow { display: flex; align-items: center; gap: var(--s2); }
  .ctl .field { width: 92px; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .readout { display: grid; text-align: right; }
  .readout b { font-size: 22px; font-weight: 600; }
  .lab { font-size: 14px; color: var(--muted); }
  svg { max-width: 100%; touch-action: none; cursor: ew-resize; display: block; }
  svg:active { cursor: grabbing; }
  .grid { stroke: var(--rule); stroke-width: 1; }
  .curve { fill: none; stroke: var(--text); stroke-width: 2; }
  .guide { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 3 3; }
  .ax { fill: var(--muted); font-size: 13px; font-family: var(--font); font-variant-numeric: tabular-nums; }
  .hit { fill: transparent; }
  .dot { fill: var(--accent); stroke: var(--surface); stroke-width: 3; }
  .handle { outline: none; }
  .handle:focus-visible .dot { stroke: var(--focus); stroke-width: 3; r: 10; }
  .handle:focus-visible .hit { stroke: var(--focus); stroke-width: 2; }
</style>
