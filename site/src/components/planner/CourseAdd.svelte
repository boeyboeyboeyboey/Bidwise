<script lang="ts">
  import { onMount } from 'svelte';
  import type { CourseIndexEntry } from '../../lib/data/types';
  import { fetchIndex } from '../../lib/data/client';

  let { onadd, inPlan = [], label = 'Add course', placeholder = 'Add course', dropUp = false }: {
    /** byKey: picked with Enter, so the caller keeps the cursor in the box. */
    onadd: (code: string, byKey?: boolean) => void; inPlan?: string[]; label?: string; placeholder?: string;
    /** Open the list above the box (when the box sits at the bottom of a scrolling column). */
    dropUp?: boolean;
  } = $props();
  let index = $state<CourseIndexEntry[]>([]);
  let failed = $state(false);
  let q = $state('');
  onMount(() => {
    fetchIndex().then((i) => (index = i.filter((c) => c.offeredNow && c.sectionCount > 0)), () => (failed = true));
  });
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const results = $derived.by(() => {
    const s = q.trim().toLowerCase();
    const f = norm(s);
    if (!f) return [];
    return index
      .filter((c) => norm(c.code).includes(f) || c.title.toLowerCase().includes(s))
      .sort((a, b) => Number(norm(b.code).startsWith(f)) - Number(norm(a.code).startsWith(f)))
      .slice(0, 6);
  });
  const free = $derived(results.filter((c) => !inPlan.includes(c.code)));
  function pick(code: string, byKey = false) {
    onadd(code, byKey);
    q = '';
  }
</script>

<div class="add">
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" /></svg>
  <input
    class="field"
    type="search"
    aria-label={label}
    placeholder={failed ? 'Course list failed to load' : placeholder}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    bind:value={q}
    onkeydown={(e) => e.key === 'Enter' && free[0] && pick(free[0].code, true)}
  />
  {#if results.length}
    <ul class="list" class:up={dropUp}>
      {#each results as c (c.code)}
        {@const has = inPlan.includes(c.code)}
        <li><button type="button" disabled={has} onclick={() => pick(c.code)}><b>{c.code}</b> <span>{c.title}</span><i class="num">{has ? 'In plan' : `${c.sectionCount} ${c.sectionCount === 1 ? 'section' : 'sections'}`}</i></button></li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .add { position: relative; color: var(--muted); }
  .add > svg { position: absolute; left: 14px; top: 14px; pointer-events: none; }
  input { padding-left: 42px; }
  .list { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); overflow: hidden; }
  .list.up { top: auto; bottom: calc(100% + 4px); }
  .list li + li { border-top: 1px solid var(--rule); }
  .list button { display: flex; gap: var(--s2); width: 100%; min-height: 48px; align-items: center; padding: 0 var(--s3); background: none; border: 0; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  .list button:disabled { cursor: default; color: var(--muted); }
  .list button:disabled b { color: var(--muted); }
  .list button:not(:disabled):hover, .list button:focus-visible { background: var(--accent-soft); }
  .list b { font-weight: 600; }
  .list i { margin-left: auto; flex: none; font-style: normal; font-size: 13px; color: var(--muted); }
  .list span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
</style>
