<script lang="ts">
  import { onMount } from 'svelte';
  import type { CourseIndexEntry } from '../../lib/data/types';
  import { fetchIndex } from '../../lib/data/client';
  import Browse from './Browse.svelte';
  import { browseDefaults, decodeBrowse, encodeBrowse, type BrowseState } from './browse';

  /** Build a chart is the default (and what old Compare links open); Browse all sections is `v=browse`. */
  type Mode = 'build' | 'browse';
  const MODES: Mode[] = ['build', 'browse'];
  const MODE_LABEL: Record<Mode, string> = { build: 'Build a chart', browse: 'Browse all sections' };

  let mode = $state<Mode>('build');
  let bs = $state<BrowseState>(browseDefaults());
  let index = $state<CourseIndexEntry[]>([]);
  let ready = $state(false);
  // The builder (query engine, Plot setup, controls) is fetched only when its tab is first opened.
  let BuilderView = $state.raw<typeof import('./Builder.svelte').default | null>(null);
  $effect(() => {
    if (mode === 'build' && !BuilderView) import('./Builder.svelte').then((m) => (BuilderView = m.default));
  });

  onMount(() => {
    fetchIndex().then((i) => (index = i), () => {});
    mode = new URLSearchParams(location.search).get('v') === 'browse' ? 'browse' : 'build';
    bs = decodeBrowse(location.search);
    ready = true;
  });

  // URL sync for Browse; the Build tab keeps its own address.
  $effect(() => {
    if (!ready || mode !== 'browse') return;
    history.replaceState(null, '', `?${encodeBrowse(bs)}`);
  });
</script>

<h1>Past bids</h1>
{#if ready}
  <div class="modes seg" role="group" aria-label="View">
    {#each MODES as m}
      <button type="button" aria-pressed={mode === m} onclick={() => (mode = m)}>{MODE_LABEL[m]}</button>
    {/each}
  </div>

  {#if mode === 'build'}
    {#if BuilderView}<BuilderView />{:else}<p class="empty" role="status">Loading…</p>{/if}
  {:else}
    <Browse bind:bs {index} />
  {/if}
{/if}

<style>
  h1 { margin: 0 0 var(--s3); font-size: var(--fs-lg); font-weight: 600; }
  .modes { display: flex; width: 100%; margin-bottom: var(--s4); }
  .modes > button { flex: 1 1 0; min-height: 48px; padding: 0 var(--s2); font-size: var(--fs-md); white-space: normal; }
  .empty { margin: 0; padding: var(--s6) 0; text-align: center; color: var(--muted); }
</style>
