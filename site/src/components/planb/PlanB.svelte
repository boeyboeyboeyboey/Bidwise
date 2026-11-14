<svelte:options css="injected" />
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { candidates, deriveBlocks, findDegree, pickViews, withoutCoveredDegree } from '../../lib/gradreq';
  import type { Block, GradIndex, GradView, LoadedView, OfferedCourse, Requisites } from '../../lib/gradreq';
  import { fetchIndex } from '../../lib/data/client';
  import type { CourseIndexEntry } from '../../lib/data/types';
  import { liveWindow } from '../../lib/data/window';
  import { getChosenWindow } from '../../lib/state';
  import { pct } from '../course/fmt';
  import SectionRow from './SectionRow.svelte';
  import {
    LEGACY_STORE_KEY, STORE_KEY, groupBlocks, intakesFor, isTrackBlock, leftText as blockLeftText, majorOptions, parseSaved, secondOptions,
    toSelection, trackOptions,
  } from './degree';
  import {
    ALL_TAB, MIN_BID_CENTS, OTHER_TAB, TARGETS, affordableRows, blockCodes, blockTabs, capTooLow, chunk, dedupeBlocks, effectiveRequisites, eText,
    moneyText, noFinalOnly, otherRows, parseMoney, prunedCourses, pseudoBlock, reserveCap, resolveTab, tabKeyTarget, withNotes,
    type CoursesNeeded, type PlanRow,
  } from './logic';

  let { builtWindow }: { builtWindow: string } = $props();

  const TOP_PER_BLOCK = 5;
  const TOP_LIST = 30;

  // ------------------------------------------------------------ inputs, saved on this device
  function readStore(): string | null {
    try {
      return localStorage.getItem(STORE_KEY) ?? localStorage.getItem(LEGACY_STORE_KEY);
    } catch {
      return null;
    }
  }
  const saved = parseSaved(readStore());

  let leftText = $state(saved.left);
  let courses = $state<CoursesNeeded>(saved.courses);
  let target = $state<number>(saved.target);

  let school = $state(saved.school);
  let degree = $state(saved.degree);
  let intake = $state(saved.intake);
  let major = $state(saved.major);
  let track = $state(saved.track);
  let second = $state(saved.second);
  let completed = $state<string[]>(saved.completed);

  $effect(() => {
    const text = JSON.stringify({ school, degree, intake, major, track, second, completed: [...completed], left: leftText, courses, target });
    try {
      localStorage.setItem(STORE_KEY, text);
    } catch {
      /* storage unavailable: nothing is kept, the page still works */
    }
  });

  const leftBlank = $derived(leftText.trim() === '');
  const leftCents = $derived(parseMoney(leftText));
  /** The most one course may cost; null = no limit (e$ left is blank). */
  const capCents = $derived(reserveCap(leftCents, courses));
  const leftBad = $derived(!leftBlank && leftCents === null);
  const tooLittle = $derived(!leftBad && capTooLow(capCents));
  const error = $derived(
    leftBad ? 'Enter an amount in e$, for example 60 or 42.50.'
    : tooLittle ? `${eText(leftCents as number)} isn't enough for ${courses} ${courses === 1 ? 'course' : 'courses'} at the ${eText(MIN_BID_CENTS)} minimum bid.`
    : null,
  );

  // Results stay hidden until "Show courses" is pressed; after that they follow the inputs.
  let shown = $state(false);
  /** Keep only sections with no final exam listed. Not saved with the other inputs. */
  let noFinal = $state(false);
  let resultsEl = $state<HTMLElement | null>(null);
  async function showCourses() {
    shown = true;
    await tick();
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!resultsEl) return;
    // Clear the sticky header at its real height (it wraps to two rows on narrow phones).
    const head = document.querySelector<HTMLElement>('header.top');
    const sticky = head && ['sticky', 'fixed'].includes(getComputedStyle(head).position);
    const offset = (sticky ? head.getBoundingClientRect().bottom : 0) + 16;
    window.scrollTo({ top: window.scrollY + resultsEl.getBoundingClientRect().top - offset, behavior: still ? 'auto' : 'smooth' });
  }

  // ------------------------------------------------------------ the programme
  let index = $state.raw<GradIndex | null>(null);
  let indexFailed = $state(false);
  let allCourses = $state.raw<CourseIndexEntry[]>([]);
  onMount(() => {
    fetch('/data/gradreq/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<GradIndex>) : Promise.reject(new Error(String(r.status)))))
      .then((i) => {
        index = i;
        reconcile();
      }, () => (indexFailed = true));
    fetchIndex().then((i) => (allCourses = i), () => { /* the picker then offers only the programme's own courses */ });
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

  // ------------------------------------------------------------ sections to price
  let offered = $state.raw<OfferedCourse[] | null>(null);
  let offeredFailed = $state(false);
  onMount(() => {
    fetch('/data/planb.json')
      .then((r) => (r.ok ? (r.json() as Promise<OfferedCourse[]>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => (offered = d), () => (offeredFailed = true));
  });

  const derived = $derived(loaded ? deriveBlocks(loaded.views, loaded.intake, completed) : null);
  const groups = $derived(derived ? groupBlocks(derived.open, viewLabel) : []);
  const multiView = $derived(new Set(groups.map((g) => g.blocks[0].viewId)).size > 1);
  const degreeActive = $derived(!!pick);
  const listBlocks = $derived((derived?.open ?? []).filter((b) => b.kind === 'list' && b.members.length + b.hints.length > 0));

  /** All affordable sections, then per open requirement block. null until priced. */
  let allRows = $state.raw<PlanRow[] | null>(null);
  let blockRows = $state.raw<Record<string, PlanRow[]>>({});
  let progress = $state(0);
  let priceFailed = $state(false);
  let runTok = 0;
  const keyOf = (b: Pick<Block, 'viewId' | 'id'>) => `${b.viewId}\u0000${b.id}`;
  /** Bid the chance is measured at when there is no limit; rows use the recommended bid, so it does not change them. */
  const MAX_SIM_BID = 1_000_000;
  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

  async function price(tok: number, data: readonly OfferedCourse[], budget: number | null, chance: number, done: string[], blocks: Block[], onlyNoFinal: boolean) {
    let allReqs: Requisites;
    try {
      allReqs = await fetchRequisites();
    } catch {
      if (tok === runTok) priceFailed = true;
      return;
    }
    // Nothing marked done: hide nothing for prerequisites (rows carry a tag instead). Otherwise unmet ones are hidden.
    const hasDone = done.length > 0;
    const reqs = effectiveRequisites(allReqs, hasDone);
    const liveW = liveWindow();
    const opts = { window: liveW ? `Round ${liveW.round} Window ${liveW.window}` : builtWindow, chosenWindow: getChosenWindow(), bid: budget ?? MAX_SIM_BID, target: chance, sort: 'cheapest' as const };
    const pruned = prunedCourses(noFinalOnly(data, onlyNoFinal), budget);
    const byCode = new Map(pruned.map((c) => [c.code, c]));
    // Chunks of courses, so the page stays responsive; every simulation is cached for the requirement blocks below.
    const parts = chunk(pruned, 4);
    const cands = [];
    for (let i = 0; i < parts.length; i++) {
      if (tok !== runTok) return;
      cands.push(...candidates(pseudoBlock(parts[i]), byCode, done, reqs, opts).candidates);
      progress = (i + 1) / parts.length;
      await yieldToUi();
    }
    if (tok !== runTok) return;
    const rows = withNotes(affordableRows(cands, budget), allReqs, hasDone);
    const perBlock: Record<string, PlanRow[]> = {};
    for (const b of blocks) {
      if (tok !== runTok) return;
      perBlock[keyOf(b)] = withNotes(affordableRows(candidates(b, byCode, done, reqs, opts).candidates, budget), allReqs, hasDone);
      await yieldToUi();
    }
    if (tok !== runTok) return;
    blockRows = perBlock;
    allRows = rows;
  }

  $effect(() => {
    const ready = shown && error === null;
    const budget = capCents;
    const chance = target;
    const data = offered;
    const done = [...completed];
    const blocks = listBlocks;
    const onlyNoFinal = noFinal;
    const waiting = degreeActive && !loaded;
    const tok = ++runTok;
    priceFailed = false;
    allRows = null;
    blockRows = {};
    progress = 0;
    if (!ready || !data || waiting) return;
    untrack(() => {
      price(tok, data, budget, chance, done, blocks, onlyNoFinal);
    });
  });

  let expanded = $state<Record<string, boolean>>({});
  const toggle = (k: string) => (expanded = { ...expanded, [k]: !expanded[k] });

  /** Each course once, in the first block (in display order) that has it. */
  const deduped = $derived(dedupeBlocks(groups.flatMap((g) => g.blocks).map((b) => ({ key: keyOf(b), rows: blockRows[keyOf(b)] ?? [] }))));
  const chanceText = $derived(pct(target));
  const otherList = $derived(allRows && derived ? otherRows(allRows, blockCodes(listBlocks)) : []);
  const noneText = $derived(
    leftCents === null || capCents === null
      ? `No open sections at ${chanceText}.`
      : `Nothing fits ${eText(leftCents)} left for ${courses} ${courses === 1 ? 'course' : 'courses'} (up to ${eText(capCents)} each) at ${chanceText}.`,
  );
  const noneAdvice = $derived((capCents === null ? '' : ' Try a lower chance or fewer courses.') + (noFinal ? ' Or untick the final exam filter.' : ''));

  // Requirement tabs: only with a degree. A block tab lists every section of that block (no dedupe), cheapest first.
  const tabBlocks = $derived(groups.flatMap((g) => g.blocks.map((b) => ({ b, heading: g.label }))).filter((x) => listBlocks.includes(x.b)));
  const tabs = $derived(
    derived ? blockTabs(tabBlocks.map(({ b, heading }) => ({ key: keyOf(b), name: b.name, heading, count: (blockRows[keyOf(b)] ?? []).length })), otherList.length) : [],
  );
  let selectedTab = $state(ALL_TAB);
  const tab = $derived(resolveTab(tabs, selectedTab));
  const tabBlock = $derived(tabBlocks.find((x) => keyOf(x.b) === tab)?.b ?? null);
  let tablistEl = $state<HTMLElement | null>(null);
  async function onTabKey(e: KeyboardEvent, i: number) {
    const to = tabKeyTarget(e.key, i, tabs.length);
    if (to === null) return;
    e.preventDefault();
    selectedTab = tabs[to].id;
    await tick();
    const el = tablistEl?.querySelectorAll<HTMLElement>('[role="tab"]')[to];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const needText = (needs: 'major-or-track' | 'second-major-list') =>
    needs === 'second-major-list' ? 'We don\'t have this list yet. Check your degree requirements on OASIS.' : majors.length === 0 && tracks.length > 0 ? 'Pick a track to see this.' : 'Pick a major to see this.';
  const noQuantityTrack = (b: Block) => (loaded ? isTrackBlock(b, loaded.views) : false);
</script>

{#snippet blockHead(b: Block)}
  <div class="bh"><h4>{b.name}</h4>{#if blockLeftText(b)}<span class="num left">{blockLeftText(b)}</span>{/if}</div>
  {#if noQuantityTrack(b)}<p class="small">All from one track</p>{/if}
  {#if b.unnamed.length}
    <ul class="plain">{#each b.unnamed as t (t)}<li>Find on BOSS: {t}</li>{/each}</ul>
  {:else if b.listMissing}
    <p class="small">We don't have this list yet. Check your degree requirements on OASIS.</p>
  {/if}
{/snippet}

<div class="wrap">
  <section class="step" aria-labelledby="pb-s1">
    <h2 id="pb-s1">1. Budget</h2>
    <div class="inputs">
      <label>e$ left (optional)
        <input class="field num" type="text" inputmode="decimal" autocomplete="off" aria-invalid={leftBad || tooLittle} aria-describedby={error ? 'pb-err' : undefined} placeholder="e.g. 60"
          value={leftText} oninput={(e) => (leftText = e.currentTarget.value)} />
      </label>

      <div class="grp" role="group" aria-label="Courses still needed">
        <span class="lbl">Courses still needed</span>
        <div class="seg count">
          {#each [1, 2, 3] as n (n)}
            <button type="button" class="num" aria-pressed={courses === n} onclick={() => (courses = n as CoursesNeeded)}>{n}</button>
          {/each}
        </div>
      </div>

      <div class="aimrow" role="group" aria-label="Chance you want">
        <span class="lbl aimlab" aria-hidden="true">Chance you want:</span>
        <div class="seg aim">
          {#each TARGETS as t (t)}
            <button type="button" class="num" aria-pressed={target === t} onclick={() => (target = t)}>{pct(t)}</button>
          {/each}
        </div>
      </div>
    </div>
    {#if error}<p id="pb-err" class="small err" role="alert">{error}</p>{/if}
  </section>

  <section class="step" aria-labelledby="pb-s2">
    <h2 id="pb-s2">2. Your degree</h2>
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
    {/if}
  </section>

  <section class="step done-box" aria-labelledby="pb-s3">
    <h2 id="pb-s3">3. Courses already done (optional)</h2>
    <label class="sr" for="done-q">Search courses already done</label>
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
  </section>

  <button type="button" class="btn btn-primary show" disabled={error !== null} onclick={showCourses}>Show courses</button>

  <!-- ------------------------------------------------------------ results -->
  {#if shown && error === null}
    <div class="results" class:pending={!allRows || (degreeActive && !derived)} bind:this={resultsEl}>
      <label class="chk"><input type="checkbox" checked={noFinal} onchange={() => (noFinal = !noFinal)} /><span>No final exam listed</span></label>
      {#if offeredFailed || viewsFailed || priceFailed}
        <p class="note">Could not load the data. Reload the page to try again.</p>
      {:else if !allRows || (degreeActive && !derived)}
        <p class="note num">Loading… {Math.round(progress * 100)}%</p>
      {:else if allRows.length === 0}
        <p class="note">{noneText}{noneAdvice}</p>
      {:else}
        {#if completed.length === 0}<p class="small">Add courses you've done to hide ones you can't take yet.</p>{/if}

        {#if !derived}
          <section class="grp-list">
            <h3>Courses you can afford</h3>
            <ul class="cands">
              {#each expanded.all ? allRows : allRows.slice(0, TOP_LIST) as r (r.section.classNumber)}
                <li><SectionRow row={r} chance={chanceText} /></li>
              {/each}
            </ul>
            {#if allRows.length > TOP_LIST}
              <button type="button" class="btn more" aria-expanded={!!expanded.all} onclick={() => toggle('all')}>{expanded.all ? `Show first ${TOP_LIST}` : `Show all ${allRows.length}`}</button>
            {/if}
          </section>
        {:else}
          <div class="tabs" role="tablist" aria-label="Requirements" bind:this={tablistEl}>
            {#each tabs as t, i (t.id)}
              <button type="button" role="tab" id={`pb-tab-${i}`} aria-selected={tab === t.id} aria-controls="pb-panel" tabindex={tab === t.id ? 0 : -1}
                onclick={() => (selectedTab = t.id)} onkeydown={(e) => onTabKey(e, i)}>{t.label}{#if t.count >= 0}&nbsp;<span class="num">({t.count})</span>{/if}</button>
            {/each}
          </div>

          <div class="panel" role="tabpanel" id="pb-panel" aria-labelledby={`pb-tab-${Math.max(0, tabs.findIndex((t) => t.id === tab))}`}>
            {#if tab === ALL_TAB}
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
                <section class="grp-list">
                  {#if !multiView || g.blocks[0].headings.length}<h3 class:sub={multiView}>{g.label}</h3>{/if}
                  {#each g.blocks as b (keyOf(b))}
                    {@const k = keyOf(b)}
                    {@const rows = deduped.get(k)?.rows ?? []}
                    {@const also = deduped.get(k)?.also ?? []}
                    <div class="block">
                      {@render blockHead(b)}
                      {#if b.kind === 'list' && b.members.length + b.hints.length > 0}
                        {#if rows.length === 0 && also.length === 0}
                          <p class="small">{noneText}</p>
                        {/if}
                        {#if rows.length > 0}
                          <ul class="cands">
                            {#each expanded[k] ? rows : rows.slice(0, TOP_PER_BLOCK) as r (r.section.classNumber)}
                              <li><SectionRow row={r} chance={chanceText} /></li>
                            {/each}
                          </ul>
                          {#if rows.length > TOP_PER_BLOCK}
                            <button type="button" class="btn more" aria-expanded={!!expanded[k]} onclick={() => toggle(k)}>{expanded[k] ? `Show top ${TOP_PER_BLOCK}` : `Show all ${rows.length}`}</button>
                          {/if}
                        {/if}
                        {#if also.length}<p class="small">Also counts: {also.join(', ')}</p>{/if}
                      {/if}
                    </div>
                  {/each}
                </section>
              {/each}

              {#if otherList.length}
                <section class="grp-list">
                  <h3>Other courses (free electives)</h3>
                  <ul class="cands">
                    {#each expanded.other ? otherList : otherList.slice(0, TOP_LIST) as r (r.section.classNumber)}
                      <li><SectionRow row={r} chance={chanceText} /></li>
                    {/each}
                  </ul>
                  {#if otherList.length > TOP_LIST}
                    <button type="button" class="btn more" aria-expanded={!!expanded.other} onclick={() => toggle('other')}>{expanded.other ? `Show first ${TOP_LIST}` : `Show all ${otherList.length}`}</button>
                  {/if}
                </section>
              {/if}

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
            {:else if tab === OTHER_TAB}
              <ul class="cands">
                {#each otherList as r (r.section.classNumber)}
                  <li><SectionRow row={r} chance={chanceText} /></li>
                {/each}
              </ul>
            {:else if tabBlock}
              {@const rows = blockRows[tab] ?? []}
              <div class="block">
                {@render blockHead(tabBlock)}
                {#if rows.length === 0}
                  <p class="small">{noneText}</p>
                {:else}
                  <ul class="cands">
                    {#each rows as r (r.section.classNumber)}
                      <li><SectionRow row={r} chance={chanceText} /></li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <p class="small foot">Not an official degree audit. Check your requirements on OASIS.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s5); min-width: 0; }
  .step { display: grid; gap: var(--s3); min-width: 0; }
  .step h2 { font-size: var(--fs-lg); font-weight: 600; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .show { justify-self: start; }
  .results { display: grid; gap: var(--s4); min-width: 0; }
  /* While pricing, keep the page tall enough that scrolling to the results can bring them to the top. */
  .results.pending { min-height: 80vh; align-content: start; }
  .chk {
    display: flex; align-items: center; gap: var(--s2); min-height: 44px; padding: 0 var(--s3); font-size: var(--fs-sm); cursor: pointer; justify-self: start; max-width: 100%;
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md);
  }
  .chk:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
  .chk:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
  .chk input { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); flex: none; }
  .panel { display: grid; gap: var(--s4); min-width: 0; }
  .tabs { display: flex; gap: var(--s1); overflow-x: auto; overscroll-behavior-x: contain; border-bottom: 1px solid var(--rule); min-width: 0; }
  .tabs > button { flex: none; min-height: 44px; padding: 0 var(--s3); white-space: nowrap; font: inherit; font-size: var(--fs-sm); font-weight: 600; color: var(--muted); background: none; border: 0; border-bottom: 3px solid transparent; cursor: pointer; }
  .tabs > button:hover { color: var(--text); background: var(--accent-soft); }
  .tabs > button[aria-selected='true'] { color: var(--text); border-bottom-color: var(--accent); }
  .tabs > button:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
  .note, .small { margin: 0; color: var(--muted); font-size: var(--fs-xs); }
  .note { font-size: var(--fs-sm); }
  .err { color: var(--danger); }
  .foot { padding-top: var(--s2); border-top: 1px solid var(--rule); }
  label, .lbl { display: grid; gap: var(--s1); font-size: var(--fs-sm); font-weight: 600; min-width: 0; }

  .inputs { display: grid; gap: var(--s3); grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 560px) { .inputs { grid-template-columns: repeat(2, minmax(0, 1fr)); } .aimrow { grid-column: 1 / -1; } }
  .grp { display: grid; gap: var(--s1); min-width: 0; }
  .count { display: flex; }
  .count > button { flex: 1 1 0; min-height: 44px; }
  .aimrow { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1) var(--s2); }
  .aimlab { white-space: nowrap; display: inline; }
  .aim { display: flex; flex: 1 1 320px; }
  .aim > button { flex: 1 1 0; min-height: 44px; padding: 0 var(--s2); white-space: nowrap; font-size: var(--fs-sm); }
  /* Selected chance, as on the course page: light tint, green edge, dark text. */
  .seg > button[aria-pressed='true'] { color: var(--text); background: var(--accent-soft); outline: 2px solid var(--accent); outline-offset: -2px; font-weight: 600; }
  .seg > button[aria-pressed='true']:hover { background: var(--accent-soft); }

  .fields { display: grid; gap: var(--s3); grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 560px) { .fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  select.field { font-weight: 400; text-overflow: ellipsis; }
  select:disabled { color: var(--muted); background-color: var(--bg); }

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

  .warn { margin: 0; padding: var(--s3); font-size: var(--fs-sm); background: var(--surface); border-left: 3px solid var(--rule-strong); border-radius: var(--r-sm); }
  .warn.risk { border-left-color: var(--danger); }
  .grp-list { display: grid; gap: var(--s3); }
  h3 { font-size: var(--fs-md); font-weight: 600; padding-top: var(--s3); border-top: 1px solid var(--rule); }
  h3.view { font-size: var(--fs-lg); font-weight: 600; padding-top: var(--s4); border-top: 2px solid var(--rule-strong); }
  h3.sub { font-size: var(--fs-sm); }
  .block { display: grid; gap: var(--s2); min-width: 0; }
  .bh { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 var(--s3); }
  h4 { font-size: var(--fs-sm); font-weight: 600; }
  .left { font-size: var(--fs-xs); color: var(--muted); }
  .plain { display: grid; gap: var(--s1); font-size: var(--fs-sm); }
  .cands { display: block; }
  .cands > li:first-child :global(.row-link) { border-top: 1px solid var(--rule); }
  .more { justify-self: start; }
  summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
  details ul { margin-top: var(--s1); }
</style>
