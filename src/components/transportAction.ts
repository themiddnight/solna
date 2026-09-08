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
