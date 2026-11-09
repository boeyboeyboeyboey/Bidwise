<script lang="ts">
  import { multiLabel } from './multiSelect';

  interface Props {
    label: string;
    options: { bit: number; label: string }[];
    /** Chosen options as a bit mask; 0 means any. */
    value: number;
    onchange: (mask: number) => void;
    anyLabel: string;
    noun: string;
    listMax?: number;
  }
  let { label, options, value, onchange, anyLabel, noun, listMax = 2 }: Props = $props();

  const uid = $props.id();
  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();

  const summary = $derived(multiLabel(options.filter((o) => value & o.bit).map((o) => o.label), anyLabel, noun, listMax));

  const close = (refocus = false) => {
    open = false;
    if (refocus) button?.focus();
  };

  $effect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  });

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close(true);
    }
  }
  // Tabbing out of the widget closes it.
  function focusout(e: FocusEvent) {
    if (open && !(e.relatedTarget && root?.contains(e.relatedTarget as Node))) close();
  }
</script>

<div class="ms" bind:this={root} onkeydown={keydown} onfocusout={focusout} role="presentation">
  <span class="lab" id={`${uid}-l`}>{label}</span>
  <button type="button" class="trig" class:set={value !== 0} bind:this={button} aria-expanded={open} aria-controls={`${uid}-p`} aria-labelledby={`${uid}-l ${uid}-v`} onclick={() => (open = !open)}>
    <span class="val" id={`${uid}-v`}>{summary}</span>
  </button>
  {#if open}
    <!-- Keep focus where it is on pointer clicks, so the focusout close below doesn't fire before the click lands. -->
    <div class="panel" id={`${uid}-p`} role="group" aria-labelledby={`${uid}-l`} onmousedown={(e) => e.preventDefault()}>
      {#each options as o (o.bit)}
        <label class="opt">
          <input type="checkbox" checked={!!(value & o.bit)} onchange={() => onchange(value & o.bit ? value & ~o.bit : value | o.bit)} />
          <span>{o.label}</span>
        </label>
      {/each}
      <button type="button" class="clr" onclick={() => onchange(0)}>Clear</button>
    </div>
  {/if}
</div>

<style>
  .ms { position: relative; display: grid; gap: var(--s1); min-width: 0; }
  .lab { font-size: var(--fs-xs); color: var(--muted); }
  .trig {
    display: flex; align-items: center; width: 100%; min-height: 44px; padding: 0 40px 0 12px; font: inherit; font-size: var(--fs-sm); color: var(--text); text-align: left; cursor: pointer;
    background: var(--surface) var(--chev-down) right 12px center / 16px no-repeat; border: 1px solid var(--rule-strong); border-radius: var(--r-md);
  }
  .trig[aria-expanded='true'] { border-color: var(--accent); }
  .trig.set { font-weight: 600; }
  .val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel {
    position: absolute; z-index: 20; top: 100%; left: 0; min-width: 100%; width: max-content; max-width: min(320px, calc(100vw - 2 * var(--gutter))); margin-top: 4px; padding: var(--s1);
    display: grid; background: var(--surface); border: 1px solid var(--rule-strong); border-radius: var(--r-md); box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
  }
  .opt { display: flex; align-items: center; gap: var(--s3); min-height: 44px; padding: 0 var(--s3); font-size: var(--fs-sm); cursor: pointer; border-radius: var(--r-sm); }
  .opt:hover { background: var(--accent-soft); }
  .opt input { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); flex: none; }
  .clr {
    min-height: 44px; margin-top: var(--s1); padding: 0 var(--s3); font: inherit; font-size: var(--fs-sm); font-weight: 600; text-align: left; color: var(--accent); background: none; border: 0;
    border-top: 1px solid var(--rule); border-radius: 0; cursor: pointer;
  }
  .clr:disabled { color: var(--muted); cursor: not-allowed; }
</style>
