<svelte:options css="injected" />
<script lang="ts">
  import type { HistoryRow, Section } from '../../lib/data/types';
  import { hasContext } from 'svelte';
  import { FORECASTS_ENABLED } from '../../lib/flags';
  import HistorySummary from './HistorySummary.svelte';
  import ForecastPanel from './ForecastPanel.svelte';
  import SeatTrend from './SeatTrend.svelte';
  import Snipe from './Snipe.svelte';

  let { section, history, failed = false, code, currentTerm, openScanAt = null, forecastCard = true }: {
    openScanAt?: string | null;
    /** false hides the forecast card (Swap mode); history and seat parts stay. */
    forecastCard?: boolean;
    section: Section;
    history: HistoryRow[] | null;
    failed?: boolean;
    code: string;
    currentTerm: string;
  } = $props();
  const forecast = FORECASTS_ENABLED && hasContext('forecast');
</script>

<div class="detail">
  {#if forecast && forecastCard}
    <ForecastPanel {section} {history} {failed} {currentTerm}>
      <SeatTrend {section} {openScanAt} />
    </ForecastPanel>
    <Snipe {section} />
  {:else if failed}
    <p class="err" role="alert">Could not load past results</p>
  {:else if !history}
    <div class="skel" aria-busy="true" aria-label="Loading"></div>
  {:else}
    <SeatTrend {section} {openScanAt} />
    <HistorySummary {history} {code} {currentTerm} instructor={section.instructor} />
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
