<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '../../lib/data/window';
  import { ariaSummary, formatSgt, isUrgent, leadText, msToNextTick, pickTarget, segments, type CountdownWindow } from './countdown';

  let { windows, builtAt }: {
    /** Every window in the schedule: the state is decided in the browser, so a stale build still counts down correctly. */
    windows: CountdownWindow[];
    /** Build time (epoch ms): the server-rendered text and the first client render use it, so hydration matches. */
    builtAt: number;
  } = $props();

  let now = $state(builtAt);
  const target = $derived(pickTarget(windows, now));
  const left = $derived(target ? target.at - now : 0);
  const parts = $derived(segments(left));
  const urgent = $derived(isUrgent(left));
  const summary = $derived(target ? ariaSummary(target, left) : '');

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function tick() {
      now = nowMs();
      const t = pickTarget(windows, now);
      // Wake just after the next whole second of the remaining time; nothing to schedule once no window is ahead.
      timer = t ? setTimeout(tick, msToNextTick(t.at - now)) : undefined;
    }
    function onVisibility() {
      clearTimeout(timer);
      if (!document.hidden) tick(); // resync straight away on return
    }
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

{#if target}
  <div class="countdown" role="group" aria-label={summary} data-state={target.kind}>
    <div class="lead" aria-hidden="true">
      {#if target.kind === 'closes'}<span class="dot"></span>{/if}<span>{leadText(target)}</span>
    </div>
    <div class="figure" class:urgent aria-hidden="true" data-testid="figure">
      {#each parts as p (p.unit)}
        {#if p.unit === 's'}
          {#key p.value}<span class="cd-seg cd-sec"><span class="cd-num">{p.value}</span><span class="cd-unit">{p.unit}</span></span>{/key}
        {:else}
          <span class="cd-seg"><span class="cd-num">{p.value}</span><span class="cd-unit">{p.unit}</span></span>
        {/if}
      {/each}
    </div>
    <div class="when" aria-hidden="true">{formatSgt(target.at)}</div>
  </div>
{/if}

<style>
  /* Fixed height: three lines never change size, so nothing moves before or after hydration or on rollover. */
  .countdown { display: grid; justify-items: center; align-content: center; gap: 2px; min-height: 104px; text-align: center; }
  .lead, .when { color: var(--muted); font-size: var(--fs-sm); line-height: 20px; min-height: 20px; }
  .lead { display: inline-flex; align-items: center; gap: var(--s2); }
  .figure {
    color: var(--accent); font-size: 30px; line-height: 40px; font-weight: 500; letter-spacing: 0;
    font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; white-space: nowrap;
    display: flex; justify-content: center; align-items: baseline; gap: 0.28em; height: 40px;
    transition: color 0.4s;
  }
  .figure.urgent { color: var(--danger); }
  .cd-unit { margin-left: 1px; font-size: 0.6em; font-weight: 400; color: var(--muted); letter-spacing: 0; }
  .figure.urgent .cd-unit { color: inherit; opacity: 0.75; }
  .cd-seg { line-height: 1; }
  .cd-sec { display: inline-block; }
  .dot { position: relative; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  @media (prefers-reduced-motion: no-preference) {
    .dot::after {
      content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--accent);
      animation: pulse 2s ease-out infinite;
    }
    .cd-sec .cd-num { display: inline-block; animation: tick 0.35s ease-out; }
    @keyframes pulse { from { transform: scale(1); opacity: 0.55; } to { transform: scale(3); opacity: 0; } }
    @keyframes tick { from { opacity: 0.25; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  }
  @media (min-width: 1024px) {
    .countdown { min-height: 120px; }
    .figure { font-size: 34px; line-height: 44px; height: 44px; }
    .lead, .when { font-size: var(--fs-md); }
  }
</style>
