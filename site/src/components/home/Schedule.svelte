<svelte:options css="injected" />
<script lang="ts">
  import { onMount } from 'svelte';
  import { chooseWindow, nowMs, type ConfiguredWindow } from '../../lib/data/window';
  import type { ScheduleEntry } from '../../lib/data/types';

  /** `builtAt` is the build clock; the browser swaps in nowMs() (which honours ?now=) as soon as it mounts. */
  let { entries, configured, builtAt }: { entries: ScheduleEntry[]; configured: ConfiguredWindow; builtAt: number } = $props();

  let now = $state(builtAt);
  onMount(() => {
    const tick = () => (now = nowMs());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  });

  const SGT = 'Asia/Singapore';
  const parts = (ms: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: SGT,
      }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
    );
  const thisYear = $derived(parts(now).year);
  /** "Tue 10 Nov 10:00", plus the year ("Mon 11 Jan 2027 10:00") when it is not the current year. */
  const when = (iso: string): string => {
    const p = parts(Date.parse(iso));
    return `${p.weekday} ${p.day} ${p.month}${p.year === thisYear ? '' : ' ' + p.year} ${p.hour}:${p.minute}`;
  };
  /** "1d 21h", "5h 20m", "40m". */
  const left = (ms: number): string => {
    const m = Math.max(0, Math.floor(ms / 60_000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  };
  const label = (s: Pick<ScheduleEntry, 'round' | 'window'>) => `Round ${s.round} Window ${s.window}`;

  const cur = $derived(chooseWindow(entries, configured, now));
  const curAt = $derived(entries.findIndex((s) => s.round === cur.round && s.window === cur.window));
  type State = 'done' | 'open' | 'next' | 'later';
  const stateOf = (i: number): State =>
    cur.status === 'closed' || i < curAt ? 'done' : i > curAt ? 'later' : cur.status === 'open' ? 'open' : 'next';

  // Round 1A and 1B in one column, Round 2 and 2A in the other.
  const groups = $derived.by(() => {
    const g = new Map<string, { rounds: string[]; rows: { s: ScheduleEntry; i: number }[] }>();
    entries.forEach((s, i) => {
      const k = s.round.charAt(0);
      const e = g.get(k) ?? { rounds: [], rows: [] };
      if (!e.rounds.includes(s.round)) e.rounds.push(s.round);
      e.rows.push({ s, i });
      g.set(k, e);
    });
    return [...g.values()];
  });
  const pastBids = (s: ScheduleEntry) => `/explore/?v=browse&bw=${encodeURIComponent(label(s))}`;
</script>

<section class="sched" aria-labelledby="sched-h">
  <h1 id="sched-h">Bidding schedule</h1>

  <div class="call" role="status">
    {#if cur.status === 'open'}
      <p><b>{label(cur)} is open</b>, closes {when(cur.closesAt)} (in {left(Date.parse(cur.closesAt) - now)})</p>
      <a class="btn btn-primary" href="/planner">Plan your bids</a>
    {:else if cur.status === 'upcoming'}
      <p><b>Next: {label(cur)}</b> opens {when(cur.opensAt)} (in {left(Date.parse(cur.opensAt) - now)})</p>
      <a class="btn btn-primary" href="/planner">Plan your bids</a>
    {:else}
      <p><b>All windows closed</b></p>
    {/if}
  </div>

  <div class="groups">
    {#each groups as g (g.rounds.join())}
      <div class="group">
        <h2>{g.rounds.length > 1 ? 'Rounds' : 'Round'} {g.rounds.join(' and ')}</h2>
        <div class="colhead grid"><span>Window</span><span>Status</span><span>Opens</span><span>Closes</span><span>Past bids</span></div>
        <ul>
          {#each g.rows as { s, i } (i)}
            {@const st = stateOf(i)}
            <li class="row grid" class:open={st === 'open'} class:done={st === 'done'}>
              <span class="w">{label(s)}</span>
              <span class="st">{#if st === 'done'}<b class="tag done">Done</b>{:else if st === 'open'}<b class="tag">Open now</b>{:else if st === 'next'}<b class="tag">Opens next</b>{/if}</span>
              <span class="o"><i class="k">Opens</i>{when(s.opensAt)}</span>
              <span class="c"><i class="k">Closes</i>{when(s.closesAt)}</span>
              <a class="btn pb" href={pastBids(s)} aria-label="Past bids for {label(s)}">Past bids</a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
  <p class="tz">Times in SGT</p>
</section>

<style>
  .sched { min-width: 0; }
  h1 { font-size: clamp(26px, 5vw, 36px); margin: var(--s4) 0 var(--s5); text-align: center; }
  h2 { font-size: 18px; font-weight: 600; margin: 0 0 var(--s3); }
  .call { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s3) var(--s5); padding: var(--s4); margin-bottom: var(--s5); background: var(--accent-soft); border-radius: var(--r-lg); }
  .call p { margin: 0; font-size: var(--fs-md); line-height: 1.4; }
  .groups { display: grid; gap: var(--s6); }
  .group { min-width: 0; container-type: inline-size; }
  .colhead { display: none; }
  ul { display: grid; gap: var(--s2); }
  .row { padding: var(--s3) var(--s4); background: var(--surface); border-radius: var(--r-lg); font-size: var(--fs-sm); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: var(--s3); row-gap: var(--s1); }
  .row .w { font-weight: 600; font-size: var(--fs-md); }
  .row .st { text-align: right; }
  .o, .c { grid-column: 1 / -1; display: flex; gap: var(--s3); }
  .k { font-style: normal; color: var(--muted); flex: 0 0 56px; }
  .pb { grid-column: 1 / -1; margin-top: var(--s2); }
  .row.open { background: var(--accent-soft); }
  .row.done { color: var(--muted); }
  .row.done .w { font-weight: 400; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: var(--fs-xs); font-weight: 600; color: var(--accent); border: 1px solid var(--accent); line-height: 1.5; white-space: nowrap; }
  .tag.done { color: var(--muted); border-color: var(--rule-strong); background: var(--surface); }
  .tz { margin: var(--s3) 0 0; font-size: var(--fs-xs); color: var(--muted); text-align: center; }
  /* Table mode needs about 740px: two 170px date columns, so dates and the button never touch. */
  @container (min-width: 740px) {
    .colhead, .row { display: grid; grid-template-columns: minmax(140px, 1.2fr) 96px minmax(165px, 1fr) minmax(165px, 1fr) 112px; column-gap: var(--s3); align-items: center; }
    .colhead { padding: 0 var(--s4) var(--s2); margin-bottom: var(--s2); font-size: var(--fs-xs); color: var(--muted); border-bottom: 1px solid var(--rule-strong); }
    .row .st { text-align: left; }
    .o, .c { grid-column: auto; display: block; white-space: nowrap; }
    .k { display: none; }
    .pb { grid-column: auto; margin-top: 0; }
  }
</style>
