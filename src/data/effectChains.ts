// The effect-chain library: the six Instant Vibes' authored master-effects
// blocks, keyed by a library id, so a vibe references a mix instead of inlining
// one — the same reference-and-resolve shape CHORD_PROGRESSIONS already gives a
// vibe's chords and DRUM_GRIDS gives a vibe's rhythm.
//
// Library ids here are internal: projects persist the resolved effects object,
// not the id, so these ids are safe to rename (unlike Instant Vibe preset ids).
//
// Every chain is a Partial<MasterEffects> by design, not oversight: only
// synthwave-neon-hall and edm-club-drive carry distortionWet. applyVibeToStore
// (src/store/vibes.ts) spreads a resolved chain over the current store.effects
// (`{ ...store.effects, ...vibe.effects }`), so an omitted key means "inherit
// the current value" — adding distortionWet to a chain that omits it today would be
// a sound change, which this refactor forbids.
//
// compressorThreshold is a value held ready, not part of the sound as it plays.
// Master dynamics became an explicit, default-OFF stage (DEV-385): the compressor
// is bypassed by rewiring, so a chain's threshold configures a node with no input
// edges until the user switches the stage on. These values are kept, not deleted —
// they are what each vibe asks for the moment its compressor is engaged — but a
// vibe now sounds uncompressed by default, which is a deliberate change from when
// the compressor was always on.
//
// Layering: this file imports nothing at runtime — src/data/ files never do —
// so it can be read, reviewed or copied into a fixture in isolation.

import type { MasterEffects } from '@/types';

export const EFFECT_CHAINS: Record<string, Partial<MasterEffects>> = {
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
