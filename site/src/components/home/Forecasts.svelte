<svelte:options css="injected" />
<script lang="ts">
  import type { WindowHighlights, ForecastHighlight } from '../../lib/data/types';
  import { eS } from '../course/fmt';
  import { followChosenWindow } from './chosenWindow';
  import { liveLabel } from '../../lib/data/window';
  import { onMount } from 'svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import { parseBalance } from '../planner/plan';

  let { byWindow, openLabel, targetP, slots }: {
    byWindow: Record<string, WindowHighlights>;
    openLabel: string;
    targetP: number;
    /** Day and time of each section, keyed by class number (built from the course files). */
    slots: Record<string, string>;
  } = $props();
  const ROWS = 6;

  let chosen = $state<string | null>(null);
  followChosenWindow((l) => (chosen = l));
  // A window without a forecast falls back to the open one; the heading always names what is shown.
  // The window open now, or the next to open; the browser's clock decides, the build's pick is the start.
  let current = $state(openLabel);
  onMount(() => (current = liveLabel(openLabel)));
  const label = $derived(chosen && byWindow[chosen] ? chosen : (byWindow[current] ? current : openLabel));
  const rowsAll = $derived(byWindow[label]?.mostContested ?? []);
  const target = $derived(`${Math.round(targetP * 100)}%`);

  // Optional balance in e$: empty = no filtering. When set, rows whose bid is above it are hidden. Kept in this browser only.
  const KEY = 'bidwise.balance';
  let balanceText = $state('');
  const balanceCents = $derived(parseBalance(balanceText));
  onMount(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null && parseBalance(v) !== null) balanceText = v;
    } catch {}
  });
  function onBalance() {
    try {
      if (balanceText.trim() === '') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, balanceText.trim());
    } catch {}
  }
  const rows = $derived(rowsAll.filter((h) => balanceCents === null || h.bidCents <= balanceCents).slice(0, ROWS));
  const seatText = (h: ForecastHighlight) => `${h.approx ? 'About ' : ''}${h.seatsLeft} ${h.seatsLeft === 1 ? 'seat' : 'seats'} left of ${h.seatsTotal}`;
</script>

<section aria-labelledby="comp-h">
  <div class="head">
    <div class="ttl"><h2 id="comp-h">{label === current ? 'Most competitive' : `Most competitive in ${label}`}</h2> <InfoTip label="How are these bids calculated?" lines={[`Each bid aims for about a ${target} chance of a seat.`, 'We replay the window thousands of times with random bidders, using what people bid on this course and instructor in past terms. It is an estimate, not a guarantee.']} /></div>
    <label class="bal">
      <span>My balance</span>
      <span class="inp"><span class="cur" aria-hidden="true">e$</span><input class="num" type="text" inputmode="decimal" autocomplete="off" placeholder="optional" bind:value={balanceText} oninput={onBalance} /></span>
    </label>
  </div>
  <ul>
    {#each rows as h, i (h.classNumber)}
      <li>
        <a class="row-link" href={`/course/${h.code}?s=${encodeURIComponent(h.section)}`} aria-label={`${h.code} ${h.section}, ${slots[h.classNumber] || 'time not set'}, ${seatText(h)}, bid ${eS(h.bidCents)} for about a ${target} chance of a seat`}>
          <span class="id"><b>{h.code}</b> {h.section} <span class="when">· {slots[h.classNumber] || 'Time not set'}</span><span class="who">{h.instructor ?? 'Instructor not listed'}</span></span>
          <span class="seats">{seatText(h)}</span>
          <span class="fig num">{eS(h.bidCents)} <span class="ar" aria-hidden="true">→</span> {target}<span class="ch">&nbsp;chance</span></span>
        </a>
      </li>
    {/each}
  </ul>
  {#if !rows.length}
    <p class="none">{balanceCents !== null && rowsAll.length ? 'None within your balance' : 'No forecast for this window yet'}</p>
  {/if}
</section>

<style>
  section { container-type: inline-size; min-width: 0; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-lg); padding: var(--s4); }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 var(--s4); }
  .ttl { display: flex; align-items: center; column-gap: var(--s3); min-height: 44px; }
  h2 { font-size: var(--fs-md); font-weight: 600; }
  .bal { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--fs-sm); font-weight: 600; }
  .inp { display: inline-flex; align-items: center; height: 44px; width: 130px; padding: 0 var(--s3); gap: var(--s1); background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); font-weight: 400; }
  .inp:focus-within { outline: 2px solid var(--focus); outline-offset: 1px; }
  .cur { color: var(--muted); }
  .inp input { flex: 1; min-width: 0; height: 100%; padding: 0; font: inherit; font-size: 16px; color: var(--text); background: none; border: 0; outline: none; }
  .inp input::placeholder { color: var(--muted); opacity: 1; }
  .ar { color: var(--muted); }
  .ch { color: var(--muted); font-weight: 400; font-size: var(--fs-xs); }
  .none { margin: var(--s3) 0 0; font-size: var(--fs-sm); color: var(--muted); }

  .row-link { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'id id' 'seats fig'; align-items: baseline; column-gap: var(--s3); row-gap: 2px; padding-top: 8px; padding-bottom: 8px; }
  .id { grid-area: id; display: block; min-width: 0; overflow-wrap: break-word; }
  .id b { font-weight: 600; white-space: nowrap; }
  .when { color: var(--text); }
  .who { display: block; color: var(--muted); font-size: var(--fs-xs); line-height: 1.3; }
  .seats { grid-area: seats; font-size: var(--fs-xs); color: var(--muted); }
  .fig { grid-area: fig; justify-self: end; font-weight: 600; font-size: var(--fs-sm); white-space: nowrap; }
  @container (min-width: 480px) {
    .row-link { display: grid; grid-template-columns: minmax(0, 1fr) 150px 190px; grid-template-areas: none; column-gap: var(--s3); }
    .ch { font-size: inherit; color: inherit; }
    .row-link { align-items: center; }
    .id, .seats, .fig { grid-area: auto; }
    .seats { text-align: right; font-size: var(--fs-sm); color: var(--text); }
    .fig { font-size: var(--fs-sm); text-align: right; }
  }
</style>
