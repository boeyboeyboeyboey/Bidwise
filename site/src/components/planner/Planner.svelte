<script lang="ts">
  import { flushSync, onMount, tick, untrack } from 'svelte';
  import type { CourseData } from '../../lib/data/types';
  import { fetchCourse } from '../../lib/data/client';
  import type { SimResult } from '../../lib/sim';
  import { runOptimise, runSim } from '../../lib/sim/client';
  import { recommendBid } from '../../lib/sim';
  import { TARGETS } from '../../lib/sim/forecast';
  import type { PlanItem, PlanResult, Role } from '../../lib/sim/planner';
  import { liveWindow } from '../../lib/data/window';
  import { BALANCE_KEY, getBalanceText, getChosenWindow, getPlan, onPlanChange, onWindowChange, savePlan, setBalanceText, setChosenWindow } from '../../lib/state';
  import { eS, pct } from '../course/fmt';
  import { buildReportCsv, reportFileName, sgtStamp, type ReportMeta, type ReportRow } from '../../lib/report/csv';
  import { downloadCsv } from '../../lib/report/download';
  import { bidReason, planReportRow, planTotals } from '../../lib/report/plan';
  import ReportPrint from './ReportPrint.svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import CourseAdd from './CourseAdd.svelte';
  import PlanRow from './PlanRow.svelte';
  import {
    DEFAULT_TARGET, balanceFromCents, bidSummary, bidsAtTarget, biddableItems, balanceLabel, blurBalance, clampToRecommended, clashLines, clashSummary, courseLabel, findClashes, needSaver, needSentence, decodeShare, defaultSection, duplicateCourses, encodeShare, freeLetter, isCapped, overBalance,
    pickGroupFor, rowIssue, samePlan, snapTarget, toPlanSimInput, typeBalance, typicalNeedCents, type BalanceState, type StoredPlan,
  } from './plan';
  import { DAYS, type PlanRowState } from './types';

  let { windows, currentWindow: builtWindow, lowConfidence = [], hot = [], startTimes = [] }: {
    windows: string[];
    /** Distinct meeting start times this term ("08:15"), sorted: the rows of the can't-attend grid. */
    startTimes?: string[];
    /** The window the build picked as current; the browser re-picks from the clock. */
    currentWindow: string;
    lowConfidence?: string[];
    /** Most contested courses in the current window, for the quick-add chips. */
    hot?: { code: string; cents: number }[];
  } = $props();

  // Open now, or the next to open between windows: the default window and the one "no choice" means.
  const liveWin = liveWindow();
  const currentWindow = liveWin ? `Round ${liveWin.round} Window ${liveWin.window}` : builtWindow;
  const upcoming = liveWin?.status === 'upcoming';
  let rows = $state<PlanRowState[]>([]);
  const fallbackWindow = windows.includes(currentWindow) ? currentWindow : (windows[0] ?? '');
  let win = $state(fallbackWindow);
  let bal = $state<BalanceState>(balanceFromCents(null));
  /** The student's balance in cents, or null while empty: then bids are shown uncut, with no fit-to-balance logic. */
  const balanceCents = $derived(bal.cents);
  const balanceBad = $derived(bal.bad);
  /** Chance you want, as on the course page: 80, 90 or 95%. */
  let target = $state<number>(DEFAULT_TARGET);
  let avoid = $state<string[]>([]);
  let ready = $state(false);
  let fitting = $state(false);
  let avoidOpen = $state(false);
  /** Letter of the Pick one group whose list of options to add is open. */
  let addOpen = $state('');
  let loadError = $state('');
  /** The student's own saved plan, set aside while a different shared plan from the link is shown. */
  let mine = $state.raw<StoredPlan | null>(null);
  /** The window chosen before a shared plan switched it, so "Restore mine" can put it back. */
  let mineWindow: string | null = null;
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  /** Shown in a read-only field when the clipboard is blocked. */
  let shareUrl = $state('');
  let shareEl = $state<HTMLInputElement>();
  /** Two-column layout (result beside the rows): the bottom bar is not shown then. */
  let wide = $state(false);

  let courses = $state.raw<Record<string, CourseData>>({});
  let curves = $state.raw<Record<string, SimResult>>({});
  /** Bids fitted into the balance by the optimiser; used only when the recommended bids add up to more than the balance. */
  let fitted = $state.raw<PlanResult | null>(null);
  const inflight = new Set<string>();
  const loading = new Set<string>();
  const failed = new Set<string>();

  const uid = () => Math.random().toString(36).slice(2, 9);
  const simKey = (r: PlanRowState) => `${win}|${r.sectionId}|${r.group}`;

  async function loadCourse(code: string): Promise<CourseData | null> {
    if (courses[code]) return courses[code];
    if (loading.has(code) || failed.has(code)) return null;
    loading.add(code);
    try {
      const d = await fetchCourse(code);
      courses = { ...courses, [code]: d };
      for (const r of rows) {
        if (r.course === code && !d.sectionsNow.some((s) => s.id === r.sectionId)) {
          const taken = rows.filter((x) => x.course === code && x !== r).map((x) => x.sectionId);
          r.sectionId = defaultSection(d.sectionsNow, taken, avoid)?.id ?? r.sectionId;
        }
      }
      return d;
    } catch {
      failed.add(code);
      loadError = `Could not load ${code}`;
      rows = rows.filter((r) => r.course !== code);
      return null;
    } finally {
      loading.delete(code);
    }
  }

  // per-row section and why it can't be simulated (if so)
  const info = $derived(
    rows.map((r) => {
      const sec = courses[r.course]?.sectionsNow.find((s) => s.id === r.sectionId);
      return { sec, issue: sec ? rowIssue(sec, win, r.group) : null };
    }),
  );
  const okRows = $derived(rows.filter((_, i) => info[i].sec && !info[i].issue));
  const excluded = $derived(info.filter((x) => x.issue).length);
  const planItems = $derived.by(() => {
    const out: PlanItem[] = [];
    for (const r of okRows) {
      const c = curves[simKey(r)];
      if (c) out.push({ key: r.id, courseCode: r.course, role: r.role, oneOfGroup: r.oneOf, curve: c });
    }
    return out;
  });

  const blocks = $derived.by(() => {
    const out: number[][] = [];
    const at = new Map<string, number[]>();
    rows.forEach((r, i) => {
      if (r.role === 'oneOf') {
        const g = at.get(r.oneOf);
        if (g) { g.push(i); return; }
        const n = [i];
        at.set(r.oneOf, n);
        out.push(n);
      } else out.push([i]);
    });
    return out;
  });
  const rowName = (r: PlanRowState) => {
    const sec = courses[r.course]?.sectionsNow.find((s) => s.id === r.sectionId);
    return sec ? `${r.course} ${sec.section}` : r.course;
  };
  /** Setting a row to Pick one puts it with a course that is waiting for a partner, else in a new group. */
  function setRole(row: PlanRowState, role: Role) {
    if (role === 'oneOf' && row.role !== 'oneOf') row.oneOf = pickGroupFor(rows, row.id);
    row.role = role;
  }
  /** Pulls another course of the plan into the Pick one group of `letter`. */
  function joinGroup(id: string, letter: string) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    r.role = 'oneOf';
    r.oneOf = letter;
  }

  // name of the course that covers a skipped one-of row
  const coveredBy = (row: PlanRowState) => {
    if (row.role !== 'oneOf' || !result) return '';
    const o = rows.find((r) => r.id !== row.id && r.role === 'oneOf' && r.oneOf === row.oneOf && (result!.bids[r.id] ?? 0) > 0 && (result!.p[r.id] ?? 0) >= 0.05);
    return o ? rowName(o) : '';
  };

  const dupes = $derived(duplicateCourses(rows));
  const reqNeedCents = $derived(typicalNeedCents(planItems));
  const hasRequired = $derived(planItems.some((i) => i.role !== 'optional'));
  /** True when no row that can be simulated is a must-get or pick-one: the headline chance would be meaningless. */
  const noMust = $derived(okRows.length > 0 && !okRows.some((r) => r.role !== 'optional'));
  const allSimmed = $derived(okRows.length > 0 && planItems.length === okRows.length);
  /** Every row at the course page's recommended bid for the chance you want. */
  const full = $derived(allSimmed ? bidsAtTarget(planItems, target, balanceCents ?? 0) : null);
  /** The recommended bids add up to more than the balance, so they have to be cut to fit. */
  const needsFit = $derived(!!full && balanceCents !== null && full.bidTotalCents > balanceCents);
  const result = $derived(needsFit ? fitted : full);
  const pending = $derived(okRows.length > 0 && (!allSimmed || (needsFit && fitting)));
  const fullBidOf = (row: PlanRowState) => {
    const c = curves[simKey(row)];
    return c ? recommendBid(c, target) : null;
  };
  const over = $derived(hasRequired && balanceCents !== null && overBalance(reqNeedCents, balanceCents));
  const hopeless = $derived(!!result && !pending && result.pAll < 0.05);
  const overBudget = $derived(hopeless && over);
  /** Totals against the balance; null with no balance (then only the bid total is shown). */
  const sum = $derived(result && balanceCents !== null ? bidSummary(result.bidTotalCents, result.spentCents, balanceCents) : null);
  // Over balance, Nice to have rows are not bid on at all: Must gets come first.
  const hasOptional = $derived(rows.some((r) => r.role === 'optional'));
  /** Some bid is below the bid for the chance wanted, because the balance does not stretch. */
  const anyCut = $derived(!!result && !pending && needsFit && rows.some((r) => isCapped(result.bids[r.id] ?? null, fullBidOf(r), needsFit)));
  const saver = $derived((over || anyCut) && balanceCents !== null ? needSaver(planItems, balanceCents) : null);
  const showNotice = $derived(!!result && !pending && (hopeless || over));
  const showCallout = $derived(anyCut || showNotice);
  // Pick one group of a row, named by its courses ("IS469 / IS470").
  const pickOf = (row: PlanRowState) => (row.role === 'oneOf' ? courseLabel(rows.filter((r) => r.role === 'oneOf' && r.oneOf === row.oneOf).map((r) => r.course)) : '');
  /** One line on why the plan bids this much on a row, from its own forecast. */
  function reasonOf(row: PlanRowState, i: number): string {
    const sec = info[i]?.sec;
    if (!sec || info[i].issue || overBudget) return '';
    return bidReason({
      bid: result ? (result.bids[row.id] ?? null) : null,
      fullBid: fullBidOf(row),
      target,
      minBidCents: sec.minBidCents,
      curve: curves[simKey(row)],
      nObs: sec.forecast?.[win]?.nObs,
    });
  }
  const clashPairs = $derived(
    findClashes(
      rows.flatMap((r, i) => {
        const sec = info[i]?.sec;
        return sec ? [{ id: r.id, label: rowName(r), meetings: sec.meetings, alt: r.role === 'oneOf' ? r.oneOf : undefined }] : [];
      }),
    ),
  );
  const clashNote = $derived(clashSummary(clashPairs));
  function raiseBudget() {
    bal = balanceFromCents(Math.ceil(reqNeedCents / 100) * 100, true);
    setBalanceText(String(bal.cents! / 100));
  }

  /**
   * Adds the row at once, in its "Calculating…" state (no section yet); loadCourse picks the section when the course file arrives.
   * A course with no section to take is taken out again.
   */
  async function addRow(code: string) {
    loadError = '';
    const same = rows.filter((r) => r.course === code);
    if (same.length) {
      // already in the plan: no second row. Alternatives are added from a Pick one group.
      document.querySelector(`[data-row-id="${same[0].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const id = uid();
    rows.push({ id, course: code, sectionId: courses[code] ? (defaultSection(courses[code].sectionsNow, [], avoid)?.id ?? '') : '', group: 1, role: 'required', oneOf: 'A' });
    const d = await loadCourse(code);
    const row = rows.find((r) => r.id === id);
    if (row && !d?.sectionsNow.some((s) => s.id === row.sectionId)) rows = rows.filter((r) => r.id !== id);
  }
  /** Adds another section of a course already in the group `letter`, as an alternative. */
  function addSection(code: string, letter: string) {
    const d = courses[code];
    const same = rows.filter((r) => r.course === code);
    const sec = d && defaultSection(d.sectionsNow, same.map((r) => r.sectionId), avoid);
    if (!sec || same.some((r) => r.sectionId === sec.id)) return;
    rows.push({ id: uid(), course: code, sectionId: sec.id, group: same[0]?.group ?? 1, role: 'oneOf', oneOf: letter });
  }
  /** Adding by keyboard keeps the cursor in the box (the box is a new one when the first course is added), ready for the next code. */
  async function onAdd(code: string, byKey = false) {
    const done = addRow(code);
    if (byKey) {
      await tick();
      document.querySelector<HTMLInputElement>('.main input[type="search"]')?.focus();
    }
    await done;
  }
  const moreSections = (code: string) => (courses[code]?.sectionsNow.length ?? 0) > rows.filter((r) => r.course === code).length;
  function onAddPick(value: string, letter: string) {
    if (value.startsWith('sec:')) addSection(value.slice(4), letter);
    else joinGroup(value, letter);
  }

  const snap = (): StoredPlan => ({
    b: balanceCents,
    s: target,
    w: win === currentWindow ? '' : win,
    a: avoid,
    r: rows.filter((r) => r.sectionId).map((r) => ({ c: r.course, i: r.sectionId, g: r.group, o: r.role, l: r.oneOf })),
  });
  /** Rows, chance, busy times of a plan. The balance is not restored from it: it lives under its own key (old plans carried a default). */
  function apply(st: StoredPlan) {
    target = snapTarget(st.s);
    avoid = st.a;
    rows = st.r.map((r) => ({ id: uid(), course: r.c, sectionId: r.i, group: r.g, role: r.o, oneOf: r.l }));
  }
  const windowFor = (label: string | null) => (label && windows.includes(label) ? label : fallbackWindow);
  const setWindow = (w: string) => {
    win = w;
    setChosenWindow(w === currentWindow ? null : w);
  };
  function clearHash() {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* ignore */
    }
  }
  /** A "#share=" link shows that plan; the saved plan stays recoverable until the student decides. Other hashes are ignored. */
  function readHash() {
    const shared = decodeShare(location.hash);
    if (!shared) {
      if (location.hash) clearHash();
      return;
    }
    const saved = getPlan();
    if (saved?.r.length && !samePlan(shared, { ...saved, w: shared.w })) {
      if (!mine) {
        mine = saved;
        mineWindow = getChosenWindow();
      }
    } else clearHash();
    apply(shared);
    // 12500 was the old default balance (e$125); shared links made with it carry no balance.
    const sharedBal = shared.b === 12500 ? null : shared.b;
    if (sharedBal !== null) bal = balanceFromCents(sharedBal, true);
    setWindow(windowFor(shared.w || currentWindow));
  }
  function restoreMine() {
    if (mine) {
      apply(mine);
      win = windowFor(mineWindow);
      setChosenWindow(mineWindow);
    }
    mine = null;
    clearHash();
  }
  function keepShared() {
    mine = null;
    clearHash();
  }
  async function sharePlan() {
    const url = `${location.origin}${location.pathname}${encodeShare(snap())}`;
    try {
      await navigator.clipboard.writeText(url);
      shareUrl = '';
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = false), 3000);
    } catch {
      // clipboard blocked: show the link, selected, to copy by hand
      shareUrl = url;
      await tick();
      shareEl?.focus();
      shareEl?.select();
    }
  }

  const examples = $derived(hot.slice(0, 3));
  onMount(() => {
    try {
      localStorage.removeItem('boss.plan');
    } catch {
      /* storage unavailable */
    }
    const mq = window.matchMedia('(min-width: 1100px)');
    const onMq = () => (wide = mq.matches);
    onMq();
    mq.addEventListener('change', onMq);
    win = windowFor(getChosenWindow());
    const kept = getBalanceText();
    if (kept !== null) bal = typeBalance(balanceFromCents(null), kept);
    const saved = getPlan();
    if (saved) apply(saved);
    const hadHash = !!decodeShare(location.hash);
    readHash();
    // A plan that came back from this browser's storage (not from a shared link) is announced, so it never reappears silently.
    if (saved?.r.length && !hadHash) {
      restored = true;
      restoredKey = rows.map((r) => r.id).join();
    }
    ready = true;
    // The saved plan is the source of truth: a course added from another tab appears here.
    const offPlan = onPlanChange(() => {
      const st = getPlan();
      if (!st) return;
      if (mine) {
        mine = st;
        return;
      }
      untrack(() => {
        if (!samePlan({ ...st, w: '' }, { ...snap(), w: '' })) apply(st);
      });
    });
    const offWin = onWindowChange((label) => (win = windowFor(label)));
    const onStore = (e: StorageEvent) => {
      if (e.key === BALANCE_KEY && !bal.bad) bal = e.newValue?.trim() ? typeBalance(bal, e.newValue) : balanceFromCents(null, true);
    };
    window.addEventListener('storage', onStore);
    const onHash = () => readHash();
    window.addEventListener('hashchange', onHash);
    return () => {
      offPlan();
      offWin();
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('storage', onStore);
      mq.removeEventListener('change', onMq);
    };
  });

  // fetch course files for the rows (lazy, cached)
  $effect(() => {
    for (const code of new Set(rows.map((r) => r.course))) if (!courses[code]) void loadCourse(code);
  });

  // persist
  $effect(() => {
    if (!ready || mine) return;
    const st = snap();
    const saved = untrack(getPlan);
    if (saved ? samePlan(saved, st) : !st.r.length) return;
    savePlan(st);
    window.dispatchEvent(new Event('plan-change'));
  });

  // simulate per (window, section, group) in the worker, cached
  $effect(() => {
    rows.forEach((r, i) => {
      const sec = info[i].sec;
      const k = simKey(r);
      if (!sec || info[i].issue || curves[k] || inflight.has(k)) return;
      const input = toPlanSimInput(sec, win, r.group);
      if (!input) return;
      inflight.add(k);
      runSim(input)
        .then((res) => (curves = { ...curves, [k]: res }))
        .finally(() => inflight.delete(k));
    });
  });

  // Only when the recommended bids do not fit the balance: the optimiser spreads the balance over the rows in the worker,
  // debounced, and no row is raised above its recommended bid. Stale answers are dropped.
  let fitToken = 0;
  $effect(() => {
    const items = planItems;
    const need = needsFit;
    const budget = balanceCents ?? 0;
    const t = target;
    const dropOptional = over;
    const my = ++fitToken;
    if (!need) {
      fitting = false;
      fitted = null;
      return;
    }
    fitting = true;
    const timer = setTimeout(() => {
      runOptimise({ budgetCents: budget, items: biddableItems(items, dropOptional), certainty: 1 }).then((fit) => {
        if (my !== fitToken) return;
        fitted = clampToRecommended(items, fit, t, budget);
        fitting = false;
      });
    }, 200);
    return () => clearTimeout(timer);
  });

  function onBalance(e: Event) {
    const text = (e.currentTarget as HTMLInputElement).value;
    bal = typeBalance(bal, text);
    if (!bal.bad) setBalanceText(text);
  }
  // Adds courses only: the balance, priority and busy times the student set stay as they are.
  async function tryExample() {
    const codes = examples.map((h) => h.code);
    for (const c of codes) await addRow(c);
    const ex = codes.map((c) => rows.find((r) => r.course === c));
    if (ex.length >= 3 && ex[1] && ex[2]) {
      const letter = freeLetter(rows);
      for (const r of [ex[1], ex[2]]) {
        r.role = 'oneOf';
        r.oneOf = letter;
      }
    }
  }
  let restored = $state(false);
  let restoredKey = '';
  // Any change to the rows (an edit, Clear all, a plan from another tab) ends the note.
  $effect(() => {
    const k = rows.map((r) => r.id).join();
    if (restored && k !== restoredKey) restored = false;
  });
  let undoRows = $state.raw<PlanRowState[] | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  function clearAll() {
    clearTimeout(undoTimer);
    undoRows = rows.map((r) => ({ ...r }));
    rows = [];
    shareUrl = '';
    undoTimer = setTimeout(() => (undoRows = null), 10000);
  }
  function undoClear() {
    clearTimeout(undoTimer);
    if (undoRows) rows = [...undoRows, ...rows];
    undoRows = null;
  }
  function toResult() {
    document.getElementById('plan-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Bid report: the rows as the planner shows them (same bids and chances), in display order. Null until everything is computed.
  // A pick whose course loaded but whose section is gone is left out (and listed); a course still loading makes the report wait.
  const reportReady = $derived(ready && !pending && info.some((x) => !!x.sec) && rows.every((r, i) => !!info[i].sec || !!courses[r.course]));
  function buildReport(): { rows: ReportRow[]; meta: ReportMeta } | null {
    if (!reportReady) return null;
    const order = blocks.flat();
    const skipped = order.filter((i) => !info[i].sec).map((i) => rows[i].course);
    const out = order.filter((i) => !!info[i].sec).map((i) => {
      const r = rows[i];
      const c = curves[simKey(r)];
      return planReportRow({
        code: r.course,
        title: courses[r.course]?.title ?? '',
        section: info[i].sec!,
        role: r.role,
        pickOf: pickOf(r),
        group: r.group,
        window: win,
        issue: info[i].issue,
        bid: result ? (result.bids[r.id] ?? null) : null,
        p: result ? (result.p[r.id] ?? null) : null,
        fullBid: fullBidOf(r),
        covered: coveredBy(r),
        none: overBudget,
        capMode: needsFit,
        target,
        reason: reasonOf(r, i),
        clashes: clashLines(clashPairs, r.id),
        bids: { 0.8: c ? recommendBid(c, 0.8) : null, 0.9: c ? recommendBid(c, 0.9) : null, 0.95: c ? recommendBid(c, 0.95) : null },
      });
    });
    const shown = !!result && !overBudget;
    const totals = planTotals({
      balanceCents,
      bidTotalCents: shown ? result!.bidTotalCents : null,
      leftCents: shown && sum ? sum.leftCents : null,
      pAll: result && !noMust && !overBudget ? result.pAll : null,
      needCents: over ? reqNeedCents : null,
    });
    const notes = skipped.length ? [`Left out, section no longer offered: ${skipped.join(', ')}`] : [];
    return { rows: out, meta: { title: 'Bidwise bid report', generatedAt: sgtStamp(new Date()), plan: true, totals, notes } };
  }
  function downloadReport() {
    const rep = buildReport();
    if (rep) downloadCsv(reportFileName('plan', new Date()), buildReportCsv(rep.rows, rep.meta));
  }
  // The printable view exists only while printing (Print button or Ctrl+P): built just before, removed just after.
  let printData = $state.raw<{ rows: ReportRow[]; meta: ReportMeta } | null>(null);
  function beforePrint() {
    printData = buildReport();
    flushSync();
  }
  // The button builds the report itself, so it works even where beforeprint is not fired; beforeprint then rebuilds it (same data).
  function printReport() {
    beforePrint();
    window.print();
  }
  const toggle = (slot: string) => (avoid = avoid.includes(slot) ? avoid.filter((a) => a !== slot) : [...avoid, slot]);
</script>

<svelte:window onbeforeprint={beforePrint} onafterprint={() => (printData = null)} />
{#if printData}<ReportPrint rows={printData.rows} meta={printData.meta} />{/if}

{#snippet avoidGrid()}
  <div class="avoidbox" id="avoid-grid" role="group" aria-labelledby="avoid-h">
  <h2 class="avoidh" id="avoid-h">Can't attend</h2>
  <div class="avoid">
    <span></span>
    {#each DAYS as d (d)}<span class="dh">{d}</span>{/each}
    {#each startTimes as t (t)}
      <span class="bh">{t}</span>
      {#each DAYS as d (d)}
        {@const slot = `${d}-${t}`}
        <button
          type="button"
          class="slot"
          class:on={avoid.includes(slot)}
          aria-pressed={avoid.includes(slot)}
          aria-label="Can't attend {d} {t}"
          onclick={() => toggle(slot)}
        ><span aria-hidden="true">{avoid.includes(slot) ? '×' : ''}</span></button>
      {/each}
    {/each}
  </div>
  </div>
{/snippet}

<div class="planner" class:has-bar={rows.length > 0 && !wide} class:empty={!rows.length}>
  <div class="main">
    <div class="setup">
      <div class="ctl">
      <label class="budget">
        <span class="lab">My balance <InfoTip label="About the balance" anchor="planner" lines={['Leave it empty to see the bid for each course. With a balance, bids are cut to fit it.']} /></span>
        <span class="inp">
          <span class="cur" aria-hidden="true">e$</span>
          <input
            class="field num"
            class:bad={balanceBad}
            type="text"
            inputmode="decimal"
            autocomplete="off"
            aria-label="My balance in e$"
            aria-invalid={balanceBad}
            aria-describedby={balanceBad ? 'bal-err' : undefined}
            value={bal.text}
            disabled={!ready}
            oninput={onBalance}
            onblur={() => (bal = blurBalance(bal))}
          />
        </span>
      </label>
      <div class="aimbox" role="group" aria-labelledby="aim-h">
        <span class="lab" id="aim-h">Chance you want</span>
        <div class="seg aim">
          {#each TARGETS as t}
            <button type="button" class="num" aria-pressed={target === t} onclick={() => (target = t)}>{pct(t)}</button>
          {/each}
        </div>
      </div>
      </div>
      {#if upcoming && win === currentWindow}
        <span class="tag">Upcoming window</span>
      {/if}
      {#if lowConfidence.includes(win)}
        <span class="tag" title="The backtest for this window was less reliable: fewer sections filled, or the ranges missed too often.">Low confidence</span>
      {/if}
      {#if rows.length}
        <div class="tools">
        <button type="button" class="btn clear" aria-expanded={avoidOpen} aria-controls="avoid-grid" onclick={() => (avoidOpen = !avoidOpen)}>
          Times I can't attend{#if avoid.length}<span class="badge" aria-label="{avoid.length} {avoid.length === 1 ? 'time' : 'times'} blocked">{avoid.length}</span>{/if}
        </button>
        <button type="button" class="btn clear" onclick={sharePlan}>Copy plan link</button>
        <button type="button" class="btn clear danger" onclick={clearAll}>Clear all</button>
        </div>
      {/if}
    </div>
    {#if rows.length && avoidOpen}{@render avoidGrid()}{/if}

    {#if restored}
      <p class="restored" role="status">Last plan restored</p>
    {/if}

    {#if shareUrl}
      <div class="shareurl">
        <input class="field num" readonly aria-label="Plan link" value={shareUrl} bind:this={shareEl} onfocus={(e) => e.currentTarget.select()} />
        <button type="button" class="btn clear" onclick={() => (shareUrl = '')}>Done</button>
      </div>
    {/if}
    {#if mine}
      <div class="shared" role="status">
        <span>Loaded shared plan</span>
        <button type="button" class="btn clear" onclick={restoreMine}>Restore mine</button>
        <button type="button" class="btn clear" onclick={keepShared}>Keep this one</button>
      </div>
    {/if}
    {#if balanceBad}<p class="err" id="bal-err" role="alert">Invalid amount</p>{/if}
    {#if loadError}<p class="err" role="alert">{loadError}</p>{/if}
    {#if dupes.length}<p class="warn" role="status">{dupes.join(', ')} added twice · set to Pick one</p>{/if}
    {#if clashNote}<p class="warn" role="status">{clashNote}</p>{/if}

    {#if rows.length}
      <p class="legend"><span>Priority</span> <InfoTip label="What the priorities mean" anchor="planner" lines={['Must get: you need it this term.', 'Pick one: any one of a set.', 'Nice to have: only if the balance allows.']} /></p>
      <ul class="rows">
        {#each blocks as idxs (rows[idxs[0]].id)}
          {#snippet one(i: number, grouped: boolean)}
            {@const row = rows[i]}
            <PlanRow
              bind:row={rows[i]}
              course={courses[row.course]}
              issue={info[i]?.issue ?? null}
              {avoid}
              {grouped}
              onrole={(role) => setRole(row, role)}
              bid={result ? (result.bids[row.id] ?? null) : null}
              p={result ? (result.p[row.id] ?? null) : null}
              busy={pending}
              none={overBudget}
              fullBid={fullBidOf(row)}
              capMode={needsFit}
              {target}
              canPick={rows.length >= 2}
              covered={coveredBy(row)}
              reason={reasonOf(row, i)}
              clashes={clashLines(clashPairs, row.id)}
              onremove={() => (rows = rows.filter((r) => r.id !== row.id))}
            />
          {/snippet}
          {#if rows[idxs[0]].role === 'oneOf'}
            {@const letter = rows[idxs[0]].oneOf}
            {@const ids = idxs.map((i) => rows[i].id)}
            {@const others = rows.filter((r) => !ids.includes(r.id))}
            {@const more = [...new Set(idxs.map((i) => rows[i].course))].filter(moreSections)}
            <li class="grp">
              <div class="pick" role="group" aria-label="Pick one of">
                <span class="pickh">Pick one of: {#each idxs as i, k (rows[i].id)}{#if k > 0}<span class="or">{' or '}</span>{/if}<b class="num">{rowName(rows[i])}</b>{/each}</span>
                {#if idxs.length < 2}<span class="pc warn">Pair it with another course</span>{/if}
                {#if others.length || more.length}
                  <button type="button" class="btn addbtn" aria-expanded={addOpen === letter} onclick={() => (addOpen = addOpen === letter ? '' : letter)}>+ Add a course to this group</button>
                {/if}
              </div>
              {#if addOpen === letter && (others.length || more.length)}
                <div class="addlist" role="group" aria-label="Add a course to this group">
                  {#each more as c (c)}<button type="button" class="btn" onclick={() => { onAddPick('sec:' + c, letter); addOpen = ''; }}>Another {c} section</button>{/each}
                  {#each others as o (o.id)}<button type="button" class="btn" onclick={() => { onAddPick(o.id, letter); addOpen = ''; }}>{rowName(o)}</button>{/each}
                </div>
              {/if}
              <ul>
                {#each idxs as i (rows[i].id)}
                  {@render one(i, true)}
                {/each}
              </ul>
            </li>
          {:else}
            {@render one(idxs[0], false)}
          {/if}
        {/each}
      </ul>
    {/if}

    {#if rows.length}
      <CourseAdd onadd={onAdd} inPlan={rows.map((r) => r.course)} dropUp={wide} />
    {:else}
      <section class="start" aria-label="Start">
        <CourseAdd onadd={onAdd} inPlan={[]} label="Add a course" placeholder="Course code or title" />
        {#if examples.length >= 3}
          <div class="go">
            <button type="button" class="btn btn-primary" onclick={tryExample}>Try an example plan</button>
          </div>
        {/if}
        {#if examples.length}
          <div class="chips" role="group" aria-label="Popular courses">
            <span class="lab">Popular</span>
            {#each examples as c (c.code)}<button type="button" class="btn chip num" onclick={() => addRow(c.code)}>{c.code}</button>{/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>

  {#if rows.length}
  <aside class="side">
    <section class="panel result" id="plan-result" aria-live="polite" aria-busy={rows.length > 0 && pending}>
      {#if !noMust}<div class="lab">Chance of all Must get {#if rows.some((r) => r.group > 1)}<span>· whole group</span>{/if} <InfoTip label="About this chance" anchor="planner" lines={['Every Must get course, and one course from each Pick one group.', 'Nice to have courses do not count.']} /></div>{/if}
      {#if result}
        {#if noMust}
          <div class="big none">No must-get courses</div>
        {:else if overBudget}
          <div class="big none">Not possible</div>
        {:else}
          <div class="big num" class:dim={pending}>{pct(result.pAll)}</div>
        {/if}
      {:else if pending && wide}
        <div class="calc">Calculating…</div>
      {/if}
      {#if showCallout && result}
        <div class="notice" role="status">
          {#if anyCut && balanceCents !== null}<p><b>Bids cut to fit {balanceLabel(balanceCents)}</b></p>{/if}
          {#if showNotice}
            <p>{#if over && balanceCents !== null}{#if overBudget}<b>Not possible</b>{' · '}{/if}{needSentence(planItems, reqNeedCents, balanceCents)}{:else}Best possible: <b>{pct(result.pAll)}</b>{/if}</p>
          {/if}
          {#if saver || over}
            <div class="acts">
              {#if saver}{@const sv = saver}
                {#if over && sv.fits}<button type="button" class="btn" onclick={() => (rows = rows.filter((r) => !sv.keys.includes(r.id)))}>Drop {sv.label}</button>{/if}
              {/if}
              {#if over}<button type="button" class="btn" onclick={raiseBudget}>Set balance to e${Math.ceil(reqNeedCents / 100)}</button>{/if}
            </div>
          {/if}
        </div>
      {/if}
      {#if excluded}<p class="warn" role="status">{excluded} left out</p>{/if}
      {#if result && !sum && !overBudget}
        <p class="tot num" class:dim={pending}>Bids total <b>{eS(result.bidTotalCents)}</b></p>
      {/if}
      {#if sum && !overBudget && balanceCents !== null}
        <section class="split num" class:dim={pending}>
          <p class="tot">Bids total <b>{eS(sum.bidCents)}</b> of {eS(balanceCents)} · <b>{eS(Math.max(0, sum.leftCents))}</b> left</p>
          <div class="stack" role="img" aria-label="Expected spend {eS(sum.likelyCents)}, bids total {eS(sum.bidCents)}, left {eS(Math.max(0, sum.leftCents))}">
            <span class="sg likely" style="flex: {sum.share.likely} 1 0"><span class="sl">Expected spend {eS(sum.likelyCents)}</span></span>
            <span class="sg rest" style="flex: {sum.share.rest} 1 0"></span>
            <span class="sg left" style="flex: {sum.share.left} 1 0"></span>
          </div>
        </section>
      {/if}
      <div class="report" role="group" aria-label="Bid report">
        <span class="lab">Bid report</span>
        <button type="button" class="btn" disabled={!reportReady} onclick={printReport}>Print</button>
        <button type="button" class="btn" disabled={!reportReady} onclick={downloadReport}>Download CSV</button>
      </div>
    </section>
  </aside>
  {/if}

  {#if undoRows}
    <div class="toast" role="status"><span>Plan cleared</span><span aria-hidden="true">·</span><button type="button" class="undo" onclick={undoClear}>Undo</button></div>
  {:else if copied}
    <div class="toast" role="status"><span>Link copied</span></div>
  {/if}

  {#if rows.length && !wide}
    <button type="button" class="bar num" class:busy={pending} aria-busy={pending} onclick={toResult} aria-label="Show plan details">
      {#if result}
        {#if noMust}<b>No must-get courses</b>{:else if overBudget}<b>Not possible</b><span>· need about {eS(reqNeedCents)}</span>{:else}<b>{pct(result.pAll)} chance of all</b>{#if showCallout}<span class="fit">· Over balance</span>{:else}<span>· bids {eS(result.bidTotalCents)}</span>{#if sum}<span>· {eS(Math.max(0, sum.leftCents))} left</span>{/if}{/if}{/if}
        {#if overBudget && showCallout}<span class="fit">· Over balance</span>{/if}
      {:else}
        <span class="lab">Calculating…</span>
      {/if}
      <span class="chev" aria-hidden="true">›</span>
    </button>
  {/if}
</div>

<style>
  .restored { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .planner { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s5); min-width: 0; }
  .planner.has-bar { padding-bottom: 56px; }
  .main, .side { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s4); min-width: 0; align-content: start; }
  .lab { font-size: 14px; color: var(--muted); }
  /* Not "top": Base.astro styles a global .top as the sticky header. */
  .setup { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s2) var(--s3); }
  .ctl { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--s2) var(--s4); min-width: 0; max-width: 100%; }
  .budget, .aimbox { display: grid; gap: var(--s1); min-width: 0; }
  .budget .inp { width: 140px; }
  .aimbox .aim { display: flex; }
  .aimbox .aim > button { flex: 1 1 0; min-height: 44px; padding: 0 var(--s3); font-size: 15px; }
  @media (min-width: 768px) { .budget .inp { width: 170px; } .setup { align-items: flex-end; } }
  .tag { display: inline-flex; align-items: center; min-height: 28px; padding: 0 var(--s2); font-size: 13px; font-weight: 600; background: var(--bg); border: 1px solid var(--rule-strong); border-radius: 2px; }
  .err, .warn { margin: 0; font-size: 14px; }
  .err { color: var(--danger); }
  .warn { padding-left: var(--s3); border-left: 3px solid var(--danger); }
  .budget input.bad { border-color: var(--danger); }
  .shared { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); padding: var(--s2) var(--s3); font-size: 14px; background: var(--accent-soft); border-radius: var(--r-md); }
  .shared span { margin-right: auto; font-weight: 600; }
  .split { display: grid; gap: var(--s2); }
  .tot { margin: 0; font-size: 16px; }
  .tot b { font-weight: 600; }
  .stack { display: flex; height: 32px; border-radius: var(--r-md); overflow: hidden; gap: 2px; }
  .sg { display: flex; align-items: center; min-width: 0; overflow: hidden; }
  .sg.likely { background: color-mix(in srgb, var(--text) 80%, var(--surface)); color: #fff; }
  .sg.rest { background: color-mix(in srgb, var(--text) 32%, var(--surface)); }
  .sg.left { background: var(--rule); }
  .sl { padding: 0 var(--s2); font-size: 13px; white-space: nowrap; }
  .notice { display: grid; gap: var(--s3); padding: var(--s1) 0 var(--s1) var(--s3); border-left: 3px solid var(--danger); color: var(--text); font-size: 15px; }
  .notice p { margin: 0; }
  .notice b { font-weight: 700; }
  .acts { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
  .chip { min-height: 44px; padding: 0 var(--s3); font-size: 14px; }
  .tools { display: flex; flex-wrap: wrap; gap: var(--s2); margin-left: auto; max-width: 100%; }
  @media (max-width: 767px) { .tools { width: 100%; margin-left: 0; } .tools .clear { padding: 0 var(--s2); } }
  .clear { gap: var(--s2); min-height: 44px; padding: 0 var(--s3); font-size: 14px; white-space: nowrap; flex: none; }
  .clear.danger { color: var(--danger); border-color: var(--danger); }
  .shareurl { display: flex; gap: var(--s2); align-items: center; }
  .shareurl .field { flex: 1 1 auto; min-width: 0; }
  .toast { position: fixed; z-index: 30; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 64px); display: flex; align-items: center; gap: var(--s2); min-height: 48px; padding: 0 var(--s2) 0 var(--s4); font-size: 15px; color: var(--surface); background: var(--text); border-radius: var(--r-md); white-space: nowrap; }
  .undo { min-height: 44px; padding: 0 var(--s3); font: inherit; font-weight: 600; color: inherit; text-decoration: underline; background: none; border: 0; cursor: pointer; }
  .planner :global(.field) { height: 44px; min-height: 44px; padding-top: 0; padding-bottom: 0; }
  .report { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); padding-top: var(--s3); border-top: 1px solid var(--rule); }
  .report .lab { margin-right: var(--s1); }
  .start { display: grid; gap: var(--s4); padding: var(--s5) 0; min-width: 0; }
  .start h2 { margin: 0; font-size: var(--fs-lg); font-weight: 600; line-height: 1.3; }
  .go { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); }
  .planner.empty { grid-template-columns: minmax(0, 1fr); }
  .start :global(.field) { height: 52px; min-height: 52px; font-size: var(--fs-md); }
  .start :global(.add > svg) { top: 16px; }
  /* control width, not a page cap */
  .start :global(.add) { max-width: 720px; }
  .lab :global(.tip) { margin-left: var(--s2); }
  .calc { font-size: 22px; font-weight: 600; color: var(--muted); }
  .dim { opacity: 0.5; }
  .inp { position: relative; display: block; }
  .cur { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 16px; }
  .budget input { padding-left: 40px; font-weight: 600; }
  .rows { display: grid; border-top: 1px solid var(--rule); }
  .grp { position: relative; margin: var(--s2) 0; padding: 0 var(--s3); border: 1px solid var(--accent); border-left-width: 4px; border-radius: var(--r-md); background: var(--accent-soft); }
  .grp ul { display: grid; }
  @media (min-width: 768px) {
    /* the framed groups and Nice to have rows sit outside the column so every control lines up with plain rows */
    .grp { margin-left: calc(-1 * (var(--s3) + 4px)); margin-right: calc(-1 * (var(--s3) + 1px)); }
    .rows > :global(.row.bonus) { margin-left: calc(-1 * (var(--s2) + 1px)); margin-right: calc(-1 * (var(--s2) + 1px)); }
  }
  .grp :global(.row) + :global(.row) { border-top: 1px solid var(--rule); }
  .pick { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); padding: var(--s2) 0; border-bottom: 1px solid var(--accent); }
  .pc { display: inline-flex; align-items: center; min-height: 28px; padding: 0 var(--s3); font-size: 14px; font-weight: 600; background: var(--surface); border: 1px solid var(--accent); border-radius: 999px; white-space: nowrap; }
  .pc.warn { color: var(--danger); border-color: var(--danger); background: var(--surface); }
  .addpick { min-height: 44px; padding: 0 var(--s3); font: inherit; font-size: 14px; color: var(--text); background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); cursor: pointer; }
  .addpick:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .avoid { width: 100%; display: grid; grid-template-columns: 44px repeat(5, minmax(0, 1fr)); gap: var(--s1); align-items: center; }
  .dh, .bh { font-size: 13px; color: var(--muted); text-align: center; }
  .slot { min-height: 44px; padding: 0; border-radius: var(--r-sm); border: 1px solid var(--rule-strong); background: var(--surface); color: var(--accent); font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; }
  .slot.on { background: var(--accent-soft); border-color: var(--accent); }
  .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; font-size: 13px; font-weight: 600; color: var(--accent-ink); background: var(--accent); border-radius: 999px; }
  .avoidbox { display: grid; gap: var(--s2); width: 100%; max-width: 300px; }
  .avoidh { margin: 0; font-size: 15px; font-weight: 600; }
  .pickh { font-size: 15px; }
  .pickh b { font-weight: 600; }
  .or { color: var(--muted); }
  .addbtn { min-height: 44px; padding: 0 var(--s3); font-size: 14px; margin-left: auto; }
  .addlist { display: flex; flex-wrap: wrap; gap: var(--s2); padding: 0 0 var(--s2); }
  .addlist .btn { font-size: 14px; }
  .result { display: grid; gap: var(--s3); min-width: 0; scroll-margin-top: calc(var(--topbar-h) + var(--s3)); }
  .big { font-size: 56px; line-height: 1; font-weight: 600; }
  .big.none { font-size: 32px; color: var(--muted); }
  .bar {
    position: fixed; left: 0; right: 0; bottom: calc(var(--tabbar-h) + 1px + env(safe-area-inset-bottom)); z-index: 20;
    display: flex; align-items: center; gap: var(--s2); white-space: nowrap; overflow: hidden;
    height: 44px; padding: 0 var(--gutter); font: inherit; font-size: var(--fs-sm); color: var(--text); text-align: left; cursor: pointer;
    background: var(--surface); border: 0; border-top: 1px solid var(--rule-strong);
  }
  .bar b { font-weight: 600; }
  .bar .fit { color: var(--accent); font-weight: 600; }
  .chev { margin-left: auto; font-size: 28px; line-height: 1; color: var(--muted); }

  @media (min-width: 1100px) {
    .planner:not(.empty), .planner.has-bar:not(.empty) { grid-template-columns: minmax(0, 1fr) clamp(480px, 32vw, 680px); gap: var(--s6); align-items: start; padding-bottom: var(--s5); }
    .main { grid-column: 1; grid-row: 1; }
    .side { grid-column: 2; grid-row: 1; align-self: start; }
    .side { position: sticky; top: calc(var(--topbar-h) + var(--s4)); max-height: calc(100vh / var(--z) - var(--topbar-h) - var(--s5)); overflow-y: auto; }
    .bar { display: none; }
    /* The whole page scrolls; the summary card stays in view beside the list (.side is sticky). */
    .main > .rows { border-top: 0; }
    .legend { padding-bottom: var(--s2); border-bottom: 1px solid var(--rule); }
  }
  .legend { margin: 0; display: flex; align-items: center; gap: var(--s3); font-size: 14px; color: var(--muted); }
</style>
