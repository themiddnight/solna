import { BASS_PATTERNS, type BassStepChoice } from '@/data/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/timeSignature';
import {
  defaultFxState,
  defaultPadState,
  defaultTrackArp,
  defaultTrackSynth,
  INITIAL_CHORDS,
} from './initialState';
import { defaultBeatState } from './beatPresets';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import type { LoopContent } from './loop';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION, LEAD_TICKS_PER_BAR } from '../utils/stepResolution';

/**
 * The one place a per-loop default is written (S7). `createDefaultLoop` adds
 * slot identity to it; `store.ts` hands it to every slice factory that owns
 * per-loop fields. A leaf module on purpose: it imports no slice, so it can
 * never join the loopSlice/store cycle loopCopySlice.ts documents.
 * A factory, not a constant: every array and object is fresh per call.
 */
export function createDefaultLoopContent(): LoopContent {
  return {
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: defaultTrackSynth('synth'),
    chordSynthParams: defaultTrackSynth('chord'),
    bassSynthParams: defaultTrackSynth('bass'),
    synthArpSettings: defaultTrackArp('synth'),
    chordArpSettings: defaultTrackArp('chord'),
    bassArpSettings: defaultTrackArp('bass'),
    chords: INITIAL_CHORDS,
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    customChordLoopLength: 1,
    customChordHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
    chordFeel: 0.5,
    chordOctave: 4,
    bassPatternId: BASS_PATTERNS[0].id,
    bassPatternMode: 'preset',
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
    customBassLoopLength: 1,
    customBassHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
    bassFeel: 0.5,
    bassOctave: 2,
    ...defaultPadState(),
    ...defaultFxState(),
    leadMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
    leadGate: DEFAULT_LEAD_GATE,
    // A fresh deep copy per loop: two loops sharing one row object would
    // toggle together the first time a step was drawn.
    ...defaultBeatState(),
    // Decibels from here down: unity is 0 dB. The old 0.8 drum-bus default
    // was a -1.9 dB trim nobody chose; DEV-383 sets a measured one
    // (DEFAULT_BUS_TRIM_DB — see its comment in levelUnits.ts for the
    // measurement) on every source bus except padVolume, which comes through
    // defaultPadState() below instead.
    synthVolume: DEFAULT_BUS_TRIM_DB,
    synthMuted: false,
    chordVolume: DEFAULT_BUS_TRIM_DB,
    chordMuted: false,
    bassVolume: DEFAULT_BUS_TRIM_DB,
    bassMuted: false,
    // Per-track master sends, LINEAR 0..1 (DEV-423). The one place these
    // defaults are written: the sanitizer falls back to createDefaultLoop()
    // and the slice starts from `defaults`.
    trackSends: {
      synth: { reverb: 1, delay: 1, distortion: 1 },
      chord: { reverb: 1, delay: 1, distortion: 1 },
      bass: { reverb: 1, delay: 1, distortion: 1 },
      pad: { reverb: 1, delay: 1, distortion: 1 },
      fx: { reverb: 1, delay: 1, distortion: 1 },
      // Beat was dry into delay and distortion before DEV-423; reverb 1 keeps its
      // per-voice reverbSend path at exactly today's level.
      sequencer: { reverb: 1, delay: 0, distortion: 0 },
    },
  };
}
