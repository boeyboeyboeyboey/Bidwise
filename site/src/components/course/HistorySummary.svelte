<svelte:options css="injected" />
<script lang="ts">
  import type { HistoryRow } from '../../lib/data/types';
  import { sameInstructor } from '../../lib/data/format';
  import HistoryWindowChart from './HistoryWindowChart.svelte';
  import { byWindow, termWithResults } from './history';

  let { history, code, currentTerm, instructor = null, hideTitle = false }: {
    history: HistoryRow[];
    code: string;
    currentTerm: string;
    /** Instructor of the section being viewed; null on a course with no sections this term. */
    instructor?: string | null;
    hideTitle?: boolean;
  } = $props();

  const mine = $derived(instructor ? termWithResults(history, currentTerm, instructor) : null);
  const anyTerm = $derived(termWithResults(history, currentTerm));
  // Initial choice is read once: the panel is re-created when the section changes.
  const firstMine = () => !!instructor && termWithResults(history, currentTerm, instructor) !== null;
  let scope = $state<'instructor' | 'course'>(firstMine() ? 'instructor' : 'course');
  const who = $derived(scope === 'instructor' ? instructor : null);
  const term = $derived(scope === 'instructor' ? mine : anyTerm);
  // Regular rounds only: the incoming-student intakes are other cohorts and would crowd the axis (the full history page has them).
  const points = $derived(term ? byWindow(history, term, who).filter((p) => p.window.startsWith('Round')) : []);
  const noPrice = $derived(points.length > 0 && points.every((p) => p.median === null && p.min === null));
  const late = $derived(!!term && term !== currentTerm);
  const href = $derived(`/course/${encodeURIComponent(code)}/history/${instructor ? `?i=${encodeURIComponent(instructor)}` : ''}`);
</script>

<div class="hh"><section class="hist">
  <h3>{hideTitle || !term ? (term ?? '') : `Past results · ${term}`}</h3>
  {#if instructor}
    <div class="pair" role="group" aria-label="Show">
      <span class="lab">Show</span>
      <div class="seg">
        <button type="button" aria-pressed={scope === 'instructor'} disabled={!mine} onclick={() => (scope = 'instructor')}>Same instructor</button>
        <button type="button" aria-pressed={scope === 'course'} onclick={() => (scope = 'course')}>Whole course</button>
      </div>
    </div>
  {/if}
  {#if !term || points.length === 0}
    <p class="none">No past results for this selection</p>
  {:else}
    {#if late}<p class="note">No results yet for {currentTerm}. Showing the latest term with results.</p>{/if}
    {#if noPrice}
      <p class="note">No bid won a seat in these windows, so there's no past price.</p>
    {:else}
      <HistoryWindowChart {points} {term} />
    {/if}
  {/if}
  <a class="more" href={href}>Full bid history ›</a>
</section></div>

<style>
  .hist { display: grid; gap: var(--s3); min-width: 0; }
  h3 { font-size: 17px; font-weight: 600; }
  .pair { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s2); min-width: 0; }
  .lab { font-size: 14px; color: var(--muted); }
  .seg button:disabled { opacity: 0.5; cursor: not-allowed; }
  .none { color: var(--muted); margin: var(--s3) 0; }
  .note { margin: 0; font-size: 14px; color: var(--muted); }
  .more { justify-self: start; display: inline-flex; align-items: center; min-height: 44px; font-weight: 600; font-size: 15px; color: var(--accent); }
  .hh { container-type: inline-size; min-width: 0; }
</style>
