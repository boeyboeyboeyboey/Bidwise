<svelte:options css="injected" />
<script lang="ts">
  import type { FreedRow } from '../../lib/data/seatDeltas';
  import { scanTimeText } from '../../lib/data/seats';

  let { rows, openScanAt = null, scanAt = null }: { rows: (FreedRow & { slot?: string })[]; openScanAt?: string | null; scanAt?: string | null } = $props();
  const asOf = $derived(scanTimeText(scanAt));
  const unit = (n: number) => (n === 1 ? 'seat' : 'seats');
</script>

{#if rows.length}
  <section aria-labelledby="freed-h">
    <h2 id="freed-h">Most seats freed{#if asOf}<span class="asof">{asOf}</span>{/if}</h2>
    <ul>
      {#each rows as r, i (`${r.code}-${r.section}`)}
        <li>
          <a class="row-link" href={`/course/${r.code}?s=${encodeURIComponent(r.section)}`} aria-label={`${r.code} ${r.section}, ${r.slot || 'time not set'}, ${r.available} ${unit(r.available)} left of ${r.total}, ${r.sinceOpen} more than at opening`}>
            <span class="id"><b>{r.code}</b> {r.section} <span class="when">· {r.slot || 'Time not set'}</span><span class="who">{r.instructor || 'Instructor not listed'}</span></span>
            <span class="seats"><span>{r.available} {unit(r.available)} left of {r.total}</span><span class="up">+{r.sinceOpen} since opening</span></span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  section { container-type: inline-size; min-width: 0; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-lg); padding: var(--s4); }
  h2 { font-size: var(--fs-md); font-weight: 600; min-height: 44px; display: flex; align-items: center; column-gap: var(--s3); }
  .asof { font-weight: 400; font-size: var(--fs-sm); color: var(--muted); }
  .row-link { display: grid; grid-template-columns: minmax(0, 1fr); row-gap: 2px; padding-top: 8px; padding-bottom: 8px; }
  .id { display: block; min-width: 0; overflow-wrap: break-word; }
  .id b { font-weight: 600; white-space: nowrap; }
  .when { color: var(--text); }
  .who { display: block; color: var(--muted); font-size: var(--fs-xs); line-height: 1.3; }
  .seats { display: flex; flex-wrap: wrap; column-gap: var(--s2); font-size: var(--fs-xs); color: var(--muted); }
  .up { color: var(--up); font-weight: 600; }
  @container (min-width: 480px) {
    .row-link { display: grid; grid-template-columns: minmax(0, 1fr) 190px; column-gap: var(--s3); }
    .row-link { align-items: center; }
    .seats { display: grid; justify-items: end; text-align: right; font-size: var(--fs-sm); color: var(--text); }
    .up { font-size: var(--fs-xs); }
  }
</style>
