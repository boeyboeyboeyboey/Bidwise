<svelte:options css="injected" />
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fmtBid, fmtSeats, fullWindow, pastSections, seatsTaken, type BrowseRow } from '../explore/browse';
  import { fetchCourseTerms, fetchManifest, fetchTerm } from '../explore/browseClient';
  import { shortTerm, termChoices } from '../explore/courses';
  import { parseTermParams, pickTerm, withTermParams } from './termSections';

  let { code }: { code: string } = $props();

  // Terms with data for this course, newest first. Null until loaded; empty hides the block.
  let terms = $state.raw<string[] | null>(null);
  let term = $state('');
  let sec = $state('');
  let ready = false;
  let root: HTMLElement | undefined = $state();

  onMount(() => {
    const want = parseTermParams(location.search);
    fetchCourseTerms().then((t) => {
      const list = termChoices('', false, (t.by[code] ?? []).map((i) => t.terms[i])).map((c) => c.term);
      terms = list;
      term = pickTerm(list, want.term);
      // A section only applies to the term it was named with.
      sec = term === want.term ? want.sec : '';
      ready = true;
      if (want.term && list.length) settleScroll();
    }, () => (terms = []));
  });

  // A link that names a term lands on the block (on the named section when there is one). The chart and table above load
  // after this, pushing the block down, so the scroll is repeated while the page settles, until the visitor scrolls.
  function settleScroll() {
    let stop = false;
    const quit = () => (stop = true);
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) addEventListener(ev, quit, { once: true, passive: true });
    const go = () => {
      if (stop) return;
      const el = (sec && document.getElementById(`d-${sec}`)?.closest('li')) || root;
      el?.scrollIntoView({ block: 'start' });
    };
    tick().then(go);
    for (const ms of [300, 800, 1600]) setTimeout(go, ms);
  }

  // The address follows the choice (replaced, not added, so Back leaves the page). Only after the user has chosen or a link named a term.
  let touched = false;
  $effect(() => {
    const t = term, s = sec;
    if (!ready || !t) return;
    if (!touched && !location.search.includes('term=')) return;
    try {
      const qs = withTermParams(location.search, t, s);
      if (qs !== location.search) history.replaceState(history.state, '', location.pathname + qs + location.hash);
    } catch { /* ignore */ }
  });

  let rows = $state.raw<BrowseRow[] | null>(null);
  let failed = $state(false);
  let token = 0;
  function load(t: string) {
    const mine = ++token;
    rows = null;
    failed = false;
    fetchManifest().then((m) => fetchTerm(m, t)).then(
      (r) => { if (mine === token) rows = r; },
      () => { if (mine === token) failed = true; },
    );
  }
  $effect(() => {
    if (term) load(term);
  });

  const list = $derived(rows ? pastSections(rows, code) : []);
  const pick = (t: string) => { touched = true; term = t; sec = ''; };
  const toggle = (s: string) => { touched = true; sec = sec === s ? '' : s; };
</script>

