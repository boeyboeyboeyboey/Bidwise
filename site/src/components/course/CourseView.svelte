<script lang="ts">
  import { onMount, setContext, tick } from 'svelte';
  import type { ForecastMeta, HistoryRow, ResultsPartial, Section } from '../../lib/data/types';
  import { resultsPending } from '../../lib/data/partial';
  import type { ForecastCtx } from './forecast-ctx';
  import { fetchCourse } from '../../lib/data/client';
  import { orderSections, type RowBid } from './sections';
  import { anyApprox, APPROX_NOTE, latestScan, scanTimeText, seatsLeftNow } from '../../lib/data/seats';
  import { pInAt, recommendBid, type SimResult } from '../../lib/sim';
  import { effectiveWindow } from '../../lib/sim/forecast';
  import { liveWindow } from '../../lib/data/window';
  import { getChosenWindow, onWindowChange, setChosenWindow } from '../../lib/state';
  import { eS, pct } from './fmt';
  import { BID_TARGETS, NO_BIDS, buildReportCsv, courseNote, reportFileName, sectionFacts, sgtStamp, type ReportRow } from '../../lib/report/csv';
  import { downloadCsv } from '../../lib/report/download';
  import { simSection } from './sectionSim';
  import SectionCard from './SectionCard.svelte';
  import SectionDetail from './SectionDetail.svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import { isPreAssigned, swapOptions, type SwapOption } from '../../lib/swap/swap';
  import { swapBidCents } from '../../lib/swap/swapSim';
  import { formatSlot } from '../../lib/format/slot';
  import { modeFromUrl, modeToSearch, orderForSwap, SWAP_DISCLAIMER, type Mode, type SwapCell } from './swapUi';

  let { code, title = '', sections, windowName, currentTerm, latestWindow, resultsPartial = null, openScanAt = null, prevScanAt = null, forecastMeta }: {
    /** Set while the newest window's results are only partly released. */
    resultsPartial?: ResultsPartial | null; code: string; title?: string; sections: Section[]; windowName: string; currentTerm: string; latestWindow: string; openScanAt?: string | null; prevScanAt?: string | null; forecastMeta: ForecastMeta } = $props();
  const ordered = $derived(orderSections(sections));
  const preferred = [windowName, latestWindow];
  // The current window re-picked from the clock in the browser (open now, or the next to open); the build's pick until then.
  let curName = $state<string | null>(null);
  let curUpcoming = $state(false);
  const currentName = $derived(curName ?? windowName);

  let history = $state<HistoryRow[] | null>(null);
  let withForecast = $state<Map<string, Section> | null>(null);
  let failed = $state(false);
  // The bidding window chosen on this site; null = the open window.
  let chosen = $state<string | null>(null);
  // The chance the suggested bids aim for. Shared by every row and the detail.
  let target = $state(0.9);
  // This term's results for each class, from the latest window with results.
  const latestBy = $derived.by(() => {
    const m = new Map<string, HistoryRow>();
    for (const r of history ?? []) if (r.term === currentTerm && r.window === latestWindow) m.set(r.classNumber, r);
    return m;
  });

  setContext<ForecastCtx>('forecast', {
    get code() { return code; },
    get meta() { return forecastMeta; },
    get currentWindow() { return currentName; },
    get currentUpcoming() { return curUpcoming; },
    get chosenWindow() { return chosen; },
    setWindow(label: string) { chosen = label; setChosenWindow(label); },
    get bySection() { return withForecast; },
    get failed() { return failed; },
    latestFor(classNumber: string) { return latestBy.get(classNumber) ?? null; },
    pendingFor(classNumber: string) { return !!history && resultsPending(resultsPartial, latestWindow, latestBy.has(classNumber)); },
    get desktop() { return desktop; },
    get target() { return target; },
    setTarget(t: number) { target = t; },
    select(id: string) { choose(id, true); },
    get canReport() { return !!withForecast; },
    get reporting() { return reporting; },
    downloadReport() { void downloadReport(); },
  });

  // One simulation per open section (group of 1, the chosen window), run as soon as the course file has loaded, so every row can show
  // its bid without a click. Results land row by row; null = this section has no forecast. sectionSim caches them for the detail panel.
  let sims = $state.raw(new Map<string, SimResult | null>());
  let simToken = 0;
  $effect(() => {
    const m = withForecast;
    const chosenWin = chosen;
    const open = currentName;
    const my = ++simToken;
    const acc = new Map<string, SimResult | null>();
    sims = acc;
    if (!m) return;
    for (const s0 of ordered) {
      const s = m.get(s0.classNumber);
      if (!s || seatsLeftNow(s) <= 0) continue;
      const win = effectiveWindow(chosenWin, open, forecastMeta.windows.filter((w) => !!s.forecast?.[w]));
      const job = simSection(s, win, 1);
      if (!job) {
        acc.set(s0.classNumber, null);
        continue;
      }
      job.then(
        (r) => {
          if (my !== simToken) return;
          sims = new Map(acc.set(s0.classNumber, r));
        },
        () => {
          if (my !== simToken) return;
          sims = new Map(acc.set(s0.classNumber, null));
        },
      );
    }
    if (acc.size) sims = new Map(acc);
  });

  const bids = $derived.by(() => {
    const out = new Map<string, RowBid>();
    for (const [cn, r] of sims) {
      if (!r) continue;
      const cents = recommendBid(r, target);
      out.set(cn, { cents, p: pInAt(r, cents) });
    }
    return out;
  });
  // The open section with the lowest bid at the chosen chance (first one on a tie).
  const bestId = $derived.by(() => {
    let id: string | null = null;
    let low = Infinity;
    for (const s of ordered) {
      const b = bids.get(s.classNumber);
      if (b && b.cents < low) {
        low = b.cents;
        id = s.id;
      }
    }
    return id;
  });
  const bestSection = $derived(ordered.find((s) => s.id === bestId));
  const bestBid = $derived(bestSection ? (bids.get(bestSection.classNumber) ?? null) : null);
  const openSections = $derived(ordered.filter((s) => seatsLeftNow(s) > 0));
  function rowBid(s: Section): RowBid | 'full' | 'none' | 'wait' {
    if (seatsLeftNow(s) <= 0) return 'full';
    if (failed) return 'none';
    if (!withForecast || !sims.has(s.classNumber)) return 'wait';
    return bids.get(s.classNumber) ?? 'none';
  }

  // Past this many sections the full ones fold behind a button (sooner on phones, where the list does not scroll on its own).
  const MAX_ROWS = 14;
  const MAX_ROWS_PHONE = 6;
  let showFull = $state(false);
  const scanText = $derived(scanTimeText(latestScan(sections)));
  const approxAny = $derived(anyApprox(sections));
  const fullCount = $derived(ordered.filter((s) => seatsLeftNow(s) <= 0).length);
  const foldable = $derived(!swapping && ordered.length > (desktop ? MAX_ROWS : MAX_ROWS_PHONE) && fullCount > 0);
  const shownSection = $derived(desktop ? current : ordered.find((s) => s.id === openId));
  const hideFull = $derived(foldable && !showFull && (shownSection ? seatsLeftNow(shownSection) : 1) > 0);

  // Swap mode: the person's own section, and the chance of swapping into each other section.
  let mode = $state<Mode>('bid');
  let mine = $state('');
  const swapping = $derived(mode === 'swap');
  // Predicted Round 1 Window 1 median bid of every section (the simulator, off the main thread). Null until all have come back, so rows show "Calculating".
  let swapBids = $state.raw<Map<string, number> | null>(null);
  let swapToken = 0;
  $effect(() => {
    const m = withForecast;
    const on = swapping;
    const h = history;
    const my = ++swapToken;
    swapBids = null;
    if (!m || !on || !h) return;
    // Pre-assigned courses are scored from the forecast bid level, so they need no simulation.
    if (isPreAssigned(h)) {
      swapBids = new Map();
      return;
    }
    const acc = new Map<string, number>();
    const jobs = [...m.values()].map((s) => {
      const job = swapBidCents(s);
      return job ? job.then((c) => void acc.set(s.section, c), () => {}) : Promise.resolve();
    });
    void Promise.all(jobs).then(() => {
      if (my === swapToken) swapBids = acc;
    });
  });
  const swapMap = $derived.by(() => {
    const m = new Map<string, SwapOption>();
    if (!swapping || !mine || !withForecast || !history || !swapBids) return m;
    for (const o of swapOptions({ sectionsNow: [...withForecast.values()], history }, mine, swapBids)) m.set(o.section, o);
    return m;
  });
  const swapRows = $derived(orderForSwap(ordered, mine || null, swapMap));
  function swapCell(s: Section): SwapCell {
    if (s.section === mine) return { kind: 'mine' };
    if (!mine) return { kind: 'pick' };
    const o = swapMap.get(s.section);
    return o ? { kind: 'opt', opt: o } : { kind: 'wait' };
  }
  function setMode(m: Mode) {
    mode = m;
    syncUrl();
  }
  function syncUrl() {
    try {
      window.history.replaceState(null, '', location.pathname + modeToSearch(location.search, mode, mine || null) + location.hash);
    } catch {
      /* URL not writable: the page still works */
    }
  }
  const rows = $derived(swapping ? swapRows : hideFull ? openSections : ordered);

  // Fades the bottom of the scrolling list while more sections are below.
  let listEl = $state<HTMLUListElement>();
  let moreBelow = $state(false);
  function measure() {
    const el = listEl;
    moreBelow = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4;
  }
  $effect(() => {
    const el = listEl;
    rows;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  let desktop = $state(false);
  let mounted = $state(false);
  const showDesk = $derived(!mounted || desktop);
  // Phone: the section open under its row. Desktop: the section in the side panel.
  let openId = $state<string | null>(null);
  let selectedId = $state<string | null>(null);
  const current = $derived(ordered.find((s) => s.id === selectedId) ?? (swapping ? swapRows[0] : undefined) ?? ordered[0]);

  onMount(() => {
    fetchCourse(code).then((d) => {
      history = d.history;
      withForecast = new Map(d.sectionsNow.map((s) => [s.classNumber, s]));
    }, () => (failed = true));
    const mq = matchMedia('(min-width: 1024px)');
    const upd = () => (desktop = mq.matches);
    upd();
    mounted = true;
    // ?s=G1 (section name or class number) or #id names the section to open instead of the lowest-bid one.
    const u = modeFromUrl(location.search);
    mode = u.mode;
    mine = sections.find((s) => !!u.from && s.section.toLowerCase() === u.from.toLowerCase())?.section ?? '';
    const want = new URLSearchParams(location.search).get('s')?.trim().toLowerCase() || decodeURIComponent(location.hash.slice(1)).toLowerCase();
    const named = want ? sections.find((s) => s.id.toLowerCase() === want || s.section.toLowerCase() === want || s.classNumber === want) : undefined;
    if (named) {
      openId = named.id;
      selectedId = named.id;
    }
    const lw = liveWindow();
    if (lw) {
      curName = `Round ${lw.round} Window ${lw.window}`;
      curUpcoming = lw.status === 'upcoming';
    }
    chosen = getChosenWindow();
    const offWindow = onWindowChange((l) => (chosen = l));
    mq.addEventListener('change', upd);
    return () => {
      mq.removeEventListener('change', upd);
      offWindow();
    };
  });

  // Bid report CSV: every section of this course in the window chosen on the site, the same bids the rows show (group of 1).
  let reporting = $state(false);
  async function downloadReport() {
    const m = withForecast;
    if (!m || reporting) return;
    reporting = true;
    try {
      const out: ReportRow[] = await Promise.all(
        ordered.map(async (s0) => {
          const s = m.get(s0.classNumber) ?? s0;
          const wins = forecastMeta.windows.filter((w) => !!s.forecast?.[w]);
          const win = effectiveWindow(chosen, currentName, wins);
          const job = seatsLeftNow(s) > 0 ? simSection(s, win, 1) : null;
          const r = job ? await job : null;
          const bids = r ? (Object.fromEntries(BID_TARGETS.map((t) => [t, recommendBid(r, t)])) as ReportRow['bids']) : NO_BIDS;
          return { ...sectionFacts(code, title, s), window: wins.length ? win : '', bids, note: courseNote(s, wins.length > 0) };
        }),
      );
      const now = new Date();
      downloadCsv(reportFileName(code, now), buildReportCsv(out, { title: `Bidwise bid report: ${code}${title ? ` ${title}` : ''}`, generatedAt: sgtStamp(now), plan: false }));
    } finally {
      reporting = false;
    }
  }

  /**
   * Opens a section. On a phone it opens under its row and closes the one that was open; the row the person tapped is then put back
   * where it was on screen, so the page does not jump when the closing panel above it shrinks.
   */
  async function choose(id: string, fromLink = false) {
    const row = document.getElementById(id);
    const before = row?.getBoundingClientRect().top ?? 0;
    if (desktop) selectedId = id;
    else openId = openId === id && !fromLink ? null : id;
    selectedId = id;
    await tick();
    const after = document.getElementById(id)?.getBoundingClientRect().top;
    if (after === undefined) return;
    if (fromLink) {
      // Reached from a link inside another panel: bring the section into view.
      if (desktop) document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
      else window.scrollBy({ top: after - 72, behavior: 'instant' });
    } else if (!desktop && Math.abs(after - before) > 1) window.scrollBy({ top: after - before, behavior: 'instant' });
  }
</script>

{#if sections.length === 0}
  <p class="off">Not offered this term</p>
  {#if failed}
    <p class="off" role="alert">Could not load past results</p>
  {:else if history}
    <HistoryPanel {history} {preferred} />
  {/if}
{:else}
<div class="cols">
  <div class="list">
    {#if sections.length > 1}
      <div class="modebar">
        <div class="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={!swapping} onclick={() => setMode('bid')}>Bid</button>
          <button type="button" aria-pressed={swapping} onclick={() => setMode('swap')}>Swap</button>
        </div>
      </div>
    {/if}
    {#if swapping}
      <label class="mine"><span>My section</span>
        <select bind:value={mine} onchange={syncUrl}>
          <option value="">Select</option>
          {#each ordered as s (s.id)}
            <option value={s.section}>{s.section} · {formatSlot(s.meetings) || 'Time not set'} · {s.instructor || 'Instructor not listed'}</option>
          {/each}
        </select>
      </label>
      <p class="disc" role="note">{SWAP_DISCLAIMER}</p>
    {/if}
    <p class="sortnote">{#if scanText}<span>Seats as of {scanText}</span>{/if}{#if !swapping}<InfoTip label="About these bids and seat counts" lines={[`Open sections first. Bids are for 1 person, aiming for about a ${pct(target)} chance of a seat.`, ...(approxAny ? [`Seat counts marked “about” are estimates. ${APPROX_NOTE}`] : [])]} />{/if}</p>
    {#if approxAny}<p class="sortnote">Seats marked ≈ are estimates.</p>{/if}
    {#if !swapping && bestSection && bestBid}
      <button type="button" class="btn best" aria-label={`Show ${bestSection.section}, lowest bid ${eS(bestBid.cents)}, ${pct(bestBid.p)} chance`} onclick={() => choose(bestSection.id, true)}>
        <span class="bt">Lowest bid: <b>{bestSection.section}</b> <b class="num">{eS(bestBid.cents)}</b> <span aria-hidden="true">→</span> {pct(bestBid.p)} chance</span>
        <span class="go" aria-hidden="true">›</span>
      </button>
    {/if}
    <div class="colhead head" aria-hidden="true">
      <span>Section</span>
      <span>Professor</span>
      <span>Day and time</span>
      <span>Seats</span>
      <span class="r">{swapping ? 'Swap chance' : 'Bid → chance'}</span>
    </div>
    <ul bind:this={listEl} class:more-below={moreBelow} onscroll={measure}>
      {#each rows as s (s.id)}
        <SectionCard
          section={s}
          bid={rowBid(s)}
          {history}
          {failed}
          {preferred}
          {desktop}
          {openScanAt}
          open={!desktop && openId === s.id}
          selected={desktop && !!current && current.id === s.id}
          best={s.id === bestId}
          swap={swapping ? swapCell(s) : null}
          ontoggle={() => choose(s.id)}
        />
      {/each}
    </ul>
    {#if foldable}
      <div class="acts">
        <button type="button" class="btn" aria-expanded={!hideFull} onclick={() => (showFull = !showFull)}>{hideFull ? `Show ${fullCount} full ${fullCount === 1 ? 'section' : 'sections'}` : 'Hide full sections'}</button>
      </div>
    {/if}
  </div>

  {#if showDesk && current}
    <aside class="side" aria-label="Selected section">
      <div class="panel">
        <h2>{current.section} <span>{current.instructor || 'Instructor not listed'}</span></h2>
        {#key current.id}
          <SectionDetail section={current} {history} {failed} {preferred} {openScanAt} forecastCard={!swapping} />
        {/key}
      </div>
    </aside>
  {/if}
</div>
{/if}

<style>
  .off { color: var(--muted); margin: 0 0 var(--s4); }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s5); }
  .list { --cols: 56px minmax(0, 1.1fr) minmax(0, 1.3fr) minmax(0, 1.2fr) 172px; min-width: 0; container-type: inline-size; }
  .side { display: none; }
  .head { display: none; }
  .r { text-align: right; }
  .sortnote { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); margin: 0; min-height: 28px; font-size: var(--fs-xs); color: var(--muted); }
  .side h2 { margin-bottom: var(--s2); font-size: var(--fs-md); font-weight: 600; }
  .side h2 span { margin-left: var(--s2); font-weight: 400; color: var(--muted); }
  .best { justify-content: space-between; align-items: center; gap: var(--s3); flex-wrap: wrap; width: 100%; min-height: 44px; margin: var(--s1) 0 var(--s2); font-weight: 400; text-align: left; }
  .best .go { margin-left: auto; color: var(--accent); font-weight: 600; white-space: nowrap; }
  .best b { font-weight: 600; }
  .modebar { margin: 0 0 var(--s2); }
  .modebar .seg > button { min-height: 44px; min-width: 88px; }
  .mine { display: grid; gap: var(--s1); margin: 0 0 var(--s2); font-size: var(--fs-xs); color: var(--muted); }
  .mine select { width: 100%; min-height: 44px; padding: 0 var(--s3); font: inherit; font-size: var(--fs-sm); color: var(--text); background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); }
  .disc { margin: 0 0 var(--s2); padding: var(--s2) var(--s3); font-size: var(--fs-xs); color: var(--text); background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); }
  .acts { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s2); }

  /* Wide list (a desktop column, or a tablet): one line per row with labelled column headers. SectionCard reads the same --cols. */
  @container (min-width: 640px) {
    .head { display: grid; grid-template-columns: var(--cols); column-gap: var(--s3); padding-right: 28px; line-height: 1.2; }
  }
  @media (min-width: 1024px) {
    /* One screen: the section list scrolls inside this height (fade cue); the detail panel flows with the page (page header, footer and padding taken off). */
    .cols { --avail: calc(100vh / var(--z) - var(--topbar-h) - 178px); grid-template-columns: minmax(480px, 1.2fr) minmax(360px, 1fr); align-items: start; gap: var(--s6); }
    .list { display: flex; flex-direction: column; max-height: var(--avail); }
    .list ul { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    .list ul.more-below { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent); }
    .side { display: block; }
  }
</style>
