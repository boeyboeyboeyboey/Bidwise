<svelte:options css="injected" />
<script lang="ts">
  import { onMount } from 'svelte';
  import type { CourseIndexEntry } from '../../lib/data/types';
  import { fetchIndex } from '../../lib/data/client';

  let recent = $state<string[]>([]);
  let index = $state<CourseIndexEntry[]>([]);

  onMount(() => {
    try {
      const raw = localStorage.getItem('boss.recent');
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) recent = parsed.filter((c): c is string => typeof c === 'string');
    } catch {
      recent = [];
    }
    if (recent.length) fetchIndex().then((i) => (index = i), () => {});
  });

  const entries = $derived(
    recent.map((code) => index.find((c) => c.code === code)).filter((c): c is CourseIndexEntry => !!c).slice(0, 5),
  );
</script>

{#if entries.length}
  <section class="recent" aria-labelledby="rec-h">
    <h2 id="rec-h">Recently viewed</h2>
    <ul>
      {#each entries as c (c.code)}
        <li><a class="btn chip" href={`/course/${c.code}`} title={c.title}>{c.code}</a></li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .recent { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s3); }
  h2 { font-size: var(--fs-sm); font-weight: 600; color: var(--muted); }
  ul { display: flex; flex-wrap: wrap; gap: var(--s2); }
</style>
