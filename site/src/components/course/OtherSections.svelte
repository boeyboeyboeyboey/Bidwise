<svelte:options css="injected" />
<script lang="ts">
  import { getContext } from 'svelte';
  import type { Section } from '../../lib/data/types';
  import { recommendBid } from '../../lib/sim';
  import type { ForecastCtx } from './forecast-ctx';
  import SeatDelta from './SeatDelta.svelte';
  import { APPROX_NOTE, fullText, SEATS_HELP_HREF, seatsLeftNow, seatsOf } from '../../lib/data/seats';
  import { eS, pct } from './fmt';
  import { formatSlot } from '../../lib/format/slot';
  import { simSection } from './sectionSim';

  let { section, win, group, target, fit = 0, onall }: { section: Section; win: string; group: number; target: number; fit?: number; onall?: () => void } = $props();
  const ctx = getContext<ForecastCtx>('forecast');
  const SHOWN = 7;

  type Key = 'section' | 'instructor' | 'time' | 'seats' | 'chance' | 'bid';
  type Row = { s: Section; time: string; chance: number | null; bid: number | null };
  let sims = $state.raw<Map<string, { pFill: number; bid: number } | null> | null>(null);
  let all = $state(false);
  let key = $state<Key>('bid');
  let dir = $state<1 | -1>(1);
  let token = 0;

  const others = $derived([...(ctx.bySection?.values() ?? [])].filter((s) => s.classNumber !== section.classNumber));

  $effect(() => {
    const list = others;
    const g = group;
    const w = win;
    const t = target;
    const my = ++token;
    sims = null;
    const jobs = list.map((s) => simSection(s, w, g));
    Promise.all(jobs.map((j) => j ?? Promise.resolve(null))).then((rs) => {
      if (my !== token) return;
      sims = new Map(list.map((s, i) => [s.classNumber, rs[i] ? { pFill: rs[i]!.pFill, bid: recommendBid(rs[i]!, t) } : null]));
    });
  });

  const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const rows = $derived.by<Row[]>(() => {
    if (!sims) return [];
    const m = sims;
    const rs: Row[] = others.filter((s) => seatsLeftNow(s) >= fit).map((s) => ({
      s,
      time: formatSlot(s.meetings) || 'Time not set',
      chance: m.get(s.classNumber)?.pFill ?? null,
      bid: m.get(s.classNumber)?.bid ?? null,
    }));
    const val = (r: Row): number | string | null =>
      key === 'section' ? r.s.section : key === 'instructor' ? r.s.instructor || 'TBA' : key === 'time' ? r.time : key === 'seats' ? seatsLeftNow(r.s) : key === 'chance' ? r.chance : r.bid;
    // Open sections first (those without a forecast after those with one), full sections last, whatever the sort.
    const tier = (r: Row) => (seatsLeftNow(r.s) <= 0 ? 2 : r.bid === null ? 1 : 0);
    return rs.sort((a, b) => {
      if (tier(a) !== tier(b)) return tier(a) - tier(b);
      const x = val(a);
      const y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : x === null || y === null ? 0 : natural(String(x), String(y));
      return dir * c || natural(a.s.section, b.s.section);
    });
  });
  const shown = $derived(all ? rows : rows.slice(0, SHOWN));

  function sortBy(k: Key) {
    if (key === k) dir = dir === 1 ? -1 : 1;
    else {
      key = k;
      dir = k === 'chance' ? -1 : 1;
    }
  }
  const aria = (k: Key) => (key === k ? (dir === 1 ? 'ascending' : 'descending') : 'none');
  const cols: { k: Key; l: string; cls: string }[] = [
    { k: 'section', l: 'Section', cls: '' },
    { k: 'instructor', l: 'Instructor', cls: 'ins' },
    { k: 'time', l: 'Time', cls: 'tm' },
    { k: 'seats', l: 'Seats now', cls: 'r' },
    { k: 'chance', l: 'Chance section fills', cls: 'r' },
    { k: 'bid', l: 'Bid', cls: 'r' },
  ];
</script>

