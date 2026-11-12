<svelte:options css="injected" />
<script lang="ts">
  import type { HistoryRow } from '../../lib/data/types';
  import { sameInstructor } from '../../lib/data/format';
  import HistoryChart from './HistoryChart.svelte';
  import { sortWindows, timeText } from './history';
  import { bidOrNone } from './fmt';

  let { history, instructor = null, preferred = [], hideTitle = false }: {
    hideTitle?: boolean;
    history: HistoryRow[];
    /** Instructor of the section being viewed; null on a course with no sections this term. */
    instructor?: string | null;
    /** Windows to open on, best first (the current window, then the latest with results). */
    preferred?: string[];
  } = $props();

  const CAP = 40;
  const windows = $derived(sortWindows(history.map((r) => r.window)));
  const mine = (r: HistoryRow) => !!instructor && sameInstructor(r.instructor, instructor);
  const hasMine = $derived(history.some(mine));

  // Initial choices are read once: the panel is re-created when the section changes.
  const firstMine = () => !!instructor && history.some(mine);
  let scope = $state<'instructor' | 'course'>(firstMine() ? 'instructor' : 'course');
  const pickWindow = () => {
    const pool = scope === 'instructor' ? history.filter(mine) : history;
    return preferred.find((w) => pool.some((r) => r.window === w)) ?? sortWindows(pool.map((r) => r.window))[0] ?? '';
  };
  let win = $state(pickWindow());
  let all = $state(false);

  const rows = $derived(
    history
      .filter((r) => (scope === 'course' || mine(r)) && (!win || r.window === win))
      .sort((a, b) => (a.term < b.term ? 1 : a.term > b.term ? -1 : a.window.localeCompare(b.window, undefined, { numeric: true }) || a.section.localeCompare(b.section, undefined, { numeric: true }))),
  );
  const shown = $derived(all ? rows : rows.slice(0, CAP));
  /** Every row shown has no lowest or median bid: nobody won in them. */
  const noPrice = $derived(rows.length > 0 && rows.every((r) => r.minCents === null && r.medianCents === null));
  const seats = (r: HistoryRow) => `${r.after} of ${r.vacancy}`;
</script>

<div class="hh"><section class="hist">
  {#if !hideTitle}<h3>Past results</h3>{/if}
  <div class="ctl">
    {#if instructor}
      <div class="pair" role="group" aria-label="Show">
        <span class="lab">Show</span>
        <div class="seg">
          <button type="button" aria-pressed={scope === 'instructor'} disabled={!hasMine} onclick={() => (scope = 'instructor')}>Same instructor</button>
          <button type="button" aria-pressed={scope === 'course'} onclick={() => (scope = 'course')}>Whole course</button>
        </div>
      </div>
    {/if}
    <label class="pair win">
      <span class="lab">Window</span>
      <select class="field" bind:value={win}>
        <option value="">All windows</option>
        {#each windows as w}<option value={w}>{w}</option>{/each}
      </select>
    </label>
  </div>

  {#if rows.length === 0}
    <p class="none">No past results for this selection</p>
  {:else}
    {#if noPrice}<p class="note">No bid won a seat in {win ? 'this window' : 'these windows'}, so there's no past price.</p>{/if}
    {#if !noPrice}<HistoryChart {rows} instructor={scope === 'course' ? instructor : null} />{/if}
    <div class="tbl" role="table" aria-label="Past results">
      <div class="th" role="row">
        <span role="columnheader">Term{win ? '' : ' and window'}</span>
        <span role="columnheader">Section</span>
        <span role="columnheader" class="r">Lowest bid</span>
        <span role="columnheader" class="r">Median bid</span>
        <span role="columnheader" class="r seats">Seats left</span>
      </div>
      {#each shown as r}
        <div class="tr" class:mine={scope === 'course' && mine(r)} role="row">
          <span role="cell" class="when"><b>{r.term}</b>{#if !win}<span class="sub">{r.window}</span>{/if}</span>
          <span role="cell" class="sec"><b>{r.section}</b><span class="sub">{r.instructor}</span><span class="sub num t">{timeText(r.days, r.start, r.end)}</span></span>
          <span role="cell" class="r num" class:no={r.minCents === null}>{bidOrNone(r.minCents)}</span>
          <span role="cell" class="r num" class:no={r.medianCents === null}>{bidOrNone(r.medianCents)}</span>
          <span role="cell" class="r num seats">{seats(r)}</span>
        </div>
      {/each}
    </div>
    {#if rows.length > CAP && !all}
      <button type="button" class="btn more" onclick={() => (all = true)}>Show all {rows.length} rows</button>
    {/if}
  {/if}
</section></div>

<style>
  .hist { display: grid; gap: var(--s3); min-width: 0; }
  h3 { font-size: 17px; font-weight: 600; }
  .ctl { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; }
  .seg button:disabled { opacity: 0.5; cursor: not-allowed; }
  .ctl { gap: var(--s2) var(--s4); }
  .pair { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); min-width: 0; max-width: 100%; }
  .lab { font-size: 14px; color: var(--muted); }
  .win { flex: 1 1 260px; }
  .win select { flex: 1 1 auto; min-width: 0; width: auto; min-height: 44px; padding-top: 8px; padding-bottom: 8px; font-size: 15px; }
  .none { color: var(--muted); margin: var(--s3) 0; }
  .note { margin: 0; font-size: 14px; color: var(--muted); }
  .th, .tr {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) 76px 76px; column-gap: var(--s2); align-items: baseline;
  }
  .seats { display: none; }
  .th { font-size: 13px; color: var(--muted); padding: var(--s2) var(--s2); border-bottom: 1px solid var(--rule); }
  .tr { padding: var(--s2); border-bottom: 1px solid var(--rule); }
  .tr.mine { background: var(--accent-soft); }
  .r { text-align: right; }
  .when b, .sec b { font-weight: 600; }
  .sub { display: block; font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when, .sec { min-width: 0; }
  .no { color: var(--muted); }
  .more { justify-self: start; }
  @container (min-width: 560px) {
    .th, .tr { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 84px 84px 84px; }
    .seats { display: block; }
  }
  .hh { container-type: inline-size; min-width: 0; }
</style>
