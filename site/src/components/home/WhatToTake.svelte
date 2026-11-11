<svelte:options css="injected" />
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { candidates, deriveBlocks, pickViews, withoutCoveredDegree } from '../../lib/gradreq';
  import type { Block, CandidateResult, GradIndex, GradView, LoadedView, Requisites } from '../../lib/gradreq';
  import { findDegree } from '../../lib/gradreq';
  import { fetchCourse, fetchIndex } from '../../lib/data/client';
  import type { CourseData, CourseIndexEntry } from '../../lib/data/types';
  import { liveWindow } from '../../lib/data/window';
  import { getChosenWindow } from '../../lib/state';
  import { eS, pct } from '../course/fmt';
  import {
    STORE_KEY, groupBlocks, intakesFor, isTrackBlock, leftText, majorOptions, parseBidCents, parseSaved, secondOptions,
    shownSection, splitCandidates, toSelection, trackOptions,
  } from './take';

  let { builtWindow }: { builtWindow: string } = $props();

  const TOP = 5;

  // ------------------------------------------------------------ saved on this device
  function readStore(): string | null {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  }
  const saved = parseSaved(readStore());

  let school = $state(saved.school);
  let degree = $state(saved.degree);
  let intake = $state(saved.intake);
  let major = $state(saved.major);
  let track = $state(saved.track);
  let second = $state(saved.second);
  let completed = $state<string[]>(saved.completed);
  let bidText = $state(saved.bid);
  let sort = $state<'chance' | 'cheapest'>(saved.sort);

  $effect(() => {
    const text = JSON.stringify({ school, degree, intake, major, track, second, completed: [...completed], bid: bidText, sort });
    try {
      localStorage.setItem(STORE_KEY, text);
    } catch {
      /* storage unavailable: nothing is kept, the page still works */
    }
  });

  // ------------------------------------------------------------ the programme
  let index = $state.raw<GradIndex | null>(null);
  let indexFailed = $state(false);
  onMount(() => {
    fetch('/data/gradreq/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<GradIndex>) : Promise.reject(new Error(String(r.status)))))
      .then((i) => {
        index = i;
        reconcile();
      }, () => (indexFailed = true));
  });

  const schools = $derived(index?.schools ?? []);
  const degrees = $derived(schools.find((s) => s.id === school)?.degrees ?? []);
  const degreeObj = $derived(index && degree ? findDegree(index, degree) : null);
  const intakes = $derived(index ? intakesFor(index, degreeObj) : []);
  const majors = $derived(intake ? majorOptions(degreeObj, intake) : []);
  const tracks = $derived(intake ? trackOptions(degreeObj, major, intake) : []);
  const seconds = $derived(index && intake && degree ? secondOptions(index, degree, intake) : []);
  const hasTracks = $derived(!!degreeObj && ((degreeObj.tracks?.length ?? 0) > 0 || (degreeObj.majors ?? []).some((m) => (m.tracks?.length ?? 0) > 0)));
  // Major, track and second major are each optional; all open once the intake is set.
  const canPick = $derived(!!intake);

  /** Clears any later field whose value is no longer offered, so the chain never holds a stale pick. */
  function reconcile() {
    if (!index) return;
    if (!schools.some((s) => s.id === school)) school = '';
    if (!degrees.some((d) => d.id === degree)) degree = '';
    if (!intakes.includes(intake)) intake = '';
    if (!majors.some((m) => m.value === major)) major = '';
    if (!tracks.some((t) => t.value === track)) track = '';
    if (!seconds.some((s) => s.value === second)) second = '';
  }
  function set(field: 'school' | 'degree' | 'intake' | 'major' | 'track' | 'second', v: string) {
    if (field === 'school') school = v;
    else if (field === 'degree') degree = v;
    else if (field === 'intake') intake = v;
    else if (field === 'major') major = v;
    else if (field === 'track') track = v;
    else second = v;
    reconcile();
  }

  const pick = $derived(index && degree && intake ? pickViews(index, toSelection({ degree, intake, major, track, second })) : null);

  // ------------------------------------------------------------ requirement views
  const viewCache = new Map<string, Promise<GradView>>();
  function fetchView(id: string): Promise<GradView> {
    let p = viewCache.get(id);
    if (!p) {
      p = fetch(`/data/gradreq/${encodeURIComponent(id)}.json`).then((r) => (r.ok ? (r.json() as Promise<GradView>) : Promise.reject(new Error(String(r.status)))));
      p.catch(() => viewCache.delete(id));
      viewCache.set(id, p);
    }
    return p;
  }
  let reqP: Promise<Requisites> | null = null;
  function fetchRequisites(): Promise<Requisites> {
    reqP ??= fetch('/data/gradreq/requisites.json').then((r) => (r.ok ? (r.json() as Promise<Requisites>) : Promise.reject(new Error(String(r.status)))));
    reqP.catch(() => (reqP = null));
    return reqP;
  }

  let loaded = $state.raw<{ views: LoadedView[]; intake: string } | null>(null);
  let viewsFailed = $state(false);
  let viewTok = 0;
  $effect(() => {
    const picked = pick?.views ?? [];
    const forIntake = intake;
    const tok = ++viewTok;
    viewsFailed = false;
    if (!picked.length) {
      loaded = null;
      return;
    }
    Promise.all(picked.map((v) => fetchView(v.id).then((view): LoadedView => ({ kind: v.kind, view })))).then(
      (views) => {
        if (tok === viewTok) loaded = { views: withoutCoveredDegree(views), intake: forIntake };
      },
      () => {
        if (tok === viewTok) viewsFailed = true;
      },
    );
  });

  const viewLabel = (id: string) => loaded?.views.find((v) => v.view.id === id)?.view.label ?? '';

  // ------------------------------------------------------------ courses already done
  let allCourses = $state.raw<CourseIndexEntry[]>([]);
  onMount(() => {
    fetchIndex().then((i) => (allCourses = i), () => { /* the picker then offers only the programme's own courses */ });
  });
  /** Courses in the selected views. */
  const poolCourses = $derived.by(() => {
    const m = new Map<string, string>();
    for (const lv of loaded?.views ?? []) for (const g of lv.view.groups) for (const x of g.members) if (x.code && !m.has(x.code)) m.set(x.code, x.title);
    return m;
  });
  let q = $state('');
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const matches = $derived.by(() => {
    const s = q.trim().toLowerCase();
    const f = norm(s);
    if (!f) return [];
    // Every course the site knows, plus any course a selected view lists that the site has no page for.
    const all = new Map<string, string>(allCourses.map((c) => [c.code, c.title]));
    for (const [code, title] of poolCourses) if (!all.has(code)) all.set(code, title);
    const rank = (code: string) => Number(!poolCourses.has(code)) * 2 + Number(!norm(code).startsWith(f));
    return [...all]
      .filter(([code, title]) => !completed.includes(code) && (norm(code).includes(f) || title.toLowerCase().includes(s)))
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .slice(0, 6);
  });
  function addDone(code: string) {
    if (!completed.includes(code)) completed = [...completed, code];
    q = '';
  }
  const removeDone = (code: string) => (completed = completed.filter((c) => c !== code));

  // ------------------------------------------------------------ blocks and candidates
  const derived = $derived(loaded ? deriveBlocks(loaded.views, loaded.intake, completed) : null);
  const groups = $derived(derived ? groupBlocks(derived.open, viewLabel) : []);
  const multiView = $derived(new Set(groups.map((g) => g.blocks[0].viewId)).size > 1);
  const bidCents = $derived(parseBidCents(bidText));
  let appliedBid = $state(3000);
  $effect(() => {
    const c = bidCents;
    if (c === null) return;
    const t = setTimeout(() => (appliedBid = c), 350);
    return () => clearTimeout(t);
  });

  type BlockResult = { state: 'loading' } | { state: 'error' } | { state: 'done'; data: CandidateResult };
  let results = $state.raw<Record<string, BlockResult>>({});
  let runTok = 0;
  const keyOf = (b: Pick<Block, 'viewId' | 'id'>) => `${b.viewId}\u0000${b.id}`;
  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

  let offeredP: Promise<Set<string>> | null = null;
  function offeredCodes(): Promise<Set<string>> {
    offeredP ??= fetchIndex().then((i) => new Set(i.filter((c) => c.offeredNow && c.sectionCount > 0).map((c) => c.code)));
    offeredP.catch(() => (offeredP = null));
    return offeredP;
  }

  /** Course files for the block's members and hints that are offered now, a few requests at a time. */
  async function loadOffered(b: Block, done: Set<string>): Promise<Map<string, CourseData>> {
    const offered = await offeredCodes();
    const want = [...new Set([...b.members.filter((m) => !m.done && !m.setSatisfied).map((m) => m.code), ...b.hints.map((h) => h.code)])]
      .filter((c) => offered.has(c) && !done.has(c));
    const out = new Map<string, CourseData>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, want.length) }, async () => {
      while (next < want.length) {
        const code = want[next++];
        try {
          out.set(code, await fetchCourse(code));
        } catch {
          /* one missing course file only drops that course */
        }
      }
    }));
    return out;
  }

  async function runBlocks(tok: number, blocks: Block[], done: string[], bid: number, order: 'chance' | 'cheapest') {
    let reqs: Requisites;
    try {
      reqs = await fetchRequisites();
    } catch {
      if (tok === runTok) results = Object.fromEntries(blocks.map((b) => [keyOf(b), { state: 'error' } as BlockResult]));
      return;
    }
    const doneSet = new Set(done);
    const liveW = liveWindow();
    const opts = { window: liveW ? `Round ${liveW.round} Window ${liveW.window}` : builtWindow, chosenWindow: getChosenWindow(), bid, sort: order };
    for (const b of blocks) {
      if (tok !== runTok) return;
      const k = keyOf(b);
      try {
        const offered = await loadOffered(b, doneSet);
        // Simulate a few members at a time so the page stays responsive; the final call below then hits the cache.
        for (let i = 0; i < b.members.length; i += 6) {
          if (tok !== runTok) return;
          candidates({ ...b, members: b.members.slice(i, i + 6), hints: [] }, offered, done, reqs, opts);
          await yieldToUi();
        }
        if (tok !== runTok) return;
        results = { ...results, [k]: { state: 'done', data: candidates(b, offered, done, reqs, opts) } };
      } catch {
        if (tok === runTok) results = { ...results, [k]: { state: 'error' } };
      }
      await yieldToUi();
    }
  }

  $effect(() => {
    const d = derived;
    const done = [...completed];
    const bid = appliedBid;
    const order = sort;
    const tok = ++runTok;
    if (!d) {
      results = {};
      return;
    }
    const blocks = d.open.filter((b) => b.kind === 'list' && b.members.length + b.hints.length > 0);
    untrack(() => {
      // Keep what is shown until the new figures arrive; blocks not seen before say Loading.
      results = Object.fromEntries(blocks.map((b) => [keyOf(b), results[keyOf(b)] ?? ({ state: 'loading' } as BlockResult)]));
      runBlocks(tok, blocks, done, bid, order);
    });
  });

  let expanded = $state<Record<string, boolean>>({});

  const noQuantityTrack = (b: Block) => (loaded ? isTrackBlock(b, loaded.views) : false);
  const needText = (needs: 'major-or-track' | 'second-major-list') =>
    needs === 'second-major-list' ? 'We don\'t have this list yet. Check your degree requirements on OASIS.' : majors.length === 0 && tracks.length > 0 ? 'Pick a track to see this.' : 'Pick a major to see this.';
