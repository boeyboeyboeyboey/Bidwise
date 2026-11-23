<script lang="ts">
  import type { SearchEntry } from '../lib/data/types';
  import { flatText, isExactCode, searchCourses } from '../lib/search/courseSearch';
  import { bossCodeOf } from '../lib/data/bossCode';
  import { findProfs, type ProfEntry } from '../lib/search/profSearch';

  /**
   * `suffix` is appended to every course link (e.g. '?mode=swap' to open course pages in Swap mode).
   * `profs` adds a Professors group (links to /prof/<slug>/); none when omitted.
   */
  let {
    index,
    suffix = '',
    profs = [],
    profTerm = '',
    label = 'Search for a course by code, title or nickname',
    placeholder = 'Code, title or nickname',
  }: {
    index: SearchEntry[];
    suffix?: string;
    profs?: ProfEntry[];
    /** Short name of the term the professor rows refer to, e.g. "Term 2". */
    profTerm?: string;
    label?: string;
    placeholder?: string;
  } = $props();
  const LIMIT = 12;
  const PROF_LIMIT = 5;

  let query = $state('');
  // Ranked by courseRank (code, nickname, title). Offered-now courses come before all not-offered ones (those sit in a
  // collapsed group at the end); within a tier, code order (the index is pre-sorted).
  // When nothing matches exactly, `found.close` marks typo matches.
  const found = $derived(searchCourses(index, query, (e) => [e[0], e[1]]));
  const profFound = $derived(findProfs(profs, query));
  // Close (typo) matches of either kind show only when neither kind matches exactly, so an exact hit is never
  // pushed below or mixed with typo guesses. `allClose` is then true and one "No exact match" line covers both groups.
  const anyExact = $derived((found.items.length > 0 && !found.close) || (profFound.items.length > 0 && !profFound.close));
  const matches = $derived(found.close && anyExact ? [] : found.items);
  const profHits = $derived(profFound.close && anyExact ? [] : profFound.items);
  const allClose = $derived(!anyExact && (matches.length > 0 || profHits.length > 0));
  const offered = $derived(matches.filter((e) => e[2] > 0));
  const notOffered = $derived(matches.filter((e) => e[2] <= 0));
  let showAll = $state(false);
  let showNot = $state(false);
  let showAllProfs = $state(false);
  $effect(() => { query; showAll = false; showNot = false; showAllProfs = false; });
  const shown = $derived(showAll ? offered : offered.slice(0, LIMIT));
  const results = $derived(showNot ? [...shown, ...notOffered] : shown);
  const profShown = $derived(showAllProfs ? profHits : profHits.slice(0, PROF_LIMIT));
  const searching = $derived(query.trim().length > 0);
  // Arrow keys run through the course rows, then the professor rows. Professor rows take the ids after the courses.
  const total = $derived(results.length + profShown.length);

  // The highlighted result is the default: it starts on the first one, arrow keys move it, Enter opens it.
  // Typing resets it. If the text is exactly a course code and the arrows were not used, that course opens.
  // Enter on a professor row opens that professor's page.
  let active = $state(0);
  let moved = false;
  $effect(() => { query; active = 0; moved = false; });
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!total) return;
      e.preventDefault();
      moved = true;
      active = (active + (e.key === 'ArrowDown' ? 1 : total - 1)) % total;
      document.getElementById(`q-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (!flatText(query)) return;
      const exact = moved ? undefined : index.find((e) => isExactCode(e[0], query));
      if (exact) {
        location.href = `/course/${exact[0]}${suffix}`;
      } else if (active < results.length) {
        const target = results[active];
        if (target) location.href = `/course/${target[0]}${suffix}`;
      } else {
        const prof = profShown[active - results.length];
        if (prof) location.href = `/prof/${prof[1]}/`;
      }
    }
  }
</script>

<div class="search">
  <label class="find" for="q">{label}</label>
  <div class="box">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" fill="currentColor" fill-rule="evenodd" /></svg>
    <input
      id="q"
      class="field"
      type="search"
      {placeholder}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="search"
      bind:value={query}
      role="combobox"
      aria-expanded={searching && total > 0}
      aria-controls={profHits.length ? 'q-list q-prof-list' : 'q-list'}
      aria-autocomplete="list"
      aria-activedescendant={searching && total ? `q-opt-${active}` : undefined}
      onkeydown={onKey}
    />
  </div>

  {#if searching}
    {#if allClose}<p class="close" aria-live="polite">No exact match. Close matches:</p>{/if}
    {#if matches.length}
      {#if results.length}
      {#if profHits.length}<h2 class="group">Courses</h2>{/if}
      <ul class="list" id="q-list" role="listbox" aria-label="Matching courses">
        {#each results as [code, title, n, boss], i (code)}
          <li id={`q-opt-${i}`} role="option" aria-selected={i === active} class:active={i === active}>
            <a class="row-link" href={`/course/${code}${suffix}`} tabindex="-1">
              <span class="code">{bossCodeOf(code, boss)}</span>
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
    {/if}
    {#if profHits.length}
      <h2 class="group">Professors</h2>
      <ul class="list" id="q-prof-list" role="listbox" aria-label="Matching professors">
        {#each profShown as [name, slug, n, now], j (slug)}
          <li id={`q-opt-${results.length + j}`} role="option" aria-selected={results.length + j === active} class:active={results.length + j === active} class="prof-row">
            <a class="row-link" href={`/prof/${slug}/`} tabindex="-1">
              <span class="code">{name}</span>
              <span class="count">{n} {n === 1 ? 'course' : 'courses'}{now ? ` · in ${profTerm || 'the bidding term'}` : ''}</span>
              <span class="open">Open <span aria-hidden="true">›</span></span>
            </a>
          </li>
        {/each}
      </ul>
      {#if !showAllProfs && profHits.length > PROF_LIMIT}
        <div class="foot">
          <button type="button" class="btn" onclick={() => (showAllProfs = true)}>Show all {profHits.length} professors</button>
        </div>
      {/if}
    {/if}
    {#if !matches.length && !profHits.length}
      <p class="empty" aria-live="polite">{profs.length ? 'No courses or professors found' : 'No courses found'}</p>
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
  .close { margin-top: var(--s3); font-size: var(--fs-sm); color: var(--muted); }
  li.active a { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
  a { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: baseline; gap: var(--s3); min-height: 44px; }
  .open { color: var(--accent); font-weight: 600; white-space: nowrap; }
  .code { font-weight: 600; }
  .title { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .count { font-size: 13px; color: var(--muted); white-space: nowrap; }
  .foot { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); }
  .empty { color: var(--muted); margin-top: var(--s4); }
  .group { margin: var(--s4) 0 0; font-size: var(--fs-sm); font-weight: 600; color: var(--muted); }
  .group + .list { margin-top: var(--s2); }
  li.prof-row a { grid-template-columns: minmax(0, 1fr) auto auto; }
</style>
