<script lang="ts" module>
  import type { BuilderSpec as Spec } from './builder/spec';
  /** The spec of the last visit, so leaving the Build tab and coming back keeps the chart. */
  let lastSpec: Spec | null = null;
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import { shortLabel, type Theme } from './chart';
  import type { BrowseManifest, BrowseRow } from './browse';
  import { loadManifest, loadRows, termsFor } from './builder/data';
  import { download } from './export';
  import { fieldById } from './builder/fields';
  import { hasCourse, lineColor, lineLabels, runLines } from './builder/lines';
  import { deleteChart, loadSaved, MAX_SAVED, saveChart, type SavedChart } from './builder/saved';
  import { csvAllowed, resultCsv, resultTable } from './builder/table';
  import { xLabel, yLabel } from './builder/plan';
  import { drawChart } from './builder/plot';
  import { valueChoices } from './builder/query';
  import {
    CHART_LABEL, CHART_TYPES, MAX_LINES, NARROW_KEYS, NUMBER_X_IDS, X_IDS, Y_IDS, decodeSpec, defaultSpec, emptyLine, encodeSpec, normalizeSpec,
    type ChartType, type NarrowKey,
  } from './builder/spec';

  /** Rows shown in the screen-reader table. */
  const ROW_CAP = 500;
  /** Placeholder (and accessible name) of each narrowing select. */
  const NARROW_LABEL: Record<NarrowKey, string> = { day: 'Day', band: 'Time of day', section: 'Section', instructor: 'Professor' };

  let spec = $state<Spec>(defaultSpec());
  let ready = $state(false);
  let man = $state.raw<BrowseManifest | null>(null);
  let rows = $state.raw<BrowseRow[]>([]);
  let loading = $state(false);
  let failed = $state(false);
  let width = $state(0);
  let vh = $state(0);
  let host: HTMLDivElement | undefined = $state();
  let ctl: HTMLDivElement | undefined = $state();
  let showTable = $state(false);
  let token = 0;
  let saved = $state<SavedChart[]>([]);
  let saveOpen = $state(false);
  let saveName = $state('');
  let msg = $state('');

  /** Every change to the spec goes through here, so the URL and the chart follow. */
  const set = (next: Partial<Spec>) => (spec = normalizeSpec({ ...plain, ...next }));
  const val = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;

  onMount(() => {
    const fromUrl = new URLSearchParams(location.search).get('kv') !== null;
    spec = fromUrl ? decodeSpec(location.search) : (lastSpec ?? defaultSpec());
    loadManifest().then((m) => (man = m), () => (failed = true));
    saved = loadSaved();
    ready = true;
    // Divide out the wide-screen zoom so px heights fit the real viewport.
    const realVh = () => innerHeight / (parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
    vh = realVh();
    const onRs = () => (vh = realVh());
    addEventListener('resize', onRs);
    return () => removeEventListener('resize', onRs);
  });

  // URL sync (Explore leaves the address to this tab while it is open).
  $effect(() => {
    if (!ready) return;
    const q = encodeSpec(spec);
    lastSpec = normalizeSpec($state.snapshot(spec));
    history.replaceState(null, '', `?${q}`);
  });

  // Chart host width: read straight away so the first draw never waits on a frame callback; later changes on a timer.
  $effect(() => {
    if (!host) return;
    width = host.clientWidth;
    let timer = 0;
    const ro = new ResizeObserver((e) => {
      const w = Math.floor(e[0].contentRect.width);
      clearTimeout(timer);
      timer = window.setTimeout(() => { if (w !== width) width = w; }, 0);
    });
    ro.observe(host);
    return () => { clearTimeout(timer); ro.disconnect(); };
  });

  const plain = $derived($state.snapshot(spec) as Spec);
  const wanted = $derived(plain.lines.some(hasCourse));
  const terms = $derived(man ? termsFor(man, plain.more) : []);
  const termKey = $derived(terms.join('|'));

  // Data: nothing loads until a course is typed; then only the terms in view (the last four, or all with More terms).
  $effect(() => {
    const m = man;
    if (!m || !wanted) return;
    const ts = termKey ? termKey.split('|') : [];
    const mine = ++token;
    loading = true;
    loadRows(m, ts).then(
      (r) => { if (mine === token) { rows = r; failed = false; loading = false; } },
      () => { if (mine === token) { failed = true; loading = false; } },
    );
  });

  const codes = $derived(new Set(man?.codes ?? []));
  const labels = $derived(lineLabels(plain.lines));
  const result = $derived(wanted && rows.length ? runLines(rows, plain) : null);
  const hasPoints = $derived(!!result && result.points.length > 0);
  const raw = $derived(plain.chart === 'scatter');
  const xChoices = $derived(plain.chart === 'scatter' ? NUMBER_X_IDS : X_IDS);

  /** Rows of each typed course, and the narrowing choices of each line from them. */
  const byCourse = $derived.by(() => {
    const need = new Set(plain.lines.filter(hasCourse).map((l) => l.course));
    const m = new Map<string, BrowseRow[]>();
    for (const c of need) m.set(c, []);
    if (need.size) for (const r of rows) m.get(r.code)?.push(r);
    return m;
  });
  const choices = $derived(plain.lines.map((l) => (hasCourse(l) && byCourse.get(l.course)?.length ? NARROW_KEYS.map((k) => valueChoices(byCourse.get(l.course) ?? [], k)) : null)));

  function theme(): Theme {
    const c = getComputedStyle(document.documentElement);
    const g = (n: string) => c.getPropertyValue(n).trim();
    return { text: g('--text'), muted: g('--muted'), border: g('--rule'), surface: g('--surface'), font: g('--font') || 'system-ui, sans-serif' };
  }

  /** Desktop: the plot fills what is left of the viewport below it; phone: a fixed height. */
  function baseHeight(): number {
    if (!host || innerWidth < 1024) return 320;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const top = (host.getBoundingClientRect().top + scrollY) / zoom;
    return Math.round(Math.max(380, Math.min(700, vh - top - 150)));
  }

  $effect(() => {
    const r = result; const s = plain; const w = width; void vh;
    if (!host || !w || !r || !r.points.length) { host?.replaceChildren(); return; }
    try {
      const svg = drawChart(s, r, theme(), w, baseHeight());
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${yLabel(s)} by ${xLabel(s)}, ${CHART_LABEL[s.chart].toLowerCase()} chart, ${r.series.join(', ')}`);
      host.replaceChildren(svg);
    } catch (err) {
      console.error('builder render', err);
      host.replaceChildren();
    }
  });

  const tbl = $derived(result && result.points.length ? resultTable(plain, result, ROW_CAP) : null);
  const termLabel = (t: string) => shortLabel(t);
  const termsText = $derived(terms.length > 1 ? `${termLabel(terms[0])} to ${termLabel(terms[terms.length - 1])}` : terms.length ? termLabel(terms[0]) : '');
  const notes = $derived.by(() => {
    if (!result) return [];
    const t = result.totals;
    const out: string[] = [];
    if (t.droppedNullX) out.push(`${t.droppedNullX.toLocaleString()} rows have no ${(fieldById(plain.x)?.label ?? '').toLowerCase()}`);
    if (t.droppedNullY) out.push(`${t.droppedNullY.toLocaleString()} rows have no value`);
    if (t.sampled) out.push(`A sample of ${t.rowsPlotted.toLocaleString()} points is shown`);
    return out;
  });

  // Lines
  const setLine = (i: number, patch: Partial<Spec['lines'][number]>) => set({ lines: plain.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setCourse = (i: number, text: string) => set({ lines: plain.lines.map((l, j) => (j === i ? { course: text } : l)) });
  const setNarrow = (i: number, k: NarrowKey, v: string) => setLine(i, { [k]: v || undefined });
  const removeLine = (i: number) => set({ lines: plain.lines.filter((_, j) => j !== i) });
  async function addLine() {
    if (plain.lines.length >= MAX_LINES) return;
    set({ lines: [...plain.lines, emptyLine()] });
    await tick();
    const all = ctl?.querySelectorAll<HTMLInputElement>('input.course');
    all?.[all.length - 1]?.focus();
  }
  const setChart = (c: ChartType) => set({ chart: c });

  // Saved charts, link, CSV
  const flash = (t: string) => { msg = t; setTimeout(() => { if (msg === t) msg = ''; }, 3000); };
  function doSave() {
    const r = saveChart(saveName, plain);
    saved = r.list;
    if (r.ok) { saveOpen = false; saveName = ''; flash('Saved'); }
    else flash(r.reason === 'full' ? `Limit is ${MAX_SAVED}` : r.reason === 'name' ? 'Name it first' : 'Could not save');
  }
  async function copyLink() {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copied');
    } catch {
      const t = document.createElement('textarea');
      t.value = url;
      t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* no clipboard */ }
      t.remove();
      flash(ok ? 'Link copied' : 'Copy the address bar');
    }
  }
  const saveCsv = () => { if (result && csvAllowed(plain)) download(new Blob([resultCsv(plain, result)], { type: 'text/csv;charset=utf-8' }), 'bidwise-chart.csv'); };
</script>

<div class="bld">
  <aside class="side" bind:this={ctl}>
    <fieldset class="types">
      <legend class="sr-only">Chart type</legend>
      {#each CHART_TYPES as c}
        <button type="button" class="pill" aria-pressed={plain.chart === c} onclick={() => setChart(c)}>{CHART_LABEL[c]}</button>
      {/each}
    </fieldset>

    <div class="axes">
      <label>X axis
        <select class="field" value={plain.x} onchange={(e) => set({ x: val(e) })}>
          {#each xChoices as id}<option value={id}>{fieldById(id)?.label}</option>{/each}
        </select>
      </label>
      <label>Y axis
        <select class="field" value={plain.y} onchange={(e) => set({ y: val(e) })}>
          {#each Y_IDS as id}<option value={id}>{fieldById(id)?.label}</option>{/each}
        </select>
      </label>
    </div>

    <ul class="lines" aria-label="Lines">
      {#each plain.lines as l, i}
        <li class="line">
          <div class="head">
            <i class="chip" style:background={lineColor(i)} aria-hidden="true"></i>
            <input
              class="field course" type="text" list="bld-codes" placeholder="Type a course code" aria-label={`Line ${i + 1} course`}
              autocomplete="off" autocapitalize="characters" spellcheck="false" value={l.course} oninput={(e) => setCourse(i, val(e).trim().toUpperCase())}
            />
            <button type="button" class="x" aria-label={`Remove line ${i + 1}`} onclick={() => removeLine(i)}>×</button>
          </div>
          {#if hasCourse(l)}
            {#if man && !codes.has(l.course)}
              <p class="mu small">No such course</p>
            {:else}
              {#if labels[i] !== l.course}<p class="lab" title={labels[i]}>{labels[i]}</p>{/if}
              {#if choices[i]}
                <div class="narrow">
                  {#each NARROW_KEYS as k, ki}
                    <select class="field" aria-label={`${NARROW_LABEL[k]} of line ${i + 1}`} value={l[k] ?? ''} onchange={(e) => setNarrow(i, k, val(e))}>
                      <option value="">{NARROW_LABEL[k]}</option>
                      {#each choices[i]?.[ki] ?? [] as c}<option value={c.value}>{c.label}</option>{/each}
                    </select>
                  {/each}
                </div>
              {/if}
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    <datalist id="bld-codes">{#each man?.codes ?? [] as c}<option value={c}></option>{/each}</datalist>
    <button type="button" class="btn add" disabled={plain.lines.length >= MAX_LINES} onclick={addLine}>+ Add line</button>

    <div class="more">
      <label class="check"><input type="checkbox" checked={plain.more} onchange={(e) => set({ more: e.currentTarget.checked })} /> More terms</label>
      <InfoTip anchor="seats" label="About the terms" lines={['Shows the last four terms. More terms loads every term (about 12 MB).']} />
    </div>
  </aside>

  <section class="main" aria-label="Chart">
    {#if failed}
      <p class="empty" role="alert">Could not load data</p>
    {:else if !wanted}
      <p class="empty" role="status">Type a course code</p>
    {:else if loading && !hasPoints}
      <p class="empty" role="status">Loading…</p>
    {:else if !hasPoints}
      <p class="empty" role="status">No data{plain.more ? '' : ' in the last four terms'}</p>
    {/if}

    <div class="plot" bind:this={host}></div>

    {#if hasPoints && result}
      <ul class="legend" aria-label="Lines">
        {#each result.series as s}
          <li><i style:background={result.colors.get(s)}></i>{s}</li>
        {/each}
      </ul>

      <div class="bar" role="group" aria-label="Chart actions">
        {#if saveOpen}
          <input class="field nm" type="text" maxlength="60" placeholder="Name" aria-label="Chart name" bind:value={saveName} onkeydown={(e) => e.key === 'Enter' && doSave()} />
          <button type="button" class="btn" onclick={doSave}>Save</button>
          <button type="button" class="btn" onclick={() => (saveOpen = false)}>Cancel</button>
        {:else}
          <button type="button" class="btn" onclick={() => (saveOpen = true)}>Save</button>
          <button type="button" class="btn" onclick={copyLink}>Copy link</button>
          {#if csvAllowed(plain)}<button type="button" class="btn" onclick={saveCsv}>CSV</button>{/if}
        {/if}
        <span class="msg" role="status">{msg}</span>
      </div>
    {/if}
    {#if saved.length}
      <details class="saved">
        <summary class="btn">Saved ({saved.length})</summary>
        <ul>
          {#each saved as c (c.name)}
            <li>
              <button type="button" class="btn open" onclick={() => (spec = c.spec)}>{c.name}</button>
              <button type="button" class="btn" aria-label={`Delete ${c.name}`} onclick={() => (saved = deleteChart(c.name))}>×</button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if hasPoints && result}
      <p class="totals">{result.totals.rowsFiltered.toLocaleString()} rows · {termsText}</p>
      {#each notes as n}<p class="note" role="status">{n}</p>{/each}
    {/if}

    {#if tbl}
      <div class="tblbox">
        <button type="button" class="btn" aria-expanded={showTable} aria-controls="bld-table" onclick={() => (showTable = !showTable)}>{showTable ? 'Hide table' : 'Show as table'}</button>
        <div id="bld-table" class="tw" class:sr-only={!showTable} role="region" aria-label="Chart values as a table" tabindex={showTable ? 0 : -1}>
          <table>
            <caption>{yLabel(plain)} by {xLabel(plain).toLowerCase()}</caption>
            <thead><tr>{#each tbl.heads as h, i}<th scope="col" class:num={i >= tbl.heads.length - tbl.nNum}>{h}</th>{/each}</tr></thead>
            <tbody>
              {#each tbl.body as r}
                <tr>{#each r as c, i}<td class:num={i >= r.length - tbl.nNum}>{c}</td>{/each}</tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if showTable && tbl.more > 0}<p class="note">First {ROW_CAP} of {(tbl.more + ROW_CAP).toLocaleString()} rows</p>{/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .bld { display: grid; gap: var(--s4); min-width: 0; align-content: start; }
  .bld > * { min-width: 0; }
  .side { display: grid; gap: var(--s3); align-content: start; padding: var(--s3); border: 1px solid var(--rule); border-radius: var(--r-sm); background: var(--surface); }
  .side > * { min-width: 0; margin: 0; }
  fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  .types { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s2); }
  .pill {
    min-height: 44px; padding: 0 var(--s2); font: inherit; font-size: var(--fs-sm); color: var(--text); background: var(--surface);
    border: 1px solid var(--rule-strong); border-radius: var(--r-sm); cursor: pointer;
  }
  .pill[aria-pressed='true'] { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); font-weight: 600; }
  .pill:not([aria-pressed='true']):hover { background: var(--accent-soft); }
  .axes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2) var(--s3); }
  .axes label { display: grid; gap: var(--s1); font-size: var(--fs-sm); line-height: 1.2; color: var(--muted); align-content: start; min-width: 0; }
  .lines { display: grid; gap: var(--s3); margin: 0; padding: 0; list-style: none; }
  .line { display: grid; gap: var(--s1); padding-left: var(--s3); border-left: 4px solid var(--rule); min-width: 0; }
  .head { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .chip { flex: none; width: 14px; height: 14px; border-radius: 50%; }
  .course { flex: 1; min-width: 0; text-transform: uppercase; }
  .course::placeholder { text-transform: none; }
  .x { flex: none; width: 44px; min-height: 44px; font: inherit; font-size: 22px; color: var(--text); background: none; border: 0; cursor: pointer; }
  .x:hover { background: var(--accent-soft); border-radius: var(--r-sm); }
  .lab { margin: 0; font-size: var(--fs-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .narrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2); }
  .narrow .field { padding-left: var(--s2); padding-right: 32px; text-overflow: ellipsis; font-size: var(--fs-sm); background-position: right 8px center; }
  .add { justify-self: start; }
  .more { display: flex; align-items: center; gap: var(--s2); }
  .check { display: inline-flex; align-items: center; gap: var(--s2); min-height: 44px; font-size: var(--fs-sm); color: var(--text); cursor: pointer; }
  .check input { width: 20px; height: 20px; flex: none; accent-color: var(--accent); }
  .mu { color: var(--muted); }
  .small { font-size: var(--fs-xs); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
  .bar .nm { flex: 1 1 140px; min-width: 0; }
  .msg { font-size: var(--fs-sm); color: var(--muted); }
  .saved summary { display: inline-flex; cursor: pointer; list-style: none; }
  .saved summary::-webkit-details-marker { display: none; }
  .saved ul { display: grid; gap: var(--s2); margin: var(--s2) 0 0; padding: 0; list-style: none; }
  .saved li { display: flex; gap: var(--s2); }
  .saved .open { flex: 1; min-width: 0; justify-content: flex-start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main { display: grid; gap: var(--s3); align-content: start; min-width: 0; }
  .main > * { min-width: 0; margin: 0; }
  .plot { width: 100%; min-width: 0; }
  .plot :global(svg) { display: block; max-width: 100%; }
  .empty { margin: 0; padding: var(--s6) 0; text-align: center; color: var(--muted); }
  .legend { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); padding: 0; list-style: none; font-size: var(--fs-xs); }
  .legend li { display: inline-flex; align-items: center; gap: var(--s2); }
  .legend i { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
  .totals { font-size: var(--fs-sm); color: var(--muted); }
  .note { margin: 0; font-size: var(--fs-xs); color: var(--muted); }
  .tblbox { display: grid; gap: var(--s2); justify-items: start; }
  .tw { max-width: 100%; overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r-sm); }
  .tw.sr-only { border: 0; }
  .tw:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .tw table { border-collapse: collapse; font-size: var(--fs-sm); }
  .tw caption { padding: var(--s2) var(--s3); text-align: left; font-weight: 600; }
  .tw th, .tw td { padding: var(--s2) var(--s3); text-align: left; border-top: 1px solid var(--rule); white-space: nowrap; }
  .tw thead th { color: var(--muted); font-weight: 600; background: var(--surface); }
  .tw .num { text-align: right; }
  @media (min-width: 1024px) {
    .bld { grid-template-columns: 320px minmax(0, 1fr); gap: var(--s5); align-items: start; }
  }
</style>
