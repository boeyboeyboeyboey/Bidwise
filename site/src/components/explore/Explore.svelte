<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CourseData, CourseIndexEntry } from '../../lib/data/types';
  import type { SimResult } from '../../lib/sim';
  import { runSim } from '../../lib/sim/client';
  import { cutoffAt, FORECAST_SEED, FORECAST_RUNS, toSimParams } from '../../lib/sim/forecast';
  import { seatsLeftNow } from '../../lib/data/seats';
  import { fetchCourse, fetchIndex } from '../../lib/data/client';
  import { getChosenWindow, onWindowChange } from '../../lib/state';
  import { EXPLORE_FORECAST_ENABLED } from '../../lib/flags';
  import { sortTerms, sortWindows } from '../course/history';
  import { buildRows, sectionsOf, toCsv } from './rows';
  import { bidSummary } from './summary';
  import {
    decode, encodeFull, defaults, METRICS, DIMS, XFIELDS, MARKS,
    type ExploreState, type Metric,
  } from './state';
  import { compute, fmtUnit, DIM_LABEL, X_LABEL, METRIC_META, fcMetrics, type Fc } from './model';
  import { render, palette, ACCENT, type Theme } from './chart';
  import { savePng, download } from './export';
  import Browse from './Browse.svelte';
  import { browseDefaults, decodeBrowse, encodeBrowse, fullWindow, type BrowseState } from './browse';
  import { MODES, type Mode } from './state';

  let { popular = [], windowTerm, windowName, forecastWindows = [] }: {
    /** Windows that have forecasts. */
    forecastWindows?: string[];
    /** Suggestion chips shown before any course is chosen. */
    popular?: { code: string; title: string }[];
    windowTerm: string;
    windowName: string;
  } = $props();

  /** Individual-section lines are capped so the chart stays readable. */
  const MAX_SECTIONS = 6;
  /** Compare mode starts with the busiest few sections; more can be added up to the cap. */
  const DEFAULT_COMPARE = 3;
  const MARK_LABEL = { auto: 'Auto', line: 'Line', dot: 'Dot', bar: 'Bar', area: 'Area', box: 'Box' } as const;

  let st = $state<ExploreState>(defaults());
  let bs = $state<BrowseState>(browseDefaults());
  const MODE_LABEL: Record<Mode, string> = { compare: 'Compare courses', browse: 'Browse all sections', build: 'Build a chart' };
  // The builder (query engine, Plot setup, controls) is fetched only when its tab is first opened.
  let BuilderView = $state.raw<typeof import('./Builder.svelte').default | null>(null);
  $effect(() => {
    if (st.mode === 'build' && !BuilderView) import('./Builder.svelte').then((m) => (BuilderView = m.default));
  });
  let ready = $state(false);
  let query = $state('');
  let width = $state(0);
  let vh = $state(0);
  let host: HTMLDivElement | undefined = $state();
  let svgEl: SVGSVGElement | undefined;
  let advOpen = $state(false);
  let addOpen = $state(false);
  // Forecast overlay: simulated in the worker for the chosen window (the window filter if it has a forecast, else the current one).
  let fcs = $state.raw<Fc[]>([]);
  const fcWindow = $derived(
    forecastWindows.includes(st.w) ? st.w : forecastWindows.includes(windowName) ? windowName : (forecastWindows[0] ?? ''),
  );
  const fcCache = new Map<string, Promise<SimResult>>();
  let fcToken = 0;

  let index = $state<CourseIndexEntry[]>([]);
  let loaded = $state<Record<string, CourseData>>({});
  let loadingN = $state(0);
  let loadFailed = $state(false);

  async function load(code: string) {
    if (loaded[code]) return;
    loadingN++;
    try {
      const d = await fetchCourse(code);
      loaded[code] = d;
      if (st.sel[code] && st.sel[code].length === 0) {
        st.sel[code] = st.color === 'section' ? topSections(d, Math.max(1, Math.min(DEFAULT_COMPARE, MAX_SECTIONS - used(code)))) : sectionsOf(d);
      }
    } catch {
      delete st.sel[code];
      loadFailed = true;
    } finally {
      loadingN--;
    }
  }

  /** Sections with the most bid history first: the ones worth drawing. */
  function topSections(d: CourseData, n: number): string[] {
    const cnt = new Map<string, number>();
    for (const h of d.history) if (h.medianCents !== null) cnt.set(h.section, (cnt.get(h.section) ?? 0) + 1);
    const top = sectionsOf(d).sort((a, b) => (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0)).slice(0, n);
    return sectionsOf(d).filter((x) => top.includes(x));
  }
  /** Sections already chosen in other courses. */
  const used = (except = '') => Object.entries(st.sel).reduce((n, [c, v]) => n + (c === except ? 0 : v.length), 0);

  onMount(() => {
    fetchIndex().then((i) => (index = i), () => {});
    st = decode(location.search);
    bs = decodeBrowse(location.search);
    // No course is preloaded. Unless the link names a window, the chart follows the header's bidding window.
    const follow = (l: string | null) => (st.w = l ?? windowName);
    if (!st.w) follow(getChosenWindow());
    const offWindow = onWindowChange(follow);
    for (const code of Object.keys(st.sel)) load(code);
    ready = true;
    // Divide out the wide-screen zoom so px heights fit the real viewport.
    const realVh = () => innerHeight / (parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
    vh = realVh();
    const onRs = () => (vh = realVh());
    addEventListener('resize', onRs);
    return () => { removeEventListener('resize', onRs); offWindow(); };
  });

  // Observe the chart host once it is bound (onMount can run before the bind).
  $effect(() => {
    if (!host) return;
    // Read the width straight away, so the first draw never waits on a frame callback (frames are paused in background tabs and hidden panes).
    width = host.clientWidth; // layout px, like contentRect (getBoundingClientRect is scaled by the page zoom)
    // Later changes are applied after the callback returns, on a timer: redrawing inside it resizes the host again and trips "ResizeObserver loop completed".
    let timer = 0;
    const ro = new ResizeObserver((e) => {
      const w = Math.floor(e[0].contentRect.width);
      clearTimeout(timer);
      timer = window.setTimeout(() => { if (w !== width) width = w; }, 0);
    });
    ro.observe(host);
    return () => { clearTimeout(timer); ro.disconnect(); };
  });

  const allSections = $derived(Object.fromEntries(Object.values(loaded).map((d) => [d.code, sectionsOf(d)])));
  // Before any course is chosen the chart shows the first popular course as an example. Choosing or searching replaces it.
  const exampleCode = $derived(Object.keys(st.sel).length === 0 ? (popular[0]?.code ?? '') : '');
  const view = $derived<ExploreState>(
    exampleCode && loaded[exampleCode] ? { ...st, sel: { [exampleCode]: sectionsOf(loaded[exampleCode]) }, color: 'course', fc: false } : st,
  );
  $effect(() => {
    if (ready && exampleCode && st.mode === 'compare') untrack(() => load(exampleCode));
  });
  const allRows = $derived(buildRows(Object.keys(view.sel).map((c) => loaded[c]).filter((d): d is CourseData => !!d)));
  const terms = $derived(sortTerms(allRows.map((r) => r.term)));
  const windows = $derived(sortWindows([...new Set([...allRows.map((r) => r.window), ...(st.w ? [st.w] : [])])]));

  // URL sync
  $effect(() => {
    if (!ready || st.mode === 'build') return; // the Build tab keeps its own address
    // With no course chosen there is nothing to share, so keep the address clean. Browse always names its mode.
    const q = st.mode === 'browse' ? encodeBrowse(bs) : Object.keys(st.sel).length ? encodeFull(st, allSections) : '';
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
  });

  const codes = $derived(Object.keys(st.sel));
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const qf = norm(q);
    if (!qf) return [];
    return index
      .filter((c) => !st.sel[c.code] && (norm(c.code).includes(qf) || c.title.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.offeredNow) - Number(a.offeredNow) || Number(norm(b.code).startsWith(qf)) - Number(norm(a.code).startsWith(qf)))
      .slice(0, 6);
  });

  function addCourse(code: string) {
    if (st.sel[code]) return;
    if (EXPLORE_FORECAST_ENABLED && Object.keys(st.sel).length === 0) st.fc = true;
    st.sel[code] = [];
    load(code);
    query = '';
  }
  function removeCourse(code: string) {
    delete st.sel[code];
  }
  const split = $derived(st.color === 'section');
  const multiSec = $derived(codes.some((c) => (allSections[c]?.length ?? 0) > 1));
  const nSel = $derived(Object.values(st.sel).reduce((n, v) => n + v.length, 0));
  function toggleSection(code: string, sec: string) {
    const cur = st.sel[code];
    if (cur.includes(sec)) st.sel[code] = cur.length > 1 ? cur.filter((s) => s !== sec) : cur;
    else if (nSel < MAX_SECTIONS) st.sel[code] = [...cur, sec];
  }
  function setSplit(on: boolean) {
    if (on === split) return;
    const cs = Object.keys(st.sel).filter((c) => loaded[c]);
    const per = Math.max(1, Math.min(DEFAULT_COMPARE, Math.floor(MAX_SECTIONS / Math.max(1, cs.length))));
    for (const c of cs) st.sel[c] = on ? topSections(loaded[c], per) : sectionsOf(loaded[c]);
    st.color = on ? 'section' : 'course';
  }
  function setMetric(m: Metric) {
    st.metric = m;
    st.layers = st.layers.filter((l) => l !== m);
  }
  function reset() {
    st = { ...defaults(), sel: st.sel };
  }
  const sections = $derived(Object.keys(st.sel).map((code) => ({ code, all: allSections[code] ?? null })));
  const fcOk = $derived(fcMetrics.includes(st.metric) || st.layers.some((l) => fcMetrics.includes(l)));

  $effect(() => {
    const win = fcWindow;
    const on = EXPLORE_FORECAST_ENABLED && st.fc;
    const sel = $state.snapshot(st.sel);
    const my = ++fcToken;
    if (!on || !win) { fcs = []; return; }
    const jobs: Promise<Fc>[] = [];
    for (const code of Object.keys(sel)) {
      for (const s of loaded[code]?.sectionsNow ?? []) {
        const f = s.forecast?.[win];
        // no forecast, no min bid or no seats: nothing to simulate
        if (!sel[code].includes(s.section) || !f || s.minBidCents == null || seatsLeftNow(s) <= 0) continue;
        const key = `${s.classNumber}|${win}`;
        let p = fcCache.get(key);
        if (!p) {
          p = runSim({ seats: seatsLeftNow(s), group: 1, minBidCents: s.minBidCents, params: toSimParams(f), runs: FORECAST_RUNS, seed: FORECAST_SEED });
          fcCache.set(key, p);
        }
        const m = s.meetings[0];
        jobs.push(p.then((r) => ({
          course: code, section: s.section, instructor: s.instructor, day: m?.day ?? '', start: m?.start ?? '',
          p10E: cutoffAt(r, 0.1) / 100, p50E: r.percentilesCents.p50 / 100, p90E: r.percentilesCents.p90 / 100, pFillPct: r.pFill * 100,
        })));
      }
    }
    Promise.all(jobs).then((r) => { if (my === fcToken) fcs = r; });
  });

  const plotted = $derived(compute(view, allRows, fcs, windowTerm, fcWindow || windowName));
  const empty = $derived(codes.length === 0);
  const summaryLines = $derived(bidSummary(allRows, Object.keys(view.sel).filter((c) => loaded[c])));
  // True when there is nothing at all to draw: no course chosen and no example course either.
  const noChart = $derived(empty && !exampleCode);
  const exampleWaiting = $derived(!!exampleCode && !loaded[exampleCode] && !loadFailed);
  const nothing = $derived(!noChart && !exampleWaiting && plotted.rows.length === 0 && loadingN === 0);
  const dual = $derived(!!plotted.secondary);
  const flat = $derived.by(() => {
    const r = plotted.rows;
    if (!r.length) return null;
    const v = r[0].y;
    return r.every((x) => x.y === v) ? `${METRIC_META[r[0].layer].label} was ${fmtUnit(r[0].unit, v)} in every ${X_LABEL[st.x].toLowerCase()} shown` : null;
  });
  const swatches = $derived(palette());

  function theme(): Theme {
    const cs = getComputedStyle(document.documentElement);
    const g = (n: string) => cs.getPropertyValue(n).trim();
    return { text: g('--text'), muted: g('--muted'), border: g('--rule'), surface: g('--surface'), font: g('--font') || 'system-ui, sans-serif' };
  }

  /** Desktop: the plot takes whatever is left of the viewport below it (the table button, footer and page padding reserved, so the whole page fits one screen), so the values are visible without scrolling. */
  function fillHeight(): number {
    if (!host) return 360;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const top = (host.getBoundingClientRect().top + scrollY) / zoom;
    return Math.round(Math.max(300, Math.min(680, vh - top - 165)));
  }

  $effect(() => {
    const p = plotted; const s = $state.snapshot(view); const w = width; const h = innerWidth >= 1024 ? fillHeight() : 290; void vh;
    if (!host || !w || noChart || nothing || flat) { svgEl = undefined; host?.replaceChildren(); return; }
    try {
      svgEl = render(p, s, theme(), w, h);
      describe(svgEl, p);
      host.replaceChildren(svgEl);
    } catch (err) {
      console.error('explore render', err);
      svgEl = undefined;
      host.replaceChildren();
    }
  });

  /** Accessible name and short description for the chart: which course(s), which metric, and the latest value. */
  function describe(svg: SVGSVGElement, p: typeof plotted) {
    const val = (u: 'e$' | 'seats' | '%', v: number) => (u === 'e$' ? `e$${fmtUnit(u, v)}` : u === 'seats' ? `${fmtUnit(u, v)} seats` : fmtUnit(u, v));
    const courses = Object.keys(view.sel).join(', ');
    const metric = METRIC_META[p.layers[0]].label;
    const mine = p.rows.filter((r) => r.layer === p.layers[0]);
    const lastX = p.xs.filter((x) => mine.some((r) => r.x === x)).at(-1);
    const last = mine.filter((r) => r.x === lastX);
    const latest = last.length === 1 ? `Latest (${lastX}): ${val(last[0].unit, last[0].y)}.`
      : last.length ? `Latest (${lastX}): ${last.map((r) => `${r.series} ${val(r.unit, r.y)}`).join(', ')}.` : '';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${metric} by ${X_LABEL[st.x].toLowerCase()} for ${courses || 'selected courses'}`);
    const desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
    desc.id = 'plot-desc';
    desc.textContent = `${p.series.length} ${p.series.length === 1 ? 'line' : 'lines'}. ${latest}${p.fc.length ? ' A forecast point is marked for the open window.' : ''}`.trim();
    svg.prepend(desc);
    svg.setAttribute('aria-describedby', 'plot-desc');
  }

  /** The plotted values as a table (the screen-reader alternative to the chart): one row per x value, one column per line. */
  const tbl = $derived.by(() => {
    if (!plotted.rows.length) return null;
    const cols: { key: string; head: string }[] = [];
    const cells = new Map<string, string>();
    const colOf = (facet: string, series: string, layer: Metric) => {
      const key = `${facet}|${series}|${layer}`;
      if (!cols.some((c) => c.key === key)) {
        const m = METRIC_META[layer];
        cols.push({ key, head: `${[facet, series].filter((x) => x && x !== m.label).join(' · ')} ${m.label} (${m.unit})`.trim() });
      }
      return key;
    };
    for (const r of plotted.rows) cells.set(`${r.x}|${colOf(r.facet, r.series, r.layer)}`, fmtUnit(r.unit, r.y));
    for (const r of plotted.fc) {
      const u = METRIC_META[r.layer].unit;
      cells.set(`${r.x}|${colOf(r.facet, r.series, r.layer)}`, `${fmtUnit(u, r.p50)} forecast${r.hi > r.lo ? ` (${fmtUnit(u, r.lo)} to ${fmtUnit(u, r.hi)})` : ''}`);
    }
    return {
      xhead: X_LABEL[st.x],
      cols,
      rows: plotted.xs.map((x) => ({ x, vals: cols.map((c) => cells.get(`${x}|${c.key}`) ?? '–') })),
    };
  });
  let showTable = $state(false);

  function toggleCourse(code: string) {
    if (st.sel[code]) removeCourse(code);
    else addCourse(code);
  }

  const baseName = $derived(
    `boss-${codes.length > 2 ? 'multi' : codes.join('+') || 'chart'}-${st.metric === 'pfill' ? 'pfill' : st.metric}`,
  );

  function csvPlotted() {
    const data = [
      ...plotted.rows.map((r) => ({ series: r.series, facet: r.facet, metric: METRIC_META[r.layer].label, unit: r.unit, x: r.x, value: Math.round(r.y * 100) / 100, rows: r.n })),
      ...plotted.fc.map((r) => ({ series: r.series, facet: r.facet, metric: `${METRIC_META[r.layer].label} forecast p50`, unit: METRIC_META[r.layer].unit, x: r.x, value: Math.round(r.p50 * 100) / 100, rows: '' })),
    ];
    return toCsv(['series', 'facet', 'metric', 'unit', 'x', 'value', 'rows'], data);
  }
  function downloadCsv() {
    download(new Blob([csvPlotted()], { type: 'text/csv' }), `${baseName}.csv`);
  }
  function downloadImage() {
    if (svgEl) savePng(svgEl, theme(), `${baseName}.png`);
  }
  // Start at 0 is already in force for bars, areas and non-e$ metrics, and meaningless on a log axis.
  const zeroForced = $derived(plotted.mark === 'bar' || plotted.mark === 'area' || plotted.primary !== 'e$');
  const addable = $derived(METRICS.filter((m) => m !== st.metric && !st.layers.includes(m)));
</script>

{#snippet adder()}
    <input
      id="course-search"
      class="field"
      type="search"
      placeholder="Course code or title, e.g. ACCT101"
      autocomplete="off"
      bind:value={query}
      onkeydown={(e) => { if (e.key === 'Enter' && matches[0]) addCourse(matches[0].code); }}
    />
    {#if matches.length}
      <ul class="hits" role="listbox" aria-label="Courses">
        {#each matches as m}
          <li role="option" aria-selected="false">
            <button type="button" onclick={() => addCourse(m.code)}><b>{m.code}</b> <span>{m.title}</span></button>
          </li>
        {/each}
      </ul>
    {/if}
{/snippet}

<h1>Past bids</h1>
<div class="modes seg" role="group" aria-label="View">
  {#each MODES as m}
    <button type="button" aria-pressed={st.mode === m} onclick={() => (st.mode = m)}>{MODE_LABEL[m]}</button>
  {/each}
</div>

{#if st.mode === 'build'}
  {#if BuilderView}<BuilderView />{:else}<p class="empty" role="status">Loading…</p>{/if}
{:else if st.mode === 'browse'}
  <Browse bind:bs {index} />
{:else}
<div class="ex">
  <div class="find">
    <label class="findl" for="course-search">Search a course to see its past bids</label>
    <div class="add">{@render adder()}</div>
    {#if popular.length}
    <div class="pops">
      <span class="pophead" id="pop-h">Popular courses:</span>
      <ul class="chips" aria-labelledby="pop-h">
        {#each popular as p}
          <li><button type="button" class="chip" aria-pressed={!!st.sel[p.code]} title={p.title} onclick={() => toggleCourse(p.code)}>{p.code}</button></li>
        {/each}
      </ul>
    </div>
    {/if}
  </div>

  <div class="status">
    {#if empty}
      {#if exampleCode}<p class="exlabel"><span class="tag">Example</span> Showing an example: <b>{exampleCode}</b>. Search to see yours.</p>{/if}
    {:else}
    <ul class="courses" aria-label="Chosen courses">
      {#each sections as c (c.code)}
        <li class="course">
          <span class="ccode">{c.code}</span>
          {#if !c.all}
            <span class="load">Loading</span>
          {/if}
          <button type="button" class="btn btn-icon" aria-label={`Remove ${c.code}`} onclick={() => removeCourse(c.code)}>×</button>
          {#if split && c.all}
            <div class="pills" role="group" aria-label={`${c.code} sections`}>
              {#each c.all as sec}
                <button type="button" class="pill num" aria-pressed={st.sel[c.code].includes(sec)} disabled={!st.sel[c.code].includes(sec) && nSel >= MAX_SECTIONS} onclick={() => toggleSection(c.code, sec)}>{sec}</button>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {/if}
  </div>

  {#if !noChart}
  <div class="metricwrap">
    <div class="seg metric" role="group" aria-label="Metric">
      {#each METRICS as m}
        <button type="button" aria-pressed={st.metric === m} onclick={() => setMetric(m)}>{METRIC_META[m].label}</button>
      {/each}
    </div>
  </div>
  {/if}

  {#if summaryLines.length > 0}
    <div class="sum" aria-label="Past bids summary">
      {#each summaryLines.slice(0, 4) as line}<p>{line}</p>{/each}
      {#if summaryLines.length > 4}<p class="mu">And {summaryLines.length - 4} more courses in the chart.</p>{/if}
    </div>
  {/if}
  <div class="chart" class:isflat={!!flat} class:hide={noChart || nothing}>
    <div class="plot" bind:this={host}></div>
    {#if flat}<p class="flat" role="status">{flat}</p>{/if}
  </div>
  {#if nothing}
    <p class="empty" role="status">No data</p>
  {:else if loadingN > 0 || exampleWaiting}
    <p class="empty" role="status">Loading chart…</p>
  {/if}
  {#if loadFailed}
    <p class="empty" role="alert">Could not load a course</p>
  {/if}
  {#if !empty && !nothing && !flat}
    <ul class="legend" aria-label="Legend">
      {#each plotted.series as s, i}
        <li><i style:background={swatches[i % swatches.length]}></i>{s}</li>
      {/each}
      {#if plotted.fc.length}
        <li><i class="fcm" style:background={plotted.series.length === 1 ? ACCENT : 'var(--text)'}></i>Forecast</li>
      {/if}
    </ul>
  {/if}

  {#if tbl && !nothing}
  <div class="tblbox">
    <button type="button" class="btn" aria-expanded={showTable} aria-controls="data-table" onclick={() => (showTable = !showTable)}>{showTable ? 'Hide table' : 'Show as table'}</button>
    <div id="data-table" class="tw" class:sr-only={!showTable} role="region" aria-label="Chart values as a table" tabindex={showTable ? 0 : -1}>
      <table>
        <caption>{plotted.layers.map((l) => METRIC_META[l].label).join(', ')} by {X_LABEL[st.x].toLowerCase()}</caption>
        <thead><tr><th scope="col">{tbl.xhead}</th>{#each tbl.cols as c}<th scope="col" class="num">{c.head}</th>{/each}</tr></thead>
        <tbody>
          {#each tbl.rows as r}
            <tr><th scope="row">{r.x}</th>{#each r.vals as v}<td class="num">{v}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if showTable}<p class="tnote">– means there is no value for that term.</p>{/if}
  </div>
  {/if}

  {#if !empty && multiSec}
    <div class="secmode">
      <span class="shown" id="shown-l">Show:</span>
      <div class="seg" role="group" aria-labelledby="shown-l">
        <button type="button" aria-pressed={!split} onclick={() => setSplit(false)}>Course average</button>
        <button type="button" aria-pressed={split} onclick={() => setSplit(true)}>Compare sections</button>
      </div>
      {#if split}<p class="cap" role="status">Select up to {MAX_SECTIONS} sections ({nSel} of {MAX_SECTIONS})</p>{/if}
    </div>
  {/if}

  {#if !empty}
    <div class="bar">
      {#if EXPLORE_FORECAST_ENABLED}<label class="check switch"><input type="checkbox" role="switch" checked={st.fc && fcOk} onchange={(e) => (st.fc = e.currentTarget.checked)} disabled={!fcOk} /> Show forecast</label>{/if}
      <div class="dl">
        <button type="button" class="btn" disabled={nothing || !svgEl} onclick={downloadImage}>Download image</button>
        <button type="button" class="btn" disabled={nothing} onclick={downloadCsv}>Download CSV of plotted data</button>
      </div>
    </div>

    <div class="adv">
      <button type="button" class="btn adv-btn" aria-expanded={advOpen} aria-controls="adv-panel" onclick={() => (advOpen = !advOpen)}>More options</button>
    </div>
  {/if}
  {#if advOpen && !empty}
  <div id="adv-panel" class="advbody">
    <div class="yfs">
      <div class="yrow">
        <span class="ylab" id="yax-l">Y axis:</span>
      <div class="seg" role="group" aria-labelledby="yax-l">
        <button type="button" aria-pressed={!(st.log && !dual)} onclick={() => (st.log = false)}>Normal</button>
        <button type="button" aria-pressed={st.log && !dual} disabled={dual} onclick={() => (st.log = true)}>Log</button>
      </div>
      <label class="check"><input type="checkbox" checked={zeroForced || (st.zero && !(st.log && !dual))} disabled={zeroForced || (st.log && !dual)} onchange={(e) => (st.zero = e.currentTarget.checked)} /> Start at 0</label>
      </div>
    </div>
    <fieldset>
      <legend>Horizontal axis</legend>
      <label>X axis
        <select class="field" bind:value={st.x}>{#each XFIELDS as x}<option value={x}>{X_LABEL[x]}</option>{/each}</select>
      </label>
    </fieldset>
    <fieldset>
      <legend>Style</legend>
      <label>Chart type
        <select class="field" bind:value={st.mark}>{#each MARKS as m}<option value={m}>{MARK_LABEL[m]}</option>{/each}</select>
      </label>
      <label>Colour by
        <select class="field" bind:value={st.color}>{#each DIMS as d}<option value={d}>{DIM_LABEL[d]}</option>{/each}</select>
      </label>
      <label class="wide">Split into panels by
        <select class="field" bind:value={st.facet}>{#each DIMS as d}<option value={d}>{DIM_LABEL[d]}</option>{/each}</select>
      </label>
    </fieldset>
    <fieldset>
      <legend>Filter</legend>
      <label>Terms from
        <select class="field" bind:value={st.t0}><option value="">Any</option>{#each terms as t}<option value={t}>{t}</option>{/each}</select>
      </label>
      <label>Terms to
        <select class="field" bind:value={st.t1}><option value="">Any</option>{#each terms as t}<option value={t}>{t}</option>{/each}</select>
      </label>
      <label class="wide">Bidding window
        <select class="field" bind:value={st.w}><option value="">Any</option>{#each windows as w}<option value={w}>{fullWindow(w)}</option>{/each}</select>
      </label>
      <label class="check wide"><input type="checkbox" bind:checked={st.filled} /> Only sections that filled</label>
    </fieldset>
    <fieldset>
      <legend>More lines</legend>
      <div class="layers wide">
        {#each st.layers as l}
          <span class="lchip">{METRIC_META[l].label} <button type="button" aria-label={`Remove ${METRIC_META[l].label}`} onclick={() => (st.layers = st.layers.filter((x) => x !== l))}>×</button></span>
        {/each}
        {#if addable.length}
          <label class="addl">Add another line
            <select class="field" value="" onchange={(e) => { const v = e.currentTarget.value as Metric; if (v) st.layers = [...st.layers, v]; e.currentTarget.value = ''; }}>
              <option value="">Choose</option>
              {#each addable as m}<option value={m}>{METRIC_META[m].label}</option>{/each}
            </select>
          </label>
        {/if}
      </div>
      {#if EXPLORE_FORECAST_ENABLED}<label class="check wide"><input type="checkbox" bind:checked={st.band} disabled={!(st.fc && fcOk)} /> Show forecast range</label>{/if}
    </fieldset>
    <button type="button" class="btn" onclick={reset}>Reset</button>
  </div>
  {/if}
</div>
{/if}

<style>
  h1 { margin: 0 0 var(--s3); font-size: var(--fs-lg); font-weight: 600; }
  .modes { display: flex; width: 100%; margin-bottom: var(--s4); }
  .modes > button { flex: 1 1 0; min-height: 48px; padding: 0 var(--s2); font-size: var(--fs-md); white-space: normal; }
  .ex { display: grid; gap: var(--s4); min-width: 0; align-content: start; }
  .ex > * { min-width: 0; margin: 0; }
  .find { display: grid; gap: var(--s2); }
  .findl { font-size: var(--fs-md); font-weight: 600; }
  .add { position: relative; }
  .hits {
    position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5;
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-sm);
  }
  .hits li + li { border-top: 1px solid var(--rule); }
  .hits button {
    display: flex; gap: var(--s2); align-items: baseline; width: 100%; min-height: 48px;
    padding: 0 var(--s3); text-align: left; font: inherit; color: var(--text);
    background: none; border: 0; cursor: pointer;
  }
  .hits button b { font-weight: 600; }
  .hits button span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hits button:hover, .hits button:focus-visible { background: var(--accent-soft); }
  .pops { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); }
  .pophead { font-size: var(--fs-sm); color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .chip {
    min-height: 44px; padding: 0 var(--s4); font: inherit; font-size: var(--fs-sm); font-weight: 600; color: var(--text);
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); cursor: pointer;
  }
  .chip:hover { background: var(--accent-soft); }
  .chip[aria-pressed='true']:hover { background: var(--accent); }
  .status { display: flex; align-items: center; min-height: 44px; }
  .exlabel { margin: 0; font-size: var(--fs-sm); color: var(--text); }
  .tag { display: inline-block; padding: 1px var(--s2); margin-right: var(--s1); font-size: var(--fs-xs); font-weight: 600; color: var(--muted); border: 1px solid var(--rule-strong); border-radius: var(--r-sm); }
  .courses { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); width: 100%; }
  .course { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
  .ccode { font-weight: 600; font-size: var(--fs-md); }
  .load { color: var(--muted); }
  .pills { display: flex; flex-wrap: wrap; gap: var(--s2); flex: 1 1 100%; }
  button.pill:disabled { color: var(--muted); background: var(--bg); border-style: dashed; border-color: var(--muted); cursor: not-allowed; }
  .pill {
    min-height: 36px; min-width: 44px; padding: 0 var(--s3); font: inherit; font-weight: 600;
    color: var(--text); background: var(--surface); border: 1px solid var(--rule-strong);
    border-radius: var(--r-sm); cursor: pointer;
  }
  .secmode { display: grid; gap: var(--s1); justify-items: start; }
  .shown { font-size: var(--fs-sm); color: var(--muted); }
  .secmode .seg > button { min-height: 44px; }
  .cap { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .sum { font-size: var(--fs-sm); }
  .sum p { margin: 0 0 var(--s1); }
  .sum .mu { color: var(--muted); }
  .metricwrap { max-width: 100%; }
  .metric { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); width: 100%; border: 0; background: none; overflow: visible; }
  .metric > button { min-height: 44px; font-size: var(--fs-sm); border: 1px solid var(--rule-strong); border-radius: var(--r-sm); white-space: normal; padding: 0 var(--s2); }
  .metric > button[aria-pressed='true'] { border-color: var(--accent); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s3); }
  .check { display: inline-flex; align-items: center; gap: var(--s2); min-height: 44px; font-weight: 600; cursor: pointer; }
  .check input { width: 20px; height: 20px; accent-color: var(--accent); }
  .switch { min-width: 44px; }
  .switch input {
    -webkit-appearance: none; appearance: none; position: relative; flex: none;
    width: 44px; height: 44px; margin: 0; cursor: pointer; background: none; border: 0;
  }
  .switch input::before {
    content: ''; position: absolute; top: 10px; left: 2px; width: 40px; height: 24px;
    background: var(--rule-strong); border-radius: 12px;
  }
  .switch input::after {
    content: ''; position: absolute; top: 13px; left: 5px; width: 18px; height: 18px;
    background: var(--surface); border-radius: 50%;
  }
  .switch input:checked::before { background: var(--accent); }
  .switch input:checked::after { transform: translateX(16px); }
  .switch input:disabled { opacity: 0.5; cursor: not-allowed; }
  .check:has(input:disabled) { color: var(--muted); }
  .switch input:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; border-radius: 12px; }
  .dl { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .yrow { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s4); grid-column: 1 / -1; }
  .ylab { font-size: var(--fs-sm); color: var(--muted); }
  .yrow .seg > button { min-height: 44px; }
  .yrow .check input:disabled + * { color: var(--muted); }
  .adv { display: grid; gap: var(--s3); }
  .adv-btn { width: fit-content; }
  .adv-btn::after {
    content: ''; width: 16px; height: 16px; background: var(--chev-down) center / 16px no-repeat;
  }
  .adv-btn[aria-expanded='true']::after { transform: rotate(180deg); }
  .advbody { display: grid; gap: var(--s4); justify-items: start; width: 100%; padding: var(--s4); border: 1px solid var(--rule); border-radius: var(--r-sm); }
  fieldset { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); width: 100%; min-width: 0; margin: 0; padding: 0; border: 0; }
  legend { grid-column: 1 / -1; padding: 0; margin-bottom: var(--s2); font-size: var(--fs-sm); font-weight: 600; color: var(--muted); }
  fieldset label:not(.check), .addl { display: grid; gap: var(--s1); font-size: var(--fs-sm); color: var(--muted); min-width: 0; }
  fieldset .wide { grid-column: 1 / -1; }
  .chart { position: relative; min-width: 0; min-height: 300px; overflow: hidden; }
  .chart.isflat { min-height: 200px; }
  .chart.hide { display: none; }
  .flat { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: var(--s4); text-align: center; color: var(--muted); }
  .layers { display: flex; flex-wrap: wrap; align-items: end; gap: var(--s2); padding-bottom: var(--s3); }
  .lchip {
    display: inline-flex; align-items: center; gap: var(--s1); min-height: 40px; padding: 0 var(--s1) 0 var(--s3);
    font-weight: 600; color: var(--accent); background: var(--accent-soft);
    border: 1px solid var(--accent); border-radius: var(--r-sm);
  }
  .lchip button { min-width: 32px; min-height: 32px; font-size: var(--fs-md); color: var(--accent); background: none; border: 0; cursor: pointer; }
  .plot { width: 100%; min-width: 0; }
  .plot :global(svg) { display: block; max-width: 100%; }
  .empty { margin: 0; text-align: center; color: var(--muted); padding: var(--s6) 0; }
  .legend { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); font-size: var(--fs-xs); }
  .legend li { display: inline-flex; align-items: center; gap: var(--s2); }
  .legend i { width: 12px; height: 3px; display: inline-block; }
  .legend i.fcm { width: 10px; height: 10px; transform: rotate(45deg); }
  .tblbox { display: grid; gap: var(--s2); justify-items: start; }
  .tw { max-width: 100%; overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r-sm); }
  .tw.sr-only { border: 0; }
  .tw:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .tw table { border-collapse: collapse; font-size: var(--fs-sm); }
  .tw caption { padding: var(--s2) var(--s3); text-align: left; font-weight: 600; }
  .tw th, .tw td { padding: var(--s2) var(--s3); text-align: left; border-top: 1px solid var(--rule); white-space: nowrap; }
  .tw thead th { color: var(--muted); font-weight: 600; background: var(--surface); }
  .tw .num { text-align: right; }
  .tw tbody th { font-weight: 400; }
  .tnote { margin: 0; font-size: var(--fs-xs); color: var(--muted); }
  @media (max-width: 1023px) {
    .find { order: 0; }
    .status { order: 1; }
    .sum, .chart, .empty { order: 2; }
    .legend { order: 3; }
    .tblbox { order: 4; }
    .metricwrap { order: 5; }
    .secmode { order: 6; }
    .bar { order: 7; }
    .adv { order: 8; }
    .advbody { order: 9; }
  }
  @media (min-width: 1024px) {
    .metric { display: flex; width: max-content; min-width: 0; border: 1px solid var(--rule-strong); border-radius: var(--r-md); overflow: hidden; background: var(--surface); }
    .metric > button { border: 0; border-radius: 0; padding: 0 var(--s4); font-size: var(--fs-sm); }
    .metric > button[aria-pressed='true'] { border-color: transparent; }
    .advbody { grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: start; }
    .advbody > .btn { grid-column: 1 / -1; }
    fieldset { grid-template-columns: 1fr; }
    .chart { min-height: 300px; }
    .chart.isflat { min-height: 200px; }
  }
</style>
