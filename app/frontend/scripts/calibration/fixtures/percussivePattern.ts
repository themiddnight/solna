import type { NoteEvent } from "@/engine/instruments/noteEvent";

/** 32 hits over 4 seconds, velocity 127 — representative of a short performance phrase for
 * drums/mallets/plucked instruments (high crest factor per spec §11, low RMS/high peak).
 *
 * Duration is 4s, not the original 2s, because EBU R128 short-term loudness is a rolling
 * 3-second window: ffmpeg reports a "gate not open yet" sentinel for every frame before t=3s,
 * so a 2s pattern produced zero valid measurements (discovered rendering versilian_drumset —
 * see scripts/calibration/README.md). The hit rhythm repeats every 2s so the 3s trailing window
 * at t≥3s still contains real hits, not just decay tail.
 *
 * Interleaves GM kick (36/C2) + snare (38/D2) with the original tom pair (48/C3, 50/D3):
 * a batch run against the full catalog found several drum machines (MFB-512, Casio-RZ1, most
 * DrumAbuse boxes) map only kick/snare/hihat, with nothing on 48/50 — the tom-only pattern
 * rendered total silence for them. Kick+snare is the closest thing to a universal minimum
 * across drum-machine presets.
 *
 * Percussion sets (congas/bongos, world hand drums, etc.) are a separate, known limitation:
 * their `gmNoteToRegion` maps are genuinely per-set and mostly non-GM (congas use 60-64, world
 * hand drums an extended 90-94 block, orchestral 100-113 — see `percussion/percussionSets.ts`)
 * with no notes in common with each other, let alone with this pattern. No fixed note set can
 * cover them; per-set/per-instrument note derivation is the real fix (DEV-311's own Open
 * Question #3, left unresolved) — tracked as a follow-up, not silently patched over here. */
export const PERCUSSIVE_PATTERN: NoteEvent[] = [
  { note: "C2", velocity: 127, time: 0 },
  { note: "D2", velocity: 127, time: 0.125 },
  { note: "C3", velocity: 127, time: 0.25 },
  { note: "D3", velocity: 127, time: 0.375 },
  { note: "C2", velocity: 127, time: 0.5 },
  { note: "D2", velocity: 127, time: 0.625 },
  { note: "C3", velocity: 127, time: 0.75 },
  { note: "D2", velocity: 127, time: 0.875 },
  { note: "C2", velocity: 127, time: 1.0 },
  { note: "D2", velocity: 127, time: 1.125 },
  { note: "C3", velocity: 127, time: 1.25 },
  { note: "D3", velocity: 127, time: 1.375 },
  { note: "C2", velocity: 127, time: 1.5 },
  { note: "D2", velocity: 127, time: 1.625 },
  { note: "C3", velocity: 127, time: 1.75 },
  { note: "D2", velocity: 127, time: 1.875 },
  { note: "C2", velocity: 127, time: 2.0 },
  { note: "D2", velocity: 127, time: 2.125 },
  { note: "C3", velocity: 127, time: 2.25 },
  { note: "D3", velocity: 127, time: 2.375 },
  { note: "C2", velocity: 127, time: 2.5 },
  { note: "D2", velocity: 127, time: 2.625 },
  { note: "C3", velocity: 127, time: 2.75 },
  { note: "D2", velocity: 127, time: 2.875 },
  { note: "C2", velocity: 127, time: 3.0 },
  { note: "D2", velocity: 127, time: 3.125 },
  { note: "C3", velocity: 127, time: 3.25 },
  { note: "D3", velocity: 127, time: 3.375 },
  { note: "C2", velocity: 127, time: 3.5 },
  { note: "D2", velocity: 127, time: 3.625 },
  { note: "C3", velocity: 127, time: 3.75 },
  { note: "D2", velocity: 127, time: 3.875 },
];
export const PERCUSSIVE_PATTERN_DURATION_SEC = 4;
