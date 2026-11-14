<svelte:options css="injected" />
<script lang="ts">
  import { eS } from '../course/fmt';
  import { seatText } from './seats';
  import type { PlanRow } from './logic';
  import { onMount } from 'svelte';
  import { readSeatMeta, type SeatMeta } from '../../lib/data/freshness';
  import { scanBadgeFor } from '../../lib/data/seatDeltas';
  import SeatDelta from '../course/SeatDelta.svelte';

  let { row, chance }: { row: PlanRow; /** The chance the bid is for, as text: "80%". */ chance: string } = $props();
  const s = $derived(row.section);
  // Scan times come from the page (Base.astro), read after mount so the server render matches the first client render.
  let seatMeta = $state<SeatMeta | null>(null);
  onMount(() => { seatMeta = readSeatMeta(); });
  // The change since the previous scan, for a section the scan saw. Absent on options that do not carry it: no badge.
  const badge = $derived(scanBadgeFor(s.sinceLast, seatMeta?.prevScanAt, seatMeta?.scanAt));
</script>

<a class="row-link" href={`/course/${row.code}`}>
  <span class="l1"><b>{row.code}</b> <span class="title">{row.title}</span> <span class="sec">{s.section}</span></span>
  <span class="stats num">
    <span><i>Bid for {chance}</i> {eS(s.bidCents as number)}</span>
    <span><i>Seats</i> {seatText(s)}{#if badge}<span class="chg"> · <SeatDelta {badge} /></span>{/if}</span>
  </span>
  <span class="l3">{s.instructor || 'Instructor not listed'} · <span class="num">{s.times || 'Time not set'}</span></span>
  {#if row.note}<small>{row.note}</small>{/if}
  {#if row.cls === 'tagged'}<small>From BOSS course tags</small>{/if}
</a>

<style>
  .row-link { display: grid; gap: var(--s1); font-size: var(--fs-sm); min-width: 0; }
  .l1 { overflow-wrap: anywhere; }
  .l1 b, .sec { font-weight: 600; }
  .sec { color: var(--muted); font-size: var(--fs-xs); }
  .stats { display: flex; flex-wrap: wrap; gap: 0 var(--s4); }
  .stats i { font-style: normal; font-size: var(--fs-xs); color: var(--muted); margin-right: var(--s1); }
  .l3 { color: var(--muted); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  small { font-size: var(--fs-xs); color: var(--muted); }
</style>
