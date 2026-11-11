<svelte:options css="injected" />
<script lang="ts">
  import { takeState } from './takeState.svelte';
</script>

<button type="button" class="btn big" aria-expanded={takeState.open} onclick={() => (takeState.open = !takeState.open)}>
  I don't know what to take
</button>

<style>
  .big { min-height: 52px; width: 100%; text-align: center; }
  .big[aria-expanded='true'] { background: var(--accent-soft); border-color: var(--accent); }
</style>
