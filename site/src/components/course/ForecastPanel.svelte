<script lang="ts">
  import { fullText, seatsLeftNow } from '../../lib/data/seats';
  import DropChance from './DropChance.svelte';
  import { getContext, type Snippet } from 'svelte';
  import type { HistoryRow, Section } from '../../lib/data/types';
  import { recommendBid, type SimResult } from '../../lib/sim';
  import { MAX_FRIENDS_GROUP, TARGETS, clampGroup, effectiveWindow, isLowConfidence } from '../../lib/sim/forecast';
  import { addToPlan, onPlanChange, planHas } from '../../lib/state';
  import type { ForecastCtx } from './forecast-ctx';
  import OtherSections from './OtherSections.svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import HistorySummary from './HistorySummary.svelte';
  import { simSection } from './sectionSim';
  import { bidOrNone, eS, pct } from './fmt';
  import { refitNote } from '../../lib/data/refitNote';

  let { section, history, failed = false, currentTerm, children }: {
    section: Section;
    history: HistoryRow[] | null;
    failed?: boolean;
    currentTerm: string;
    /** Shown between the answer block and the tabs (the seat trend). */
    children?: Snippet;
  } = $props();
  const ctx = getContext<ForecastCtx>('forecast');
  const uid = $props.id();

  const full = $derived(ctx.bySection?.get(section.classNumber) ?? null);
  // Only windows this section has a forecast for (all windows until the course file has loaded).
  const windows = $derived(full?.forecast ? ctx.meta.windows.filter((w) => !!full.forecast![w]) : ctx.meta.windows);
  // The window chosen in the site header (kept across sections); the open window if that has no forecast here.
  const win = $derived(effectiveWindow(ctx.chosenWindow, ctx.currentWindow, windows));
  let group = $state(1);
  // The group size the person asked for when it was more than the seats left (0 = none): shown in the note and used for "Other sections".
  let tried = $state(0);
  // The chance the bids aim for is shared with the section list, so a row and this answer never disagree.
  const target = $derived(ctx.target);
  type Tab = 'past' | 'others';
  // Beside the list the past results show at once; under a row on a phone they stay folded until asked for (they run to thousands of pixels).
  let picked = $state<Tab | 'none' | null>(null);
  const tab = $derived<Tab | 'none'>(picked ?? (ctx.desktop ? 'past' : 'none'));
  function openTab(t: Tab) {
    picked = !ctx.desktop && tab === t ? 'none' : t;
  }

  const note = $derived(refitNote(ctx.meta));
  const fw = $derived(full?.forecast?.[win] ?? null);
  const minBid = $derived(full?.minBidCents ?? null);
  const seats = $derived(seatsLeftNow(section));
  const soldOut = $derived(seats <= 0);
  const maxGroup = $derived(Math.max(1, Math.min(MAX_FRIENDS_GROUP, seats)));
  const latest = $derived(ctx.latestFor(section.classNumber));
  const hasLast = $derived(!!latest && (latest.medianCents !== null || latest.minCents !== null));
  const tabs: { v: Tab; l: string }[] = [
    { v: 'past', l: 'Past results' },
    { v: 'others', l: 'Other sections' },
  ];

  // The latest finished simulation, with the window and group size it was run for.
  let res = $state<{ r: SimResult; win: string; group: number } | null>(null);
  let token = 0;

  $effect(() => {
    const f = full;
    const w = win;
    const g = group;
    if (!f || soldOut) return;
    const p = simSection(f, w, g);
    if (!p) return;
    const my = ++token;
    p.then((r) => {
      if (my === token) res = { r, win: w, group: g };
    });
  });

  const live = $derived(!!fw && minBid !== null && !soldOut);
  const sim = $derived(res?.r ?? null);
  // After a window or group change the previous result stays (dimmed, under its own window label) until the new one arrives.
  const stale = $derived(!!res && (res.win !== win || res.group !== group));
  const rec = $derived(sim ? recommendBid(sim, target) : 0);
  const lowRel = $derived(!soldOut && isLowConfidence(ctx.meta.byWindow[win]));

  // null until the saved plan has been read in the browser, so the server-rendered button does not flip.
  let inPlan = $state<boolean | null>(null);
  $effect(() => {
    const code = ctx.code;
    const id = section.id;
    const sync = () => (inPlan = planHas(code, id));
    sync();
    return onPlanChange(sync);
  });

  // The three aim bids are the same: the minimum bid already gets the seat.
  const allSame = $derived(!!sim && TARGETS.every((t) => recommendBid(sim!, t) === recommendBid(sim!, TARGETS[0])));

  function setGroup(g: number) {
    const c = clampGroup(g);
    tried = c > maxGroup ? c : 0;
    group = Math.min(maxGroup, c);
  }
  function onGroup(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    setGroup(parseFloat(el.value));
    el.value = String(group);
  }
  // "Other sections" is sized for the larger group asked for, if any other section has room for it.
  const othersGroup = $derived(tried > group && othersFit ? tried : group);
  // Whether some other section has room for the group the person tried (true while the other sections are still loading).
  const othersFit = $derived(!ctx.bySection || [...ctx.bySection.values()].some((o) => o.classNumber !== section.classNumber && seatsLeftNow(o) >= tried));
  const rangeText = $derived(`Max ${maxGroup}`);
  const showControls = $derived(!soldOut && windows.length > 0 && !!full?.forecast);
