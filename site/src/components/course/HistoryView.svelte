<svelte:options css="injected" />
<script lang="ts">
  import { onMount } from 'svelte';
  import type { HistoryRow } from '../../lib/data/types';
  import { fetchCourse } from '../../lib/data/client';
  import HistoryPanel from './HistoryPanel.svelte';
  import type { HistorySeed } from './history';

  let { code, windowName, seed = undefined, instructor: fallback = null }: {
    code: string;
    windowName: string;
    /** The default view, worked out at build time so it is in the page's HTML; absent when too large to embed. */
    seed?: HistorySeed;
    /** Instructor of the lowest-bid section this term, used when the link names none. */
    instructor?: string | null;
  } = $props();

  let history = $state<HistoryRow[] | null>(null);
  // The embedded default view is for the page's default instructor; a ?i= link names another one, so it waits for the full history.
  let useSeed = $state(!!seed);
  let failed = $state(false);
  let instructor = $state<string | null>(fallback);

  onMount(() => {
    // The course page links here with ?i=<instructor> so the "Same instructor" choice carries over.
    const i = new URLSearchParams(location.search).get('i')?.trim();
    if (i) {
      instructor = i;
      useSeed = false;
    }
    fetchCourse(code).then((d) => (history = d.history), () => (failed = true));
  });
</script>

{#if failed && !(useSeed && seed)}
  <p class="msg" role="alert">Could not load past results</p>
{:else if !history && !(useSeed && seed)}
  <div class="skel" aria-busy="true" aria-label="Loading"></div>
{:else}
  {#key instructor}
    <HistoryPanel history={history ?? (seed as HistorySeed).rows} seed={history ? undefined : seed} {instructor} currentWindow={windowName} hideTitle />
  {/key}
{/if}

<style>
  .msg { margin: 0; color: var(--muted); }
  .skel { height: 240px; border-radius: var(--r-sm); background: linear-gradient(var(--rule), var(--rule)) 0 50% / 100% 1px no-repeat; }
</style>
