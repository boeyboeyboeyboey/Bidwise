<script lang="ts">
  import { onMount } from 'svelte';
  import { scanTimeText } from '../../lib/data/seats';
  import {
    DAYS, TIMES, NO_FILTERS, R, activeFilterCount, filterRows, filtersFromQuery, filtersToQuery, seatText, subjectsOf,
    type ClassRow, type ClassesPayload, type ExamFilter, type Filters, type SortKey,
  } from './logic';

  const PAGE = 50;

  let rows = $state<ClassRow[]>([]);
  let scannedAt = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let f = $state<Filters>({ ...NO_FILTERS });
  let open = $state(false);
  let shown = $state(PAGE);
  let ready = false;

  const subjects = $derived(subjectsOf(rows));
  const results = $derived(filterRows(rows, f));
  const visible = $derived(results.slice(0, shown));
  const count = $derived(activeFilterCount(f));
  const scanText = $derived(scanTimeText(scannedAt));

  function load() {
    status = 'loading';
    fetch('/data/classes.json')
      .then((r) => (r.ok ? (r.json() as Promise<ClassesPayload>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => { rows = d.rows; scannedAt = d.scannedAt; status = 'ready'; })
      .catch(() => (status = 'error'));
  }

  onMount(() => {
    f = filtersFromQuery(location.search);
    open = activeFilterCount(f) > 0;
    ready = true;
    load();
  });

  // Filters live in the URL (replaceState, so Back leaves the page); any change returns to the first 50.
  $effect(() => {
    const qs = filtersToQuery(f);
    shown = PAGE;
    if (!ready) return;
    try { history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '')); } catch { /* ignore */ }
  });

  const toggle = (mask: number, bit: number) => (mask & bit ? mask & ~bit : mask | bit);
  const clear = () => (f = { ...NO_FILTERS, q: f.q, sort: f.sort });
</script>

