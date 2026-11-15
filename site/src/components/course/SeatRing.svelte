<script lang="ts">
  import { seatRing } from './seatRing';
  let { left, group = 1, approx = false, size = 18 }: { left: number; group?: number; approx?: boolean; size?: number } = $props();
  const ring = $derived(seatRing(left, group));
</script>

<svg class="ring" width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
  <circle cx="9" cy="9" r="7" fill="none" stroke="var(--rule-strong)" stroke-width="3" stroke-dasharray={approx ? '2 2' : undefined} />
  {#if ring.level !== 'empty'}
    <circle
      class={ring.level}
      cx="9" cy="9" r="7" fill="none" stroke-width="3" stroke-linecap="butt"
      pathLength="100" stroke-dasharray="{ring.fill * 100} 100" transform="rotate(-90 9 9)"
    />
  {/if}
</svg>

<style>
  .ring { flex: none; vertical-align: -3px; }
  .low { stroke: var(--down); }
  .some { stroke: var(--warn); }
  .ok { stroke: var(--up); }
</style>
