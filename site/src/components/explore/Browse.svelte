<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { APPROX_NOTE, scanTimeText } from '../../lib/data/seats';
  import { fetchIndex } from '../../lib/data/client';
  import MultiSelect from '../ui/MultiSelect.svelte';
  import { R, seatText, type ClassRow, type ClassesPayload } from '../classes/logic';
  import { fmtBid, fmtSeats, fullWindow, pastSections, seatsTaken, type BrowseRow, type CourseTerms } from './browse';
  import { fetchCourseTerms, fetchManifest, fetchTerm } from './browseClient';
  import {
    activeFilterCount, browseDefaults, dayOptions, decodeBrowse, encodeBrowse, groupCourses, filterCourses, instructorLine, maskToTimes, timeOptions, timesToMask, sectionFilterOn, sectionMatches, shortTerm,
    subjectsOf, termChoices, type BrowseState, type CourseEntry,
  } from './courses';

  const PAGE = 50;

  let bs = $state<BrowseState>(browseDefaults());
  let courses = $state.raw<CourseEntry[]>([]);
  let currentTerm = $state('');
  let scannedAt = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let filtersOpen = $state(false);
  let shown = $state(PAGE);
  let ready = false;

  const subjects = $derived(subjectsOf(courses));
  const dayChoices = $derived(dayOptions(courses, bs.days));
  const timeList = $derived(timeOptions(courses, bs.times));
  const timeChoices = $derived(timeList.map((label, i) => ({ bit: 1 << i, label })));
  const hits = $derived(filterCourses(courses, bs));
  const count = $derived(activeFilterCount(bs));
  const filtered = $derived(sectionFilterOn(bs));
  const scanText = $derived(scanTimeText(scannedAt));
  const open = $derived(bs.course ? courses.find((c) => c.code === bs.course) : undefined);

  function load() {
    status = 'loading';
    Promise.all([
      fetchIndex(),
      fetch('/data/classes.json').then((r) => (r.ok ? (r.json() as Promise<ClassesPayload>) : Promise.reject(new Error(String(r.status))))),
    ]).then(([index, d]) => {
      courses = groupCourses(d.rows, index);
      currentTerm = d.term;
      scannedAt = d.scannedAt;
      if (bs.course && !courses.some((c) => c.code === bs.course)) bs = { ...bs, course: '', term: '', sec: '' };
      status = 'ready';
    }, () => (status = 'error'));
  }

  let lastCourse = '';
  let listY = 0;
  onMount(() => {
    bs = decodeBrowse(location.search);
    lastCourse = bs.course;
    filtersOpen = activeFilterCount(bs) > 0;
    ready = true;
    load();
    const pop = () => {
      bs = decodeBrowse(location.search);
      lastCourse = bs.course;
      if (!bs.course) tick().then(() => window.scrollTo(0, listY));
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  });

  // The address follows the state. Opening a course adds a history entry (Back returns to the list); everything else replaces it.
  $effect(() => {
    const qs = encodeBrowse(bs);
    const course = bs.course;
    shown = PAGE;
    if (!ready) return;
    const url = location.pathname + (qs ? `?${qs}` : '');
    if (url !== location.pathname + location.search) {
      try {
        if (course && !lastCourse) history.pushState({ browse: 1 }, '', url);
        else history.replaceState(history.state, '', url);
      } catch { /* ignore */ }
    }
    lastCourse = course;
  });

  function openCourse(c: CourseEntry) {
    listY = window.scrollY;
    bs = { ...bs, course: c.code, term: '', sec: '' };
    window.scrollTo(0, 0);
  }
  function back() {
    if (history.state?.browse) history.back();
    else {
      bs = { ...bs, course: '', term: '', sec: '' };
      tick().then(() => window.scrollTo(0, listY));
    }
  }

  // ---- Terms of the open course
  let terms = $state.raw<CourseTerms | null>(null);
  let termsFailed = $state(false);
  $effect(() => {
    if (!open || terms) return;
    termsFailed = false;
    fetchCourseTerms().then((t) => (terms = t), () => (termsFailed = true));
  });
  const choices = $derived.by(() => {
    if (!open) return [];
    const withData = terms ? (terms.by[open.code] ?? []).map((i) => terms!.terms[i]) : [];
    return termChoices(currentTerm, open.sections.length > 0, withData);
  });
  const termsKnown = $derived(!!terms || termsFailed || !open || open.sections.length > 0);
  const active = $derived(choices.find((c) => c.term === bs.term) ?? choices[0]);

  // Past rows of the active term, loaded when it is opened (one file per term, cached).
  let past = $state.raw<BrowseRow[] | null>(null);
  let pastFailed = $state(false);
  let pastToken = 0;
  const pastTerm = $derived(active && !active.now ? active.term : '');
  function loadPast(term: string) {
    const mine = ++pastToken;
    past = null;
    pastFailed = false;
    fetchManifest().then((m) => fetchTerm(m, term)).then(
      (rows) => { if (mine === pastToken) past = rows; },
      () => { if (mine === pastToken) pastFailed = true; },
    );
  }
  $effect(() => {
    if (pastTerm) loadPast(pastTerm);
  });

  const nowAll = $derived(open?.sections ?? []);
  const nowMatching = $derived(filtered ? nowAll.filter((r) => sectionMatches(r, bs)) : nowAll);
  const nowShown = $derived(nowMatching.length ? nowMatching : nowAll);
  const pastList = $derived(open && past ? pastSections(past, open.code) : []);

  const toggleBit = (mask: number, bit: number) => (mask & bit ? mask & ~bit : mask | bit);
  const clear = () => (bs = { ...bs, sub: '', days: 0, times: [], seats: false, nofinal: false });
  const clearSectionFilters = () => (bs = { ...bs, days: 0, times: [], seats: false, nofinal: false });
  const pickTerm = (t: string) => (bs = { ...bs, term: t, sec: '' });
  const toggleSec = (s: string) => (bs = { ...bs, sec: bs.sec === s ? '' : s });
  const secLabel = (n: number, total: number) => (n === total ? `${n} ${n === 1 ? 'section' : 'sections'}` : `${n} of ${total} sections`);
  const seatsLine = (r: ClassRow) => `${r[R.approx] === 1 ? '≈' : ''}${r[R.left]} of ${r[R.total]}`;
</script>

{#if status === 'loading'}
  <p class="meta" role="status">Loading…</p>
{:else if status === 'error'}
  <p class="meta">Could not load courses. <button type="button" class="link" onclick={load}>Try again</button></p>
{:else if open}
  <div class="course">
    <button type="button" class="btn back" onclick={back}>← Results</button>
    <h2><span class="code">{open.code}</span>{#if open.title}<span class="ttl">{open.title}</span>{/if}</h2>

    {#if choices.length}
      <div class="terms" role="group" aria-label="Term">
        {#each choices as c (c.term)}
          <button type="button" class="tog" aria-pressed={c.term === active?.term} aria-label={c.term} onclick={() => pickTerm(c.term)}>{c.now ? 'This term' : shortTerm(c.term)}</button>
        {/each}
      </div>
    {:else if !termsKnown}
      <p class="meta" role="status">Loading…</p>
    {:else}
      <p class="meta">{termsFailed ? 'Could not load past terms.' : 'No data for this course.'}</p>
    {/if}

    {#if active?.now}
      <p class="meta">{active.term}{scanText ? ` · seats as of ${scanText}` : ''}</p>
      {#if nowShown.length < nowAll.length || (filtered && !nowMatching.length)}
        <p class="meta">{secLabel(nowShown.length, nowAll.length)} match your filters. <button type="button" class="link" onclick={clearSectionFilters}>Show all</button></p>
      {/if}
      <ul class="secs">
        {#each nowShown as r (r[R.section])}
          {@const on = bs.sec === r[R.section]}
          <li>
            <button type="button" class="sec" aria-expanded={on} aria-controls={`d-${r[R.section]}`} onclick={() => toggleSec(r[R.section])}>
              <span class="s1"><b>{r[R.section]}</b><span class="slot">{r[R.slot] || 'Time not set'}</span></span>
              <span class="s2">{r[R.instructor] || 'Instructor not listed'}</span>
              <span class="right" class:none={r[R.left] <= 0}>{seatText(r)}</span>
            </button>
            {#if on}
              <div class="detail" id={`d-${r[R.section]}`}>
                <dl>
                  <div><dt>Professor</dt><dd>{r[R.instructor] || '–'}</dd></div>
                  <div><dt>Time</dt><dd>{r[R.slot] || 'Not set'}</dd></div>
                  <div><dt>Seats left</dt><dd>{seatsLine(r)}</dd></div>
                  <div><dt>Final exam</dt><dd>{r[R.exam] || 'No exam listed'}</dd></div>
                </dl>
                {#if r[R.approx] === 1}<p class="note">≈ {APPROX_NOTE}.</p>{/if}
                <a class="btn btn-primary see" href={`/course/${open.code}/?s=${encodeURIComponent(r[R.section])}`}>See bid</a>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if active}
      <p class="meta">{active.term}</p>
      {#if pastFailed}
        <p class="meta">Could not load this term. <button type="button" class="link" onclick={() => loadPast(active.term)}>Try again</button></p>
      {:else if !past}
        <p class="meta" role="status">Loading…</p>
      {:else if pastList.length}
        <p class="note">Bids in e$. A dash (–) means no bid won a seat.</p>
        <ul class="secs">
          {#each pastList as s (s.section)}
            {@const on = bs.sec === s.section}
            <li>
              <button type="button" class="sec" aria-expanded={on} aria-controls={`d-${s.section}`} onclick={() => toggleSec(s.section)}>
                <span class="s1"><b>{s.section}</b><span class="slot">{s.slot || 'Time not set'}</span></span>
                <span class="s2">{s.instructor || 'Instructor not listed'}</span>
              </button>
              {#if on}
                <div class="detail" id={`d-${s.section}`}>
                  <dl>
                    <div><dt>Professor</dt><dd>{s.instructor || '–'}</dd></div>
                    <div><dt>Time</dt><dd>{s.slot || 'Not set'}</dd></div>
                  </dl>
                  <table class="wt">
                    <thead><tr><th scope="col">Window</th><th scope="col" class="n">Offered</th><th scope="col" class="n">Taken</th><th scope="col" class="n">Lowest</th><th scope="col" class="n">Median</th></tr></thead>
                    <tbody>
                      {#each s.windows as w (w.window)}
                        <tr>
                          <th scope="row">{fullWindow(w.window)}</th>
                          <td class="n" data-label="Offered">{fmtSeats(w.before)}</td>
                          <td class="n" data-label="Taken">{fmtSeats(seatsTaken(w))}</td>
                          <td class="n" data-label="Lowest">{fmtBid(w.minCents)}</td>
                          <td class="n" data-label="Median">{fmtBid(w.medianCents)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="meta">No sections in this term.</p>
      {/if}
    {/if}
  </div>
{:else}
  <div class="cs">
    <div class="card">
      <div class="qrow">
        <label class="sr" for="b-q">Search by course code, title or professor</label>
        <div class="search">
          <svg class="mag" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.7 12.7 17 17" /></svg>
          <input id="b-q" class="field" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="Code, title or professor" bind:value={bs.q} />
          {#if bs.q}
            <button type="button" class="x" aria-label="Clear search" onclick={() => { bs = { ...bs, q: '' }; document.getElementById('b-q')?.focus(); }}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
            </button>
          {/if}
        </div>
        <button type="button" class="btn fbtn" aria-expanded={filtersOpen} aria-controls="b-filters" onclick={() => (filtersOpen = !filtersOpen)}>
          Filters{count ? ` (${count})` : ''}
        </button>
      </div>
      <div id="b-filters" class="filters" class:open={filtersOpen}>
        <label class="g sub"><span>Subject</span>
          <select value={bs.sub} onchange={(e) => (bs = { ...bs, sub: e.currentTarget.value })}>
            <option value="">All subjects</option>
            {#each subjects as s (s)}<option value={s}>{s}</option>{/each}
          </select>
        </label>
        <div class="g"><MultiSelect label="Day" options={dayChoices} value={bs.days} onchange={(m) => (bs = { ...bs, days: m })} anyLabel="Any day" noun="days" /></div>
        <div class="g"><MultiSelect label="Start time" options={timeChoices} value={timesToMask(timeList, bs.times)} onchange={(m) => (bs = { ...bs, times: maskToTimes(timeList, m) })} anyLabel="Any start time" noun="start times" listMax={3} /></div>
        <div class="checks">
          <label class="chk"><input type="checkbox" checked={bs.seats} onchange={() => (bs = { ...bs, seats: !bs.seats })} /><span>Has seats left</span></label>
          <label class="chk"><input type="checkbox" checked={bs.nofinal} onchange={() => (bs = { ...bs, nofinal: !bs.nofinal })} /><span>No final exam listed</span></label>
        </div>
        {#if count}<button type="button" class="btn clearf" onclick={clear}>Clear filters</button>{/if}
      </div>
    </div>

    <p class="meta" aria-live="polite">
      {hits.length} {hits.length === 1 ? 'course' : 'courses'}{scanText ? ` · seats as of ${scanText}` : ''}
    </p>
    {#if filtered}<p class="note">Day, time, seats and exam filters apply to this term's sections.</p>{/if}

    {#if hits.length}
      <ul class="list">
        {#each hits.slice(0, shown) as h (h.course.code)}
          <li>
            <button type="button" class="row-link row" onclick={() => openCourse(h.course)}>
              <span class="code">{h.course.code}</span>
              <span class="main">
                <span class="title">{h.course.title}</span>
                {#if h.course.professors.length}<span class="prof">{instructorLine(h.course.professors)}</span>{/if}
              </span>
              <span class="n" class:none={!h.course.sections.length}>{h.course.sections.length ? secLabel(h.sections.length, h.course.sections.length) : 'No sections this term'}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if hits.length > shown}
        <button type="button" class="btn more" onclick={() => (shown += PAGE)}>Show more ({hits.length - shown} left)</button>
      {/if}
    {:else}
      <p class="empty">No courses match.{count || bs.q ? ' Try fewer filters.' : ''}</p>
    {/if}
  </div>
{/if}

<style>
  .cs, .course { width: 100%; display: grid; gap: var(--s3); min-width: 0; align-content: start; }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .meta, .empty, .note { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .note { font-size: var(--fs-xs); }
  .link { font: inherit; color: var(--accent); background: none; border: 0; padding: 0 var(--s2); min-height: 44px; text-decoration: underline; cursor: pointer; }
  .card { display: grid; gap: var(--s3); padding: var(--s3); background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-lg); }
  .qrow { display: flex; gap: var(--s2); align-items: center; }
  .search { position: relative; flex: 1 1 auto; min-width: 0; }
  .search .field { padding-left: 40px; padding-right: 44px; background-color: var(--bg); }
  .search .field::-webkit-search-cancel-button { display: none; }
  .mag { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
  .x { position: absolute; right: 0; top: 0; width: 44px; height: 100%; display: grid; place-items: center; color: var(--muted); background: none; border: 0; cursor: pointer; border-radius: var(--r-md); }
  .x:hover { color: var(--text); }
  .fbtn { flex: none; padding: 0 var(--s3); }
  .filters { display: none; flex-wrap: wrap; gap: var(--s3); align-items: flex-end; padding-top: var(--s3); border-top: 1px solid var(--rule); }
  .filters.open { display: flex; }
  .g { display: grid; gap: var(--s1); min-width: 0; flex: 1 1 calc(50% - var(--s3)); }
  .g.sub { flex-basis: 100%; }
  .g > span { font-size: var(--fs-xs); color: var(--muted); }
  .g select { width: 100%; }
  .checks { display: flex; flex-wrap: wrap; gap: var(--s3); flex: 1 1 100%; }
  .chk {
    display: flex; align-items: center; gap: var(--s2); flex: 1 1 calc(50% - var(--s3)); min-height: 44px; padding: 0 var(--s3); font-size: var(--fs-sm); cursor: pointer;
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md);
  }
  .chk:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
  .chk:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
  .chk input { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); flex: none; }
  .clearf { flex: none; }
  .tog {
    min-height: 44px; padding: 0 var(--s2); font: inherit; font-size: var(--fs-sm); color: var(--text); cursor: pointer;
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); white-space: nowrap;
  }
  .tog[aria-pressed='true'] { background: var(--accent); color: var(--accent-ink); font-weight: 600; }

  .list { border-top: 1px solid var(--rule); }
  .row { width: 100%; text-align: left; font: inherit; background: none; border: 0; border-bottom: 1px solid var(--rule); cursor: pointer;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--s3); row-gap: 2px; align-items: baseline; }
  .row > * { min-width: 0; overflow-wrap: anywhere; }
  .code { font-weight: 600; }
  .row .code { grid-column: 1; }
  .row .main { grid-column: 1 / -1; grid-row: 2; display: grid; gap: 2px; }
  .row .n { grid-column: 2; grid-row: 1; font-size: var(--fs-sm); white-space: nowrap; }
  .row .prof { font-size: var(--fs-sm); color: var(--muted); }
  .none { color: var(--muted); font-weight: 400; }
  .more { justify-self: stretch; }

  .back { justify-self: start; }
  h2 { font-size: var(--fs-lg); font-weight: 600; display: flex; flex-wrap: wrap; gap: 0 var(--s3); overflow-wrap: anywhere; }
  h2 .ttl { font-weight: 400; }
  .terms { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .secs { border-top: 1px solid var(--rule); }
  .secs li { border-bottom: 1px solid var(--rule); }
  .sec {
    width: 100%; min-height: 52px; padding: var(--s3) 36px var(--s3) var(--s2); text-align: left; font: inherit; color: inherit; cursor: pointer;
    background: none; border: 0; position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--s3); row-gap: 2px; align-items: baseline;
  }
  .sec::after {
    content: ''; position: absolute; right: var(--s2); top: 50%; width: 16px; height: 16px; transform: translateY(-50%);
    background: var(--chev-down) center / 16px no-repeat;
  }
  .sec[aria-expanded='true']::after { transform: translateY(-50%) rotate(180deg); }
  .sec > * { min-width: 0; overflow-wrap: anywhere; }
  .s1 { grid-column: 1; }
  .s1 .slot { margin-left: var(--s3); }
  .s2 { grid-column: 1; font-size: var(--fs-sm); color: var(--muted); }
  .right { grid-column: 2; grid-row: 1 / 3; align-self: center; font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .detail { display: grid; gap: var(--s3); padding: var(--s3); margin-bottom: var(--s3); background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-lg); }
  dl { margin: 0; display: grid; gap: var(--s2); }
  dl > div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: var(--s3); }
  dt { color: var(--muted); font-size: var(--fs-sm); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .see { justify-self: start; }
  .wt { width: 100%; border-collapse: collapse; font-size: var(--fs-xs); table-layout: fixed; }
  .wt th, .wt td { padding: var(--s2) var(--s1); text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); overflow-wrap: anywhere; }
  .wt thead th { color: var(--muted); font-weight: 600; }
  .wt tbody th { font-weight: 400; }
  .wt .n { text-align: right; font-variant-numeric: tabular-nums; width: 15%; }
  .wt tbody tr:last-child > * { border-bottom: 0; }

  /* Under 640px each window is a short card: its name, then labelled numbers that wrap. */
  @media (max-width: 639px) {
    .wt, .wt tbody { display: block; }
    .wt thead { display: none; }
    .wt tr { display: flex; flex-wrap: wrap; gap: 0 var(--s3); padding: var(--s2) 0; border-bottom: 1px solid var(--rule); }
    .wt tbody tr:last-child { border-bottom: 0; }
    .wt th, .wt td { padding: 0; border: 0; }
    .wt tbody th { flex: 1 1 100%; font-weight: 600; }
    .wt td.n { width: auto; text-align: left; }
    .wt td.n::before { content: attr(data-label) ' '; color: var(--muted); }
  }
  @media (min-width: 768px) {
    .fbtn { display: none; }
    .filters { display: flex; }
    .g { flex: 1 1 150px; }
    .g.sub { flex: 1.3 1 200px; }
    .checks { flex: 0 0 auto; flex-wrap: nowrap; }
    .chk { flex: 0 0 auto; }
    .wt { font-size: var(--fs-sm); }
    .wt .n { width: 100px; }
  }
  @media (min-width: 1024px) {
    .row { grid-template-columns: 130px minmax(0, 1fr) 170px; column-gap: var(--s4); align-items: center; }
    .row .code { grid-column: 1; }
    .row .main { grid-column: 2; grid-row: 1; }
    .row .n { grid-column: 3; grid-row: 1; text-align: right; }
    .sec { grid-template-columns: 90px 260px minmax(0, 1fr) 100px; column-gap: var(--s4); align-items: center; }
    .s1 { display: contents; }
    .s1 b { grid-column: 1; }
    .s1 .slot { grid-column: 2; margin: 0; }
    .s2 { grid-column: 3; }
    .right { grid-column: 4; grid-row: 1; text-align: right; }
  }
</style>
