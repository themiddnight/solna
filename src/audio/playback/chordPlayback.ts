import { audioEngine, STEPS_PER_BAR, type AudioEngine } from "../engine";
import { cycleStepAt, equalPowerVelocityScale } from "../chordRhythms";
import type { RhythmPattern } from "@/data/chordRhythms";
import { buildArpSequence } from "../arpeggiator";
import { arpFiresOnStep, computeArpTriggers } from "../arpSchedule";
import { arpStepFor } from "@/utils/meter";
import {
  deriveChordNotes,
  getDiatonicChordForDegree,
  shiftNoteOctave,
  barDurationSec,
  stepDurationSec,
} from "@/utils/musicTheory";
import { DEFAULT_VELOCITY } from "../constants";
import type { ChordItem, SynthParams } from "@/types";

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
      (hit.velocity ?? DEFAULT_VELOCITY) * equalPowerVelocityScale(notes.length);
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
 * The one event-phase filter. `stepInCycle` has already been folded onto the
 * cycle the caller schedules, so this is a plain match; the folding is
 * `cycleStepAt`'s job and a second copy of it here is exactly how a preview and
 * the transport came to disagree about a bar line.
 *
 * A single pass avoids the intermediate array `.filter().map()` would allocate;
 * this runs twice per 16th step (chord + bass) for the session.
 */
function phaseEventsForStep(
  events: BarInvariantEvent[],
  stepInCycle: number,
  isLastBar: boolean,
): StepEvent[] {
  const out: StepEvent[] = [];
  for (const ev of events) {
    if (ev.step !== stepInCycle) continue;
    if (!isLastBar && ev.lastBarOnly) continue;
    out.push({
      noteName: ev.noteName,
      velocity: ev.velocity,
      timeOffset: ev.timeOffset,
      hold: ev.hold,
    });
  }
  return out;
}

/**
 * The events of one bar-invariant set that land on the cycle column a
 * progression-relative step falls on. Approach notes lead into the NEXT chord,
 * so `lastBarOnly` events are withheld until the active chord's final bar: a
 * preset's one-bar cycle repeats, but its approach still fires once.
 */
export function eventsForCycleStep(
  events: BarInvariantEvent[],
  progressionStep: number,
  cycleSteps: number,
  isLastBar: boolean,
): StepEvent[] {
  return phaseEventsForStep(events, cycleStepAt(progressionStep, cycleSteps), isLastBar);
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
  /**
   * The engine to play on. Defaults to the singleton, so every live call site
   * is unchanged; the offline renderer passes its own render engine. The
   * parameter exists rather than a copy of this function existing in the
   * renderer, because the clamp below is one rule — a strum's later notes can
   * start past `chordEnd` at high bpm — and a second copy would be the copy
   * no live test exercises.
   */
  engine: AudioEngine = audioEngine,
): void {
  for (const ev of events) {
    const start = time + ev.timeOffset;
    engine.triggerSynthNoteOn(ev.noteName, params, ev.velocity, start, source, 1, "sequencer");
    // The clamp to chordEnd stops a long feel hold from overlapping the next
    // chord — but a strum's later notes start up to (n-1)*30 ms after `time`,
    // and on a chord's LAST step at high bpm (200 bpm = 0.075 s/step) that
    // start is already past chordEnd. Floor the gate at 10 ms so the note-off
    // can never precede its own note-on.
    const off = Math.max(start + 0.01, Math.min(start + ev.hold, chordEnd));
    engine.triggerSynthNoteOff(ev.noteName, params.release, off, source);
  }
}

/**
 * Lays a whole cycle down in one burst — or `totalSteps` of one, which may be
 * several repetitions of it. Still the right shape for the pattern previews,
 * which are driven by a bar timer instead of the shared clock and so have no
 * per-step tick to hang events on.
 *
 * `totalSteps` and `cycleSteps` are both stated by the caller rather than
 * assumed to be a bar: a custom lane's cycle is `loopLength * stepsPerBar`, and
 * a bar-relative modulo would silently drop every event past column
 * `stepsPerBar - 1` — a bar two of a two-bar pattern would simply never sound.
 * The phase filter is `eventsForCycleStep`, the same one live scheduling and the
 * offline renderer use, so a preview cannot drift from what actually plays.
 *
 * An approach note fires on the last repetition of the cycle, matching the
 * preset rule that it belongs to the chord's final bar.
 */
export function scheduleWholeChord(
  events: BarInvariantEvent[],
  params: SynthParams,
  source: string,
  startTime: number,
  stepDur: number,
  totalSteps: number,
  cycleSteps: number,
): void {
  const chordEnd = startTime + totalSteps * stepDur;
  const lastCycle = Math.ceil(totalSteps / cycleSteps) - 1;
  for (let s = 0; s < totalSteps; s++) {
    const isLastBar = Math.floor(s / cycleSteps) === lastCycle;
    emitStepEvents(
      eventsForCycleStep(events, s, cycleSteps, isLastBar),
      params,
      source,
      startTime + s * stepDur,
      chordEnd,
    );
  }
}

/**
 * Where a PROGRESSION-relative step falls inside the chord armed at
 * `plan.startProgressionStep`, or null when the step is outside the chord's
 * span.
 *
 * Both the step and the plan's start are measured from the step the PLAYBACK
 * RUN began on (`playbackOriginStep`, held by the caller's arming state) —
 * never from a bar line, and never from the plan's own start. One plan is one
 * chord and a run spans many, so the count has to survive every chord after
 * it, and the plans tile the run exactly: each is armed one whole chord after
 * the last. That is what keeps a two-bar chord cycle and a three-bar bass
 * cycle in phase over a six-bar progression. Each lane folds this one number by
 * its own resolved `cycleSteps` with `eventsForCycleStep`; the fold is
 * deliberately not here, because the two widths differ and this function knows
 * neither.
 *
 * `stepInBar` used to be returned here, and its presence was the one-bar
 * assumption this signature removes: a bar-relative column cannot address
 * column 20 of a two-bar custom cycle, and every caller that wanted one had to
 * reconstruct the cycle it came from.
 */
