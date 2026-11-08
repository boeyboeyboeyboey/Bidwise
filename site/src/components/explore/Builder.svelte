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
  import { availableTerms, loadManifest, loadRows, termsForFilters } from './builder/data';
  import {
    AGG_LABEL, AXIS_FIELDS, CHART_LABEL, SORT_LABEL, allTermsOn, controlState, effectiveTerms, isRaw, setAgg, setAllTerms, setBin, setChart,
    setLatestTerm, setOptional, setRaw, setSwap, setX, setY, termsSizeMb, toggleTerm,
  } from './builder/controls';
  import { download } from './export';
  import { fieldById } from './builder/fields';
  import { FILTER_FIELDS, chipFilters, filterFor, filterSummary, removeFilter, searchChoices, setFilterRange, setFilterValues, toggleFilterValue } from './builder/filters';
  import { PRESETS, applyPreset } from './builder/presets';
  import { deleteChart, loadSaved, MAX_SAVED, saveChart, type SavedChart } from './builder/saved';
  import { csvAllowed, resultCsv, resultTable } from './builder/table';
  import { fmtTick, fmtY, planFor, xLabel, yLabel } from './builder/plan';
  import { chartHeight, colorOf, drawChart, heatRamp, tipText, xText } from './builder/plot';
  import { applyFilters, runQuery, SORT_MODES, valueChoices, type QueryResult } from './builder/query';
  import { CHART_TYPES, decodeSpec, defaultSpec, encodeSpec, normalizeSpec } from './builder/spec';

  /** Rows shown in the table view and the screen-reader table. */
  const ROW_CAP = 500;

  let spec = $state<Spec>(defaultSpec());
  let ready = $state(false);
  let man = $state.raw<BrowseManifest | null>(null);
  let rows = $state.raw<BrowseRow[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  let width = $state(0);
  let vh = $state(0);
  let host: HTMLDivElement | undefined = $state();
  let open = $state(false);
  let showTable = $state(false);
  let hidden = $state(0);
  let token = 0;
  /** The field whose filter editor is open. */
  let editing = $state<string | null>(null);
  let search = $state('');
  let searchEl: HTMLInputElement | undefined = $state();
  let saved = $state<SavedChart[]>([]);
  let saveOpen = $state(false);
  let saveName = $state('');
  let msg = $state('');

  /** Every change to the spec goes through here, so the URL and the chart follow. */
  const set = (next: Spec) => (spec = next);

  onMount(() => {
    const fromUrl = new URLSearchParams(location.search).get('kv') !== null;
    spec = fromUrl ? decodeSpec(location.search) : (lastSpec ?? defaultSpec());
    loadManifest().then((m) => (man = m), () => { failed = true; loading = false; });
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

  // Data: only the terms the spec asks for (the latest one by default), keyed by a string so unrelated changes do not reload.
  const allTerms = $derived(man ? availableTerms(man) : []);
  const termKey = $derived(man ? termsForFilters(man, spec.filters).join('|') : '');
  $effect(() => {
    const m = man;
    if (!m) return;
    const ts = termKey ? termKey.split('|') : [];
    const mine = ++token;
    loading = true;
    loadRows(m, ts).then(
      (r) => { if (mine === token) { rows = r; failed = false; loading = false; } },
      () => { if (mine === token) { failed = true; loading = false; } },
    );
  });

  const plain = $derived($state.snapshot(spec) as Spec);
  const cs = $derived(controlState(plain));
  const plan = $derived(planFor(plain));
  const result = $derived<QueryResult | null>(rows.length ? runQuery(rows, plain) : null);
  const hasPoints = $derived(!!result && result.points.length > 0);
  const isTable = $derived(plain.chart === 'table');
  const drawable = $derived(hasPoints && !isTable && !plan.needsColor);
  const picked = $derived(effectiveTerms(plain, allTerms));
  const sizeMb = $derived(man ? termsSizeMb(man.terms, picked) : 0);
  const xf = $derived(fieldById(plain.x));
  const hasColor = $derived(!!result && result.domains.color.length > 0 && !!plain.color);
  const colorFn = $derived(colorOf(result?.domains.color ?? []));

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
    const r = result; const s = plain; const w = width; void vh; void drawable;
    if (!host || !w || !r || !drawable) { host?.replaceChildren(); hidden = 0; return; }
    try {
      const d = drawChart(s, r, theme(), w, chartHeight(s, r, baseHeight()));
      d.svg.setAttribute('role', 'img');
      d.svg.setAttribute('aria-label', `${yLabel(s)} by ${xLabel(s)}, ${CHART_LABEL[s.chart].toLowerCase()} chart`);
      host.replaceChildren(d.svg);
      hidden = d.hidden;
    } catch (err) {
      console.error('builder render', err);
      host.replaceChildren();
    }
  });

  /** The result as a table: the table chart, and the screen-reader alternative to every other chart. */
  const tbl = $derived(result && result.points.length ? resultTable(plain, result, ROW_CAP) : null);

  const notes = $derived.by(() => {
    if (!result) return [];
    const t = result.totals;
    const out: string[] = [];
    const lc = (id: string | undefined) => (fieldById(id ?? '')?.label ?? '').toLowerCase();
    if (t.capped.x) out.push(`Other combines ${t.capped.x} more ${lc(plain.x)} groups`);
    if (t.capped.color) out.push(`Other combines ${t.capped.color} more ${lc(plain.color)} groups`);
    if (t.capped.facet) out.push(`Other combines ${t.capped.facet} more ${lc(plain.facet)} groups`);
    if (t.emptyGroups) out.push(t.emptyGroups === 1 ? '1 group has no value' : `${t.emptyGroups} groups have no value`);
    if (t.droppedNullX) out.push(`${t.droppedNullX.toLocaleString()} rows have no ${lc(plain.x)}`);
    if (t.droppedNullY) out.push(`${t.droppedNullY.toLocaleString()} rows have no value`);
    if (t.sampled) out.push(`A sample of ${t.rowsPlotted.toLocaleString()} points is shown`);
    if (hidden) out.push(`${hidden} values of 0 or less are hidden on the log axis`);
    return out;
  });

  const range = $derived.by(() => {
    if (!result || !plan.marks.includes('cell')) return null;
    const ys = result.points.map((p) => p.y);
    return ys.length ? { lo: Math.min(...ys), hi: Math.max(...ys) } : null;
  });

  const termLabel = (t: string) => shortLabel(t);
  const termsText = $derived(picked.length === 1 ? termLabel(picked[0]) : `${picked.length} terms`);

  // Filters
  const chips = $derived(chipFilters(plain));
  const addable = $derived(FILTER_FIELDS.filter((f) => !filterFor(plain, f.id)));
  const editField = $derived(editing ? fieldById(editing) : undefined);
  const editFilter = $derived(editing ? filterFor(plain, editing) : undefined);
  const choices = $derived(editField && editField.kind !== 'number' ? valueChoices(applyFilters(rows, plain.filters.filter((f) => f.field !== editing)), editField.id) : []);
  const found = $derived(searchChoices(choices, search, editFilter?.in ?? []));

  async function openEditor(id: string, focus = false) {
    editing = editing === id && !focus ? null : id;
    search = '';
    if (editing && focus) { await tick(); searchEl?.focus(); }
  }
  const dropFilter = (id: string) => { set(removeFilter(plain, id)); if (editing === id) editing = null; };
  const addField = (e: Event) => { const id = val(e); (e.currentTarget as HTMLSelectElement).value = ''; if (id) openEditor(id, true); };
  const pickFirst = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const c = found.shown.find((x) => !(editFilter?.in ?? []).includes(x.value));
    if (c && editing) { set(toggleFilterValue(plain, editing, c.value)); search = ''; }
  };

  // Presets
  function usePreset(e: Event) {
    const p = PRESETS.find((x) => x.id === val(e));
    (e.currentTarget as HTMLSelectElement).value = '';
    if (!p) return;
    set(applyPreset(plain, p));
    if (p.needsCourse && !filterFor(plain, 'course')) openEditor('course', true);
  }

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
  const val = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;
  const chk = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
