<svelte:options css="injected" />
<script lang="ts">
  import { onMount } from 'svelte';
  import { followChosenWindow } from './chosenWindow';
  import { liveWindow, nowMs } from '../../lib/data/window';

  interface Win { label: string; opensAt: string; closesAt: string; opens: string; closes: string }
  let { label, closesLabel, closesAt, status, windows, quiet = false }: {
    /** Plain centred text for the home page; off keeps the boxed link. */
    quiet?: boolean;
    label: string;
    closesLabel: string;
    closesAt: string;
    status: 'open' | 'closed' | 'upcoming';
    /** Every window in the schedule, to describe the one chosen in the header. */
    windows: Win[];
  } = $props();

  let now = $state<number | null>(null);
  // The window to show comes from the clock in the browser (a stale build still flips after closesAt); `label`/`status` are the build's pick.
  let live = $state<{ label: string; status: 'open' | 'closed' | 'upcoming' } | null>(null);
  function tick() {
    now = nowMs();
    const w = liveWindow(now);
    live = w ? { label: `Round ${w.round} Window ${w.window}`, status: w.status } : null;
  }
  onMount(() => {
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  });
  let chosen = $state<string | null>(null);
  followChosenWindow((l) => (chosen = l));

  const curLabel = $derived(live?.label ?? label);
  const cur = $derived(windows.find((w) => w.label === curLabel) ?? null);
  const closesIso = $derived(cur?.closesAt ?? closesAt);
  const closesText = $derived(cur?.closes ?? closesLabel);
  const left = $derived(now === null ? null : new Date(closesIso).getTime() - now);
  const untilOpen = $derived(now === null || !cur ? null : new Date(cur.opensAt).getTime() - now);
  const state = $derived<'open' | 'closed' | 'upcoming'>(
    live ? live.status : status === 'closed' || (status === 'open' && left !== null && left <= 0) ? 'closed' : status,
  );
  const short = (s: string) => s.replace(',', '');
  /** "4h", "2d 3h", "35m": whole units, rounded down. */
  const compact = (ms: number) => {
    const m = Math.floor(ms / 60_000);
    if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
    return m >= 60 ? `${Math.floor(m / 60)}h` : `${Math.max(m, 0)}m`;
  };
  const sentence = $derived.by(() => {
    if (state === 'closed') return `${curLabel} closed ${short(closesText)}`;
    const inn = (ms: number | null) => (ms === null ? '' : ` · in ${compact(ms)}`);
    if (state === 'upcoming') return `${curLabel} opens ${short(cur?.opens ?? '')}${inn(untilOpen)}`;
    return `${curLabel} closes ${short(closesText)}${inn(left)}`;
  });
  // Only when the header's window is a different one from the open one.
  const view = $derived(chosen && chosen !== curLabel ? (windows.find((w) => w.label === chosen) ?? null) : null);
  const viewing = $derived.by(() => {
    if (!view) return '';
    const t = now ?? 0;
    if (now !== null && t >= new Date(view.closesAt).getTime()) return `closed ${short(view.closes)}`;
    if (now !== null && t >= new Date(view.opensAt).getTime()) return `closes ${short(view.closes)}`;
    return `opens ${short(view.opens)}`;
  });
  const viewSentence = $derived(view ? `Viewing ${view.label}: ${viewing}` : '');
</script>

<a class="status" class:quiet href="/schedule/" aria-label={`${sentence}${viewSentence} Open the full schedule.`}>
  <span class="txt">
    {sentence}{#if viewSentence}<span class="mu"> {viewSentence}</span>{/if}
  </span>
  {#if !quiet}<span class="chev" aria-hidden="true">›</span>{/if}
</a>

<style>
  .status {
    display: flex; align-items: center; gap: var(--s3); min-height: 48px; padding: var(--s2) var(--s4);
    background: var(--surface); border-radius: var(--r-lg); text-decoration: none; color: var(--text);
    font-size: var(--fs-sm); line-height: 1.4;
  }
  .status:hover { background: var(--accent-soft); }
  .status.quiet { justify-content: center; text-align: center; background: none; color: var(--muted); }
  .status.quiet:hover { background: none; text-decoration: underline; text-underline-offset: 3px; }
  .txt { flex: 1; min-width: 0; }
  .mu { color: var(--muted); }
  .chev { flex: none; font-size: 20px; line-height: 1; color: var(--muted); }
  @media (min-width: 1024px) { .status { font-size: var(--fs-md); } }
</style>
