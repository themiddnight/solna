import type { PadPlanSnapshot } from '@/audio/playback/plan/padPlan';
import { getMeter } from '@/utils/meter';
import type { AppStore } from './types';

/**
 * The live half of DEV-397's planner seam: one builder per lane, turning app
 * state into the immutable snapshot that lane's planner reads.
 *
 * Every builder takes the state as an ARGUMENT. Nothing here calls
 * `useAppStore.getState()`, so the singleton stays in the controller that owns
 * the clock subscription and a planner can never acquire a store read by
 * importing a "convenience" wrapper. The offline renderer builds the same
 * shapes from its own snapshot (`src/audio/export/renderMixdown.ts`), which is
 * why live/offline equivalence is a deep-equality assertion on two snapshots.
 *
 * What is NOT here is as deliberate as what is: no synth patch, no arp
 * settings that a lane reads live, no feel. Those are EMIT-time reads passed to
 * the planner per step by the controller, which is what keeps a knob tweak
 * audible on the very next hit instead of on the next chord.
 */
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