</script>

<div class="wrap">
  {#if indexFailed}
    <p class="note">Could not load the programme list. Reload the page to try again.</p>
  {:else if !index}
    <p class="note">Loading…</p>
  {:else}
    <div class="fields">
      <label>School
        <select class="field" value={school} onchange={(e) => set('school', e.currentTarget.value)}>
          <option value="">Select</option>
          {#each schools as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <label>Degree
        <select class="field" value={degree} disabled={!school} onchange={(e) => set('degree', e.currentTarget.value)}>
          <option value="">Select</option>
          {#each degrees as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
        </select>
      </label>
      <label>Intake year
        <select class="field" value={intake} disabled={!degree} onchange={(e) => set('intake', e.currentTarget.value)}>
          <option value="">Select</option>
          {#each intakes as i (i)}<option value={i}>{i}</option>{/each}
        </select>
      </label>
      {#if degreeObj?.majors?.length && (!intake || majors.length)}
        <label>Major (optional)
          <select class="field" value={major} disabled={!canPick} onchange={(e) => set('major', e.currentTarget.value)}>
            <option value="">None</option>
            {#each majors as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
          </select>
        </label>
      {/if}
      {#if degreeObj && (!intake ? hasTracks : tracks.length)}
        <label>Track (optional)
          <select class="field" value={track} disabled={!canPick} onchange={(e) => set('track', e.currentTarget.value)}>
            <option value="">None</option>
            {#each tracks as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
          </select>
        </label>
      {/if}
      {#if !degreeObj || (degreeObj.secondMajors?.length && (!intake || seconds.length))}
        <label>Second major (optional)
          <select class="field" value={second} disabled={!canPick} onchange={(e) => set('second', e.currentTarget.value)}>
            <option value="">None</option>
            {#each seconds as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
          </select>
        </label>
      {/if}
    </div>

    {#if pick}
      {#if viewsFailed}
        <p class="note">Could not load the requirements. Reload the page to try again.</p>
      {:else if !loaded}
        <p class="note">Loading…</p>
      {:else}
        <div class="done-box">
          <label class="lbl" for="done-q">Courses already done</label>
          <div class="pickbox">
            <input id="done-q" class="field" type="search" placeholder="Search by code or title" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={q}
              onkeydown={(e) => e.key === 'Enter' && matches[0] && addDone(matches[0][0])} />
            {#if matches.length}
              <ul class="matches">
                {#each matches as [code, title] (code)}
                  <li><button type="button" onclick={() => addDone(code)}><b>{code}</b> <span>{title}</span></button></li>
                {/each}
              </ul>
            {/if}
          </div>
          {#if completed.length}
            <ul class="picks">
              {#each completed as code (code)}
                <li><button type="button" class="pick-chip" onclick={() => removeDone(code)} aria-label={`Remove ${code}`}>{code}<span aria-hidden="true">×</span></button></li>
              {/each}
            </ul>
          {/if}
          <p class="small">Saved on this device only.</p>
        </div>

        <div class="opts">
          <label>Bid per course
            <span class="bidbox"><span aria-hidden="true">e$</span><input class="field num" type="text" inputmode="decimal" aria-invalid={bidCents === null} bind:value={bidText} /></span>
          </label>
          <div class="sortbox" role="group" aria-label="Sort by">
            <span class="lbl">Sort by</span>
            <div class="seg">
              <button type="button" aria-pressed={sort === 'chance'} onclick={() => (sort = 'chance')}>Best chance</button>
              <button type="button" aria-pressed={sort === 'cheapest'} onclick={() => (sort = 'cheapest')}>Cheapest</button>
            </div>
          </div>
        </div>
        {#if bidCents === null}<p class="small err">Enter an amount from e$0.01 to e$1000.</p>{/if}

        {#if derived}
          <p class="small">Some prerequisites aren't checked here. BOSS checks them when you bid.</p>
          {#each derived.secondMajors.filter((s) => s.atRisk || (s.minNotShared ?? 0) > 0) as s (s.viewId)}
            <p class="warn" class:risk={s.atRisk}>At least {s.minNotShared} CUs of your second major can't also count toward your first major.</p>
          {/each}

          {#each derived.needsSelection as p (p.viewId + p.id)}
            <div class="block">
              <h4>{p.name}</h4>
              <p class="small">{needText(p.needs)}</p>
            </div>
          {/each}

          {#each groups as g, gi (g.key)}
            {#if multiView && (gi === 0 || groups[gi - 1].blocks[0].viewId !== g.blocks[0].viewId)}
              <h3 class="view">{viewLabel(g.blocks[0].viewId)}</h3>
            {/if}
            <section class="grp">
              {#if !multiView || g.blocks[0].headings.length}<h3 class:sub={multiView}>{g.label}</h3>{/if}
              {#each g.blocks as b (keyOf(b))}
                {@const k = keyOf(b)}
                {@const r = results[k]}
                <div class="block">
                  <div class="bh"><h4>{b.name}</h4>{#if leftText(b)}<span class="num left">{leftText(b)}</span>{/if}</div>
                  {#if noQuantityTrack(b)}<p class="small">All from one track</p>{/if}
                  {#if b.unnamed.length}
                    <ul class="plain">{#each b.unnamed as t (t)}<li>Find on BOSS: {t}</li>{/each}</ul>
                  {:else if b.listMissing}
                    <p class="small">We don't have this list yet. Check your degree requirements on OASIS.</p>
                  {/if}
                  {#if b.kind === 'list' && b.members.length + b.hints.length > 0}
                    {#if !r || r.state === 'loading'}
                      <p class="small">Loading…</p>
                    {:else if r.state === 'error'}
                      <p class="small">Could not load these courses. Reload the page to try again.</p>
                    {:else}
                      {@const sp = splitCandidates(r.data)}
                      {@const list = expanded[k] ? sp.open : sp.open.slice(0, TOP)}
                      {#if sp.open.length === 0 && b.members.length > 0}
                        <p class="small">{sp.fullCount > 0 ? 'All sections are full this term.' : 'Nothing offered this term.'}</p>
                      {/if}
                      {#if list.length}
                        <ul class="cands">
                          {#each list as c (c.code)}
                            {@const s = shownSection(c, sort)}
                            <li>
                              <a class="row-link" href={`/course/${c.code}`}>
                                <span class="l1"><b>{c.code}</b> <span class="title">{c.title}</span></span>
                                <span class="stats num">
                                  <span><i>Chance at {eS(appliedBid).replace('.00', '')}</i> {s.chance === null ? 'No forecast' : pct(s.chance)}</span>
                                  <span><i>Bid needed</i> {s.bidCents === null ? '—' : eS(s.bidCents)}</span>
                                  <span><i>Seats</i> {s.seatsLeft}</span>
                                </span>
                                <span class="l3">{s.instructor || 'Instructor not listed'} · <span class="num">{s.times || 'Time not set'}</span></span>
                                {#if c.eligibility === 'check'}<small>Check prerequisites on BOSS</small>{/if}
                                {#if c.cls === 'tagged'}<small>From BOSS course tags</small>{/if}
                              </a>
                            </li>
                          {/each}
                        </ul>
                        {#if sp.open.length > TOP}
                          <button type="button" class="btn more" aria-expanded={!!expanded[k]} onclick={() => (expanded = { ...expanded, [k]: !expanded[k] })}>
                            {expanded[k] ? `Show top ${TOP}` : `Show all ${sp.open.length}`}
                          </button>
                        {/if}
                      {/if}
                      {#if r.data.mayCount.length}
                        <details class="may">
                          <summary>May also count ({r.data.mayCount.length})</summary>
                          <ul class="cands">
                            {#each r.data.mayCount as m (m.code)}
                              <li>
                                <a class="row-link" href={`/course/${m.code}`}>
                                  <span class="l1"><b>{m.code}</b> <span class="title">{m.title}</span></span>
                                  {#if m.eligibility === 'check'}<small>Check prerequisites on BOSS</small>{/if}
                                </a>
                              </li>
                            {/each}
                          </ul>
                        </details>
                      {/if}
                    {/if}
                  {/if}
                </div>
              {/each}
            </section>
          {/each}

          {#if derived.nonCourse.length}
            <p class="small">Not course-based: {[...new Set(derived.nonCourse.map((n) => n.name))].join(', ')}</p>
          {/if}

          {#if derived.finished.length}
            <details class="fin">
              <summary>Done ({derived.finished.length})</summary>
              <ul class="plain">
                {#each derived.finished as b (keyOf(b))}
                  <li>{b.name}{b.doneCodes.length ? ` · ${b.doneCodes.join(', ')}` : ''}</li>
                {/each}
              </ul>
            </details>
          {/if}

          <p class="small foot">Not an official degree audit. Check your requirements on OASIS.</p>
        {/if}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .wrap { display: grid; gap: var(--s4); min-width: 0; }
  .note, .small { margin: 0; color: var(--muted); font-size: var(--fs-xs); }
  .note { font-size: var(--fs-sm); }
  .err { color: var(--danger); }
  .foot { padding-top: var(--s2); border-top: 1px solid var(--rule); }
  label, .lbl { display: grid; gap: var(--s1); font-size: var(--fs-sm); font-weight: 600; min-width: 0; }
  .fields { display: grid; gap: var(--s3); grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 560px) { .fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  select.field { font-weight: 400; text-overflow: ellipsis; }
  select:disabled { color: var(--muted); background-color: var(--bg); }

  .done-box { display: grid; gap: var(--s2); }
  .pickbox { position: relative; }
  .matches { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); overflow: hidden; }
  .matches li + li { border-top: 1px solid var(--rule); }
  .matches button { display: flex; gap: var(--s2); width: 100%; min-height: 48px; align-items: center; padding: 0 var(--s3); background: none; border: 0; color: var(--text); font: inherit; font-size: var(--fs-sm); text-align: left; cursor: pointer; }
  .matches button:hover, .matches button:focus-visible { background: var(--accent-soft); }
  .matches b { font-weight: 600; flex: none; }
  .matches span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .picks { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .pick-chip { display: inline-flex; align-items: center; gap: var(--s2); min-height: 44px; padding: 0 var(--s3); font: inherit; font-size: var(--fs-sm); color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent); border-radius: var(--r-md); cursor: pointer; }
  .pick-chip span { font-size: var(--fs-md); line-height: 1; }

  .opts { display: flex; flex-wrap: wrap; gap: var(--s4); align-items: end; }
  .bidbox { display: flex; align-items: center; gap: var(--s2); font-weight: 400; }
  .bidbox .field { width: 7em; }
  .sortbox { display: grid; gap: var(--s1); }

  .warn { margin: 0; padding: var(--s3); font-size: var(--fs-sm); background: var(--surface); border-left: 3px solid var(--rule-strong); border-radius: var(--r-sm); }
  .warn.risk { border-left-color: var(--danger); }
  .grp { display: grid; gap: var(--s3); }
  h3 { font-size: var(--fs-md); font-weight: 600; padding-top: var(--s3); border-top: 1px solid var(--rule); }
  h3.view { font-size: var(--fs-lg); font-weight: 600; padding-top: var(--s4); border-top: 2px solid var(--rule-strong); }
  h3.sub { font-size: var(--fs-sm); }
  .block { display: grid; gap: var(--s2); min-width: 0; }
  .bh { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 var(--s3); }
  h4 { font-size: var(--fs-sm); font-weight: 600; }
  .left { font-size: var(--fs-xs); color: var(--muted); }
  .plain { display: grid; gap: var(--s1); font-size: var(--fs-sm); }
  .cands { display: block; }
  .cands > li:first-child .row-link { border-top: 1px solid var(--rule); }
  .row-link { display: grid; gap: var(--s1); font-size: var(--fs-sm); min-width: 0; }
  .l1 { overflow-wrap: anywhere; }
  .l1 b { font-weight: 600; }
  .stats { display: flex; flex-wrap: wrap; gap: 0 var(--s4); }
  .stats i { font-style: normal; font-size: var(--fs-xs); color: var(--muted); margin-right: var(--s1); }
  .l3 { color: var(--muted); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .row-link small { font-size: var(--fs-xs); color: var(--muted); }
  .more { justify-self: start; }
  summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
  details ul { margin-top: var(--s1); }
</style>
