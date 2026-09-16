import type { ChordItem, PadInterval, PadMode, PadVoicing } from '@/types';
import { barDurationSec } from '@/utils/musicTheory';
import { loopBars } from '@/utils/songStructure';
import { padHoldsAcrossLoop, resolvePadArm } from '../padPlayback';

/**
 * Everything the pad lane reads, captured when a chord is ARMED.
 *
 * Pad is the one lane with no emit-time half at all: an arm is a single
 * note-on/note-off pair, so there is no per-step context to pass and no live
 * read to preserve. The synth patch is deliberately absent — it is the
 * CONTROLLER's, read at the moment it triggers, which is what keeps a pad knob
 * audible on the next arm without the planner knowing an engine exists.
 */
export interface PadPlanSnapshot {
  mode: PadMode;
  /** The whole progression: a drone's hold is the loop's bars, not the chord's. */
  chords: readonly ChordItem[];
  degree: number;
  intervals: readonly PadInterval[];
  padOctave: number;
  voicing: PadVoicing;
  scaleRoot: string;
  scaleType: string;
  bpm: number;
  stepsPerBar: number;
}

/**
 * The pad's arm for the chord at `context.chordIndex`, or null when nothing
 * should sound.
 *
 * `isLoopStart` is derived here rather than passed: the caller already knows
 * the chord's index inside the progression, and "index 0" is the only thing
 * `shouldArmPad` ever meant by the top of a pass. `loopBars` is still paid for
 * by drone mode only — pad mode arms on EVERY chord and must not walk the
 * progression to learn a number it will not read.
 *
 * The second parameter is an object, not a bare scalar, by the binding
 * convention every `plan<Lane>` function follows: a later per-call value
 * (a chord/bass planner's feel, a melody planner's live synth params) is then
 * an additive change to `context`'s shape rather than a signature change.
 */
export function planPadArm(
  snapshot: PadPlanSnapshot,
  context: { chordIndex: number },
): { notes: string[]; holdSec: number } | null {
  const { chordIndex } = context;
  const chord = snapshot.chords[chordIndex];
  if (!chord) return null;
  return resolvePadArm({
    mode: snapshot.mode,
    isLoopStart: chordIndex === 0,
    chord,
    degree: snapshot.degree,
    intervals: snapshot.intervals,
    padOctave: snapshot.padOctave,
    voicing: snapshot.voicing,
    scaleRoot: snapshot.scaleRoot,
    scaleType: snapshot.scaleType,
    barDur: barDurationSec(snapshot.bpm, snapshot.stepsPerBar),
    loopBarCount: padHoldsAcrossLoop(snapshot.mode) ? loopBars(snapshot.chords) : 0,
  });
}
