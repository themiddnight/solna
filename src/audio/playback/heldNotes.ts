import type { SynthControlTarget } from '@/utils/synthControl';

/**
 * Which synth bus each currently-held note is sounding on.
 *
 * ONE map, not two structures: it answers "where do I release this note"
 * (the per-note captured target) and "how many notes are held on this bus"
 * (the per-bus polyphony count) from the same fact, so the two can never
 * disagree with each other.
 *
 * The rule it exists to enforce: a target is CAPTURED at note-on and is never
 * recomputed at release time. Focus can change mid-hold, and a note-off that
 * recomputed the target would release a bus the voice was never on — the held
 * voice then drones until the same key is pressed again on the same track.
 * That is the same rule `chordKeyNotesRef` in components/useInputDeck.ts
 * already states for chord mode ("key-up releases those notes even if
 * key/scale/octave changed while the key was held"), on a different axis.
 *
 * It lives in `src/audio/` because both `components/useInputDeck.ts` and
 * `audio/playback/arpPlayback.ts` read it and `src/audio/` may not import
 * `src/components/` (layering rule 2).
 */
export type HeldNoteTargets = Map<string, SynthControlTarget>;

/**
 * The bus a note was PLAYED on, or `undefined` when it is not held. Never
 * derive this from the current focus — see HeldNoteTargets.
 */
export function noteTargetFor(
  held: ReadonlyMap<string, SynthControlTarget>,
  note: string,
): SynthControlTarget | undefined {
  return held.get(note);
}

/**
 * How many notes are held on ONE bus. Equal-power polyphony exists to keep a
 * chord's total level flat as keys are added to ONE instrument; counting
 * across buses turns it into a duck — two notes on Lead and two on FX are two
 * buses running two voices each, not one bus running four, and a global count
 * would quieten every note the moment a second track was played.
 */
export function heldCountFor(
  held: ReadonlyMap<string, SynthControlTarget>,
  target: SynthControlTarget,
): number {
  let count = 0;
  for (const heldTarget of held.values()) {
    if (heldTarget === target) count++;
  }
  return count;
}

/**
 * The notes held on ONE bus, in insertion order — the arp's sequence input.
 *
 * Allocates, so the arp calls it only AFTER its fires-on-this-step gate; the
 * cheap "is anything held here at all" question is `heldCountFor`, which
 * allocates nothing. `buildArpSequence` keys its cache on the contents, so a
 * fresh array per tick still hits the cache.
 */
export function heldNotesFor(
  held: ReadonlyMap<string, SynthControlTarget>,
  target: SynthControlTarget,
): string[] {
  const notes: string[] = [];
  for (const [note, heldTarget] of held) {
    if (heldTarget === target) notes.push(note);
  }
  return notes;
}
