/**
 * The offline mixdown snapshot: the frozen, store-free shape of a song
 * `renderMixdown.ts` renders, and the adapters that build each lane's own
 * arm-time snapshot from one loop of it.
 *
 * Lives in `plan/`, not `export/`, so `songTimeline.ts` (this folder) can
 * plan an arrangement without importing the renderer, and `plan/` never
 * imports `export/`. `src/audio/` may not reach into the store, so every
 * field a lane needs arrives on `MixdownLoop` — the names match the store's
 * on purpose, so an equivalence test between a live snapshot builder
 * (`src/store/playbackPlanSnapshots.ts`) and its offline twin here is a deep
 * equality assertion.
 */
import type { LeadNote } from '@/audio/leadMelody';
import type { BassStepChoice } from '@/data/bassPatterns';
import type {
  BeatMix,
  BeatParams,
  BeatPattern,
  BeatVoiceId,
  ChordItem,
  MasterEffects,
  PadInterval,
  PadMode,
  PadVoicing,
} from '@/types';
import type { ActiveSynth, ArpSettings } from '@/types/synth';
import type { MeterId } from '@/utils/meter';
import type { LeadStepResolutionId } from '@/utils/stepResolution';
import type { BeatPlanSnapshot } from './beatPlan';
import type { ChordPlanSnapshot } from './chordPlan';
import type { MelodyPlanSnapshot } from './melodyPlan';
import type { PadPlanSnapshot } from './padPlan';
import type { SongTrack } from './songTimeline';

/** One source bus, its gain already converted from the store's dB to linear. */
export interface MixdownBusState {
  source: string;
  gain: number;
  muted: boolean;
}

/**
 * One Beat voice's fader, already converted from the store's dB to linear at
 * the slice boundary, with the voice's MUTE folded in as a gain of 0 — the
 * same one-line rule `engineSync.ts` applies live, so the exported mix and the
 * monitored one cannot drift apart.
 */
export interface MixdownBeatVoiceGain {
  voice: BeatVoiceId;
  gain: number;
}

/**
 * One loop of the arrangement, structurally: the per-loop columns the offline
 * snapshot carries, named exactly as `ProjectLoop` names them
 * (`src/store/projectFormat.ts`). Lives in `plan/`, not `export/`, so neither
 * the renderer nor the song timeline needs to import the store.
 *
 * Deliberately the flat store names rather than a nested, renderer-shaped
 * restatement, except for `buses`: that is the store→audio conversion seam
 * where persisted dB becomes linear gain. The slice spreads each project
 * loop and adds only that derived row set, so the musical content is not
 * hand-mapped field by field.
 */
export interface MixdownLoop {
  id: string;
  repeatCount?: number;
  scaleRoot: string;
  scaleType: string;
  chords: ChordItem[];
  synthParams: ActiveSynth;
  chordSynthParams: ActiveSynth;
  bassSynthParams: ActiveSynth;
  padSynthParams: ActiveSynth;
  fxSynthParams: ActiveSynth;
  synthArpSettings: ArpSettings;
  chordArpSettings: ArpSettings;
  bassArpSettings: ArpSettings;
  padArpSettings: ArpSettings;
  fxArpSettings: ArpSettings;
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  /**
   * The custom chord lane's OWN cycle, in bars, and its holds. The renderer
   * resolves the lane's cycle from these — `src/audio/` may not reach back
   * into the store for them, so the snapshot carries them like any other loop
   * field.
   */
  customChordLoopLength: number;
  customChordHoldSteps: number[];
  chordFeel: number;
  chordOctave: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  /** The bass lane's own cycle. See `customChordLoopLength`. */
  customBassLoopLength: number;
  customBassHoldSteps: number[];
  bassFeel: number;
  bassOctave: number;
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  /**
   * The Beat instrument, per loop: the sound, the events and the mix.
   *
   * `beatParams` and `beatPattern` are the store's own shapes. `beatMix` is
   * too, and the renderer reads only its per-voice MUTE flags — the dB in it
   * is never read here, because the levels arrive already converted as
   * `beatVoiceGains` and the bus level arrives in `buses`. Two fields rather
   * than one because the mute is a SCHEDULING decision (`planBeatStep`
   * builds no voice for a muted row) while the level is an AudioParam.
   */
  beatParams: BeatParams;
  beatPattern: BeatPattern;
  beatMix: BeatMix;
  beatVoiceGains: MixdownBeatVoiceGain[];
  leadMelodySteps: LeadNote[][];
  leadLoopLength: number;
  leadStepResolution: LeadStepResolutionId;
  leadGate: number;
  fxMelodySteps: LeadNote[][];
  fxLoopLength: number;
  fxStepResolution: LeadStepResolutionId;
  fxGate: number;
  /** Per-loop source mixer, converted to linear gain by the store boundary. */
  buses: MixdownBusState[];
}