{#if others.length}
  <section class="os" aria-label="Other sections of this course">
    {#if !sims}
      <div class="skel" aria-busy="true" aria-label="Loading other sections"></div>
    {:else}
      {#if fit > 1}
        <p class="fitnote">Sections with {fit}+ seats{#if onall}<button type="button" class="link" onclick={onall}>Show all sections</button>{/if}</p>
      {/if}
      <div class="tbl" role="table" aria-label="Other sections in {win}">
        <div class="tr th" role="row">
          {#each cols as c (c.k)}
            <span role="columnheader" class={c.cls} aria-sort={aria(c.k)}>
              <button type="button" class="sort" class:on={key === c.k} onclick={() => sortBy(c.k)}>{c.k === 'bid' ? `Bid for ${pct(target)}` : c.l}{#if key === c.k}<i aria-hidden="true">{dir === 1 ? '▲' : '▼'}</i>{/if}</button>
            </span>
          {/each}
        </div>
        {#each shown as r (r.s.id)}
          <div class="tr" class:full={seatsLeftNow(r.s) <= 0} role="row">
            <span role="cell"><button type="button" class="btn sel" onclick={() => ctx.select(r.s.id)} aria-label="Show section {r.s.section}">{r.s.section}</button></span>
            <span role="cell" class="ins">{r.s.instructor || 'TBA'}</span>
            <span role="cell" class="tm num">{r.time}</span>
            <span role="cell" class="r num">{#if seatsLeftNow(r.s) <= 0}<b class="badge">{fullText(r.s)}</b>{:else}{#if seatsOf(r.s).source === 'approx'}<a class="approx" href={SEATS_HELP_HREF} title={APPROX_NOTE} aria-label={APPROX_NOTE}>≈</a>{/if}{seatsLeftNow(r.s)}{/if}<SeatDelta section={r.s} /></span>
            <span role="cell" class="r num">{r.chance === null ? '—' : pct(r.chance)}</span>
            <span role="cell" class="r num">{#if r.bid === null}—{:else}<b>{eS(r.bid)}</b>{/if}</span>
          </div>
        {/each}
      </div>
      {#if rows.length > SHOWN}
        <button type="button" class="btn more" aria-expanded={all} onclick={() => (all = !all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
      {/if}
    {/if}
  </section>
{:else}
  <p class="none">This course has no other sections this term</p>
{/if}

<style>
  .os { display: grid; gap: var(--s2); min-width: 0; }
  .fitnote { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s3); margin: 0; font-size: 15px; font-weight: 600; }
  .link { min-height: 44px; padding: 0; font: inherit; font-weight: 600; color: var(--accent); background: none; border: 0; text-decoration: underline; cursor: pointer; }
  .none { margin: 0; color: var(--muted); }
  .skel { height: 120px; border-radius: var(--r-sm); background: linear-gradient(var(--rule), var(--rule)) 0 50% / 100% 1px no-repeat; }
  .tr { display: grid; grid-template-columns: 64px minmax(0, 1.3fr) minmax(0, 1.5fr) 84px 112px 100px; align-items: center; gap: var(--s2); min-height: 40px; padding: 2px 0; border-bottom: 1px solid var(--rule); font-size: 14px; }
  .tr.full { color: var(--muted); }
  .th { align-items: end; min-height: 32px; font-size: 13px; line-height: 1.2; color: var(--muted); }
  .r { text-align: right; }
  .ins, .tm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sort { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; padding: 4px 0; font: inherit; color: inherit; text-align: inherit; background: none; border: 0; cursor: pointer; }
  .r .sort { justify-content: flex-end; }
  .sort:hover, .sort.on { color: var(--text); }
  .sort i { font-style: normal; font-size: 13px; }
  .sel { min-height: 32px; padding: 0 var(--s2); font-size: 14px; font-weight: 600; }
  .approx { color: var(--muted); margin-right: 2px; text-decoration: none; cursor: help; }
  .badge { display: inline-block; padding: 1px 6px; font-size: 13px; font-weight: 600; color: var(--muted); background: var(--bg); border: 1px solid var(--rule-strong); border-radius: 4px; }
  .more { justify-self: start; min-height: 36px; padding: 0 var(--s3); font-size: 14px; }
  @media (max-width: 640px) {
    .tr { grid-template-columns: 52px minmax(0, 1fr) 70px 90px; }
    .ins, .tm { display: none; }
  }
</style>
