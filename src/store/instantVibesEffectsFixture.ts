/**
 * A golden snapshot of every Instant Vibe's `effects` block, originally
 * captured before the vibe-effects-from-library plan replaced each
 * vibe's inline block with `effectChainId` + `effectChainById`. That
 * migration is long done; this fixture's ongoing job is to pin the resolved
 * mix so `instantVibesEffects.test.ts` fails loudly if a VIBE_EFFECT_CHAINS
 * entry, or a vibe's `effectChainId`, changes what actually plays.
 * Deliberately duplicates the number literals that used to live in
 * `instantVibes.ts` and imports nothing from that file — or from the
 * library — so this fixture cannot silently track a later change to the data
 * it is meant to be checked against. It is a snapshot, not a re-derivation,
 * and that independence is the whole proof.
 *
 * Keyed by vibe id, not by library chain id: the point of comparison is
 * "what this vibe sounded like before", so the library's own naming must not
 * leak in here.
 *
 * If the test goes red: figure out whether the library edit was intentional.
 * If yes — the sound was meant to change — update this fixture to match. If
 * no — someone edited a shared chain (or a vibe's `effectChainId`) without
 * meaning to change this vibe's mix — revert the library/vibe change instead.
 */
import type { MasterEffects } from '../types';

export const ORIGINAL_VIBE_EFFECTS: Record<string, Partial<MasterEffects>> = {
  'lofi-chill': {
    reverbWet: 0.35,
    reverbDecay: 2.4,
    delayWet: 0.22,
    delayFeedback: 0.28,
    compressorThreshold: -18,
    eqLow: 3,
    eqMid: 1,
    eqHigh: -2,
  },
  'synthwave-80s': {
    reverbWet: 0.48,
    reverbDecay: 3.6,
    delayWet: 0.28,
    delayFeedback: 0.35,
    distortionWet: 0.18,
    compressorThreshold: -15,
    eqLow: 2,
    eqMid: 1,
    eqHigh: 4,
  },
  'cyber-dance': {
    reverbWet: 0.36,
    reverbDecay: 2.8,
    delayWet: 0.32,
    delayFeedback: 0.42,
    distortionWet: 0.22,
    compressorThreshold: -14,
    eqLow: 3,
    eqMid: 0,
    eqHigh: 4,
  },
  'ambient-chill': {
    reverbWet: 0.68,
    reverbDecay: 5.8,
    delayWet: 0.48,
    delayFeedback: 0.58,
    compressorThreshold: -20,
    eqLow: 2,
    eqMid: -1,
    eqHigh: 2,
  },
  'hiphop-groove': {
    reverbWet: 0.30,
    reverbDecay: 2.0,
    delayWet: 0.20,
    delayFeedback: 0.22,
    compressorThreshold: -16,
    eqLow: 3,
    eqMid: 1,
    eqHigh: 0,
  },
  'asian-zen': {
    reverbWet: 0.58,
    reverbDecay: 4.4,
    delayWet: 0.42,
    delayFeedback: 0.46,
    compressorThreshold: -18,
    eqLow: 1,
    eqMid: 0,
    eqHigh: 3,
  },
  'lofi-waltz': {
    reverbWet: 0.35,
    reverbDecay: 2.4,
    delayWet: 0.22,
    delayFeedback: 0.28,
    compressorThreshold: -18,
    eqLow: 3,
    eqMid: 1,
    eqHigh: -2,
  },
  'afro-six-eight': {
    reverbWet: 0.3,
    reverbDecay: 2,
    delayWet: 0.2,
    delayFeedback: 0.22,
    compressorThreshold: -16,
    eqLow: 3,
    eqMid: 1,
    eqHigh: 0,
  },
};
