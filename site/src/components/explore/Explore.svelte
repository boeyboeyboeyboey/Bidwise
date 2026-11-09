<script lang="ts">
  import { onMount } from 'svelte';
  import Browse from './Browse.svelte';
  import { exploreMode } from './courses';

  /** Browse is the default (and what old Browse and Classes links open); Build a chart is `v=build`. */
  type Mode = 'browse' | 'build';
  const MODES: Mode[] = ['browse', 'build'];
  const MODE_LABEL: Record<Mode, string> = { browse: 'Browse', build: 'Build a chart' };

  let mode = $state<Mode>('browse');
  let ready = $state(false);
  // The builder (query engine, Plot setup, controls) is fetched only when its tab is first opened.
  let BuilderView = $state.raw<typeof import('./Builder.svelte').default | null>(null);
  $effect(() => {
    if (mode === 'build' && !BuilderView) import('./Builder.svelte').then((m) => (BuilderView = m.default));
  });

  onMount(() => {
    mode = exploreMode(location.search);
    ready = true;
  });
</script>

<h1>{mode === 'browse' ? 'Browse courses' : 'Past bids'}</h1>
{#if ready}
  <div class="modes seg" role="group" aria-label="View">
    {#each MODES as m}
      <button type="button" aria-pressed={mode === m} onclick={() => (mode = m)}>{MODE_LABEL[m]}</button>
    {/each}
  </div>

  {#if mode === 'browse'}
    <Browse />
  {:else if BuilderView}
    <BuilderView />
  {:else}
    <p class="empty" role="status">Loading…</p>
  {/if}
{/if}

<style>
  h1 { margin: 0 0 var(--s3); font-size: var(--fs-lg); font-weight: 600; }
  .modes { display: flex; width: 100%; margin-bottom: var(--s4); }
  .modes > button { flex: 1 1 0; min-height: 48px; padding: 0 var(--s2); font-size: var(--fs-md); white-space: normal; }
  .empty { margin: 0; padding: var(--s6) 0; text-align: center; color: var(--muted); }
</style>
