<svelte:options css="injected" />
<script lang="ts">
  import { onMount } from 'svelte';
  import type { HistoryRow } from '../../lib/data/types';
  import { fetchCourse } from '../../lib/data/client';
  import HistoryPanel from './HistoryPanel.svelte';

  let { code, windowName, latestWindow, instructor: fallback = null }: {
    code: string;
    windowName: string;
    latestWindow: string;
    /** Instructor of the lowest-bid section this term, used when the link names none. */
    instructor?: string | null;
  } = $props();

  let history = $state<HistoryRow[] | null>(null);
  let failed = $state(false);
  let instructor = $state<string | null>(fallback);

  onMount(() => {
    // The course page links here with ?i=<instructor> so the "Same instructor" choice carries over.
    const i = new URLSearchParams(location.search).get('i')?.trim();
    if (i) instructor = i;
    fetchCourse(code).then((d) => (history = d.history), () => (failed = true));
  });
</script>

{#if failed}
  <p class="msg" role="alert">Could not load past results</p>
{:else if !history}
  <div class="skel" aria-busy="true" aria-label="Loading"></div>
{:else}
  {#key instructor}
    <HistoryPanel {history} {instructor} preferred={[windowName, latestWindow]} hideTitle />
  {/key}
{/if}

<style>
  .msg { margin: 0; color: var(--muted); }
  .skel { height: 240px; border-radius: var(--r-sm); background: linear-gradient(var(--rule), var(--rule)) 0 50% / 100% 1px no-repeat; }
</style>