<div class="cs">
  <label class="sr" for="cs-q">Search by course code, title or professor</label>
  <input id="cs-q" class="field" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
    placeholder="Code, title or professor" bind:value={f.q} />

  <div class="bar">
    <button type="button" class="btn fbtn" aria-expanded={open} aria-controls="cs-filters" onclick={() => (open = !open)}>
      Filters{count ? ` (${count})` : ''}
    </button>
    <label class="sort"><span class="sr">Sort by</span>
      <select aria-label="Sort by" value={f.sort} onchange={(e) => (f.sort = e.currentTarget.value as SortKey)}>
        <option value="code">Sort: Code</option>
        <option value="seats">Sort: Seats left</option>
      </select>
    </label>
  </div>

  <div id="cs-filters" class="filters" class:open>
    <label class="g"><span>Subject</span>
      <select value={f.subject} onchange={(e) => (f.subject = e.currentTarget.value)}>
        <option value="">All subjects</option>
        {#each subjects as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </label>
    <div class="g dayg" role="group" aria-label="Day">
      <span>Day</span>
      <div class="days">
        {#each DAYS as d, i (d)}
          <button type="button" class="tog" aria-pressed={!!(f.days & (1 << i))} onclick={() => (f.days = toggle(f.days, 1 << i))}>{d}</button>
        {/each}
      </div>
    </div>
    <div class="g" role="group" aria-label="Time of day">
      <span>Time</span>
      <div class="times">
        {#each TIMES as t (t.id)}
          <button type="button" class="tog" aria-pressed={!!(f.times & t.bit)} onclick={() => (f.times = toggle(f.times, t.bit))}>{t.label}</button>
        {/each}
      </div>
    </div>
    <label class="g"><span>Final exam</span>
      <select value={f.exam} onchange={(e) => (f.exam = e.currentTarget.value as ExamFilter)}>
        <option value="any">Any</option>
        <option value="has">Has exam</option>
        <option value="none">No exam listed</option>
      </select>
    </label>
    <div class="g last">
      <button type="button" class="tog wide" aria-pressed={f.hasSeats} onclick={() => (f.hasSeats = !f.hasSeats)}>Has seats left</button>
      {#if count}<button type="button" class="btn" onclick={clear}>Clear filters</button>{/if}
    </div>
  </div>

  {#if status === 'ready'}
    <p class="meta" aria-live="polite">
      {results.length} {results.length === 1 ? 'section' : 'sections'}{scanText ? ` · seats as of ${scanText}` : ''}
    </p>
    {#if results.length}
      <ul class="list">
        {#each visible as r (r[R.code] + '|' + r[R.section])}
          <li>
            <a class="row-link row" href={`/course/${r[R.code]}?s=${encodeURIComponent(r[R.section])}`}>
              <span class="l1"><b class="code">{r[R.code]} {r[R.section]}</b><span class="dot"> · </span><span class="slot">{r[R.slot] || 'Time not set'}</span></span>
              <span class="l2"><span class="title">{r[R.title]}</span>{#if r[R.instructor]}<span class="dot"> · </span><span class="prof">{r[R.instructor]}</span>{/if}</span>
              {#if r[R.exam]}<span class="exam">Exam {r[R.exam]}</span>{/if}
              <span class="seats" class:none={r[R.left] <= 0}>{seatText(r)}</span>
            </a>
          </li>
        {/each}
      </ul>
      {#if results.length > shown}
        <button type="button" class="btn more" onclick={() => (shown += PAGE)}>Show more ({results.length - shown} left)</button>
      {/if}
    {:else}
      <p class="empty">No sections match.{count || f.q ? ' Try fewer filters.' : ''}</p>
    {/if}
  {:else if status === 'loading'}
    <p class="meta">Loading…</p>
  {:else}
    <p class="meta">Could not load the class list. <button type="button" class="link" onclick={load}>Try again</button></p>
  {/if}
</div>

<style>
  .cs { width: 100%; margin: 0; display: grid; gap: var(--s3); min-width: 0; }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .bar { display: flex; gap: var(--s2); min-width: 0; }
  .fbtn { flex: 0 0 auto; }
  .sort { flex: 1 1 auto; min-width: 0; display: block; }
  .sort select { width: 100%; }
  .filters { display: none; gap: var(--s3); padding: var(--s3); background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-lg); }
  .filters.open { display: grid; }
  .g { display: grid; gap: var(--s1); min-width: 0; }
  .g > span { font-size: var(--fs-xs); color: var(--muted); }
  .g select { width: 100%; }
  .days { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s1); }
  .times { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s1); }
  .last { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .tog {
    min-height: 44px; padding: 0 var(--s1); font: inherit; font-size: var(--fs-sm); color: var(--text); cursor: pointer;
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); white-space: nowrap;
  }
  .tog.wide { padding: 0 var(--s4); }
  .tog[aria-pressed='true'] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
  .meta, .empty { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .link { font: inherit; color: var(--accent); background: none; border: 0; padding: 0 var(--s2); min-height: 44px; text-decoration: underline; cursor: pointer; }
  .list { border-top: 1px solid var(--rule); }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--s3); row-gap: 2px; align-items: baseline; padding-right: 32px; }
  .l1, .l2 { grid-column: 1; min-width: 0; overflow-wrap: anywhere; }
  .l2 { font-size: var(--fs-sm); color: var(--muted); }
  .exam { grid-column: 1; font-size: var(--fs-xs); color: var(--muted); }
  .seats { grid-column: 2; grid-row: 1 / -1; align-self: center; font-variant-numeric: tabular-nums; font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; }
  .seats.none { color: var(--muted); font-weight: 400; }
  .more { justify-self: stretch; }
  @media (min-width: 768px) {
    .fbtn { display: none; }
    .sort { flex: 0 0 200px; margin-left: auto; }
    .bar { order: 0; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); align-items: end; }
    .days { grid-template-columns: repeat(6, 56px); }
    .dayg { grid-column: span 2; }
  }
  @media (min-width: 1024px) {
    .row { grid-template-columns: 150px minmax(190px, 270px) minmax(0, 1fr) minmax(0, 220px) 190px 88px; column-gap: var(--s4); align-items: center; }
    .l1, .l2 { display: contents; }
    .dot { display: none; }
    .code { grid-column: 1; }
    .slot { grid-column: 2; }
    .title { grid-column: 3; color: var(--text); }
    .prof { grid-column: 4; font-size: var(--fs-sm); color: var(--muted); }
    .exam { grid-column: 5; grid-row: 1; font-size: var(--fs-sm); white-space: nowrap; }
    .seats { grid-column: 6; grid-row: 1; text-align: right; }
  }
</style>
