import { audioEngine, STEPS_PER_BAR, type AudioEngine } from "../engine";
import { equalPowerVelocityScale } from "../chordRhythms";
import {
  getDiatonicChordForDegree,
  barDurationSec,
  noteFrequency,
  stepDurationSec,
} from "@/utils/musicTheory";
import { DEFAULT_VELOCITY } from "../constants";
import type { ChordItem } from "@/types";
import type { ActiveSynth } from "@/types/synth";
import { synthReleaseSeconds } from "@/utils/synthPatch";
import {
  eventsForCycleStep,
  fullHoldVelocity,
  stepNoteWindow,
  type BarInvariantEvent,
  type StepEvent,
} from "./plan/chordEvents";

/**
 * Fires one step's worth of events on the audio clock.
 *
 * `synth` is read by the caller at emit time, not at chord-arm time: this is
 * what makes a knob tweak audible on the very next hit instead of only on the
 * next chord. Note-offs are clamped to `chordEnd` so a long feel hold never
 * overlaps the chord that follows.
 */
export function emitStepEvents(
  events: StepEvent[],
  synth: ActiveSynth,
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
  const releaseSeconds = synthReleaseSeconds(synth);
  for (const ev of events) {
    // The window (clamp to chordEnd, 10 ms floor) is stepNoteWindow's doc.
    const { startSec: start, endSec: off } = stepNoteWindow(time, ev, chordEnd);
    const voiceId = engine.triggerSynthNoteOn(noteFrequency(ev.noteName), synth, ev.velocity, start, source, 1, "sequencer");
    // Released by the ID this hit started, never by name: a pattern that plays
    // one note twice inside its own tail has two voices on the bus, and a
    // by-name release would end whichever the engine reached first.
    if (voiceId) engine.triggerSynthNoteOff(voiceId, releaseSeconds, off);
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
  synth: ActiveSynth,
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
      synth,
      source,
      startTime + s * stepDur,
      chordEnd,
    );
  }
}

// Held full-bar chord: strike every note together and release them together.
// `source` is a parameter rather than a constant because the pad layer holds
// its voicing exactly this way on its own bus — copying the body to make a
// `playFullHoldPad` would leave two implementations to keep in step.
export function playFullHoldChord(
  notes: string[],
  synth: ActiveSynth,
  startTime: number,
  holdSec: number,
  source: string,
  engine: AudioEngine = audioEngine,
): void {
  for (const n of notes) {
    const voiceId = engine.triggerSynthNoteOn(
      noteFrequency(n),
      synth,
      fullHoldVelocity(notes.length),
      startTime,
      source,
      1,
      "sequencer",
    );
    if (voiceId) {
      engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(synth), startTime + holdSec);
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
  notes: string[],
  synth: ActiveSynth,
  engine: PreviewEngine,
): void {
  engine.stopSource("chord", 0.05);
  for (const note of notes) {
    engine.triggerSynthNoteOn(
      noteFrequency(note),
      synth,
      DEFAULT_VELOCITY * equalPowerVelocityScale(notes.length),
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
): ChordItem {
  const tonic = getDiatonicChordForDegree(0, scaleRoot, scaleType, false);
  return {
    id: "preview",
    root: tonic.root,
    quality: tonic.quality,
    bars: 1,
  };
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
  notes: string[],
  synth: ActiveSynth,
): void {
  playChordLegato(notes, synth, audioEngine);
}
