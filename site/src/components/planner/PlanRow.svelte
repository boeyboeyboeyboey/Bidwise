<script lang="ts">
  import type { CourseData } from '../../lib/data/types';
  import { isLikelyFull, seatsLeftNow, seatsPhrase } from '../../lib/data/seats';
  import { MAX_FRIENDS_GROUP } from '../../lib/sim/forecast';
  import type { Role } from '../../lib/sim/planner';
  import { aboutPctParts, eS } from '../course/fmt';
  import { orderSections } from '../course/sections';
  import { seatLabel } from '../course/seatLabel';
  import { ISSUE_TEXT, chanceTint, groupLimitNote, hiddenSections, isCapped, sectionOption, slotsOf, type RowIssue } from './plan';
  import type { PlanRowState } from './types';
  import InfoTip from '../ui/InfoTip.svelte';

  let {
    row = $bindable(),
    course,
    issue = null,
    avoid,
    bid,
    p,
    busy = false,
    covered = '',
    none = false,
    fullBid = null,
    capMode = false,
    target = 0.9,
    canPick = true,
    onremove,
    grouped = false,
    onrole,
    reason = '',
    clashes = [],
  }: { row: PlanRowState; course: CourseData | undefined; issue?: RowIssue | null; avoid: string[]; grouped?: boolean; onrole: (role: Role) => void; bid: number | null; p: number | null; busy?: boolean; covered?: string; none?: boolean; fullBid?: number | null; capMode?: boolean; target?: number; canPick?: boolean; reason?: string; clashes?: string[]; onremove: () => void } = $props();

  const sec = $derived(course?.sectionsNow.find((x) => x.id === row.sectionId));
  /** Most people the group can be: capped by the seats left. */
  const maxGroup = $derived(Math.max(1, Math.min(MAX_FRIENDS_GROUP, sec ? seatsLeftNow(sec) : MAX_FRIENDS_GROUP)));
  const limitNote = $derived(sec ? groupLimitNote(seatsLeftNow(sec), row.group, seatsPhrase(sec)) : '');
  const skip = $derived(bid === 0);
  const capped = $derived(isCapped(bid, fullBid, capMode));
  const hidden = $derived(hiddenSections(course?.sectionsNow ?? [], row.sectionId, avoid));
  const sections = $derived(
    orderSections((course?.sectionsNow ?? []).filter((s) => s.id === row.sectionId || !slotsOf(s).some((x) => avoid.includes(x)))),
  );
  // Pick one needs a second course to pick between: it is offered only when the plan has 2+ rows (or the row already is one).
  const roles = $derived(
    ([
      { v: 'required', l: 'Must get' },
      { v: 'oneOf', l: 'Pick one' },
      { v: 'optional', l: 'Nice to have' },
    ] as { v: Role; l: string }[]).filter((r) => r.v !== 'oneOf' || canPick || row.role === 'oneOf'),
  );
</script>

