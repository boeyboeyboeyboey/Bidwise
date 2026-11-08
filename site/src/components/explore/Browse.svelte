<script lang="ts">
  import { onMount } from 'svelte';
  import type { CourseIndexEntry } from '../../lib/data/types';
  import {
    filterRows, groupRows, sortGroups, pageOf, fmtBid, fmtSeats, fmtSeatsLeft, fullWindow, nameMatches, termsToLoad, windowRank, PAGE_SIZE, PAGE_SIZE_CARDS,
    type BrowseGroup, type BrowseManifest, type BrowseRow, type BrowseState, type CourseInfo, type SortKey,
  } from './browse';
  import { fetchManifest, fetchTerm } from './browseClient';

  let { bs = $bindable(), index }: { bs: BrowseState; index: CourseIndexEntry[] } = $props();

  let man = $state.raw<BrowseManifest | null>(null);
  let data = $state.raw<BrowseRow[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  let token = 0;

  // Rows become short cards under 1100px wide (see the media query below); a page then holds 10 of them.
  let cards = $state(false);
  onMount(() => {
    const mq = window.matchMedia('(max-width: 1099px)');
    const sync = () => (cards = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    fetchManifest().then((m) => {
      man = m;
      // A link naming the latest term means the default; keep the select on its first option.
      const latest = m.terms.at(-1)?.term;
      if (latest && bs.term === latest) bs = { ...bs, term: '' };
      // A link that names an instructor with all terms is read as auto-widened.
      if (bs.instructor.trim() && bs.term === 'all' && prevTerm === null) prevTerm = '';
    }, () => { failed = true; loading = false; });
  });

  // Fetch only the terms the current selection needs (one file each, cached after the first request).
  // Keyed by a string: a new array each time would re-run the effect (and flash "Loading") on every sort or filter.
  const wantedKey = $derived(man ? termsToLoad(man, bs.term).join('|') : '');
  $effect(() => {
    const m = man;
    const ts = wantedKey ? wantedKey.split('|') : [];
    if (!m) return;
    const mine = ++token;
    loading = true;
    Promise.all(ts.map((t) => fetchTerm(m, t))).then(
      (parts) => { if (mine === token) { data = parts.flat(); failed = false; loading = false; } },
      () => { if (mine === token) { failed = true; loading = false; } },
    );
  });

  const courses = $derived(new Map<string, CourseInfo>(index.map((c) => [c.code, { title: c.title, school: c.school }])));
  const schools = $derived([...new Set(index.map((c) => c.school))].sort());
  const termChoices = $derived(man ? man.terms.map((t) => t.term).reverse() : []);
  const windowChoices = $derived(man ? [...man.windows].sort((a, b) => windowRank(a) - windowRank(b)) : []);

  const filtered = $derived(filterRows(data, bs, courses));
  // One row per section and term; its other bidding windows open underneath.
  const sorted = $derived(sortGroups(groupRows(filtered), bs.sort, bs.dir));
  const pg = $derived(pageOf(sorted, bs.page, cards ? PAGE_SIZE_CARDS : PAGE_SIZE));
  let openKeys = $state<Set<string>>(new Set());
  function toggleOpen(k: string) {
    const n = new Set(openKeys);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    openKeys = n;
  }
  // A page past the end (an old link, or fewer rows now) goes to the last page, and the address follows.
  $effect(() => {
    if (!loading && !failed && index.length && man && pg.page !== bs.page) bs = { ...bs, page: pg.page };
  });
  const nf = new Intl.NumberFormat('en-SG');

  // Changing a filter returns to the first page.
  function set<K extends keyof BrowseState>(k: K, v: BrowseState[K]) {
    if (k === 'term') prevTerm = null; // the person chose a term themselves
    bs = { ...bs, [k]: v, page: 0 };
  }
  function sortBy(k: SortKey) {
    bs = { ...bs, sort: k, dir: bs.sort === k && bs.dir === 'asc' ? 'desc' : 'asc', page: 0 };
  }
  const goto = (p: number) => (bs = { ...bs, page: p });

  // Professor type-ahead over the lookup. Naming an instructor widens the search to every term.
  let insText = $state(bs.instructor);
  let insOpen = $state(false);
  const insHits = $derived.by(() => {
    if (insText.trim().length < 2 || !man) return [];
    return man.instructors.filter((n) => nameMatches(n, insText)).slice(0, 8);
  });
  // The term chosen before naming an instructor, so clearing the name puts it back. null = not auto-widened.
  let prevTerm = $state<string | null>(null);
  function setInstructor(v: string) {
    insText = v;
    let term = bs.term;
    if (v.trim() && !bs.instructor.trim() && term !== 'all') {
      prevTerm = term;
      term = 'all';
    } else if (!v.trim() && prevTerm !== null) {
      term = prevTerm;
      prevTerm = null;
    }
    bs = { ...bs, instructor: v, term, page: 0 };
  }
  function pickInstructor(n: string) {
    setInstructor(n);
    insOpen = false;
  }
  const widened = $derived(prevTerm !== null && bs.instructor.trim() !== '' && bs.term === 'all');

  const dirOf = (k: SortKey) => (bs.sort === k ? (bs.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const cols: { key: SortKey; label: string; num?: boolean }[] = [
    { key: 'course', label: 'Course' },
    { key: 'section', label: 'Section' },
    { key: 'instructor', label: 'Professor' },
    { key: 'term', label: 'Term' },
    { key: 'window', label: 'Window' },
    { key: 'median', label: 'Median bid (e$)', num: true },
    { key: 'min', label: 'Lowest winning bid (e$)', num: true },
    { key: 'start', label: 'Seats at start', num: true },
    { key: 'seats', label: 'Seats left after', num: true },
    { key: 'filled', label: 'Full after window' },
  ];
</script>

{#snippet line(r: BrowseRow, sub: boolean, g: BrowseGroup)}
  <tr class:sub class:hm={!sub && g.others.length > 0}>
    <th scope="row" class="course"><a href={`/course/${r.code}/`}><b>{r.code}</b><span class="ttl">{courses.get(r.code)?.title ?? ''}</span></a></th>
    <td data-label="Section">{r.section}</td>
    <td class="ins-cell" data-label="Professor">{r.instructor ?? '–'}</td>
    <td class="slot nw" data-label="Day and time">{r.slot || '–'}</td>
    <td class="nw" data-label="Term">{r.term}</td>
    <td class="win" data-label="Window">
      <div class="wcell">
      <span class="wname">{fullWindow(r.window)}</span>
      {#if !sub && g.others.length}
        <button type="button" class="more" aria-expanded={openKeys.has(g.key)} onclick={() => toggleOpen(g.key)}>
          {openKeys.has(g.key) ? 'Hide other windows' : `Show ${g.others.length} other ${g.others.length === 1 ? 'window' : 'windows'}`}
        </button>
      {/if}
      </div>
    </td>
    <td class="num" data-label="Median bid (e$)">{fmtBid(r.medianCents)}</td>
    <td class="num" data-label="Lowest winning (e$)">{fmtBid(r.minCents)}</td>
    <td class="num start" data-label="Seats at start">{fmtSeats(r.before)}</td>
    <td class="num after" data-label="">
      <span class="bare">{fmtSeats(r.after)}</span><span class="words">{fmtSeatsLeft(r.after, r.before)}</span>
    </td>
    <td data-label="Full after">{r.filled ? 'Yes' : 'No'}</td>
  </tr>
{/snippet}

<div class="browse">
  <div class="filters">
    <label>School
      <select value={bs.school} onchange={(e) => set('school', e.currentTarget.value)}>
        <option value="">All schools</option>
        {#each schools as s}<option value={s}>{s}</option>{/each}
      </select>
    </label>
    <label>Term
      <select value={bs.term} onchange={(e) => set('term', e.currentTarget.value)}>
        {#each termChoices as t, i}<option value={i === 0 ? '' : t}>{t}{i === 0 ? ' (latest)' : ''}</option>{/each}
        <option value="all">All terms</option>
      </select>
    </label>
    <label>Window
      <select value={bs.window} onchange={(e) => set('window', e.currentTarget.value)}>
        <option value="">All windows</option>
        {#each windowChoices as w}<option value={w}>{fullWindow(w)}</option>{/each}
      </select>
    </label>
    <label>Course
      <input class="field" type="search" placeholder="Code or title" autocomplete="off" value={bs.q} oninput={(e) => set('q', e.currentTarget.value)} />
    </label>
    <label class="ins">Professor
      <input
        class="field"
        type="search"
        placeholder="Type a name"
        autocomplete="off"
        value={insText}
        oninput={(e) => { setInstructor(e.currentTarget.value); insOpen = true; }}
        onfocus={() => (insOpen = true)}
        onblur={() => setTimeout(() => (insOpen = false), 120)}
        onkeydown={(e) => { if (e.key === 'Enter' && insHits[0]) pickInstructor(insHits[0]); else if (e.key === 'Escape') insOpen = false; }}
      />
      {#if insOpen && insHits.length && insHits[0] !== insText}
        <ul class="hits" role="listbox" aria-label="Professors">
          {#each insHits as n}
            <li role="option" aria-selected="false"><button type="button" onmousedown={(e) => e.preventDefault()} onclick={() => pickInstructor(n)}>{n}</button></li>
          {/each}
        </ul>
      {/if}
    </label>
    <label class="check"><input type="checkbox" checked={bs.filled} onchange={(e) => set('filled', e.currentTarget.checked)} /> Only sections that filled</label>
    <label class="sortsel">Sort by
      <span class="sortrow">
        <select value={bs.sort} onchange={(e) => bs = { ...bs, sort: e.currentTarget.value as SortKey, page: 0 }}>
          {#each cols as c}<option value={c.key}>{c.label}</option>{/each}
        </select>
        <button type="button" class="btn" onclick={() => (bs = { ...bs, dir: bs.dir === 'asc' ? 'desc' : 'asc', page: 0 })}>{bs.dir === 'asc' ? 'Ascending' : 'Descending'}</button>
      </span>
    </label>
  </div>
  {#if widened}<p class="note">Showing all terms for this professor.</p>{/if}

  <div class="meta">
    <p class="count" role="status" aria-live="polite">
      {#if failed}Could not load the data. Reload to try again.
      {:else if loading || !index.length}Loading…
      {:else}{nf.format(sorted.length)} {sorted.length === 1 ? 'section' : 'sections'}{/if}
    </p>
    {#if !failed && !loading && index.length && sorted.length}
      <p class="note">One row per section: the latest window with a winning bid; open its other windows under it. A dash (–) means no bid won a seat.</p>
    {/if}
  </div>

  {#if !failed && !loading && index.length}
    {#if sorted.length}
      <div class="tw" tabindex="0" role="region" aria-label="Sections">
        <table>
          <thead>
            <tr>
              {#each cols as c}
                <th scope="col" class:num={c.num} class:course={c.key === 'course'} aria-sort={dirOf(c.key)}>
                  <button type="button" onclick={() => sortBy(c.key)}>{c.label}<i aria-hidden="true">{bs.sort === c.key ? (bs.dir === 'asc' ? '↑' : '↓') : ''}</i></button>
                </th>
                {#if c.key === 'instructor'}<th scope="col" class="slot-h"><span>Day and time</span></th>{/if}
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each pg.rows as g (g.key)}
              {@render line(g.head, false, g)}
              {#if openKeys.has(g.key)}
                {#each g.others as o}{@render line(o, true, g)}{/each}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      {#if pg.pages > 1}
        <nav class="pager" aria-label="Pages">
          <button type="button" class="btn" disabled={pg.page === 0} onclick={() => goto(pg.page - 1)}>Previous</button>
          <span class="pn num">Page {pg.page + 1} of {pg.pages}</span>
          <button type="button" class="btn" disabled={pg.page >= pg.pages - 1} onclick={() => goto(pg.page + 1)}>Next</button>
        </nav>
      {/if}
    {:else}
      <p class="none">No sections match these filters.</p>
    {/if}
  {/if}
</div>

<style>
  .browse { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s3); min-width: 0; }
  .filters { display: grid; gap: var(--s3) var(--s4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); align-items: end; }
  .filters label:not(.check) { display: grid; gap: var(--s1); font-size: 13px; font-weight: 600; color: var(--muted); min-width: 0; }
  .filters select, .filters .field { width: 100%; min-width: 0; font-weight: 400; }
  .ins { position: relative; }
  .hits {
    position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5;
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-sm);
  }
  .hits li + li { border-top: 1px solid var(--rule); }
  .hits button {
    display: block; width: 100%; min-height: 44px; padding: 0 var(--s3); text-align: left;
    font: inherit; font-size: 14px; font-weight: 400; color: var(--text); background: none; border: 0; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hits button:hover, .hits button:focus-visible { background: var(--accent-soft); }
  .check { display: inline-flex; align-items: center; gap: var(--s1); min-height: 44px; padding-right: var(--s3); font-weight: 600; cursor: pointer; }
  .check input { flex: none; width: 24px; height: 24px; margin: 10px; accent-color: var(--accent); cursor: pointer; }
  .meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s4); }
  .note, .count, .none { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .count { font-weight: 600; color: var(--text); }
  .none { padding: var(--s6) 0; text-align: center; }

  .filters label.sortsel:not(.check) { display: none; }
  .tw { max-width: 100%; border: 1px solid var(--rule); border-radius: var(--r-sm); overflow-x: auto; }
  .tw:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: var(--fs-sm); }
  th, td { padding: 2px var(--s3); text-align: left; vertical-align: middle; border-bottom: 1px solid var(--rule); background: var(--bg); }
  tbody tr:last-child > * { border-bottom: 0; }
  thead th { padding: 0; font-weight: 600; font-size: var(--fs-xs); color: var(--muted); background: var(--surface); vertical-align: bottom; }
  thead th button {
    display: inline-flex; align-items: center; gap: var(--s1); width: 100%; min-height: 44px; padding: 4px var(--s3);
    font: inherit; font-weight: 600; color: inherit; background: none; border: 0; cursor: pointer; text-align: inherit;
  }
  thead th.num button { justify-content: flex-end; text-align: right; }
  thead th button:hover { color: var(--text); }
  thead th[aria-sort='ascending'], thead th[aria-sort='descending'] { color: var(--accent); }
  thead th i { font-style: normal; display: inline-block; width: 1em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .nw { white-space: nowrap; }
  .ins-cell { min-width: 140px; }
  thead th.slot-h span { display: flex; align-items: flex-end; min-height: 44px; box-sizing: border-box; padding: 4px var(--s3); }
  td.slot { min-width: 120px; }
  tbody th.course { width: 260px; max-width: 260px; padding: 0; font-weight: 400; }
  tbody .course a { display: block; min-height: 44px; padding: 3px var(--s3); text-decoration: none; }
  tbody .course a b { display: block; font-weight: 600; color: var(--accent); text-decoration: underline; }
  tbody .course a:hover b { color: var(--accent-hover); }
  .ttl { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: var(--fs-xs); font-weight: 400; }
  .win { min-width: 150px; }
  .wcell { display: flex; align-items: center; gap: var(--s3); }
  .wname { flex: 1 1 auto; }
  .more {
    flex: none; min-height: 44px; padding: 0; font: inherit; font-size: var(--fs-xs); font-weight: 600;
    color: var(--accent); text-decoration: underline; background: none; border: 0; cursor: pointer; text-align: left;
  }
  tr.sub > * { background: var(--surface); color: var(--muted); }
  tr.sub .course a b { font-weight: 400; }
  .words { display: none; }
  .pager { display: flex; align-items: center; justify-content: center; gap: var(--s4); }
  .pn { font-size: var(--fs-sm); color: var(--muted); }
  @media (max-width: 1099px) {
    .filters label.sortsel:not(.check) { display: grid; gap: var(--s1); grid-column: 1 / -1; }
    .sortrow { display: flex; gap: var(--s2); }
    .sortrow select { flex: 1 1 auto; min-width: 0; }
    .tw { border: 0; overflow: visible; }
    table, tbody { display: block; }
    thead { display: none; }
    /* A row is a short card: the course on its own line, then labelled facts that wrap. */
    tr { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s3); padding: 0 var(--s3) var(--s2); margin-bottom: var(--s2); border: 1px solid var(--rule); border-radius: var(--r-sm); font-size: var(--fs-xs); line-height: 1.45; }
    tbody th.course { flex: 1 1 100%; min-width: 0; width: auto; max-width: none; padding: 0; border: 0; background: none; }
    tbody .course a { min-width: 0; display: flex; align-items: center; gap: var(--s2); padding: 0; font-size: var(--fs-sm); }
    tbody .course a b { display: inline; flex: none; }
    .ttl { flex: 1 1 auto; min-width: 0; font-size: var(--fs-xs); }
    td { display: inline; padding: 0; border: 0; background: none; text-align: left; }
    td::before { content: attr(data-label) ': '; color: var(--muted); }
    td[data-label='']::before { content: none; }
    td.start { display: none; }
    /* The day and time sit on their own line under the course. */
    tbody th.course { order: -2; }
    td.slot { order: -1; display: block; flex: 1 1 100%; min-width: 0; color: var(--muted); }
    td.slot::before { content: none; }
    .bare { display: none; }
    .words { display: inline; }
    tr.sub { background: var(--surface); }
    tr.sub > * { background: none; }
    .ins-cell, .win { min-width: 0; }
    .win .wcell { display: inline; }
    .win .wname { display: inline; }
    /* The "show other windows" button sits at the right of the course line, so it adds no line of its own. */
    tr { position: relative; }
    tr.hm th.course { padding-right: 150px; }
    .more { position: absolute; top: 0; right: var(--s3); display: flex; align-items: center; justify-content: flex-end; min-width: 44px; text-align: right; }
  }
  @media (max-width: 639px) {
    .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .filters .ins, .filters .check { grid-column: 1 / -1; }
  }
</style>
