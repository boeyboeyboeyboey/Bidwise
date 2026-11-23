<script lang="ts">
  import { bossCodeOf } from '../../lib/data/bossCode';
  import { onMount, tick } from 'svelte';
  import { scanDayText } from '../../lib/data/seats';
  import { fetchIndex } from '../../lib/data/client';
  import { fetchTags } from '../../lib/tags/client';
  import type { Tag, TagKind } from '../../lib/tags/types';
  import MultiSelect from '../ui/MultiSelect.svelte';
  import type { ClassesPayload } from '../classes/logic';
  import {
    activeFilterCount, browseDefaults, courseRedirect, dayOptions, decodeBrowse, encodeBrowse, groupCourses, filterCourses, instructorLine, maskToTimes, timeOptions, timesToMask, sectionFilterOn,
    subjectsOf, type BrowseState, type CourseEntry,
  } from './courses';

  const PAGE = 50;
  const SAVED_KEY = 'bidwise.browse.list';

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
  // Catalogue tags, loaded once. A tag from the URL filters only after the tags load and only if it exists.
  let tags = $state.raw<Tag[]>([]);
  let tagStatus = $state<'loading' | 'ready' | 'error'>('loading');
  const tagGroups: { kind: TagKind; label: string }[] = [
    { kind: 'gradreq', label: 'Graduation requirements' },
    { kind: 'core', label: 'Core Curriculum' },
    { kind: 'area', label: 'Majors and electives' },
    { kind: 'track', label: 'Tracks' },
  ];
  const tagsOf = (kind: TagKind) => tags.filter((t) => t.kind === kind);
  const tagOf = $derived(tags.find((t) => t.id === bs.tag) ?? null);
  const tagCodes = $derived(tagOf ? new Set(tagOf.codes) : null);
  const tagUnknown = $derived(!!bs.tag && tagStatus === 'ready' && !tagOf);
  const tagInList = $derived(tagCodes ? courses.filter((c) => tagCodes.has(c.code)).length : 0);
  const hits = $derived(filterCourses(courses, bs, tagCodes));
  const count = $derived(activeFilterCount(bs));
  const filtered = $derived(sectionFilterOn(bs));
  const scanText = $derived(scanDayText(scannedAt));

  // Scroll position and "Show more" paging of this list, kept for the trip to a course page and back.
  const listKey = () => location.pathname + location.search;
  function saveList() {
    try {
      sessionStorage.setItem(SAVED_KEY, JSON.stringify({ key: listKey(), y: window.scrollY, shown }));
    } catch { /* ignore */ }
  }
  function restoreList() {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav?.type !== 'back_forward') return;
      const raw = sessionStorage.getItem(SAVED_KEY);
      const v: unknown = raw ? JSON.parse(raw) : null;
      if (!v || typeof v !== 'object') return;
      const { key, y, shown: n } = v as { key?: unknown; y?: unknown; shown?: unknown };
      if (key !== listKey() || typeof y !== 'number' || typeof n !== 'number') return;
      shown = Math.max(PAGE, Math.min(n, hits.length));
      tick().then(() => window.scrollTo(0, y));
    } catch { /* ignore */ }
  }

  function load() {
    status = 'loading';
    Promise.all([
      fetchIndex(),
      fetch('/data/classes.json').then((r) => (r.ok ? (r.json() as Promise<ClassesPayload>) : Promise.reject(new Error(String(r.status))))),
    ]).then(([index, d]) => {
      courses = groupCourses(d.rows, index);
      currentTerm = d.term;
      scannedAt = d.scannedAt;
      // An old link to a course in a past term: now that this term is known, send it on.
      const to = courseRedirect(bs, currentTerm);
      if (to) return location.replace(to);
      status = 'ready';
      restoreList();
    }, () => (status = 'error'));
  }

  onMount(() => {
    fetchTags().then((d) => {
      tags = d?.tags ?? [];
      tagStatus = d ? 'ready' : 'error';
    });
  });

  onMount(() => {
    bs = decodeBrowse(location.search);
    // Old course links (/explore/?course=IS214) now open the course page; location.replace keeps Back from looping.
    const to = bs.course && !bs.term ? courseRedirect(bs, '') : null;
    if (to) return location.replace(to);
    filtersOpen = activeFilterCount(bs) > 0;
    ready = !bs.course;
    load();
  });

  // The address follows the state.
  $effect(() => {
    const qs = encodeBrowse(bs);
    shown = PAGE;
    if (!ready) return;
    const url = location.pathname + (qs ? `?${qs}` : '');
    if (url !== location.pathname + location.search) {
      try {
        history.replaceState(history.state, '', url);
      } catch { /* ignore */ }
    }
  });

  const clear = () => (bs = { ...bs, sub: '', days: 0, times: [], seats: false, nofinal: false, tag: '' });
  const clearTag = () => (bs = { ...bs, tag: '' });
  const secLabel = (n: number, total: number) => (n === total ? `${n} ${n === 1 ? 'section' : 'sections'}` : `${n} of ${total} sections`);