export function chordPlanPosition(
  plan: { startProgressionStep: number; totalBars: number },
  progressionStep: number,
  stepsPerBar: number = STEPS_PER_BAR,
): { isLastBar: boolean; stepsRemaining: number } | null {
  const totalSteps = plan.totalBars * stepsPerBar;
  const stepInChord = progressionStep - plan.startProgressionStep;
  if (stepInChord < 0 || stepInChord >= totalSteps) return null;
  return {
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
 * chord boundaries rather than restarting on every chord — but it is bar-phased
 * through `arpStepFor` first, which is the identity in 4/4 and stops the arp
 * from sliding against the bar line in an odd meter.
 */
export function arpEventsForStep(
  notes: string[],
  params: SynthParams,
  step: number,
  stepDur: number,
  holdScale: number,
  stepsPerBar: number = STEPS_PER_BAR,
): StepEvent[] {
  const arpStep = arpStepFor(step, stepsPerBar);
  if (!arpFiresOnStep(arpStep, params.arpRate)) return [];

  const sequence = buildArpSequence(
    notes,
    params.arpMode,
    params.arpOctaves,
  );
  if (sequence.length === 0) return [];

  return computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDur).map(
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
// `source` is a parameter rather than a constant because the pad layer holds
// its voicing exactly this way on its own bus — copying the body to make a
// `playFullHoldPad` would leave two implementations to keep in step.
export function playFullHoldChord(
  notes: string[],
  params: SynthParams,
  startTime: number,
  holdSec: number,
  source: string,
  engine: AudioEngine = audioEngine,
): void {
  for (const n of notes) {
    engine.triggerSynthNoteOn(
      n,
      params,
      DEFAULT_VELOCITY * equalPowerVelocityScale(notes.length),
      startTime,
      source,
      1,
      "sequencer",
    );
    engine.triggerSynthNoteOff(
      n,
      params.release,
      startTime + holdSec,
      source,
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
//
// `time` is left undefined, not 0: triggerSynthNoteOn falls back to
// `ctx.currentTime` only when the argument is nullish, so a literal 0 here
// scheduled the whole envelope at the audio clock's origin. On the FIRST
// preview of a session that origin is close enough to `currentTime` to pass
// unnoticed; by any later press `currentTime` has moved well past the
// attack+decay window, so every event in the envelope already lies in the
// past and the AudioParam timeline resolves straight to its last value — the
// sustain level — with no attack transient at all. That is exactly "loud
// once, then quiet" on a patch with a low sustain level.
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
      DEFAULT_VELOCITY * equalPowerVelocityScale(chord.notes.length),
      undefined,
      "chord",
      1,
      "preview",
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
  // Matches the engine's own scheduling lookahead (AudioEngine.CLOCK_LOOKAHEAD
  // in engine.ts, currently 0.1s) — a small, FIXED slop, not a fraction of the
  // bar. A bar-scaled threshold (e.g. "> barSeconds") was tried first and is
  // wrong: a timer merely late by most of a bar (1.9s of a 2s bar) would still
  // clear that check without re-anchoring, so play() would run with a stale
  // nextTime while the clock has already moved nearly a whole bar past it —
  // collapsing most of the bar's steps into a single burst on the next tick.
  const RESYNC_SLOP_SEC = 0.1;
  // The next bar's position on the AUDIO clock. Re-arming the timer from the
  // wall clock alone lets every late callback shift the loop permanently off
  // the grid; correcting the sleep against this keeps it anchored.
  let nextTime = getNow();

  const tick = () => {
    const now = getNow();
    // Ordinary timer slop (a few/tens of ms late, within RESYNC_SLOP_SEC)
    // must NOT nudge nextTime forward — that would re-introduce the exact
    // drift this fix removes. Only a stall past the slop (backgrounded tab,
    // GC pause) re-anchors to "now"; anything smaller keeps playing on the
    // original grid position.
    if (now - nextTime > RESYNC_SLOP_SEC) nextTime = now;
    play(nextTime);
    nextTime += barSeconds;
    // Arm roughly one slop EARLY relative to nextTime, so ordinary timer
    // jitter still fires with nextTime ahead of the real clock — play() must
    // never be handed a time the audio clock has already passed.
    timerId = globalThis.setTimeout(tick, Math.max(0, (nextTime - getNow() - RESYNC_SLOP_SEC) * 1000));
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

/**
 * Duration of one bar at the given bpm, in seconds. `stepsPerBar` defaults to
 * the 16-step 4/4 bar so every existing caller is unaffected; the ChordView
 * preview call sites pass the active meter's `stepsPerBar` so the preview
 * loop period matches what `playChordWithRhythm`/`playBassWithPattern`
 * actually adapt the pattern to.
 */
export function previewBarSeconds(bpm: number, stepsPerBar: number = STEPS_PER_BAR): number {
  return barDurationSec(bpm, stepsPerBar);
}

/**
 * How long one PATTERN CYCLE lasts at `bpm`, in seconds.
 *
 * This is the duration both preview buttons loop at, and it is measured from
 * the cycle the lane actually resolved — one bar for a preset, the lane's own
 * `loopLength * stepsPerBar` for a custom row. The preview timer and the
 * scheduler callback it re-fires are handed the same number, so a two-bar
 * preview cannot lay down its first bar and then restart early.
 */
export function previewCycleSeconds(cycleSteps: number, bpm: number): number {
  return cycleSteps * stepDurationSec(bpm);
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
