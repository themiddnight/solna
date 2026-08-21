import type { NoteEvent } from "@/engine/instruments/noteEvent";

/** A 4-chord progression (Cmaj7 -> Am7 -> Fmaj7 -> G7), 1 second each, velocity 127 — worst
 * case for a melodic instrument that must stay comparable whether played as a single note or
 * a full chord (spec §7's "single note is not representative for polyphonic instruments"). */
export const POLYPHONIC_PATTERN: NoteEvent[] = [
  { note: "C4", velocity: 127, time: 0 }, { note: "E4", velocity: 127, time: 0 },
  { note: "G4", velocity: 127, time: 0 }, { note: "B4", velocity: 127, time: 0 },
  { note: "A3", velocity: 127, time: 1 }, { note: "C4", velocity: 127, time: 1 },
  { note: "E4", velocity: 127, time: 1 }, { note: "G4", velocity: 127, time: 1 },
  { note: "F3", velocity: 127, time: 2 }, { note: "A3", velocity: 127, time: 2 },
  { note: "C4", velocity: 127, time: 2 }, { note: "E4", velocity: 127, time: 2 },
  { note: "G3", velocity: 127, time: 3 }, { note: "B3", velocity: 127, time: 3 },
  { note: "D4", velocity: 127, time: 3 }, { note: "F4", velocity: 127, time: 3 },
];
export const POLYPHONIC_PATTERN_DURATION_SEC = 4;
