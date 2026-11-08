<script lang="ts">
  import type { HistoryRow, Section } from '../../lib/data/types';
  import { seatsOf } from '../../lib/data/seats';
  import { formatSlot } from '../../lib/format/slot';
  import { aboutPct, eS, pct } from './fmt';
  import type { RowBid } from './sections';
  import { seatChange, seatLabel } from './seatLabel';
  import SectionDetail from './SectionDetail.svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import { chipFor, chipTipLines, type SwapCell } from './swapUi';

  let {
    section,
    bid,
    history = null,
    failed = false,
    preferred = [],
    open = false,
    selected = false,
    desktop = false,
    ontoggle,
    best = false,
    openScanAt = null,
    swap = null,
  }: {
    /** Swap mode: what this row shows instead of the bid. null = Bid mode. */
    swap?: SwapCell | null;
    openScanAt?: string | null;
    /** The suggested bid, or why there is none: full, no forecast, or still being worked out. */
    bid: RowBid | 'full' | 'none' | 'wait';
    best?: boolean;
    section: Section;
    history?: HistoryRow[] | null;
    failed?: boolean;
    preferred?: string[];
    open?: boolean;
    selected?: boolean;
    desktop?: boolean;
    ontoggle: () => void;
  } = $props();
  const panelId = `p-${section.id}`;
  const when = $derived(formatSlot(section.meetings) || 'Time not set');
  const who = $derived(section.instructor || 'Instructor not listed');
  const seatText = $derived(seatLabel(section));
  const change = $derived(seatChange(section));
  const full = $derived(seatsOf(section).left <= 0);
  const bidText = $derived(typeof bid === 'object' ? `suggested bid ${eS(bid.cents)}, ${aboutPct(bid.p)} chance of a seat` : bid === 'wait' ? 'bid being worked out' : 'no suggested bid');
  const chip = $derived(swap?.kind === 'opt' ? chipFor(swap.opt.label) : null);
  const swapText = $derived(swap?.kind === 'mine' ? 'your section' : chip ? `${chip.text} to swap into` : swap?.kind === 'wait' ? 'swap chance being worked out' : 'no swap chance yet');
  const label = $derived([section.section, who, when, seatText, swap ? swapText : bidText, !swap && best ? 'lowest bid of the open sections' : ''].filter(Boolean).join(', '));
</script>

