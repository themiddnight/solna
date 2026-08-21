import type { NoteEvent } from "@/engine/instruments/noteEvent";

/** A held triad, 4 seconds, velocity 127 — worst-case loudness for the calibration target
 * (epic AC#1 is specified "at velocity 127"). Used for pads/strings/synth-pad-style instruments. */
export const SUSTAINED_PATTERN: NoteEvent[] = [
  { note: "C4", velocity: 127, time: 0 },
  { note: "E4", velocity: 127, time: 0 },
  { note: "G4", velocity: 127, time: 0 },
];
export const SUSTAINED_PATTERN_DURATION_SEC = 4;
