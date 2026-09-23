import { useSyncExternalStore } from 'react';
import type { KnobSize } from '@/utils/knob';
import { browserMatchMedia, createMediaQuerySource } from '../ui/mediaQuerySource';

/**
 * Tailwind v4's default `lg` breakpoint. Below it the FX chain runs four cards
 * across a tablet (from `md:`) or two across a phone, and either way a card
 * is too narrow for the EQ's three `md` knobs. A knob's size is a pixel prop,
 * not a class, so it cannot follow the breakpoint in CSS.
 *
 * This picks a knob size, never a frame — the frame is useLayoutMode's alone.
 */
const WIDE_QUERY = '(min-width: 64rem)';

const wide = createMediaQuerySource(WIDE_QUERY, browserMatchMedia);

const getSnapshot = (): KnobSize => (wide.matches() === false ? 'sm' : 'md');
const getServerSnapshot = (): KnobSize => 'md';

export function useFxChainKnobSize(): KnobSize {
  return useSyncExternalStore(wide.subscribe, getSnapshot, getServerSnapshot);
}
