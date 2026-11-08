<script lang="ts">
  import type { SearchEntry } from '../lib/data/types';

  let { index }: { index: SearchEntry[] } = $props();
  const LIMIT = 12;
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

  let query = $state('');
  // Ranked: exact code, code prefix, word-start in title, then any substring. Offered-now courses come before all
  // not-offered ones (those sit in a collapsed group at the end); within a tier, code order (the index is pre-sorted).
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const qf = flat(q);
    if (!qf) return [];
    const words = q.split(/\s+/);
    const hits: { e: SearchEntry; rank: number }[] = [];
    for (const e of index) {
      const full = flat(e[0]);
      const bare = flat(e[0].slice(e[0].indexOf('-') + 1));
      const title = e[1].toLowerCase();
      let tier = -1;
      if (full === qf || bare === qf) tier = 0;
      else if (full.startsWith(qf) || bare.startsWith(qf)) tier = 1;
      else if (words.every((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, '')}`).test(title) && flat(w))) tier = 2;
      else if (full.includes(qf) || words.every((w) => title.includes(w))) tier = 3;
      if (tier < 0) continue;
      hits.push({ e, rank: tier });
    }
    return hits.sort((a, b) => a.rank - b.rank).map((h) => h.e);
  });
  const offered = $derived(matches.filter((e) => e[2] > 0));
  const notOffered = $derived(matches.filter((e) => e[2] <= 0));
  let showAll = $state(false);
  let showNot = $state(false);
  $effect(() => { query; showAll = false; showNot = false; });
  const shown = $derived(showAll ? offered : offered.slice(0, LIMIT));
  const results = $derived(showNot ? [...shown, ...notOffered] : shown);
  const searching = $derived(query.trim().length > 0);

  // The highlighted result is the default: it starts on the first one, arrow keys move it, Enter opens it.
  // Typing resets it. If the text is exactly a course code and the arrows were not used, that course opens.
  let active = $state(0);
  let moved = false;
  $effect(() => { query; active = 0; moved = false; });
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      moved = true;
      active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      document.getElementById(`q-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const qf = flat(query);
      if (!qf) return;
      const exact = moved ? undefined : index.find((e) => flat(e[0]) === qf || flat(e[0].slice(e[0].indexOf('-') + 1)) === qf);
      const target = exact ?? results[active];
      if (target) location.href = `/course/${target[0]}`;
    }
  }
</script>

<div class="search">
  <label class="find" for="q">Search for a course by code or title</label>
  <div class="box">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" fill="currentColor" fill-rule="evenodd" /></svg>
    <input
      id="q"
      class="field"
      type="search"
      placeholder="Course code or title"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="search"
      bind:value={query}
      role="combobox"
      aria-expanded={searching && results.length > 0}
      aria-controls="q-list"
      aria-autocomplete="list"
      aria-activedescendant={searching && results.length ? `q-opt-${active}` : undefined}
      onkeydown={onKey}
    />
  </div>

  {#if searching}
    {#if matches.length}
      {#if results.length}
      <ul class="list" id="q-list" role="listbox" aria-label="Matching courses">
        {#each results as [code, title, n], i (code)}
          <li id={`q-opt-${i}`} role="option" aria-selected={i === active} class:active={i === active}>
            <a class="row-link" href={`/course/${code}`} tabindex="-1">
              <span class="code">{code}</span>
              <span class="title">{title}</span>
              <span class="count">{n > 0 ? `${n} ${n === 1 ? 'section' : 'sections'}` : 'Not offered this term'}</span>
              <span class="open">Open <span aria-hidden="true">›</span></span>
            </a>
          </li>
        {/each}
      </ul>
      {/if}
      <div class="foot">
        {#if !showAll && offered.length > LIMIT}
          <button type="button" class="btn" onclick={() => (showAll = true)}>Show all {offered.length}</button>
        {/if}
        {#if notOffered.length}
          <button type="button" class="btn" aria-expanded={showNot} onclick={() => (showNot = !showNot)}>
            Not offered this term ({notOffered.length})
          </button>
        {/if}
      </div>
    {:else}
      <p class="empty" aria-live="polite">No courses found</p>
    {/if}
  {/if}
</div>

<style>
  .find { display: block; margin: 0 0 var(--s2); font-size: var(--fs-sm); line-height: 1.3; font-weight: 600; }
  .box { position: relative; color: var(--muted); }
  .box svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; }
  input { min-height: 56px; padding-left: 48px; font-size: 20px; }
  .box svg { left: 16px; width: 24px; height: 24px; }
  input::-webkit-search-cancel-button { -webkit-appearance: none; }
  .list { margin-top: var(--s3); }
  li.active a { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
  a { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: baseline; gap: var(--s3); min-height: 44px; }
  .open { color: var(--accent); font-weight: 600; white-space: nowrap; }
  .code { font-weight: 600; }
  .title { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .count { font-size: 13px; color: var(--muted); white-space: nowrap; }
  .foot { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); }
  .empty { color: var(--muted); margin-top: var(--s4); }
</style>
