<svelte:options css="injected" />
<script lang="ts">
  import type { ForecastWindowMeta } from '../../lib/data/types';
  import { eS, pct } from '../course/fmt';

  let { byWindow, highlight = null }: { byWindow: Record<string, ForecastWindowMeta>; highlight?: string | null } = $props();

  const rows = $derived(
    Object.entries(byWindow)
      .filter(([, m]) => m.maeCents !== null && m.baselineMaeCents !== null && m.coverage80Filled !== null)
      .map(([label, m]) => ({ label, mae: m.maeCents!, base: m.baselineMaeCents!, cov: m.coverage80Filled!, low: m.filled < 50, n: m.filled })),
  );
  // One scale for every window, so the early rounds' bigger misses look bigger. Bars stop at 72% to leave room for the figure.
  const maxMiss = $derived(Math.max(1, ...rows.map((r) => Math.max(r.mae, r.base))));
  const wp = (c: number) => Math.max((c / maxMiss) * 72, 0.6);
  const w = (c: number) => `${wp(c)}%`;
  const lx = (c: number) => `${wp(c) + 1.5}%`;
  // Coverage 0..100% maps to 0..80% of the width, so the 80% target line sits at 64%; labels are right-aligned in the free 20%.
  const cx = (c: number) => `${c * 80}%`;
  const better = $derived(rows.filter((r) => r.mae < r.base).length);
  const summary = $derived(
    `Average miss across all sections in each bidding window, our forecast against reusing last term's bid. Ours is smaller in ${better} of ${rows.length} windows. ` +
      rows.map((r) => `${r.label}: ours ${eS(r.mae)}, last term's ${eS(r.base)}, real bid inside our range on filled sections ${pct(r.cov)}${r.low ? ' (few filled sections tested)' : ''}`).join('; ') +
      '.',
  );
</script>

{#if rows.length > 0}
  <div class="charts">
    <figure>
      <figcaption>
        <b>Average miss across all sections in the window</b> (smaller is better; most sections don't fill, so later windows look small)
        <span class="key"><i class="sw ours"></i>Our forecast <i class="sw base"></i>Last term's bid</span>
      </figcaption>
      <ul role="img" aria-label={summary}>
        {#each rows as r (r.label)}
          <li class:hl={r.label === highlight}>
            <span class="lab">{r.label}</span>
            <svg height="38" aria-hidden="true">
              <rect x="0" y="2" width={w(r.mae)} height="15" rx="2" class="ours" />
              <text x={lx(r.mae)} y="14.5" class="v">{eS(r.mae)}</text>
              <rect x="0" y="20" width={w(r.base)} height="15" rx="2" class="base" />
              <text x={lx(r.base)} y="32.5" class="v">{eS(r.base)}</text>
            </svg>
          </li>
        {/each}
      </ul>
    </figure>
    <figure>
      <figcaption>
        <b>Real bid inside our range, sections that filled</b> (target 80%)
        <span class="key"><i class="dotk"></i>Filled sections <i class="dotk open"></i>Under 50 filled sections tested <i class="tk"></i>80% target</span>
      </figcaption>
      <ul aria-hidden="true">
        {#each rows as r (r.label)}
          <li class:hl={r.label === highlight}>
            <span class="lab">{r.label}</span>
            <svg height="30">
              <line x1="0" x2="80%" y1="15" y2="15" class="axis" />
              <line x1="64%" x2="64%" y1="2" y2="28" class="target" />
              <circle cx={cx(r.cov)} cy="15" r="6" class="dot" class:open={r.low} />
              <text x="100%" y="19.5" class="v" text-anchor="end">{pct(r.cov)}</text>
            </svg>
          </li>
        {/each}
      </ul>
    </figure>
  </div>
{/if}

<style>
  .charts { display: grid; gap: var(--s5) var(--s6); margin-top: var(--s3); }
  figure { margin: 0; min-width: 0; }
  figcaption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--s4); font-size: 15px; margin-bottom: var(--s2); }
  figcaption b { font-weight: 600; }
  .key { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px var(--s2); font-size: 13px; color: var(--muted); }
  .sw { display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-left: var(--s2); }
  .sw:first-child { margin-left: 0; }
  .sw.ours, .ours { background: var(--accent); fill: var(--accent); }
  .sw.base, .base { background: var(--muted); fill: var(--muted); }
  .dotk { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); border: 2px solid var(--accent); box-sizing: border-box; margin-left: var(--s2); }
  .dotk:first-child { margin-left: 0; }
  .tk { display: inline-block; width: 0; height: 12px; border-left: 2px dashed var(--muted); margin-left: var(--s2); }
  .dotk.open { background: var(--surface); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: 1fr; padding: var(--s1) var(--s2); border-bottom: 1px solid var(--rule); }
  li.hl { background: var(--accent-soft); border-radius: var(--r-sm); }
  .lab { font-size: 14px; color: var(--text); }
  li.hl .lab { font-weight: 600; }
  svg { display: block; width: 100%; overflow: visible; color: var(--text); }
  .v { font-size: 13px; fill: currentColor; }
  .axis { stroke: var(--rule-strong); stroke-width: 1; }
  .target { stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 3 3; }
  .dot { fill: var(--accent); stroke: var(--accent); stroke-width: 2; }
  .dot.open { fill: var(--surface); }
  @media (min-width: 560px) {
    li { grid-template-columns: 150px minmax(0, 1fr); align-items: center; column-gap: var(--s3); }
    .lab { font-size: 15px; white-space: nowrap; }
  }
  @media (min-width: 1100px) { .charts { grid-template-columns: 3fr 2fr; } }
</style>
