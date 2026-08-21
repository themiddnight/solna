import type { NoteEvent } from "@/engine/instruments/noteEvent";
import type { PercussionSetConfig } from "@/engine/instruments/percussion/types";

/** Matches the other calibration patterns' duration — long enough for the EBU R128 3s
 * short-term gate to open with real content still in its trailing window (see
 * percussivePattern.ts for the full rationale). */
export const PERCUSSION_SET_PATTERN_DURATION_SEC = 4;

const HIT_INTERVAL_SEC = 0.25;

/**
 * Percussion sets have no notes in common — each set's `gmNoteToRegion` is an independent,
 * mostly non-GM mapping (congas use GM 60-64, world hand drums an extended 90-94 block, etc. —
 * see `percussion/percussionSets.ts`). A single fixed pattern (`PERCUSSIVE_PATTERN`) can only
 * ever hit whichever set happens to share its notes, rendering silence for every other set
 * (the DEV-311 batch run's original finding, tracked as Open Question #3).
 *
 * This builds a pattern from whatever notes a *specific* set actually exposes — cycling through
 * every pad in `gmNoteToRegion` at a fixed interval until the pattern's duration is filled, so
 * every set gets a real, audible calibration signal regardless of its note layout.
 */
export function buildPercussionSetPattern(set: PercussionSetConfig): NoteEvent[] {
  const notes = Object.keys(set.gmNoteToRegion).map(Number).sort((a, b) => a - b);
  if (notes.length === 0) {
    throw new Error(`Percussion set "${set.id}" has no pads in gmNoteToRegion — cannot calibrate.`);
  }

  const hitCount = Math.ceil(PERCUSSION_SET_PATTERN_DURATION_SEC / HIT_INTERVAL_SEC);
  return Array.from({ length: hitCount }, (_, i) => {
    const note = notes.at(i % notes.length);
    if (note === undefined) throw new Error(`Unreachable: empty note cycle for set "${set.id}"`);
    return { note, velocity: 127, time: i * HIT_INTERVAL_SEC };
  });
}
