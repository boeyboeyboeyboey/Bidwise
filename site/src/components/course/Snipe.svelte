<svelte:options css="injected" />
<script lang="ts">
  import { getContext } from 'svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import type { ForecastCtx } from './forecast-ctx';
  import type { Section } from '../../lib/data/types';
  import type { SimResult } from '../../lib/sim';
  import { runSim } from '../../lib/sim/client';
  import { aboutPct, eS } from './fmt';
  import { dropWindows, parseDollars, snipeChance, snipeMoney, snipeSimInput } from '../../lib/snipe/snipe';

  let { section }: { section: Section } = $props();
  const ctx = getContext<ForecastCtx>('forecast');

  const full = $derived(ctx.bySection?.get(section.classNumber) ?? null);
  const minBid = $derived(full?.minBidCents ?? null);
  const windows = $derived(
    full?.forecast ? dropWindows(ctx.meta.windows, ctx.currentWindow, Object.keys(full.forecast)) : [],
  );

  let open = $state(false);
  let paidText = $state('');
  let rebidText = $state('');
  let picked = $state<string | null>(null);
  const win = $derived(picked && windows.includes(picked) ? picked : (windows[0] ?? ''));

  const paid = $derived(parseDollars(paidText));
  const rebid = $derived(parseDollars(rebidText) ?? minBid);
  const money = $derived(paid !== null && rebid !== null && win ? snipeMoney(paid, rebid, win) : null);

  let res = $state<{ r: SimResult; key: string } | null>(null);
  let token = 0;
  $effect(() => {
    const f = full?.forecast?.[win];
    const m = minBid;
    if (!open || !f || m === null) return;
    const key = `${section.classNumber}|${win}`;
    const my = ++token;
    runSim(snipeSimInput(f, m)).then((r) => {
      if (my === token) res = { r, key };
    });
  });
  const chance = $derived(
    res && rebid !== null && minBid !== null && res.key === `${section.classNumber}|${win}` ? snipeChance(res.r, rebid, minBid) : null,
  );
  const below = $derived(rebid !== null && minBid !== null && rebid < minBid);

  const tip = [
    'Dropping gives back what you paid, up to a cap by round: e$50 in Rounds 1 and 1A, e$40 in 1B, e$30 in 2, e$10 in 2A.',
    'The chance is that a bid of your re-bid wins one freed seat in the chosen window, from the same simulation as the bids on this page. Others can take the seat first.',
  ];
</script>

{#if windows.length && minBid !== null}
  <details class="snipe" bind:open>
    <summary>Drop and re-bid?</summary>
    <div class="body">
      <p class="risk" role="note">Risky: if someone else bids, you lose the class.</p>
      <div class="ins">
        <label>
          <span>You paid (e$)</span>
          <input class="field num" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 80" bind:value={paidText} />
        </label>
        <label>
          <span>Drop in</span>
          <select class="field" value={win} onchange={(e) => (picked = e.currentTarget.value)}>
            {#each windows as w (w)}<option value={w}>{w}</option>{/each}
          </select>
        </label>
        <label>
          <span>Re-bid (e$)</span>
          <input class="field num" type="text" inputmode="decimal" autocomplete="off" placeholder={(minBid / 100).toFixed(2)} bind:value={rebidText} />
        </label>
      </div>
      {#if below}<p class="sub">Minimum bid is {eS(minBid)}; counted as that.</p>{/if}
      {#if money && chance !== null}
        {@const save = money.savingCents}
        <p class="line">
          <b>Works {aboutPct(chance)} of the time</b>
          · {save > 0 ? `saves ${eS(save)} if it does` : 'saves nothing: re-bid is not below the refund'}
          · if it fails you lose the class
        </p>
        <p class="sub num">Refund {eS(money.refundCents)} · cost if it works {eS(money.netCents)} instead of {eS(paid ?? 0)}</p>
        <p class="sub num">If it fails you lose this class and get {eS(money.refundCents)} back.</p>
      {:else if money}
        <p class="sub" aria-busy="true">Working it out…</p>
      {:else}
        <p class="sub">Enter what you paid for this class.</p>
      {/if}
      <p class="sub"><InfoTip label="About drop and re-bid" lines={tip} anchor="snipe" linkText="How drop and re-bid works" /></p>
    </div>
  </details>
{/if}

<style>
  .snipe { background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-lg); min-width: 0; }
  summary { cursor: pointer; padding: 0 var(--s4); min-height: 44px; display: flex; align-items: center; font-weight: 600; font-size: var(--fs-sm); }
  summary:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .body { display: grid; gap: var(--s3); padding: 0 var(--s4) var(--s4); min-width: 0; }
  .risk { margin: 0; font-size: var(--fs-sm); font-weight: 600; color: var(--danger); }
  .ins { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s3); }
  label { display: grid; gap: var(--s1); min-width: 0; font-size: var(--fs-xs); color: var(--muted); }
  label .field { width: 100%; min-width: 0; }
  .line { margin: 0; font-size: var(--fs-md); overflow-wrap: anywhere; }
  .sub { margin: 0; font-size: var(--fs-sm); color: var(--muted); overflow-wrap: anywhere; }
</style>
