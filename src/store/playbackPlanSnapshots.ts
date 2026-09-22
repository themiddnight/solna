import type { BeatPlanSnapshot } from '@/audio/playback/plan/beatPlan';
import type { ChordPlanSnapshot } from '@/audio/playback/plan/chordPlan';
import type { MelodyPlanSnapshot } from '@/audio/playback/plan/melodyPlan';
import type { PadPlanSnapshot } from '@/audio/playback/plan/padPlan';
import { getMeter } from '@/utils/timeSignature';
import { melodyTrack, type MelodyTrackId } from './melodyTracks';
import type { AppStore } from './types';

/**
 * The live half of DEV-397's planner seam: one builder per lane, turning app
 * state into the immutable snapshot that lane's planner reads.
 *
 * Every builder takes the state as an ARGUMENT. Nothing here calls
 * `useAppStore.getState()`, so the singleton stays in the controller that owns
 * the clock subscription and a planner can never acquire a store read by
 * importing a "convenience" wrapper. The offline renderer builds the same
 * shapes from its own snapshot (`src/audio/playback/plan/songSnapshot.ts`),
 * which is why live/offline equivalence is a deep-equality assertion on two
 * snapshots.
 *
 * What is NOT here is as deliberate as what is: no synth patch, no arp
 * settings that a lane reads live. Those are EMIT-time-ONLY reads passed to
 * the planner per step by the controller, which is what keeps a knob tweak
 * audible on the very next hit instead of on the next chord. `chordFeel`/
 * `bassFeel` are the one exception to "arm-time snapshot excludes anything
 * read live": `chordPlanSnapshot` DOES capture them (for `cycleHoldScale`,
 * which scales a pattern note's hold duration and is fixed for the plan's
 * life), and the controller ALSO reads them live per step for `planChordStep`'s
 * `feelToHoldScale` (which scales an arp hit's hold duration). See
 * `ChordPlanSnapshot`'s own docblock in `chordPlan.ts` for why both reads are
 * needed rather than one being redundant.
 */

/**
 * The Beat lane's plan snapshot from live store state. R234 twin of the
 * offline `beatSnapshotForLoop`: a new Beat field goes in both or neither.
 */
export function beatPlanSnapshot(s: AppStore): BeatPlanSnapshot {
  return { pattern: s.beatPattern, mix: s.beatMix };
}

export function padPlanSnapshot(s: AppStore): PadPlanSnapshot {
  return {
    mode: s.padMode,
    chords: s.chords,
    degree: s.padDroneDegree,
    intervals: s.padDroneIntervals,
    padOctave: s.padOctave,
    voicing: s.padVoicing,
    scaleRoot: s.scaleRoot,
    scaleType: s.scaleType,
    bpm: s.bpm,
    stepsPerBar: getMeter(s.meterId).stepsPerBar,
  };
}

/**
 * The chord+bass lanes' ARM-time snapshot. Both lanes are armed together off
 * one read of the loop state, so one snapshot serves both — but each lane
 * resolves its own cycle from it, because their widths are independent.
 *
 * Arp arrives as a boolean, not as the settings object: the arp/pattern CHOICE
 * is fixed when the chord is armed (flipping Arp mid-chord must not stack an
 * arpeggio on a chord already sounding), while the arp's mode, rate and octaves
 * are read live on every step and handed to `planChordStep`.
 */
export function chordPlanSnapshot(s: AppStore): ChordPlanSnapshot {
  return {
    chords: s.chords,
    bpm: s.bpm,
    meterId: s.meterId,
    stepsPerBar: getMeter(s.meterId).stepsPerBar,
    chordOctave: s.chordOctave,
    bassOctave: s.bassOctave,
    scaleRoot: s.scaleRoot,
    scaleType: s.scaleType,
    chordRhythmMode: s.chordRhythmMode,
    chordRhythmId: s.chordRhythmId,
    customChordRhythm: s.customChordRhythm,
    customChordHoldSteps: s.customChordHoldSteps,
    customChordLoopLength: s.customChordLoopLength,
    chordFeel: s.chordFeel,
    bassPatternMode: s.bassPatternMode,
    bassPatternId: s.bassPatternId,
    customBassPattern: s.customBassPattern,
    customBassHoldSteps: s.customBassHoldSteps,
    customBassLoopLength: s.customBassLoopLength,
    bassFeel: s.bassFeel,
    chordArpActive: s.chordArpSettings.active,
    bassArpActive: s.bassArpSettings.active,
  };
}

/**
 * One melody track's snapshot, read through `MELODY_TRACKS` so Lead and FX are
 * one implementation with two rows. Built per DISPATCH, not per arm: melody has
 * no arm-time half, and rebuilding it each tick is what lets a note drawn while
 * the loop runs sound on the next step.
 */
export function melodyPlanSnapshot(s: AppStore, trackId: MelodyTrackId): MelodyPlanSnapshot {
  const track = melodyTrack(trackId);
  return {
    steps: s[track.steps],
    loopLength: s[track.loopLength],
    stepResolution: s[track.stepResolution],
    gate: s[track.gate],
    arp: s[track.arpSettings],
  };
}
