<script lang="ts">
  import type { CourseData } from '../../lib/data/types';
  import { isLikelyFull, seatsLeftNow, seatsOf, seatsPhrase } from '../../lib/data/seats';
  import { MAX_FRIENDS_GROUP, groupEstimatesHidden } from '../../lib/sim/forecast';
  import type { Role } from '../../lib/sim/planner';
  import { styleName } from '../../lib/sim/presets';
  import { GROUP_NOTICE, GROUP_NOTICE_ACTION, lowConfidenceLines } from '../course/bidStyle';
  import { rowLowConfidence } from '../../lib/sim/presets';
  import { aboutPctParts, eS } from '../course/fmt';
  import { orderSections } from '../course/sections';
  import { seatLabel } from '../course/seatLabel';
  import SeatRing from '../course/SeatRing.svelte';
  import { FAILED_REASON, ISSUE_TEXT, belowStyle, chanceTint, groupLimitNote, hiddenSections, sectionOption, slotsOf, type RowIssue } from './plan';
  import type { PlanRowState } from './types';
  import InfoTip from '../ui/InfoTip.svelte';

  let {
    row = $bindable(),
    course,
    issue = null,
    failed = false,
    avoid,
    bid,
    p,
    busy = false,
    covered = '',
    none = false,
    fullBid = null,
    capMode = false,
    target = 0.9,
    win = '',
    windowFlagged = false,
    canPick = true,
    canStart = true,
    onremove,
    grouped = false,
    onrole,
    reason = '',
    clashes = [],
  }: { row: PlanRowState; course: CourseData | undefined; issue?: RowIssue | null; failed?: boolean; avoid: string[]; grouped?: boolean; onrole: (role: Role) => void; bid: number | null; p: number | null; busy?: boolean; covered?: string; none?: boolean; fullBid?: number | null; capMode?: boolean; target?: number; win?: string; windowFlagged?: boolean; canPick?: boolean; canStart?: boolean; reason?: string; clashes?: string[]; onremove: () => void } = $props();

  const sec = $derived(course?.sectionsNow.find((x) => x.id === row.sectionId));
  /** Most people the group can be: capped by the seats left. */
  const maxGroup = $derived(Math.max(1, Math.min(MAX_FRIENDS_GROUP, sec ? seatsLeftNow(sec) : MAX_FRIENDS_GROUP)));
  const limitNote = $derived(sec ? groupLimitNote(seatsLeftNow(sec), row.group, seatsPhrase(sec)) : '');
  const skip = $derived(bid === 0);
  /** A group's bid and chance are withheld (see groupEstimatesHidden). */
  const groupHidden = $derived(groupEstimatesHidden(row.group));
  /** "Below Safe" when the balance cut this bid under the style's bid (calibrated only). */
  const below = $derived(issue || none || groupHidden ? '' : belowStyle(target, bid, fullBid, capMode));
  /** The row's "?" text: the default one explains a chance level, which a named style is not. */
  const tipLines = $derived.by(() => {
    const style = styleName(target);
    if (!style) return undefined;
    return [
      'We replay this window thousands of times with random bidders, using what people bid on this course and instructor (where available) in past terms.',
      below ? `This bid is below the ${style} bid because your balance does not stretch. The chance shown is for this bid. It is an estimate, not a guarantee.` : `This is the ${style} bid. It is an estimate, not a guarantee.`,
    ];
  });
  /** Why this forecast deserves less trust (one seat only, a late window), as on the course page; only for a row that is bid on. */
  const reasons = $derived(!issue && !none && sec && bid !== null && bid > 0 && seatsLeftNow(sec) > 0 ? rowLowConfidence(seatsLeftNow(sec), win, windowFlagged) : []);
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
        {#if !course}<option value={row.sectionId}>{failed ? "Couldn't load" : 'Loading'}</option>{/if}
        {#each sections as s (s.id)}
          <option value={s.id} disabled={seatsLeftNow(s) <= 0 && !isLikelyFull(s) && s.id !== row.sectionId}>{sectionOption(s)}</option>
        {/each}
      </select>
      {#if sec}
        <span class="meta" title={seatLabel(sec)}><SeatRing left={seatsLeftNow(sec)} group={row.group} approx={seatsOf(sec).source === 'approx'} /><span class="seats num">{seatLabel(sec)}</span></span>
      {/if}
    </div>
    <div class="seg role" role="radiogroup" aria-label="How much you need {row.course}">
      {#each roles as r (r.v)}
        <button type="button" role="radio" aria-checked={row.role === r.v} disabled={r.v === 'oneOf' && !canStart && row.role !== 'oneOf'} aria-describedby={r.v === 'oneOf' && !canStart && row.role !== 'oneOf' ? 'group-limit-note' : undefined} onclick={() => onrole(r.v)}>{r.l}</button>
      {/each}
    </div>
    <button type="button" class="btn btn-icon rm" aria-label="Remove {row.course}" onclick={onremove}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" /></svg>
    </button>
    <div class="l2">
    <div class="step" role="group" aria-label="{row.course} group size">
      <span class="stl"><span class="lab">Bidding group size</span><InfoTip label="About bidding group size" lines={['Friends bidding for the same section together.', 'Everyone in the group needs a seat.']} /></span>
      <div class="ctl">
        <button type="button" class="btn btn-icon" aria-label="Fewer people for {row.course}" disabled={row.group <= 1} onclick={() => row.group--}>−</button>
        <output class="num" aria-label="{row.group} {row.group === 1 ? 'person' : 'people'}">{row.group}</output>
        <button type="button" class="btn btn-icon" aria-label="More people for {row.course}" aria-describedby={limitNote ? `lim-${row.id}` : undefined} disabled={row.group >= maxGroup} onclick={() => row.group++}>+</button>
        {#if limitNote}<span class="lab left" id="lim-{row.id}">{limitNote}</span>{/if}
      </div>
    </div>
    <div class="res num" aria-live="polite" aria-busy={busy}>
      {#if failed}<span class="cant">{FAILED_REASON}</span>
      {:else if issue}<span class="cant">{ISSUE_TEXT[issue]}</span>
      {:else if groupHidden}<span class="cant">{GROUP_NOTICE}</span> <button type="button" class="btn" onclick={() => (row.group = 1)}>{GROUP_NOTICE_ACTION}</button>
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
        <InfoTip lines={tipLines} />
      {/if}
    </div>
    </div>
  </div>
  {#if below || reasons.length || reason || clashes.length}
    <div class="notes">
      {#if below || reasons.length}
        <p class="tags">
          {#if below}<span class="tag">{below}</span>{/if}
          {#if reasons.length}<span class="lowc"><span class="tag">Low confidence</span><InfoTip label="Why low confidence" lines={lowConfidenceLines(reasons)} /></span>{/if}
        </p>
      {/if}
      {#if reason}<p class="why">{reason}</p>{/if}
      {#each clashes as c (c)}<p class="clash">{c}</p>{/each}
    </div>
  {/if}
</li>

<style>
  .row { padding: 2px 0; border-bottom: 1px solid var(--rule); min-width: 0; container-type: inline-size; }
  .row.grouped { border-bottom: 0; padding: 2px 0; }
  .row.bonus { border: 1px dashed var(--rule-strong); border-radius: var(--r-md); padding: var(--s1) var(--s2); margin: var(--s1) 0; }
  .line {
    display: grid; align-items: center; gap: var(--s1) var(--s2); min-width: 0;
    grid-template-columns: minmax(0, 1fr) 44px;
    grid-template-areas: 'id rm' 'sec sec' 'role role' 'step step' 'res res';
  }
  .id { grid-area: id; display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--s2); min-width: 0; }
  .code { font-size: 17px; font-weight: 600; white-space: nowrap; }
  .chip { display: inline-flex; align-items: center; min-height: 24px; padding: 0 var(--s2); font-size: 13px; font-weight: 600; color: var(--muted); background: var(--bg); border: 1px solid var(--rule-strong); border-radius: 999px; white-space: nowrap; }
  .secwrap { grid-area: sec; display: grid; gap: 2px; min-width: 0; }
  .sec { min-height: 44px; padding-top: 0; padding-bottom: 0; }
  .meta { display: flex; align-items: center; gap: var(--s2); min-width: 0; font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; }
  .seats { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .rm { grid-area: rm; }
  .l2 { display: contents; }
  .role { grid-area: role; display: inline-flex; width: max-content; max-width: 100%; justify-self: start; }
  .role > button { flex: 0 1 auto; min-width: 0; padding: 0 8px; min-height: 44px; white-space: nowrap; }
  .step { grid-area: step; display: grid; justify-self: start; min-width: 0; }
  /* The tip's 44px tap box sits inside this row (its default negative margins would overlap the role control and the + button). */
  .stl { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1); min-height: 44px; }
  .stl :global(.q) { margin: 0; }
  .stl .lab { font-size: 13px; white-space: nowrap; }
  .ctl { display: flex; flex-wrap: wrap; align-items: center; column-gap: var(--s1); }
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
  .notes { display: grid; gap: var(--s1); padding-top: var(--s1); min-width: 0; }
  .notes p { margin: 0; font-size: 14px; }
  .why { color: var(--muted); }
  .tags { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1) var(--s3); }
  .lowc { display: inline-flex; align-items: center; gap: var(--s2); }
  .tag { display: inline-flex; align-items: center; min-height: 26px; padding: 0 var(--s2); white-space: nowrap; font-size: var(--fs-xs); font-weight: 600; color: var(--text); background: var(--bg); border: 1px solid var(--rule-strong); border-radius: 4px; }
  .clash { padding-left: var(--s3); border-left: 3px solid var(--danger); color: var(--text); font-weight: 600; }
  .calc { color: var(--muted); }
  /* Disabled stepper: muted text on the page colour (at least 4.5:1), not faded by opacity. */
  .step .btn-icon:disabled { color: var(--muted); opacity: 1; }

  /* Mid width (the planner column beside the summary): Must get / Pick one / Nice to have and the group size block share one row. */
  @container (min-width: 430px) and (max-width: 619.98px) {
    .line {
      grid-template-columns: max-content minmax(0, 1fr) 44px;
      grid-template-areas: 'id id rm' 'sec sec sec' 'role step step' 'res res res';
    }
  }
  @container (min-width: 620px) {
    .role > button { flex: 0 1 104px; width: 104px; padding: 0 var(--s1); }
    .line {
      grid-template-columns: 96px minmax(110px, 1fr) 314px 44px;
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
