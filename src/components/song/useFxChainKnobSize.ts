import { useSyncExternalStore } from 'react';
import type { KnobSize } from '@/utils/knob';

/**
 * Tailwind v4's default `lg` breakpoint. Below it the FX chain runs four cards
 * across a tablet (from `md:`) or two across a phone, and either way a card
 * is too narrow for the EQ's three `md` knobs. A knob's size is a pixel prop,
 * not a class, so it cannot follow the breakpoint in CSS.
 *
 * This picks a knob size, never a frame — the frame is useLayoutMode's alone.
 */
const WIDE_QUERY = '(min-width: 64rem)';

const mediaQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_QUERY)
    : null;

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const getSnapshot = (): KnobSize => (mediaQuery()?.matches === false ? 'sm' : 'md');
const getServerSnapshot = (): KnobSize => 'md';

export function useFxChainKnobSize(): KnobSize {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
