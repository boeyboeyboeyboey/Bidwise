<script lang="ts">
  import InfoTip from '../ui/InfoTip.svelte';
  import type { Row } from '../../lib/requisites/types';

  /** Rows already rendered at build time by lib/requisites/render. */
  let { rows }: { rows: Row[] } = $props();
</script>

<dl class="req">
  {#each rows as row}
    <div class="row" class:muted={row.muted}>
      <dt>{row.label}{#if row.labelTip}<InfoTip label={row.labelTip.label} lines={row.labelTip.lines} href={row.labelTip.href} linkText={row.labelTip.linkText ?? ''} />{/if}</dt>
      <dd>
        {#each row.parts as p}
          {#if p.k === 'text'}
            <span class:soft={p.muted}>{p.text}</span>
          {:else if p.k === 'code'}
            {#if p.href}<a class="code" href={p.href} title={p.title}>{p.code}</a>{:else}<span class="code" title={p.title}>{p.code}</span>{/if}
          {:else if p.k === 'link'}
            <a class="ext" href={p.href} target="_blank" rel="noopener">{p.text}</a>
          {:else}
            <span class="nw">{#if p.lead}<span>{p.lead}</span>{/if}<InfoTip label={p.label} showLabel={p.showLabel} lines={p.lines} href={p.href} linkText={p.linkText ?? ''} /></span>
          {/if}
        {/each}
      </dd>
    </div>
  {/each}
</dl>

<style>
  .req { margin: 0 0 var(--s3); display: grid; gap: 2px; font-size: 14.5px; line-height: 22px; }
  .row { display: grid; grid-template-columns: 124px minmax(0, 1fr); column-gap: var(--s3); align-items: baseline; }
  dt { margin: 0; font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; }
  dd { margin: 0; }
  .row.muted dd { color: var(--muted); }
  .soft { color: var(--muted); }
  .code { font-weight: 500; }
  a.code { color: var(--accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  a.code:hover { color: var(--accent-hover); }
  a.ext { color: var(--accent); text-underline-offset: 2px; }
  /* InfoTip's 44px tap target is kept, but only 20px of it counts towards the row height. */
  .row :global(.q) { margin: -12px -10px; }
  .row :global(.q.wide) { margin: -12px 0; }
  .row :global(.tip) { margin-left: var(--s1); }
  .nw { white-space: nowrap; }
  @media (max-width: 480px) {
    .row { grid-template-columns: minmax(0, 1fr); }
  }
</style>
