import { onMount } from 'svelte';
import { getChosenWindow, onWindowChange } from '../../lib/state';

/** Calls `set` with the header's chosen window once mounted, and again whenever it changes. */
export function followChosenWindow(set: (label: string | null) => void): void {
  onMount(() => {
    set(getChosenWindow());
    return onWindowChange(set);
  });
}