{#if terms && terms.length}
  <section class="bt" id="by-term" bind:this={root} aria-labelledby="bt-h">
    <h2 id="bt-h">By term</h2>
    <div class="terms" role="group" aria-label="Term">
      {#each terms as t (t)}
        <button type="button" class="tog" aria-pressed={t === term} aria-label={t} onclick={() => pick(t)}>{shortTerm(t)}</button>
      {/each}
    </div>
    {#if failed}
      <p class="meta">Could not load this term. <button type="button" class="link" onclick={() => load(term)}>Try again</button></p>
    {:else if !rows}
      <p class="meta" role="status">Loading…</p>
    {:else if list.length}
      <ul class="secs">
        {#each list as s (s.section)}
          {@const on = sec === s.section}
          <li>
            <button type="button" class="sec" aria-expanded={on} aria-controls={`d-${s.section}`} onclick={() => toggle(s.section)}>
              <span class="s1"><b>{s.section}</b><span class="slot">{s.slot || 'Time not set'}</span></span>
              <span class="s2">{s.instructor || 'Instructor not listed'}</span>
            </button>
            {#if on}
              <div class="detail" id={`d-${s.section}`}>
                <table class="wt">
                  <thead><tr><th scope="col">Window</th><th scope="col" class="n">Offered</th><th scope="col" class="n">Taken</th><th scope="col" class="n">Lowest</th><th scope="col" class="n">Median</th></tr></thead>
                  <tbody>
                    {#each s.windows as w (w.window)}
                      <tr>
                        <th scope="row">{fullWindow(w.window)}</th>
                        <td class="n" data-label="Offered">{fmtSeats(w.before)}</td>
                        <td class="n" data-label="Taken">{fmtSeats(seatsTaken(w))}</td>
                        <td class="n" data-label="Lowest">{fmtBid(w.minCents)}</td>
                        <td class="n" data-label="Median">{fmtBid(w.medianCents)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="meta">No sections in this term.</p>
    {/if}
  </section>
{/if}

<style>
  .bt { display: grid; gap: var(--s3); min-width: 0; margin-top: var(--s5); scroll-margin-top: 76px; }
  /* Clear the sticky top bar (61px) when a link scrolls here. */
  .secs li { scroll-margin-top: 76px; }
  h2 { font-size: 17px; font-weight: 600; }
  .meta { margin: 0; font-size: var(--fs-sm); color: var(--muted); }
  .link { font: inherit; color: var(--accent); background: none; border: 0; padding: 0 var(--s2); min-height: 44px; text-decoration: underline; cursor: pointer; }
  .terms { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .tog {
    min-height: 44px; padding: 0 var(--s2); font: inherit; font-size: var(--fs-sm); color: var(--text); cursor: pointer;
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); white-space: nowrap;
  }
  .tog[aria-pressed='true'] { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .secs { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--rule); }
  .secs li { border-bottom: 1px solid var(--rule); }
  .sec {
    width: 100%; min-height: 52px; padding: var(--s3) 36px var(--s3) var(--s2); text-align: left; font: inherit; color: inherit; cursor: pointer;
    background: none; border: 0; position: relative; display: grid; grid-template-columns: minmax(0, 1fr); row-gap: 2px; align-items: baseline;
  }
  .sec::after {
    content: ''; position: absolute; right: var(--s2); top: 50%; width: 16px; height: 16px; transform: translateY(-50%);
    background: var(--chev-down) center / 16px no-repeat;
  }
  .sec[aria-expanded='true']::after { transform: translateY(-50%) rotate(180deg); }
  .sec > * { min-width: 0; overflow-wrap: anywhere; }
  .s1 .slot { margin-left: var(--s3); }
  .s2 { font-size: var(--fs-sm); color: var(--muted); }
  .detail { display: grid; gap: var(--s3); padding: var(--s3); margin-bottom: var(--s3); background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-lg); }
  .wt { width: 100%; border-collapse: collapse; font-size: var(--fs-xs); table-layout: fixed; }
  .wt th, .wt td { padding: var(--s2) var(--s1); text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); overflow-wrap: anywhere; }
  .wt thead th { color: var(--muted); font-weight: 600; }
  .wt tbody th { font-weight: 400; }
  .wt .n { text-align: right; font-variant-numeric: tabular-nums; width: 15%; }
  .wt tbody tr:last-child > * { border-bottom: 0; }

  /* Under 640px each window is a short card: its name, then labelled numbers that wrap. */
  @media (max-width: 639px) {
    .wt, .wt tbody { display: block; }
    .wt thead { display: none; }
    .wt tr { display: flex; flex-wrap: wrap; gap: 0 var(--s3); padding: var(--s2) 0; border-bottom: 1px solid var(--rule); }
    .wt tbody tr:last-child { border-bottom: 0; }
    .wt th, .wt td { padding: 0; border: 0; }
    .wt tbody th { flex: 1 1 100%; font-weight: 600; }
    .wt td.n { width: auto; text-align: left; }
    .wt td.n::before { content: attr(data-label) ' '; color: var(--muted); }
  }
  @media (min-width: 768px) {
    .wt { font-size: var(--fs-sm); }
    .wt .n { width: 100px; }
  }
  @media (min-width: 1024px) {
    .sec { grid-template-columns: 90px 260px minmax(0, 1fr); column-gap: var(--s4); align-items: center; }
    .s1 { display: contents; }
    .s1 b { grid-column: 1; }
    .s1 .slot { grid-column: 2; margin: 0; }
    .s2 { grid-column: 3; }
  }
</style>