<li class="row" class:grouped class:bonus={row.role === 'optional'} data-row-id={row.id}>
  <div class="line">
    <div class="id"><b class="code">{row.course}</b>{#if hidden}<span class="lab hid">{hidden} {hidden === 1 ? 'section' : 'sections'} hidden</span>{/if}</div>
    <div class="secwrap">
      <select class="field sec" aria-label="{row.course} section" disabled={!course} bind:value={row.sectionId}>
        {#if !course}<option value={row.sectionId}>Loading</option>{/if}
        {#each sections as s (s.id)}
          <option value={s.id} disabled={seatsLeftNow(s) <= 0 && !isLikelyFull(s) && s.id !== row.sectionId}>{sectionOption(s)}</option>
        {/each}
      </select>
      {#if sec}
        <span class="meta" title="{sec.instructor || 'Instructor TBA'} · {seatLabel(sec)}"><span class="prof">{sec.instructor || 'Instructor TBA'}</span><span class="seats num"> · {seatLabel(sec)}</span></span>
      {/if}
    </div>
    <div class="seg role" role="radiogroup" aria-label="How much you need {row.course}">
      {#each roles as r (r.v)}
        <button type="button" role="radio" aria-checked={row.role === r.v} onclick={() => onrole(r.v)}>{r.l}</button>
      {/each}
    </div>
    <button type="button" class="btn btn-icon rm" aria-label="Remove {row.course}" onclick={onremove}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" /></svg>
    </button>
    <div class="l2">
    <div class="step" role="group" aria-label="{row.course} group size">
      <span class="lab stl">Group size</span>
      <button type="button" class="btn btn-icon" aria-label="Fewer people for {row.course}" disabled={row.group <= 1} onclick={() => row.group--}>−</button>
      <output class="num" aria-label="{row.group} {row.group === 1 ? 'person' : 'people'}">{row.group}</output>
      <button type="button" class="btn btn-icon" aria-label="More people for {row.course}" aria-describedby={limitNote ? `lim-${row.id}` : undefined} disabled={row.group >= maxGroup} onclick={() => row.group++}>+</button>
      {#if limitNote}<span class="lab left" id="lim-{row.id}">{limitNote}</span>{/if}
    </div>
    <div class="res num" aria-live="polite" aria-busy={busy}>
      {#if issue}<span class="cant">{ISSUE_TEXT[issue]}</span>
      {:else if none && fullBid !== null && fullBid > 0}<span class="need">Needs <s>{eS(fullBid)}</s></span>
      {:else if bid === null || (!skip && p === null)}<span class="calc">Calculating…</span>
      {:else if skip}
        {#if covered}<span class="chip">Not bid · {covered} covers it</span>
        {:else if capMode && fullBid !== null && fullBid > 0}<span class="need">Needs <s>{eS(fullBid)}</s></span>
        {:else}<span class="skip cant">Can't win a seat</span>{/if}
      {:else}
        <span class="lab">Bid</span> <b class:busy>{eS(bid)}</b>{#if row.group > 1} <span class="lab">each</span>{/if} <span class="arrow" aria-hidden="true">→</span>
        <span class="lab">{aboutPctParts(p ?? 0)[0]}</span><b class="tint" class:busy style="background: {chanceTint(p ?? 0)}">{aboutPctParts(p ?? 0)[1]}</b>
        <span class="lab">{row.group > 1 ? `chance all ${row.group}` : 'chance'}</span>
        <InfoTip />
        {#if capped && fullBid !== null}<span class="cap">Cut from <b>{eS(fullBid)}</b></span>{/if}
      {/if}
    </div>
    </div>
  </div>
  {#if reason || clashes.length}
    <div class="notes">
      {#if reason}<p class="why">{reason}</p>{/if}
      {#each clashes as c (c)}<p class="clash">{c}</p>{/each}
    </div>
  {/if}
</li>

<style>
  .row { padding: var(--s1) 0; border-bottom: 1px solid var(--rule); min-width: 0; container-type: inline-size; }
  .row.grouped { border-bottom: 0; padding: var(--s1) 0; }
  .row.bonus { border: 1px dashed var(--rule-strong); border-radius: var(--r-md); padding: var(--s1) var(--s2); margin: var(--s1) 0; }
  .line {
    display: grid; align-items: center; gap: var(--s2); min-width: 0;
    grid-template-columns: minmax(0, 1fr) 44px;
    grid-template-areas: 'id rm' 'sec sec' 'role role' 'step step' 'res res';
  }
  .id { grid-area: id; display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--s2); min-width: 0; }
  .code { font-size: 17px; font-weight: 600; white-space: nowrap; }
  .chip { display: inline-flex; align-items: center; min-height: 24px; padding: 0 var(--s2); font-size: 13px; font-weight: 600; color: var(--muted); background: var(--bg); border: 1px solid var(--rule-strong); border-radius: 999px; white-space: nowrap; }
  .secwrap { grid-area: sec; display: grid; gap: 2px; min-width: 0; }
  .sec { min-height: 44px; padding-top: 0; padding-bottom: 0; }
  .meta { display: flex; min-width: 0; font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; }
  .prof { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .seats { flex: none; white-space: pre; }
  .rm { grid-area: rm; }
  .l2 { display: contents; }
  .role { grid-area: role; display: inline-flex; width: max-content; max-width: 100%; justify-self: start; }
  .role > button { flex: 0 1 104px; width: 104px; min-width: 0; padding: 0 var(--s1); min-height: 44px; }
  .step { grid-area: step; min-height: 44px; display: flex; flex-wrap: wrap; align-items: center; column-gap: var(--s1); justify-self: start; }
  .stl { margin-right: var(--s1); white-space: nowrap; }
  .left { margin-left: var(--s1); }
  .step .btn-icon { flex: none; width: 44px; height: 44px; min-height: 44px; }
  .step output { min-width: 22px; text-align: center; font-size: 17px; font-weight: 600; }
  .res { grid-area: res; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: flex-start; gap: 0 var(--s2); font-size: 15px; }
  .arrow { color: var(--muted); }
  .lab { font-size: 14px; color: var(--muted); }
  .res b { font-weight: 600; }
  .busy { opacity: 0.5; }
  .cant { color: var(--danger); font-weight: 600; white-space: nowrap; }
  .need { color: var(--muted); }
  .need s { text-decoration-thickness: 1.5px; }
  .hid { font-size: 13px; white-space: nowrap; }
  .tint { display: inline-block; padding: 1px 6px; border-radius: var(--r-sm); color: #1b1d21; }
  .notes { display: grid; gap: var(--s1); padding-top: var(--s2); min-width: 0; }
  .notes p { margin: 0; font-size: 14px; }
  .why { color: var(--muted); }
  .clash { padding-left: var(--s3); border-left: 3px solid var(--danger); color: var(--text); font-weight: 600; }
  .cap { flex: 0 0 100%; font-size: 15px; color: var(--text); white-space: normal; }
  .calc { color: var(--muted); }
  /* Disabled stepper: muted text on the page colour (at least 4.5:1), not faded by opacity. */
  .step .btn-icon:disabled { color: var(--muted); opacity: 1; }

  @container (min-width: 620px) {
    .line {
      grid-template-columns: 150px minmax(110px, 1fr) 314px 44px;
      grid-template-areas: 'id sec role rm' 'l2 l2 l2 l2';
      column-gap: var(--s3);
    }
    .l2 { grid-area: l2; display: grid; grid-template-columns: 240px minmax(0, 1fr); align-items: center; gap: var(--s2) var(--s3); }
    .res { justify-content: flex-start; white-space: nowrap; }
  }
  @container (min-width: 620px) and (max-width: 999.98px) {
    .step, .res { grid-area: auto; }
    .step { justify-self: stretch; }
  }
  @container (min-width: 1000px) {
    .line {
      grid-template-columns: 150px minmax(110px, 1fr) 314px 240px 340px 44px;
      grid-template-areas: 'id sec role step res rm';
    }
    .l2 { display: contents; }
    .res { justify-content: flex-start; }
  }
</style>
