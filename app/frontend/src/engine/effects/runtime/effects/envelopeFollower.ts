import { computeDuckGain } from "./DuckerEffect";
import type { EnvelopeFollowerParams } from "./envelopeFollowerWorklet";

/**
 * Pure TypeScript mirror of `envelope-follower-processor.js`'s per-sample envelope math
 * (DEV-343 task 7). NOT used in the production audio path — the worklet, running on the
 * audio thread, is the real implementation; none of DuckerEffect.ts/VocoderExtEffect.ts/
 * VocoderEffect.ts call this. It exists purely so the one-pole attack/hold/release
 * behavior can be pinned by a fast, no-audio-graph-needed unit test: the kind of
 * sub-millisecond-resolution assertion the old rAF-based implementation could never have
 * passed (rAF's ~16ms granularity can't represent a 5ms attack). See
 * `__tests__/envelopeFollower.test.ts`.
 *
 * `computeDuckGain` is IMPORTED (not hand-copied) from DuckerEffect.ts — this module and
 * DuckerEffect.ts share one canonical curve implementation, so they can never drift from
 * each other. Only the worklet's own standalone-JS copy (which cannot import from src/)
 * is a hand-copy, and that one is pinned separately by this file's own test suite (the
 * worklet-agreement test in envelopeFollower.test.ts).
 */

export interface EnvelopeState {
  envelope: number;
  holdRemaining: number;
}

/** Starting state: unity gain, no hold in progress — matches the worklet's own
 *  constructor defaults (`this.envelope = 1; this.holdRemaining = 0;`). */
export function createEnvelopeState(): EnvelopeState {
  return { envelope: 1, holdRemaining: 0 };
}

/**
 * Advances the envelope by exactly one sample and returns the new value. Mirrors
 * `envelope-follower-processor.js`'s `process()` inner-loop body line-for-line: attack
 * when the target drops below the current envelope (re-arming the hold), hold while
 * `holdRemaining` hasn't drained, release otherwise. `state` is mutated in place,
 * matching the worklet's own per-instance field mutation — callers step one sample at a
 * time, so recomputing the attack/release coefficients on every call (rather than once
 * per block, as the worklet does for efficiency) produces an identical numeric result at
 * no cost that matters for a test-only function.
 */
export function stepEnvelope(
  state: EnvelopeState,
  keyDb: number,
  params: EnvelopeFollowerParams,
  sampleRate: number,
): number {
  const attackCoeff = Math.exp(-1 / ((params.attackMs / 1000) * sampleRate));
  const releaseCoeff = Math.exp(-1 / ((params.releaseMs / 1000) * sampleRate));
  const holdSamples = (params.holdMs / 1000) * sampleRate;

  const target = computeDuckGain(keyDb, params.thresholdDb, params.amount);

  if (target < state.envelope) {
    // Ducking down: attack, and re-arm the hold.
    state.envelope = target + (state.envelope - target) * attackCoeff;
    state.holdRemaining = holdSamples;
  } else if (state.holdRemaining > 0) {
    state.holdRemaining--;
  } else {
    // Recovering back toward unity (or toward a shallower reduction).
    state.envelope = target + (state.envelope - target) * releaseCoeff;
  }

  return state.envelope;
}
