<svelte:options css="injected" />
<script lang="ts">
  import type { HistoryRow, Section } from '../../lib/data/types';
  import { hasContext } from 'svelte';
  import { FORECASTS_ENABLED } from '../../lib/flags';
  import HistoryPanel from './HistoryPanel.svelte';
  import ForecastPanel from './ForecastPanel.svelte';
  import SeatTrend from './SeatTrend.svelte';

  let { section, history, failed = false, preferred = [], openScanAt = null, forecastCard = true }: {
    openScanAt?: string | null;
    /** false hides the forecast card (Swap mode); history and seat parts stay. */
    forecastCard?: boolean;
    section: Section;
    history: HistoryRow[] | null;
    failed?: boolean;
    preferred?: string[];
  } = $props();
  const forecast = FORECASTS_ENABLED && hasContext('forecast');
</script>

<div class="detail">
  {#if forecast && forecastCard}
    <ForecastPanel {section} {history} {failed} {preferred}>
      <SeatTrend {section} {openScanAt} />
    </ForecastPanel>
  {:else if failed}
    <p class="err" role="alert">Could not load past results</p>
  {:else if !history}
    <div class="skel" aria-busy="true" aria-label="Loading"></div>
  {:else}
    <SeatTrend {section} {openScanAt} />
    <HistoryPanel {history} instructor={section.instructor} {preferred} />
  {/if}
  <p class="cn num">Class number <b>{section.classNumber}</b></p>
</div>

<style>
  .detail { display: grid; gap: var(--s2); min-width: 0; }
  .cn { margin: 0; font-size: 13px; color: var(--muted); }
  .cn b { font-weight: 600; color: var(--text); }
  .err { margin: 0; color: var(--muted); }
  .skel { height: 220px; border-radius: var(--r-sm); background: linear-gradient(var(--rule), var(--rule)) 0 50% / 100% 1px no-repeat; }
</style>
