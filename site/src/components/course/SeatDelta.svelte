<svelte:options css="injected" />
<script lang="ts">
  import type { Section } from '../../lib/data/types';
  import { deltaMarker } from '../../lib/data/seatDeltas';

  let { section, openScanAt = null, prevScanAt = null }: { section: Section; openScanAt?: string | null; prevScanAt?: string | null } = $props();
  const m = $derived(deltaMarker(section, openScanAt, prevScanAt));
</script>

{#if m}<span class="delta num" class:up={m.tone === 'up'} class:down={m.tone === 'down'} title={m.title} aria-label={m.label}>{m.text}</span>{/if}

<style>
  .delta { display: inline-block; margin-left: var(--s2); font-size: 13px; font-weight: 600; line-height: 1.4; cursor: help; }
  .up { color: var(--up); }
  .down { color: var(--down); }
</style>
