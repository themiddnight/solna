import { audioEngine, STEPS_PER_BAR } from "../engine";
import {
  RhythmPattern,
  equalPowerVelocityScale,
} from "../rhythmPatterns";
import {
  deriveChordNotes,
  getDiatonicChordForDegree,
  shiftNoteOctave,
  sixteenthNoteMs,
} from "../../utils/musicTheory";
import type { ChordItem, SynthParams } from "../../types";

export interface BarInvariantEvent {
  noteName: string;
  velocity: number;
  timeOffset: number;
  hold: number;
  lastBarOnly?: boolean;
}

// Precomputes one chord trigger's bar-invariant events from a rhythm pattern.
export function buildChordEvents(
  pattern: RhythmPattern,
  notes: string[],
  stepDur: number,
  holdScale: number,
): BarInvariantEvent[] {
  return pattern.hits.flatMap((hit) => {
    const offset = hit.step * stepDur;
    const hold = Math.max(0.05, (hit.holdSteps ?? 1) * stepDur * holdScale);
    const baseVelocity =
      (hit.velocity ?? 0.8) * equalPowerVelocityScale(notes.length);
    const hitNotes = hit.note !== undefined ? [notes[hit.note]] : notes;
    const isStrum = hit.type === "strum";
    const orderedNotes =
      isStrum && hit.direction === "up" ? [...hitNotes].reverse() : hitNotes;
    const spreadMs = hit.spreadMs ?? 30;

    return orderedNotes.flatMap((n, i) => {
      if (!n) return [];
      const noteName = hit.octaveShift
        ? shiftNoteOctave(n, hit.octaveShift)
        : n;
      const timeOffset = offset + (isStrum ? (i * spreadMs) / 1000 : 0);
      const velocity = isStrum
        ? Math.max(0.1, baseVelocity * (1 - i * 0.08))
        : baseVelocity;
      return [{ noteName, velocity, timeOffset, hold }];
    });
  });
}

// Held full-bar chord: strike every note together and release them together.
export function playFullHoldChord(
  notes: string[],
  params: SynthParams,
  startTime: number,
  holdSec: number,
): void {
  for (const n of notes) {
    audioEngine.triggerSynthNoteOn(
      n,
      params,
      0.8 * equalPowerVelocityScale(notes.length),
      startTime,
      "chord",
    );
    audioEngine.triggerSynthNoteOff(
      n,
      params.release,
      startTime + holdSec,
      "chord",
    );
  }
}

// Schedules one precomputed, bar-invariant event set at the start of each bar
export function scheduleBarInvariantEvents(
  events: BarInvariantEvent[],
  params: SynthParams,
  source: string,
  startTime: number,
  barDur: number,
  totalBars: number,
): void {
  const chordEnd = startTime + totalBars * barDur;
  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = startTime + bar * barDur;
    const isLastBar = bar === totalBars - 1;
    for (const ev of events) {
      if (!isLastBar && ev.lastBarOnly) continue;
      audioEngine.triggerSynthNoteOn(
        ev.noteName,
        params,
        ev.velocity,
        barStart + ev.timeOffset,
        source,
      );
      // Clamp the note-off to the chord end so a long feel hold never
      // overlaps the next chord; earlier bars may still drag across the
      // bar boundary within the same chord.
      audioEngine.triggerSynthNoteOff(
        ev.noteName,
        params.release,
        Math.min(barStart + ev.timeOffset + ev.hold, chordEnd),
        source,
      );
    }
  }
}

// --- Chord preview helpers (tested in chordPlayback.test.ts) ---

/** Minimal engine surface the preview helpers depend on. */
export type PreviewEngine = Pick<
  typeof audioEngine,
  "triggerSynthNoteOn" | "triggerSynthNoteOff" | "stopSource"
>;

// Held chord preview: strike every note of the chord now and let the synth
// envelope sustain — no note-off is scheduled. The caller releases with
// stopSource('chord') on mouse-up. Existing voices on the chord bus are silenced
// first so successive chords never overlap or pile up into dissonant clusters.
export function playChordLegato(
  chord: ChordItem,
  params: SynthParams,
  engine: PreviewEngine,
): void {
  engine.stopSource("chord", 0.05);
  for (const note of chord.notes) {
    engine.triggerSynthNoteOn(
      note,
      params,
      0.8 * equalPowerVelocityScale(chord.notes.length),
      0,
      "chord",
    );
  }
}

// Looping pattern preview: plays immediately, then re-schedules itself one
// bar later until stop() is called. `getNow` returns audio-clock seconds;
// setTimeout/clearTimeout are read off globalThis so tests can swap them.
export function startPatternLoop(
  play: (time: number) => void,
  barSeconds: number,
  getNow: () => number,
): () => void {
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    play(getNow());
    timerId = globalThis.setTimeout(tick, barSeconds * 1000);
  };
  tick();

  return () => {
    if (timerId !== undefined) globalThis.clearTimeout(timerId);
    timerId = undefined;
  };
}

// The sound source for pattern previews: the I triad of the active scale,
// independent of the 7th-chords quick-add toggle.
export function previewChordForScale(
  scaleRoot: string,
  scaleType: string,
  octave = 4,
): ChordItem {
  const tonic = getDiatonicChordForDegree(0, scaleRoot, scaleType, false);
  return deriveChordNotes(
    {
      id: "preview",
      root: tonic.root,
      quality: tonic.quality,
      bars: 1,
      notes: [],
    },
    octave,
  );
}

/** Duration of one 16-step bar at the given bpm, in seconds. */
export function previewBarSeconds(bpm: number): number {
  return (sixteenthNoteMs(bpm) / 1000) * STEPS_PER_BAR;
}

// --- Component preview bridge (layering rule 3) ---
// ChordView's held/pattern previews reach the engine only through these
// wrappers; each body is the original engine call moved verbatim.

export function ensurePreviewEngine(): void {
  audioEngine.init();
}

export function hasPreviewEngine(): boolean {
  return !!audioEngine.getAudioContext();
}

export function previewEngineTime(): number {
  return audioEngine.getAudioContext()?.currentTime ?? 0;
}

export function stopChordPreviewSource(fade: number): void {
  audioEngine.stopSource("chord", fade);
}

export function stopBassPreviewSource(fade: number): void {
  audioEngine.stopSource("bass", fade);
}

export function playChordLegatoWithEngine(
  chord: ChordItem,
  params: SynthParams,
): void {
  playChordLegato(chord, params, audioEngine);
}
