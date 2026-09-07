/**
 * A golden snapshot of every Instant Vibe's `drumPattern`, originally
 * captured before the vibe-drums-from-library plan replaced each
 * vibe's inline rows with `drumGridId` + `drumGridById`. That migration
 * is long done; this fixture's ongoing job is to pin all eight vibes' drum
 * rows — 16 steps each in 4/4, 12 in lofi-waltz's 3/4 and afro-six-eight's
 * 6/8. Six vibes pin seven rows; `synthwave-80s` and `cyber-edm` pin eight
 * (a `hitom`) and `afro-six-eight` pins nine (`rimshot` and `bell` beside an
 * emptied `snare` and `hihat`) — a grid may name any of the eleven voices, and
 * the row count is a fact about that vibe's grid, not a constant. `cyber-edm`
 * used to pin an eighth for a different reason: it
 * points at `house` (repointed there after `edm-offbeat-pump` was deleted)
 * and so inherited house's `bass` row, which no track could ever play. That
 * row was deleted from the library, and from here with it. So
 * `instantVibesDrums.test.ts` fails loudly if a DRUM_GRIDS
 * entry, or a vibe's `drumGridId`, changes what actually plays — it is the
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
 * `drumGridId`) without meaning to change this vibe's beat — revert the
 * library/vibe change instead.
 *
 * All eight `crash` rows below were updated for exactly that reason: every
 * grid's beat-1-only crash hit was zeroed in `drumGrids.ts` (see the comment
 * there for why), and this snapshot was hand-edited to match rather than
 * re-derived.
 */
export const ORIGINAL_VIBE_DRUM_PATTERNS: Record<string, Record<string, boolean[]>> = {
  'lofi-chill': {
    kick:    [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
    snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    hihat:   [true, false, true, false, true, false, false, true, true, false, true, false, true, false, false, true],
    openhat: [false, false, false, false, false, false, true, false, false, false, false, false, false, false, true, false],
    clap:    [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
    lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, false],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  },
  'synthwave-80s': {
    kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
    hihat:   [true, true, false, true, true, true, false, true, true, true, false, true, true, true, false, true],
    openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, true, false, false],
    hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
    lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  },
  // Repointed from edm-offbeat-pump to house when that grid was deleted. The
  // only value that moved is this `bass` row: kick, snare, hihat, openhat and
  // clap were byte-identical between the two grids, and edm-offbeat-pump's tom
  // and crash MOVED INTO house with the repoint. cyber-edm sounds exactly the
  // same — `bass` is not a drum voice and nothing plays it.
  'cyber-edm': {
    kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    hihat:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    clap:    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    hitom:   [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, false],
    lowtom:  [false, false, false, false, false, false, false, true, false, false, false, false, false, false, true, false],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  },
  'deep-ambient': {
    kick:    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    snare:   [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
    hihat:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    openhat: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
    clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  },
  'boom-bap': {
    kick:    [true, false, false, false, false, false, true, false, false, true, false, false, false, false, false, false],
    snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    hihat:   [true, false, true, true, true, false, true, false, true, false, true, true, true, false, false, false],
    openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
    lowtom:  [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  },
  'zen-garden': {
    kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
    snare:   [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
    hihat:   [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
    clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    lowtom:  [false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  },
  'lofi-waltz': {
    kick:    [true, false, false, false, false, false, false, false, false, false, false, false],
    snare:   [false, false, false, false, true, false, false, false, false, false, false, false],
    hihat:   [true, false, true, false, true, false, true, false, true, false, false, false],
    openhat: [false, false, false, false, false, false, false, false, false, false, true, false],
    lowtom:  [false, false, false, false, false, false, false, false, false, false, false, true],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false],
  },
  'afro-six-eight': {
    kick:    [true, false, false, false, false, false, true, false, false, false, false, false],
    snare:   [false, false, false, false, false, false, false, false, false, false, false, false],
    rimshot: [false, false, false, false, true, false, false, false, false, false, true, false],
    hihat:   [false, false, false, false, false, false, false, false, false, false, false, false],
    bell:    [true, false, true, false, true, false, true, false, false, false, true, false],
    openhat: [false, false, false, false, false, false, false, false, true, false, false, false],
    lowtom:  [false, false, true, false, false, false, false, false, false, false, false, false],
    crash:   [false, false, false, false, false, false, false, false, false, false, false, false],
  },
};
