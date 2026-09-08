import type { Layer } from '@/types';

/**
 * What the single master Play starts, given the layer it is pressed on.
 *
 * Kept as a pure function rather than an inline ternary in TransportBar for
 * the same reason as playerStop.ts: the repo has no testing-library setup, so
 * a decision that has to be asserted is a decision that lives outside the
 * component. The two results map to the two store actions that already exist
 * — playAll() for 'song', soloLoop(activeLoopId) for 'loop' — so this phase
 * adds no transport action of its own.
 */
export function masterPlayTarget(layer: Layer): 'song' | 'loop' {
  return layer === 'song' ? 'song' : 'loop';
}

/**
 * What the master Play will start, as a word next to the button. A loop whose
 * name has been cleared still gets a label — an empty string beside a play
 * button reads as a rendering bug, not as an unnamed loop.
 */
export function playTargetLabel(layer: Layer, activeLoopName: string): string {
  if (layer === 'song') return 'Song';
  return activeLoopName.trim() === '' ? 'Loop' : activeLoopName;
}