</script>

{#snippet aim()}
  <div class="aimrow" role="group" aria-label="Chance you want">
    <span class="lab aimlab" aria-hidden="true">Chance you want:</span>
    <div class="seg aim">
      {#each TARGETS as t}
        <button type="button" class="num" aria-pressed={target === t} onclick={() => ctx.setTarget(t)}>{pct(t)}</button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet capmsg()}
  {maxGroup} {maxGroup === 1 ? 'seat' : 'seats'} left, {tried} won't fit.
  {#if othersFit}<button type="button" class="link" onclick={() => (picked = 'others')}>Sections with {tried}+ seats</button>{/if}
  <button type="button" class="link" onclick={() => setGroup(group)}>Bid for {group}</button>
{/snippet}

<section class="fc" aria-label="Bid for this section">
  {#if soldOut}
    <div class="answer soldout">
      <p class="sold"><b>{fullText(section)} after {section.latestWindow}</b></p>
      <DropChance />
      {#if latest && hasLast}
        <dl class="figs num">
          <div><dt>Last median bid</dt><dd>{bidOrNone(latest.medianCents)}</dd></div>
          <div><dt>Last lowest bid</dt><dd>{bidOrNone(latest.minCents)}</dd></div>
        </dl>
      {/if}
      <button type="button" class="btn" onclick={() => (picked = 'others')}>See other sections</button>
    </div>
  {:else if tried > 0}
    <div class="answer">
      <p class="capline" role="status">{@render capmsg()}</p>
    </div>
  {:else if !windows.length}
    <p class="none">No forecast available</p>
  {:else if !ctx.bySection && !ctx.failed}
    <div class="answer wait" aria-busy="true" aria-label="Loading bid"></div>
  {:else if !full?.forecast}
    <p class="none">No forecast for this section yet</p>
  {:else if !fw || minBid === null}
    <p class="none">No forecast for this section in this window</p>
  {:else if live && res}
    <div class="answer" class:stale>
      <p class="win">{res.win}{#if ctx.currentUpcoming && res.win === ctx.currentWindow}&nbsp;· upcoming{/if}{#if stale}&nbsp;· <span class="upd">Updating…</span>{/if}</p>
      <p class="headline num" aria-live="polite">
        Bid <b>{eS(rec)}</b>{#if res.group > 1}&nbsp;each{/if}
      </p>
      <p class="disc">Estimated from past bids; not a guarantee: bids vary from window to window.</p>
      {#if note}<p class="disc">{note}</p>{/if}
      {#if lowRel}<span class="tag">Low reliability</span>{/if}
      {#if allSame}
        <p class="sub num">Minimum bid {eS(minBid ?? rec)}</p>
      {:else}
        {@render aim()}
      {/if}
      {#if hasLast && latest}
        <p class="last num">Last window ({latest.window}): lowest {bidOrNone(latest.minCents)} · median {bidOrNone(latest.medianCents)}</p>
      {/if}
    </div>
  {:else}
    <div class="answer wait" aria-busy="true" aria-label="Loading bid"></div>
  {/if}

  {#if showControls}
    <div class="step" role="group" aria-labelledby="gl-{uid}">
      <span class="lab" id="gl-{uid}">People</span>
      <div class="ctlrow">
        <button type="button" class="btn btn-icon" aria-label="Fewer people" disabled={group <= 1} onclick={() => setGroup(group - 1)}>−</button>
        <input class="field num" type="number" inputmode="numeric" min="1" max={maxGroup} step="1" value={group} aria-label="Number of people" aria-describedby="gr-{uid}" onchange={onGroup} />
        <button type="button" class="btn btn-icon" aria-label="More people" disabled={group >= maxGroup} onclick={() => setGroup(group + 1)}>+</button>
      </div>
      <p class="range" id="gr-{uid}">{rangeText}</p>
    </div>
    <div class="acts">
      {#if inPlan === null}
        <span class="btn btn-primary ghost" aria-hidden="true">Add to plan</span>
      {:else if inPlan}
        <a class="btn in" href="/planner" role="status">In plan ✓ · View plan</a>
      {:else}
        <button type="button" class="btn btn-primary" onclick={() => { addToPlan(ctx.code, section.id, group); inPlan = true; }}>Add to plan</button>
      {/if}
      <button type="button" class="btn" disabled={!ctx.canReport || ctx.reporting} onclick={() => ctx.downloadReport()}>Download all sections (CSV)</button>
    </div>
  {/if}
  {#if !soldOut}
    <div class="how">{#if live && res}<InfoTip showLabel />{/if}<a class="plan" href="/planner">Plan several courses ›</a></div>
  {/if}

  {@render children?.()}

  <div class="tabs" role="tablist" aria-label="More about this section">
    {#each tabs as t (t.v)}
      <button type="button" role="tab" id="tab-{uid}-{t.v}" aria-selected={tab === t.v} aria-controls="tabpanel-{uid}" tabindex={tab === t.v || (tab === 'none' && t.v === 'past') ? 0 : -1} onclick={() => openTab(t.v)}>{t.l}</button>
    {/each}
  </div>

  {#if tab !== 'none'}
  <div class="tabpanel" id="tabpanel-{uid}" role="tabpanel" aria-labelledby="tab-{uid}-{tab}">
  {#if tab === 'past'}
    {#if failed}
      <p class="none" role="alert">Could not load past results</p>
    {:else if !history}
      <div class="skel" aria-busy="true" aria-label="Loading"></div>
    {:else}
      <HistorySummary {history} code={ctx.code} {currentTerm} instructor={section.instructor} hideTitle />
    {/if}
  {:else}
    {#if !ctx.bySection && !ctx.failed}
      <div class="skel" aria-busy="true" aria-label="Loading other sections"></div>
    {:else if windows.length}
      {#if !soldOut && live && sim}{@render aim()}{/if}
      <OtherSections {section} {win} group={soldOut ? 1 : othersGroup} {target} fit={!soldOut && othersGroup > group ? othersGroup : 0} onall={() => setGroup(group)} />
    {:else}
      <p class="none">No forecast available</p>
    {/if}
  {/if}
  </div>
  {/if}
</section>

<style>
  .fc { display: grid; gap: var(--s3); min-width: 0; }
  .none { margin: 0; color: var(--muted); }
  .lab { font-size: var(--fs-sm); color: var(--text); }
  .tag {
    display: inline-flex; align-items: center; min-height: 26px; padding: 0 var(--s2); white-space: nowrap;
    font-size: var(--fs-xs); font-weight: 600; color: var(--text); background: var(--bg); border: 1px solid var(--rule-strong); border-radius: 4px;
    justify-self: start;
  }
  .step { display: grid; gap: var(--s1); min-width: 0; }
  .ctlrow { display: flex; align-items: center; gap: var(--s1); }
  .ctlrow .btn-icon { width: 44px; height: 44px; min-width: 44px; min-height: 44px; padding: 0; }
  .ctlrow .field { width: 64px; min-height: 44px; padding: 8px 4px; text-align: center; }
  .range { margin: 0; font-size: var(--fs-xs); color: var(--muted); }
  .seg > button { min-height: 44px; padding: 0 var(--s3); }
  .link { min-height: 44px; padding: 0 var(--s1); font: inherit; font-weight: 600; color: var(--accent); background: none; border: 0; text-decoration: underline; cursor: pointer; }
  .acts { display: grid; gap: var(--s2); }
  .acts .btn { min-height: 44px; }
  .acts .btn-primary, .acts .in { min-height: 48px; font-size: var(--fs-md); }
  .acts .btn:not(.btn-primary):not(.in) { justify-self: start; min-height: 40px; font-weight: 400; font-size: var(--fs-sm); }
  .in { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); white-space: nowrap; }
  .ghost { visibility: hidden; }
  .how { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 var(--s4); }
  .plan { display: inline-flex; align-items: center; min-height: 44px; font-weight: 600; font-size: var(--fs-sm); color: var(--accent); }
  .aimrow { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1) var(--s2); }
  .aimlab { white-space: nowrap; }
  .aim { display: flex; flex: 1 1 320px; }
  .aim > button { flex: 1 1 0; min-height: 44px; padding: 0 var(--s2); white-space: nowrap; font-size: var(--fs-sm); }
  /* Selected chance: light tint, green edge, dark text, so "Add to plan" is the one filled button. */
  .aim > button[aria-pressed='true'] { color: var(--text); background: var(--accent-soft); outline: 2px solid var(--accent); outline-offset: -2px; font-weight: 600; }
  .aim > button[aria-pressed='true']:hover { background: var(--accent-soft); }
  .capline { margin: 0; font-size: var(--fs-md); }
  .sub { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--s2) var(--s4); margin: 0; }
  .figs div { display: grid; align-content: start; }
  .figs dt { font-size: var(--fs-sm); color: var(--muted); }
  .figs dd { margin: 0; font-size: var(--fs-lg); font-weight: 600; }
  .answer { display: grid; min-width: 0; gap: var(--s2); padding: var(--s3) var(--s4); background: var(--accent-soft); border-radius: var(--r-md); }
  .answer.wait { min-height: 120px; }
  .headline { margin: 0; font-size: var(--fs-lg); line-height: 1.3; overflow-wrap: anywhere; min-width: 0; }
  .headline b { font-size: var(--fs-xl); font-weight: 700; }
  .disc { margin: 0; font-size: var(--fs-xs); color: var(--muted); }
  .upc { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .last { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .win { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .stale .headline b, .stale .aimrow, .stale .sub { opacity: 0.5; }
  .upd { font-weight: 600; color: var(--text); }
  .tabs { display: flex; gap: var(--s1); border-bottom: 1px solid var(--rule-strong); overflow-x: auto; max-width: 100%; min-width: 0; }
  .tabs button {
    min-height: 44px; padding: 0 var(--s3); font: inherit; font-size: var(--fs-sm); font-weight: 600; color: var(--muted);
    background: none; border: 0; border-bottom: 3px solid transparent; margin-bottom: -1px; cursor: pointer; white-space: nowrap;
  }
  .tabs button:hover { color: var(--text); }
  .tabs button[aria-selected='true'] { color: var(--text); border-bottom-color: var(--accent); }
  .tabpanel { display: grid; gap: var(--s2); padding-top: var(--s1); min-width: 0; align-content: start; }
  .soldout { justify-items: start; }
  .sold { margin: 0; font-size: var(--fs-md); }
  .sold b { font-weight: 600; }
  .skel { height: 160px; border-radius: var(--r-sm); background: linear-gradient(var(--rule), var(--rule)) 0 50% / 100% 1px no-repeat; }
  @media (max-width: 640px) {
    .aim { min-width: 0; flex: 1 1 100%; }
  }
</style>
