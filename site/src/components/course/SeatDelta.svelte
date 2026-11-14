<svelte:options css="injected" />
<script lang="ts">
  import type { Section } from '../../lib/data/types';
  import { deltaMarker, type ScanBadge } from '../../lib/data/seatDeltas';

  /** `badge` (a row's "−3 since 09:00") is shown on its own; without it the section's since-open marker is. */
  let { section = null, openScanAt = null, prevScanAt = null, badge = null }: { section?: Section | null; openScanAt?: string | null; prevScanAt?: string | null; badge?: ScanBadge | null } = $props();
  const m = $derived(!badge && section ? deltaMarker(section, openScanAt, prevScanAt) : null);
</script>

{#if badge}<span class="delta scan num" class:up={badge.tone === 'up'} class:down={badge.tone === 'down'}><span aria-hidden="true">{badge.text}</span><span class="sr-only">{badge.label}</span></span>{:else if m}<span class="delta num" class:up={m.tone === 'up'} class:down={m.tone === 'down'} title={m.title} aria-label={m.label}>{m.text}</span>{/if}

<style>
  .delta { display: inline-block; margin-left: var(--s2); font-size: 13px; font-weight: 600; line-height: 1.4; cursor: help; }
  .delta.scan { margin-left: 0; cursor: default; white-space: nowrap; }
  .up { color: var(--up); }
  .down { color: var(--down); }
</style>
