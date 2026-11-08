<script lang="ts">
  import { tick } from 'svelte';

  /**
   * Tap-friendly "How is this calculated?" popover: a button that opens a short note and a link into
   * /method. Opens on click or tap (never on hover), closes on Esc, a click outside, or the link.
   */
  let { anchor = 'replay', label = 'How is this calculated?', showLabel = false, lines = DEFAULT_LINES, linkText = 'How the forecast works' }: {
    /** id of the section on /method to link to. */
    anchor?: string;
    label?: string;
    /** Show the label beside the "?" instead of the icon alone. */
    showLabel?: boolean;
    lines?: string[];
    /** Text of the link into /method. */
    linkText?: string;
  } = $props();

  const uid = $props.id();
  let open = $state(false);
  let root: HTMLSpanElement | undefined;
  let btn: HTMLButtonElement | undefined;
  let shift = $state(0);
  /** Opens above the button when it would run under a fixed bottom bar (phone tab bar, planner summary bar). */
  let up = $state(false);

  // Keeps the popover inside the screen: shifts it sideways by however much it would overhang.
  async function place() {
    shift = 0;
    up = false;
    await tick();
    const pop = root?.querySelector<HTMLElement>('.pop');
    if (!pop) return;
    const r = pop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (r.right > vw - 8) shift = vw - 8 - r.right;
    if (r.left + shift < 8) shift = 8 - r.left;
    let floor = window.innerHeight;
    for (const el of document.querySelectorAll<HTMLElement>('.tabbar, .bar')) {
      const cs = getComputedStyle(el);
      if (cs.display !== 'none' && cs.position === 'fixed') floor = Math.min(floor, el.getBoundingClientRect().top);
    }
    const bt = btn?.getBoundingClientRect();
    if (r.bottom > floor - 4 && bt && bt.top - r.height - 4 > 0) up = true;
  }
  function toggle() {
    open = !open;
    if (open) place();
  }
  function onResize() {
    if (open) place();
  }
  function close(refocus: boolean) {
    open = false;
    if (refocus) btn?.focus();
  }
  function onKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') close(true);
  }
  function onOutside(e: Event) {
    if (open && root && !root.contains(e.target as Node)) close(false);
  }
</script>

<script lang="ts" module>
  const DEFAULT_LINES = [
    'We replay this window thousands of times with random bidders, using what people bid on this course and instructor (where available) in past terms.',
    'The bid shown is the lowest one that reaches the chance you picked. It is an estimate, not a guarantee.',
  ];
</script>

<svelte:window onkeydown={onKey} onpointerdown={onOutside} onresize={onResize} />

<span class="tip" bind:this={root}>
  <button type="button" class="q" class:wide={showLabel} aria-expanded={open} aria-controls="tip-{uid}" aria-label={showLabel ? undefined : label} onclick={toggle} bind:this={btn}>
    <span class="mark" aria-hidden="true">?</span>{#if showLabel}<span class="txt">{label}</span>{/if}
  </button>
  {#if open}
    <div class="pop" class:up id="tip-{uid}" role="region" aria-label={label} style:left="{shift}px">
      {#each lines as l}<p>{l}</p>{/each}
      <a href="/method#{anchor}" onclick={() => close(false)}>{linkText}</a>
    </div>
  {/if}
</span>

<style>
  .tip { position: relative; display: inline-flex; vertical-align: middle; }
  /* The 24px circle sits in a 44px tap target; negative margins keep the layout at 24px. */
  .q {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--s2);
    min-width: 44px; min-height: 44px; margin: -10px; padding: 0;
    font: inherit; color: var(--accent); background: none; border: 0; cursor: pointer;
  }
  .q.wide { margin: 0; padding: 0 var(--s1); }
  .mark {
    flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%;
    font-size: 14px; font-weight: 700; line-height: 1; color: var(--accent); background: var(--surface); border: 1.5px solid var(--accent);
  }
  .q[aria-expanded='true'] .mark { color: var(--accent-ink); background: var(--accent); }
  .q:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; border-radius: var(--r-md); }
  .txt { font-size: 15px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
  .pop {
    position: absolute; z-index: 30; top: calc(100% + 2px); left: 0; width: 300px; max-width: calc(100vw - 16px);
    padding: var(--s3) var(--s4); display: grid; gap: var(--s2);
    font-size: 15px; font-weight: 400; line-height: 1.45; text-align: left; white-space: normal; color: var(--text);
    background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  }
  .pop.up { top: auto; bottom: calc(100% + 2px); }
  .pop p { margin: 0; }
  .pop a { display: inline-flex; align-items: center; min-height: 44px; font-weight: 600; color: var(--accent); }
</style>
