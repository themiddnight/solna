/**
 * A golden snapshot of every Instant Vibe's `drumPattern`, originally
 * captured before the vibe-drums-from-library plan replaced each
 * vibe's inline rows with `drumPatternId` + `drumPatternById`. That migration
 * is long done; this fixture's ongoing job is to pin all 6×7×16 authored
 * cells so `instantVibesDrums.test.ts` fails loudly if a VIBE_DRUM_PATTERNS
 * entry, or a vibe's `drumPatternId`, changes what actually plays — it is the
 * only thing in the repo pinning that much authored drum data. Deliberately
 * duplicates the step literals that used to live in `instantVibes.ts` and
 * imports nothing from that file — or from the library — so this fixture
 * cannot silently track a later change to the data it is meant to be checked
 * against. It is a snapshot, not a re-derivation, and that independence is
 * the whole proof.
 *
 * Keyed by vibe id, not by library pattern id: the point of comparison is
 * "what this vibe sounded like before", so the library's own naming must not
 * leak in here.
 *
 * If the test goes red: figure out whether the library edit was intentional.
 * If yes — the sound was meant to change — update this fixture's rows to
 * match. If no — someone edited a shared pattern (or a vibe's
 * `drumPatternId`) without meaning to change this vibe's beat — revert the
 * library/vibe change instead.
 */
export const ORIGINAL_VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>> = {
  'lofi-chill': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    openhat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'synthwave-80s': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'cyber-dance': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'ambient-chill': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'hiphop-groove': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'asian-zen': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'lofi-waltz': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'afro-six-eight': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    tom:     [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};