</script>

{#if status === 'loading'}
  <p class="meta" role="status">Loading…</p>
{:else if status === 'error'}
  <p class="meta">Could not load courses. <button type="button" class="link" onclick={load}>Try again</button></p>
{:else}
  <div class="cs">
    <div class="card">
      <div class="qrow">
        <label class="sr" for="b-q">Search by course code, title, nickname or professor</label>
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
        <label class="g tagf"><span>Course tag</span>
          <select value={bs.tag} disabled={tagStatus !== 'ready'} onchange={(e) => (bs = { ...bs, tag: e.currentTarget.value })}>
            <option value="">Any</option>
            {#each tagGroups as g (g.kind)}
              {#if tagsOf(g.kind).length}
                <optgroup label={g.label}>
                  {#each tagsOf(g.kind) as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
                </optgroup>
              {/if}
            {/each}
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

    {#if tagOf}
      <p class="tagline"><span>{tagOf.name}: {tagInList === tagOf.total ? `${tagOf.total} tagged courses.` : `${tagInList} of ${tagOf.total} tagged courses have bid data here.`}</span> <button type="button" class="link" onclick={clearTag}>Clear</button></p>
    {:else if tagUnknown}
      <p class="tagline"><span>That course tag no longer exists.</span> <button type="button" class="link" onclick={clearTag}>Clear</button></p>
    {:else if tagStatus === 'error' && bs.tag}
      <p class="tagline"><span>Course tags could not load.</span> <button type="button" class="link" onclick={clearTag}>Clear</button></p>
    {/if}

    <p class="meta" aria-live="polite">
      {hits[0]?.close ? 'No exact match. Close matches: ' : ''}{hits.length} {hits.length === 1 ? 'course' : 'courses'}{scanText ? ` · seats as of ${scanText}` : ''}
    </p>
    {#if filtered}<p class="note">Day, time, seats and exam filters apply to this term's sections.</p>{/if}

    {#if hits.length}
      <ul class="list">
        {#each hits.slice(0, shown) as h (h.course.code)}
          <li>
            <a class="row-link row" href={`/course/${h.course.code}/`} onclick={saveList}>
              <span class="code">{bossCodeOf(h.course.code)}</span>
              <span class="main">
                <span class="title">{h.course.title}</span>
                {#if h.course.professors.length}<span class="prof">{instructorLine(h.course.professors)}</span>{/if}
              </span>
              <span class="n" class:none={!h.course.sections.length}>{h.course.sections.length ? secLabel(h.sections.length, h.course.sections.length) : 'No sections this term'}</span>
            </a>
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
  .cs { width: 100%; display: grid; gap: var(--s3); min-width: 0; align-content: start; }
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
  .g.sub, .g.tagf { flex-basis: 100%; }
  .tagline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1) var(--s2); margin: 0; font-size: var(--fs-sm); }
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

  @media (min-width: 768px) {
    .fbtn { display: none; }
    .filters { display: flex; }
    .g { flex: 1 1 150px; }
    .g.sub, .g.tagf { flex: 1.3 1 200px; }
    .checks { flex: 0 0 auto; flex-wrap: nowrap; }
    .chk { flex: 0 0 auto; }
  }
  @media (min-width: 1024px) {
    .row { grid-template-columns: 130px minmax(0, 1fr) 170px; column-gap: var(--s4); align-items: center; }
    .row .code { grid-column: 1; }
    .row .main { grid-column: 2; grid-row: 1; }
    .row .n { grid-column: 3; grid-row: 1; text-align: right; }
  }
</style>
