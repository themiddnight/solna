import { audioEngine, STEPS_PER_BAR } from "../engine";
import {
  RhythmPattern,
  equalPowerVelocityScale,
} from "../rhythmPatterns";
import { buildArpSequence } from "../arpeggiator";
import { computeArpTriggers } from "../arpSchedule";
import {
  deriveChordNotes,
  getDiatonicChordForDegree,
  shiftNoteOctave,
  sixteenthNoteMs,
} from "../../utils/musicTheory";
import type { ChordItem, SynthParams } from "../../types";

/**
 * One note of a chord's rhythm pattern, positioned on the 16th grid rather
 * than on an absolute timeline. `step` is what the scheduler matches against
 * the clock, so nothing is scheduled before the clock reaches it; `timeOffset`
 * is only the sub-step strum spread.
 */
export interface BarInvariantEvent {
  step: number;
  noteName: string;
  velocity: number;
  timeOffset: number;
  hold: number;
  lastBarOnly?: boolean;
}

/** A BarInvariantEvent already selected for the step being emitted. */
export type StepEvent = Omit<BarInvariantEvent, "step" | "lastBarOnly">;

// Precomputes one chord trigger's bar-invariant events from a rhythm pattern.
export function buildChordEvents(
  pattern: RhythmPattern,
  notes: string[],
  stepDur: number,
  holdScale: number,
): BarInvariantEvent[] {
  return pattern.hits.flatMap((hit) => {
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
      const timeOffset = isStrum ? (i * spreadMs) / 1000 : 0;
      const velocity = isStrum
        ? Math.max(0.1, baseVelocity * (1 - i * 0.08))
        : baseVelocity;
      return [{ step: hit.step, noteName, velocity, timeOffset, hold }];
    });
  });
}

/**
 * The events of one bar-invariant set that land on `stepInBar`. Approach notes
 * lead into the NEXT chord, so `lastBarOnly` events are withheld until the
 * chord's final bar.
 */
export function eventsForStep(
  events: BarInvariantEvent[],
  stepInBar: number,
  isLastBar: boolean,
): StepEvent[] {
  return events
    .filter((ev) => ev.step === stepInBar && (isLastBar || !ev.lastBarOnly))
    .map(({ noteName, velocity, timeOffset, hold }) => ({
      noteName,
      velocity,
      timeOffset,
      hold,
    }));
}

/**
 * Fires one step's worth of events on the audio clock.
 *
 * `params` is read by the caller at emit time, not at chord-arm time: this is
 * what makes a knob tweak audible on the very next hit instead of only on the
 * next chord. Note-offs are clamped to `chordEnd` so a long feel hold never
 * overlaps the chord that follows.
 */
export function emitStepEvents(
  events: StepEvent[],
  params: SynthParams,
  source: string,
  time: number,
  chordEnd: number,
): void {
  for (const ev of events) {
    const start = time + ev.timeOffset;
    audioEngine.triggerSynthNoteOn(ev.noteName, params, ev.velocity, start, source);
    audioEngine.triggerSynthNoteOff(
      ev.noteName,
      params.release,
      Math.min(start + ev.hold, chordEnd),
      source,
    );
  }
}

/**
 * Lays a whole chord down in one burst, the way the transport used to before
 * it moved to just-in-time emission. Still the right shape for the pattern
 * previews, which are driven by a bar timer instead of the shared clock and so
 * have no per-step tick to hang events on.
 */
export function scheduleWholeChord(
  events: BarInvariantEvent[],
  params: SynthParams,
  source: string,
  startTime: number,
  stepDur: number,
  totalBars: number,
  stepsPerBar: number = STEPS_PER_BAR,
): void {
  const totalSteps = totalBars * stepsPerBar;
  const chordEnd = startTime + totalSteps * stepDur;
  for (let s = 0; s < totalSteps; s++) {
    const isLastBar = Math.floor(s / stepsPerBar) === totalBars - 1;
    emitStepEvents(
      eventsForStep(events, s % stepsPerBar, isLastBar),
      params,
      source,
      startTime + s * stepDur,
      chordEnd,
    );
  }
}

/**
 * Where an absolute clock step falls inside the chord armed at
 * `plan.startStep`, or null when the step is outside the chord's span.
 */
export function chordPlanPosition(
  plan: { startStep: number; totalBars: number },
  step: number,
  stepsPerBar: number = STEPS_PER_BAR,
): { stepInBar: number; isLastBar: boolean; stepsRemaining: number } | null {
  const totalSteps = plan.totalBars * stepsPerBar;
  const stepInChord = step - plan.startStep;
  if (stepInChord < 0 || stepInChord >= totalSteps) return null;
  return {
    stepInBar: stepInChord % stepsPerBar,
    isLastBar: Math.floor(stepInChord / stepsPerBar) === plan.totalBars - 1,
    stepsRemaining: totalSteps - stepInChord,
  };
}

/** Arp velocity, matching the keyboard arpeggiator's fixed level. */
const ARP_VELOCITY = 0.9;

/**
 * The arpeggiator's take on a chord: instead of the rhythm pattern's hits,
 * `notes` are expanded by arpMode/arpOctaves and walked one note per trigger.
 * `step` is the ABSOLUTE clock step so the arp keeps its stride across bar and
 * chord boundaries rather than restarting on every chord.
 */
export function arpEventsForStep(
  notes: string[],
  params: SynthParams,
  step: number,
  stepDur: number,
  holdScale: number,
): StepEvent[] {
  const sequence = buildArpSequence(
    notes,
    params.arpMode ?? "up",
    params.arpOctaves ?? 1,
  );
  if (sequence.length === 0) return [];

  return computeArpTriggers(step, sequence.length, params.arpRate ?? "16n", stepDur).map(
    (t) => ({
      noteName: sequence[t.noteIndex],
      velocity: ARP_VELOCITY,
      timeOffset: t.timeOffsetSec,
      // Feel may only tighten the gate. computeArpTriggers already sizes
      // holdSec at 85% of the interval between triggers; scaling past 1 would
      // hold a note past the next one, and the bass is monophonic — the next
      // note then steals the voice while it is still above its sustain level
      // and cuts it off in the voice-steal's short fade, on every step.
      hold: t.holdSec * Math.min(1, holdScale),
    }),
  );
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
