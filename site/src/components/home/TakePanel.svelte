<svelte:options css="injected" />
<script lang="ts">
  import { tick, type Component } from 'svelte';
  import { takeState } from './takeState.svelte';

  let { builtWindow }: { builtWindow: string } = $props();
  // The planner logic and requirement data load only when the panel is first opened.
  let Panel = $state.raw<Component<{ builtWindow: string }> | null>(null);
  let failed = $state(false);
  let root = $state<HTMLElement>();

  $effect(() => {
    if (!takeState.open) return;
    if (!Panel) import('./WhatToTake.svelte').then((m) => (Panel = m.default as Component<{ builtWindow: string }>), () => (failed = true));
    tick().then(() => {
      root?.scrollIntoView({ block: 'start' });
      root?.focus({ preventScroll: true });
    });
  });
</script>

{#if takeState.open}
  <section id="take" class="take" aria-labelledby="take-h" tabindex="-1" bind:this={root}>
    <h2 id="take-h">What should I take?</h2>
    {#if Panel}
      <Panel {builtWindow} />
    {:else if failed}
      <p class="note">Could not load. Reload the page to try again.</p>
    {:else}
      <p class="note">Loading…</p>
    {/if}
  </section>
{/if}

<style>
  .take { display: grid; gap: var(--s4); padding-top: var(--s4); border-top: 1px solid var(--rule); min-width: 0; scroll-margin-top: calc(var(--topbar-h) + var(--s3)); }
  .take:focus { outline: none; }
  h2 { font-size: var(--fs-lg); font-weight: 600; }
  .note { margin: 0; color: var(--muted); font-size: var(--fs-sm); }
</style>