<li id={section.id}>
  <button
    type="button"
    class="row-link head"
    class:open
    class:selected
    class:full
    aria-label={label}
    aria-expanded={desktop ? undefined : open}
    aria-controls={desktop ? undefined : panelId}
    aria-current={desktop && selected ? 'true' : undefined}
    onclick={ontoggle}
  >
    <b class="sec">{section.section}</b>
    <span class="who" class:tipwho={swap?.kind === 'opt'}>{who}{#if best && !swap}<span class="badge">Lowest bid</span>{/if}</span>
    <span class="time num">{when}</span>
    <span class="seats">{seatText}{#if change}<span class="chg num">{change}</span>{/if}</span>
    <span class="bid num" class:swapcol={!!swap}>
      {#if swap}
        {#if swap.kind === 'mine'}
          <span class="chip mine">Yours</span>
        {:else if chip}
          <span class="chip {chip.tone}">{chip.text}</span>
        {:else}
          <span class="no">{swap.kind === 'wait' ? 'Calculating' : '–'}</span>
        {/if}
      {:else if typeof bid === 'object'}
        <b>{eS(bid.cents)}</b><span class="ar" aria-hidden="true">&nbsp;→&nbsp;</span><span class="ch">{pct(bid.p)} chance</span>
      {:else if bid === 'wait'}
        <span class="no">Calculating</span>
      {:else}
        <span class="no">{bid === 'full' ? 'No bid, full' : 'No forecast'}</span>
      {/if}
    </span>
  </button>
  {#if swap?.kind === 'opt'}
    <span class="tipat"><InfoTip label={`About the ${chip?.text} label for ${section.section}`} lines={chipTipLines(swap.opt)} anchor="swap-chance" linkText="How swap chance works" /></span>
  {/if}
  {#if open}
    <div class="panel detail" id={panelId}>
      <SectionDetail {section} {history} {failed} {preferred} {openScanAt} forecastCard={!swap} />
    </div>
  {/if}
</li>

<style>
  li { position: relative; min-width: 0; list-style: none; }
  .tipat { position: absolute; right: 38px; top: 50%; transform: translateY(-50%); line-height: 0; }
  .swapcol { margin-right: 44px; }
  .chip { display: inline-block; min-width: 72px; padding: 2px 10px; font-size: var(--fs-xs); font-weight: 600; line-height: 1.5; text-align: center; border: 1px solid var(--rule-strong); border-radius: 999px; color: var(--text); background: var(--bg); }
  .chip.good { color: var(--accent-press); background: var(--accent-soft); border-color: var(--accent); }
  .chip.bad { color: var(--danger); background: #f8ebe8; border-color: #d9aaa2; }
  .chip.none, .chip.mine { color: var(--muted); background: transparent; border-style: dashed; }
  /* Phone and narrow lists: three lines. Line 1 section and professor (full width, so a name wraps only at spaces),
     line 2 day and time with the bid, line 3 seats. */
  .head {
    display: grid; width: 100%; text-align: left; cursor: pointer; font: inherit; font-size: var(--fs-sm);
    grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'sec who who' 'time time bid' 'seats seats seats';
    column-gap: var(--s2); row-gap: 2px; align-items: baseline;
    background: none; border-top: 0; border-left: 0; border-right: 0;
    min-height: 56px; padding-top: var(--s2); padding-bottom: var(--s2);
  }
  .head.full { color: var(--muted); }
  .head:hover, .head:active { background: var(--surface); }
  .head.selected { background: var(--accent-soft); }
  .head.open { background: var(--accent-soft); }
  .head.open::after { transform: translateY(-50%) rotate(90deg); }
  .sec { grid-area: sec; font-size: var(--fs-md); font-weight: 600; }
  .who { grid-area: who; min-width: 0; overflow-wrap: break-word; }
  /* Phone: the swap tip button sits at right 38px and its tap area is 44px wide (10px past each side), so keep the name clear of it. */
  @media (max-width: 767px) { .who.tipwho { padding-right: 72px; } }
  .time { grid-area: time; align-self: center; color: var(--muted); font-size: var(--fs-xs); overflow-wrap: break-word; }
  .seats { grid-area: seats; color: var(--muted); font-size: var(--fs-xs); }
  .bid { grid-area: bid; justify-self: end; text-align: right; white-space: nowrap; }
  .bid b { font-size: var(--fs-md); font-weight: 700; }
  .ar { color: var(--muted); }
  .ch { color: var(--text); }
  .no { color: var(--muted); font-size: var(--fs-xs); white-space: normal; }
  .chg { font-size: var(--fs-xs); }
  .chg::before { content: ' · '; }
  .badge { display: inline-block; margin-left: var(--s2); padding: 0 6px; font-size: var(--fs-xs); font-weight: 600; line-height: 1.5; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 4px; vertical-align: 1px; }
  .head.selected .badge, .head.open .badge { background: var(--surface); }
  .detail { margin: var(--s2) 0 var(--s4); }

  /* The desktop list scrolls and clips sideways, so the tip opens leftwards from its button there. */
  @media (min-width: 1024px) { .tipat :global(.pop) { left: auto !important; right: 0; } }

  /* Wide list: one line, one column per fact. Same columns as CourseView's header (--cols). */
  @container (min-width: 640px) {
    .head { grid-template-columns: var(--cols); grid-template-areas: 'sec who time seats bid'; column-gap: var(--s3); align-items: center; min-height: 56px; }
    .sec { font-size: var(--fs-md); }
    .time, .seats { color: var(--text); font-size: var(--fs-sm); }
    .head.full .time, .head.full .seats { color: var(--muted); }
    .seats { justify-self: start; text-align: left; }
    .chg { display: block; color: var(--muted); }
    .chg::before { content: none; }
    .bid { font-size: var(--fs-sm); }
  }
</style>