export interface MixdownSnapshot {
  bpm: number;
  meterId: MeterId;
  /** Resolved from `meterId` before it crosses the seam, so the renderer never parses a meter string. */
  stepsPerBar: number;
  /** Linear gain. */
  masterVolume: number;
  effects: MasterEffects;
  buses: MixdownBusState[];
  /**
   * There is no arrangement-wide Beat here, deliberately: a Beat belongs to a
   * LOOP, and a single snapshot-level kit is precisely the defect this
   * replaced — a song whose second loop used a different Beat exported the
   * first loop's sound over the whole arrangement.
   */
  loops: MixdownLoop[];
}

/**
 * The pad lane's snapshot for one loop — the offline twin of
 * `padPlanSnapshot` (src/store/playbackPlanSnapshots.ts). Both feed the same
 * `planPadArm`, so an export and a live session can only disagree about the pad
 * if these two builders disagree, which renderMixdown.test.ts pins directly.
 */
export function padSnapshotForLoop(
  loop: MixdownLoop,
  bpm: number,
  stepsPerBar: number,
): PadPlanSnapshot {
  return {
    mode: loop.padMode,
    chords: loop.chords,
    degree: loop.padDroneDegree,
    intervals: loop.padDroneIntervals,
    padOctave: loop.padOctave,
    voicing: loop.padVoicing,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    bpm,
    stepsPerBar,
  };
}

/**
 * The chord+bass ARM-time snapshot for one loop — the offline twin of
 * `chordPlanSnapshot` (src/store/playbackPlanSnapshots.ts).
 *
 * `src/audio/` may not reach into the store, so every field arrives on the
 * MixdownLoop; the names match the store's on purpose, so the two builders read
 * as the same list and an equivalence test is a deep-equality assertion.
 */
export function chordSnapshotForLoop(
  loop: MixdownLoop,
  meterId: MeterId,
  bpm: number,
  stepsPerBar: number,
): ChordPlanSnapshot {
  return {
    chords: loop.chords,
    bpm,
    meterId,
    stepsPerBar,
    chordOctave: loop.chordOctave,
    bassOctave: loop.bassOctave,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    chordRhythmMode: loop.chordRhythmMode,
    chordRhythmId: loop.chordRhythmId,
    customChordRhythm: loop.customChordRhythm,
    customChordHoldSteps: loop.customChordHoldSteps,
    customChordLoopLength: loop.customChordLoopLength,
    chordFeel: loop.chordFeel,
    bassPatternMode: loop.bassPatternMode,
    bassPatternId: loop.bassPatternId,
    customBassPattern: loop.customBassPattern,
    customBassHoldSteps: loop.customBassHoldSteps,
    customBassLoopLength: loop.customBassLoopLength,
    bassFeel: loop.bassFeel,
    chordArpActive: loop.chordArpSettings.active,
    bassArpActive: loop.bassArpSettings.active,
  };
}

/**
 * The Lead track's PLANNER-ONLY snapshot. The store spells the Lead row
 * irregularly (`synthParams`, not `leadSynthParams`) — exactly what
 * `MELODY_TRACKS` exists to encode on the live side, a table this module may
 * not import. The patch to play it with and the bus to play it on are
 * deliberately absent here: `songTrackVoice` is the one place that supplies
 * them.
 */
export function mixdownLeadTrack(loop: MixdownLoop): MelodyPlanSnapshot {
  return {
    steps: loop.leadMelodySteps,
    loopLength: loop.leadLoopLength,
    stepResolution: loop.leadStepResolution,
    gate: loop.leadGate,
    arp: loop.synthArpSettings,
  };
}

/** Same as `mixdownLeadTrack`, for FX. */
export function mixdownFxTrack(loop: MixdownLoop): MelodyPlanSnapshot {
  return {
    steps: loop.fxMelodySteps,
    loopLength: loop.fxLoopLength,
    stepResolution: loop.fxStepResolution,
    gate: loop.fxGate,
    arp: loop.fxArpSettings,
  };
}

/** The Beat lane's snapshot for one loop. R234 twin of the store's `beatPlanSnapshot`. */
export function beatSnapshotForLoop(loop: MixdownLoop): BeatPlanSnapshot {
  return { pattern: loop.beatPattern, mix: loop.beatMix };
}

/**
 * The patch and source bus a track's notes play on. The one place Lead's
 * irregular names (`synthParams`, bus `'synth'`) are spelled for the offline
 * path — the store's `MELODY_TRACKS` table encodes the same irregularity but
 * audio/ may not import the store.
 */
export function songTrackVoice(loop: MixdownLoop, track: SongTrack): { params: ActiveSynth; source: string } {
  switch (track) {
    case 'chord':
      return { params: loop.chordSynthParams, source: 'chord' };
    case 'bass':
      return { params: loop.bassSynthParams, source: 'bass' };
    case 'pad':
      return { params: loop.padSynthParams, source: 'pad' };
    case 'lead':
      return { params: loop.synthParams, source: 'synth' };
    case 'fx':
      return { params: loop.fxSynthParams, source: 'fx' };
  }
}
