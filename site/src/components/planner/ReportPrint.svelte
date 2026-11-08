<script lang="ts">
  import '../../styles/report-print.css';
  import { APPROX_NOTE } from '../../lib/data/seats';
  import { chanceTint } from './plan';
  import { CHANCE_HEAD, REPORT_CREDIT, REPORT_DISCLAIMER, reportCells, reportColumns, type ReportMeta, type ReportRow } from '../../lib/report/csv';

  let { rows, meta }: { rows: ReportRow[]; meta: ReportMeta } = $props();
  const heads = $derived(reportColumns(meta.plan));
  const approx = $derived(rows.some((r) => r.seatsBasis === 'approx'));

  // Directly under <body>, so the print stylesheet can hide the rest of the page.
  function toBody(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<section class="report-print" use:toBody aria-hidden="true">
  <h1>{meta.title}</h1>
  <p class="rp-meta">Generated {meta.generatedAt}</p>
  <table>
    <thead><tr>{#each heads as h (h)}<th scope="col">{h}</th>{/each}</tr></thead>
    <tbody>
      {#each rows as r (r.classNumber + r.section + r.course)}
        <tr>{#each reportCells(r, meta.plan) as c, i (i)}<td class:chance={heads[i] === CHANCE_HEAD && r.planP != null} style={heads[i] === CHANCE_HEAD && r.planP != null ? `background: ${chanceTint(r.planP)}` : undefined}>{c ?? ''}</td>{/each}</tr>
      {/each}
    </tbody>
  </table>
  {#if meta.totals?.length}
    <dl>{#each meta.totals as t (t.label)}<div><dt>{t.label}</dt><dd>{t.value}</dd></div>{/each}</dl>
  {/if}
  <p class="rp-foot">Bids are e$ per person.{#if approx} ≈ {APPROX_NOTE}.{/if}</p>
  {#each meta.notes ?? [] as n (n)}<p class="rp-foot">{n}</p>{/each}
  <p class="rp-foot">{REPORT_CREDIT}</p>
  <p class="rp-foot">{REPORT_DISCLAIMER}</p>
</section>
