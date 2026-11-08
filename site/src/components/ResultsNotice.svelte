<script lang="ts">
  import type { ResultsPartial } from '../lib/data/types';
  import { partialNotice } from '../lib/data/partial';

  let { partial = null }: { partial?: ResultsPartial | null } = $props();
</script>

{#if partial}
  <p class="rn" role="status">{partialNotice(partial)}</p>
{/if}

<style>
  .rn {
    margin: 0 0 var(--s4); padding: var(--s2) var(--s3); font-size: 14px; color: var(--text);
    background: var(--accent-soft); border-left: 3px solid var(--accent); border-radius: var(--r-sm);
  }
</style>
