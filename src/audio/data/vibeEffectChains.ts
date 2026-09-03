// The vibe effect-chain library: the six Instant Vibes' authored master-effects
// blocks, keyed by a library id, so a vibe references a mix instead of inlining
// one — the same reference-and-resolve shape CHORD_PROGRESSIONS already gives a
// vibe's chords and VIBE_DRUM_PATTERNS gives a vibe's rhythm.
//
// Library ids here are internal: projects persist the resolved effects object,
// not the id, so these ids are safe to rename (unlike Instant Vibe preset ids).
//
// Every chain is a Partial<MasterEffects> by design, not oversight: only
// synthwave-neon-hall and edm-club-drive carry distortionWet. applyInstantVibeToStore
// spreads a resolved chain over the current store.effects
// (`{ ...store.effects, ...vibe.effects }`), so an omitted key means "inherit
// the current value" — adding distortionWet to a chain that omits it today would be
// a sound change, which this refactor forbids.
//
// Layering: this file lives under src/audio/ and imports only the MasterEffects
// type (type-only, erased at compile time), so the eslint ban on audio/ -> store/
// and audio/ -> components/ cannot be violated here. src/store/ may read it; that
// direction is allowed.

import type { MasterEffects } from '../../types';

export const VIBE_EFFECT_CHAINS: Record<string, Partial<MasterEffects>> = {
  'lofi-tape-room': {
    reverbWet: 0.35,
    reverbDecay: 2.4,
    delayWet: 0.22,
    delayFeedback: 0.28,
    compressorThreshold: -18,
    eqLow: 3,
    eqMid: 1,
    eqHigh: -2,
  },
  'synthwave-neon-hall': {
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
  'edm-club-drive': {
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
  'ambient-cathedral-wash': {
    reverbWet: 0.68,
    reverbDecay: 5.8,
    delayWet: 0.48,
    delayFeedback: 0.58,
    compressorThreshold: -20,
    eqLow: 2,
    eqMid: -1,
    eqHigh: 2,
  },
  'boombap-dry-room': {
    reverbWet: 0.30,
    reverbDecay: 2.0,
    delayWet: 0.20,
    delayFeedback: 0.22,
    compressorThreshold: -16,
    eqLow: 3,
    eqMid: 1,
    eqHigh: 0,
  },
  'zen-temple-air': {
    reverbWet: 0.58,
    reverbDecay: 4.4,
    delayWet: 0.42,
    delayFeedback: 0.46,
    compressorThreshold: -18,
    eqLow: 1,
    eqMid: 0,
    eqHigh: 3,
  },
};

/**
 * Look up an authored effect chain by library id.
 *
 * Returns a FRESH shallow copy on every call — never the module's own object.
 * A shallow copy is sufficient and correct here: every value in a chain is a
 * scalar (number), so there is no nested structure for a copy to alias.
 * `resolveProgression` and `drumPatternById` follow the same rule and also
 * return freshly built objects every call.
 */
export function effectChainById(id: string): Partial<MasterEffects> | undefined {
  const chain = VIBE_EFFECT_CHAINS[id];
  if (!chain) return undefined;
  return { ...chain };
}

/**
 * Same lookup as `effectChainById`, but throws on an unknown id instead of
 * returning `undefined`. Vibe authoring sites want this: spreading an
 * `undefined` chain over `store.effects` (`{ ...store.effects, ...undefined }`)
 * is a legal no-op, so a mistyped id would silently apply no effects change
 * instead of failing loudly the way an unknown drum-pattern or synth-preset id
 * already does.
 */
export function requireEffectChain(id: string): Partial<MasterEffects> {
  const chain = effectChainById(id);
  if (!chain) {
    throw new Error(`Unknown vibe effect chain id: ${id}`);
  }
  return chain;
}
