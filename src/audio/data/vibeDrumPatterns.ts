// The vibe drum-pattern library: the six Instant Vibes' authored drum
// skeletons, keyed by a library id, so a vibe references a rhythm instead of
// inlining one — the same reference-and-resolve shape CHORD_PROGRESSIONS
// already gives a vibe's chords.
//
// Library ids here are internal: projects persist the resolved boolean grid,
// not the id, so these ids are safe to rename (unlike Instant Vibe preset ids).
//
// Deliberately NOT merged with GENRE_PRESETS (./genrePresets.ts). Measured:
// no vibe's pattern matches its own genre entry best (Jaccard over hit cells —
// synthwave-80s is closest to Trap at 81%, not Synthwave at 58%; ambient-chill
// peaks at 26% against anything; nothing matches at 100%), and the two
// disagree on cell type (boolean vs number), row set (`bass` only on the
// sequencer side, `crash` only here) and consumer. Merging them would force a
// sound change on one side or the other, which this refactor forbids.
//
// Layering: this file lives under src/audio/ and imports nothing at all, so
// the eslint ban on audio/ -> store/ and audio/ -> components/ cannot be
// violated here. src/store/ may read it; that direction is allowed.

import { DEFAULT_METER_ID, type MeterId } from '../../utils/meter';

export const VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>> = {
  'lofi-half-time-brush': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    openhat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'synthwave-four-on-floor': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'edm-offbeat-pump': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'ambient-sparse-drift': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'boombap-swung-break': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'zen-bamboo-pulse': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // --- 3/4, accentGroups [4,4,4]: beats at 0, 4, 8 ---
  'waltz-brush-three': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // --- 6/8, accentGroups [6,6]: only TWO beats, at 0 and 6 ---
  'afro-six-eight-bell': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    tom:     [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

/**
 * Look up an authored drum pattern by library id.
 *
 * Returns a FRESH deep copy on every call — never the module's own arrays.
 * This ensures VIBE_DRUM_PATTERNS stays authoritative and immutable: callers
 * cannot mutate the library through a pattern reference. (INSTANT_VIBES
 * resolves each pattern once at module load; applyInstantVibeToStore then
 * transforms it to a boolean grid via .map(), so the grid in the store shares
 * no array references with the library regardless — but the copy guards the
 * library itself against any direct mutation.) `resolveProgression` follows
 * the same rule and also returns freshly built objects every call.
 */
export function drumPatternById(id: string): Record<string, number[]> | undefined {
  const pattern = VIBE_DRUM_PATTERNS[id];
  if (!pattern) return undefined;
  const copy: Record<string, number[]> = {};
  for (const [row, steps] of Object.entries(pattern)) {
    copy[row] = [...steps];
  }
  return copy;
}

/**
 * The meter each authored pattern is written in, keyed by the SAME library ids
 * as VIBE_DRUM_PATTERNS above.
 *
 * A sidecar rather than a field on the pattern, deliberately: VIBE_DRUM_PATTERNS
 * is a flat `id -> row -> number[]` map, and wrapping it in `{ meter, rows }`
 * would change `drumPatternById`'s return type, `InstantVibe.drumPattern`, the
 * ORIGINAL_VIBE_DRUM_PATTERNS golden fixture and three invariant tests — all to
 * carry one string. The invariant test pins the two key sets together.
 */
export const VIBE_DRUM_PATTERN_METERS: Record<string, MeterId> = {
  'lofi-half-time-brush': '4/4',
  'synthwave-four-on-floor': '4/4',
  'edm-offbeat-pump': '4/4',
  'ambient-sparse-drift': '4/4',
  'boombap-swung-break': '4/4',
  'zen-bamboo-pulse': '4/4',
  'waltz-brush-three': '3/4',
  'afro-six-eight-bell': '6/8',
};

/** The meter a library pattern was authored in; 4/4 for anything unknown. */
export function drumPatternMeterId(id: string): MeterId {
  return VIBE_DRUM_PATTERN_METERS[id] ?? DEFAULT_METER_ID;
}