</script>

<div class="bld">
  <aside class="side">
    <button type="button" class="btn setbtn" aria-expanded={open} aria-controls="bld-ctl" onclick={() => (open = !open)}>Chart settings</button>
    <div id="bld-ctl" class="ctl" class:open>
      <fieldset class="wide types desk">
        <legend>Chart type</legend>
        {#each CHART_TYPES as c}
          <button type="button" class="pill" aria-pressed={plain.chart === c} onclick={() => set(setChart(plain, c))}>{CHART_LABEL[c]}</button>
        {/each}
      </fieldset>
      <label class="phone">Chart type
        <select class="field" value={plain.chart} onchange={(e) => set(setChart(plain, val(e) as never))}>
          {#each CHART_TYPES as c}<option value={c}>{CHART_LABEL[c]}</option>{/each}
        </select>
      </label>
      <label class="wd">Start from
        <select class="field" value="" onchange={usePreset}>
          <option value="">Choose</option>
          {#each PRESETS as p}<option value={p.id}>{p.label}</option>{/each}
        </select>
      </label>

      <div class="wide flt">
        <div class="chips" aria-label="Filters">
          {#each chips as f (f.field)}
            <span class="fchip" class:on={editing === f.field}>
              <button type="button" class="fbtn" aria-expanded={editing === f.field} onclick={() => openEditor(f.field)}>{filterSummary(f)}</button>
              <button type="button" class="fx" aria-label={`Remove ${fieldById(f.field)?.label ?? ''} filter`} onclick={() => dropFilter(f.field)}>×</button>
            </span>
          {/each}
          <select class="field addf" aria-label="Add filter" value="" onchange={addField}>
            <option value="">+ Filter</option>
            {#each addable as f}<option value={f.id}>{f.label}</option>{/each}
          </select>
        </div>
        {#if editField}
          <div class="editor">
            <div class="ehead">
              <strong>{editField.label}</strong>
              <button type="button" class="btn small" onclick={() => (editing = null)}>Done</button>
            </div>
            {#if editField.kind === 'number'}
              <div class="range">
                <label>Min <input class="field" type="number" step="any" inputmode="decimal" value={editFilter?.min ?? ''} oninput={(e) => set(setFilterRange(plain, editField.id, val(e), String(editFilter?.max ?? '')))} /></label>
                <label>Max <input class="field" type="number" step="any" inputmode="decimal" value={editFilter?.max ?? ''} oninput={(e) => set(setFilterRange(plain, editField.id, String(editFilter?.min ?? ''), val(e)))} /></label>
              </div>
            {:else if editField.kind === 'bool'}
              <div class="yn">
                {#each [['true', 'Yes'], ['false', 'No']] as [v, l]}
                  <button type="button" class="pill" aria-pressed={editFilter?.in?.includes(v) ?? false} onclick={() => set(toggleFilterValue(plain, editField.id, v))}>{l}</button>
                {/each}
              </div>
            {:else}
              <input class="field" type="search" placeholder={editField.id === 'course' ? 'Type a course code' : 'Search'} aria-label={`Search ${editField.label}`} bind:value={search} bind:this={searchEl} onkeydown={pickFirst} autocomplete="off" />
              <p class="mu count">{editFilter?.in?.length ?? 0} selected · {found.total} shown{#if found.total > found.shown.length} (type to narrow){/if}</p>
              <div class="olist">
                {#each found.shown as c (c.value)}
                  <label class="opt"><input type="checkbox" checked={editFilter?.in?.includes(c.value) ?? false} onchange={() => set(toggleFilterValue(plain, editField.id, c.value))} /> <span class="ol">{c.label}</span> <span class="mu">{c.n}</span></label>
                {/each}
                {#if !found.shown.length}<p class="mu">No match</p>{/if}
              </div>
              {#if editFilter?.in?.length}
                <button type="button" class="btn small" onclick={() => set(setFilterValues(plain, editField.id, []))}>Clear</button>
              {/if}
            {/if}
          </div>
        {/if}
      </div>

      <label>X
        <select class="field" value={plain.x} onchange={(e) => set(setX(plain, val(e)))}>
          {#each AXIS_FIELDS as f}<option value={f.id}>{f.label}</option>{/each}
        </select>
      </label>
      <label>Bin size
        <input class="field" type="number" min="0" step="any" inputmode="decimal" placeholder="None" disabled={!cs.binOn} value={plain.bin ?? ''} oninput={(e) => set(setBin(plain, val(e)))} />
      </label>

      <label>{cs.yShelfLabel}
        <select class="field" value={plain.y.field} onchange={(e) => set(setY(plain, val(e)))}>
          {#each cs.yFields as f}<option value={f.id}>{f.label}</option>{/each}
        </select>
      </label>
      <label>Aggregate
        <select class="field" value={plain.y.agg} disabled={cs.aggLocked} onchange={(e) => set(setAgg(plain, val(e) as never))}>
          {#each cs.aggs as a}<option value={a}>{AGG_LABEL[a]}</option>{/each}
        </select>
      </label>

      <label>{cs.colorLabel}
        <select class="field" value={plain.color ?? ''} onchange={(e) => set(setOptional(plain, 'color', val(e)))}>
          <option value="">None</option>
          {#each AXIS_FIELDS as f}<option value={f.id}>{f.label}</option>{/each}
        </select>
      </label>
      <label>Facet
        <select class="field" value={plain.facet ?? ''} onchange={(e) => set(setOptional(plain, 'facet', val(e)))}>
          <option value="">None</option>
          {#each AXIS_FIELDS as f}<option value={f.id}>{f.label}</option>{/each}
        </select>
      </label>

      <label class="wd">Sort
        <select class="field" value={plain.sort ?? 'x'} disabled={!cs.sortOn} onchange={(e) => set(normalizeSpec({ ...plain, sort: val(e) as never }))}>
          {#each SORT_MODES as m}<option value={m}>{SORT_LABEL[m]}</option>{/each}
        </select>
      </label>

      <div class="phone terms-dd">
        <span class="lbl">Terms{#if picked.length > 1 && sizeMb > 0} <span class="mb">≈{Math.max(1, Math.round(sizeMb))} MB</span>{/if}</span>
        <details class="dd">
          <summary class="field">{allTerms.length ? termsText : 'Loading'}</summary>
          {#if allTerms.length}
            <div class="ddlist">
              {#each [...allTerms].reverse() as t}
                <label class="opt"><input type="checkbox" checked={picked.includes(t)} onchange={() => set(toggleTerm(plain, t, allTerms))} /> {t}</label>
              {/each}
              {#if allTerms.length > 1}
                <label class="opt"><input type="checkbox" checked={allTermsOn(plain, allTerms)} onchange={() => set(allTermsOn(plain, allTerms) ? setLatestTerm(plain, allTerms) : setAllTerms(plain, allTerms))} /> All terms (≈12 MB)</label>
              {/if}
            </div>
          {/if}
        </details>
      </div>

      <div class="wide checks">
        <label class="check"><input type="checkbox" checked={cs.logChecked} disabled={!cs.logOn} onchange={(e) => set(normalizeSpec({ ...plain, log: chk(e) }))} /> Log scale</label>
        <label class="check"><input type="checkbox" checked={cs.zeroChecked} disabled={!cs.zeroOn} onchange={(e) => set(normalizeSpec({ ...plain, zero: chk(e) }))} /> Start at zero</label>
        <label class="check"><input type="checkbox" checked={plain.swap && cs.swapOn} disabled={!cs.swapOn} onchange={() => set(setSwap(plain))} /> Swap axes</label>
        <label class="check"><input type="checkbox" checked={cs.rawChecked} disabled={!cs.rawOn} onchange={(e) => set(setRaw(plain, chk(e)))} /> Raw rows</label>
      </div>

      <fieldset class="wide terms desk">
        <legend>Terms{#if picked.length > 1 && sizeMb > 0} <span class="mb">≈{Math.max(1, Math.round(sizeMb))} MB</span>{/if}</legend>
        {#if allTerms.length}
          {#each [...allTerms].reverse() as t}
            <button type="button" class="chip" aria-pressed={picked.includes(t)} aria-label={t} onclick={() => set(toggleTerm(plain, t, allTerms))}>{termLabel(t)}</button>
          {/each}
          {#if allTerms.length > 1}
            <button type="button" class="chip" aria-pressed={allTermsOn(plain, allTerms)} onclick={() => set(allTermsOn(plain, allTerms) ? setLatestTerm(plain, allTerms) : setAllTerms(plain, allTerms))}>All terms (≈12 MB)</button>
          {/if}
        {:else}
          <span class="mu">Loading</span>
        {/if}
      </fieldset>
      <button type="button" class="btn wide" onclick={() => set(defaultSpec())}>Reset</button>
    </div>
  </aside>

  <section class="main" aria-label="Chart">
    {#if failed}
      <p class="empty" role="alert">Could not load data</p>
    {:else if loading && !hasPoints}
      <p class="empty" role="status">Loading chart…</p>
    {:else if !hasPoints}
      <p class="empty" role="status">No data</p>
    {:else if plan.needsColor}
      <p class="empty" role="status">Choose a second axis</p>
    {/if}

    <div class="plot" bind:this={host}></div>

    {#if drawable && hasColor && !plan.marks.includes('cell')}
      <ul class="legend" aria-label="Legend">
        {#each result?.domains.color ?? [] as c}
          <li><i style:background={colorFn(c)}></i>{c}</li>
        {/each}
      </ul>
    {/if}
    {#if drawable && range}
      <div class="ramp" aria-label="Colour scale">
        <span>{fmtY(plain, range.lo)}</span><i style:background={`linear-gradient(90deg, ${heatRamp[0]}, ${heatRamp[1]})`}></i><span>{fmtY(plain, range.hi)}</span>
      </div>
    {/if}

    {#if isTable && tbl}
      <div class="tw" role="region" aria-label="Chart values as a table" tabindex="0">
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
      {#if tbl.more > 0}<p class="note">First {ROW_CAP} of {(tbl.more + ROW_CAP).toLocaleString()} rows</p>{/if}
    {/if}

    {#if hasPoints}
      <div class="bar" role="group" aria-label="Chart actions">
        {#if saveOpen}
          <input class="field nm" type="text" maxlength="60" placeholder="Name" aria-label="Chart name" bind:value={saveName} onkeydown={(e) => e.key === 'Enter' && doSave()} />
          <button type="button" class="btn" onclick={doSave}>Save</button>
          <button type="button" class="btn" onclick={() => (saveOpen = false)}>Cancel</button>
        {:else}
          <button type="button" class="btn" onclick={() => (saveOpen = true)}>Save</button>
          <button type="button" class="btn" onclick={copyLink}>Copy link</button>
          {#if csvAllowed(plain)}
          <button type="button" class="btn" onclick={saveCsv}>CSV</button>
          {/if}
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
              <button type="button" class="btn open" onclick={() => set(c.spec)}>{c.name}</button>
              <button type="button" class="btn" aria-label={`Delete ${c.name}`} onclick={() => (saved = deleteChart(c.name))}>×</button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if hasPoints}
      <p class="totals">
        <span>{result?.totals.rowsPlotted.toLocaleString()} of {result?.totals.rowsIn.toLocaleString()} rows</span>
        <InfoTip anchor="seats" label="About the fields" lines={[
          'A row is one section in one bidding window.',
          'Section seats: all seats in the section. Seats offered: seats open in that window.',
          'Other: the smallest groups combined.',
        ]} />
      </p>
      {#each notes as n}<p class="note" role="status">{n}</p>{/each}
    {/if}

    {#if !isTable && tbl && !plan.needsColor}
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
  .side { display: grid; gap: var(--s3); align-content: start; }
  .setbtn { width: 100%; justify-content: space-between; }
  .setbtn::after { content: ''; width: 16px; height: 16px; background: var(--chev-down) center / 16px no-repeat; }
  .setbtn[aria-expanded='true']::after { transform: rotate(180deg); }
  .ctl { display: none; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2) var(--s3); padding: var(--s3); border: 1px solid var(--rule); border-radius: var(--r-sm); background: var(--surface); }
  .ctl.open { display: grid; }
  .ctl > * { min-width: 0; margin: 0; }
  .wide { grid-column: 1 / -1; }
  .ctl label:not(.check) { display: grid; gap: var(--s1); font-size: var(--fs-sm); color: var(--muted); align-content: start; }
  .ctl .field:disabled { color: var(--muted); background-color: var(--bg); border-style: dashed; }
  fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  legend { padding: 0; margin-bottom: var(--s2); font-size: var(--fs-sm); color: var(--muted); }
  .types { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s2); }
  .types legend { grid-column: 1 / -1; margin-bottom: 0; }
  .pill {
    min-height: 44px; padding: 0 var(--s2); font: inherit; font-size: var(--fs-sm); color: var(--text); background: var(--surface);
    border: 1px solid var(--rule-strong); border-radius: var(--r-sm); cursor: pointer;
  }
  .pill[aria-pressed='true'], .chip[aria-pressed='true'] { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); font-weight: 600; }
  .pill:not([aria-pressed='true']):hover, .chip:not([aria-pressed='true']):hover { background: var(--accent-soft); }
  .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--s3); }
  .check { display: inline-flex; align-items: center; gap: var(--s2); min-height: 44px; font-size: var(--fs-sm); color: var(--text); cursor: pointer; }
  .check input { width: 20px; height: 20px; flex: none; accent-color: var(--accent); }
  .check:has(input:disabled) { color: var(--muted); cursor: not-allowed; }
  .terms { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .terms legend { flex: 1 1 100%; }
  .mb, .mu { color: var(--muted); }
  .chip {
    min-height: 44px; padding: 0 var(--s3); font: inherit; font-size: var(--fs-sm); color: var(--text); background: var(--surface);
    border: 1px solid var(--rule-strong); border-radius: var(--r-md); cursor: pointer;
  }
  .ctl .phone { display: grid; }
  .ctl .desk { display: none; }
  .wd { grid-column: auto; }
  .lbl { font-size: var(--fs-sm); line-height: 1.2; color: var(--muted); }
  .ctl label:not(.check) { line-height: 1.2; }
  .terms-dd { gap: var(--s1); align-content: start; }
  .dd { position: relative; }
  .dd summary { display: flex; align-items: center; cursor: pointer; list-style: none; }
  .dd summary::-webkit-details-marker { display: none; }
  .ddlist { display: grid; padding: var(--s2); margin-top: var(--s1); border: 1px solid var(--rule-strong); border-radius: var(--r-sm); background: var(--surface); }
  .opt { display: flex; align-items: center; gap: var(--s2); min-height: 44px; font-size: var(--fs-sm); color: var(--text); cursor: pointer; }
  .opt input { width: 20px; height: 20px; flex: none; accent-color: var(--accent); }
  .ol { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .flt { display: grid; gap: var(--s2); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .addf { width: auto; min-width: 120px; flex: 1 1 120px; }
  .fchip { display: inline-flex; max-width: 100%; border: 1px solid var(--rule-strong); border-radius: var(--r-md); background: var(--surface); }
  .fchip.on { border-color: var(--accent); background: var(--accent-soft); }
  .fbtn, .fx { min-height: 44px; font: inherit; font-size: var(--fs-sm); color: var(--text); background: none; border: 0; cursor: pointer; }
  .fbtn { padding: 0 var(--s2) 0 var(--s3); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx { min-width: 44px; font-size: 20px; }
  .editor { display: grid; gap: var(--s2); padding: var(--s3); border: 1px solid var(--rule); border-radius: var(--r-sm); background: var(--bg); }
  .ehead { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); }
  .range { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2); }
  .range label { display: grid; gap: var(--s1); font-size: var(--fs-sm); color: var(--muted); }
  .yn { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2); }
  .olist { display: grid; max-height: 220px; overflow-y: auto; }
  .count { margin: 0; font-size: var(--fs-xs); }
  .btn.small { min-height: 44px; }
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
  .legend { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); font-size: var(--fs-xs); }
  .legend li { display: inline-flex; align-items: center; gap: var(--s2); }
  .legend i { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
  .ramp { display: flex; align-items: center; gap: var(--s2); font-size: var(--fs-xs); max-width: 320px; }
  .ramp i { flex: 1; height: 12px; border: 1px solid var(--rule); }
  .totals { display: flex; align-items: center; gap: var(--s2); font-size: var(--fs-sm); color: var(--muted); }
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
    .setbtn { display: none; }
    .ctl .phone { display: none !important; }
    .ctl { gap: var(--s3); }
    .ctl label:not(.check), .lbl { line-height: normal; }
    .ctl .types.desk { display: grid; }
    .ctl .terms.desk { display: flex; }
    .wd { grid-column: 1 / -1; }
    .ctl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
