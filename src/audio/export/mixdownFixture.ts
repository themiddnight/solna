/**
 * Builders for a minimal renderable song, shared by the renderer's own tests
 * and the store slice's.
 *
 * One bar, one chord, one loop, one kick: every assertion the renderer makes
 * (a non-silent buffer, an exact sample count, byte-identical repeat renders)
 * is easier to read against the smallest arrangement that produces sound than
 * against a five-loop fixture whose silent bar could be hiding the bug.
 */
import { synthParamsFixture } from '../testFakes';
import { DEFAULT_DRUM_KIT, DRUM_TYPES } from '@/data/drumKits';
import type { MasterEffects, SynthParams } from '@/types';
import type { MixdownLoop, MixdownSnapshot } from './renderMixdown';

/**
 * The six source buses, spelled out.
 *
 * `SOURCE_BUSES` (src/store/sourceBuses.ts) is the real roster, and the SLICE
 * iterates it — this module may not import it, because the eslint block
 * covering src/audio/** has no allowTypeImports exemption and this is a runtime
 * value. So the fixture states its own list, and `mixdownSlice.test.ts` asserts
 * the slice's output names exactly the SOURCE_BUSES roster. Keep the two in
 * step by hand; the test is what fails when they drift.
 */
const BUSES = ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer'] as const;

/** The kick row of a one-bar 4/4 grid: steps 0 and 8. */
const KICK_STEPS = Array.from({ length: 16 }, (_, i) => i === 0 || i === 8);

export function mixdownLoop(over: Partial<MixdownLoop> = {}): MixdownLoop {
  return {
    id: 'loop-1',
    repeatCount: 1,
    scaleRoot: 'C',
    scaleType: 'major',
    chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] }],
    chordSynthParams: synthFixture(),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: [],
    chordFeel: 0.5,
    chordOctave: 4,
    bassSynthParams: synthFixture(),
    bassPatternId: 'whole-note-root',
    bassPatternMode: 'preset',
    customBassPattern: [],
    bassFeel: 0.5,
    bassOctave: 2,
    padSynthParams: synthFixture(),
    padMode: 'drone',
    padOctave: 4,
    padVoicing: 'triad',
    padDroneDegree: 1,
    padDroneIntervals: [1, 5, 8],
    sequencerTracks: [
      {
        id: 'track-kick',
        name: 'Kick',
        instrument: 'kick',
        color: 'bg-drum-kick',
        volume: 0,
        muted: false,
        steps: KICK_STEPS,
      },
    ],
    synthParams: synthFixture(),
    fxSynthParams: synthFixture(),
    leadMelodySteps: [],
    leadLoopLength: 1,
    leadStepResolution: '1/16',
    leadGate: 0.85,
    fxMelodySteps: [],
    fxLoopLength: 1,
    fxStepResolution: '1/16',
    fxGate: 0.85,
    buses: BUSES.map((source) => ({ source, gain: 1, muted: false })),
    drumFilter: { cutoff: 20000, resonance: 0.7, type: 'lowpass' },
    ...over,
  };
}

export function mixdownSnapshot(over: Partial<MixdownSnapshot> = {}): MixdownSnapshot {
  return {
    bpm: 120,
    meterId: '4/4',
    stepsPerBar: 16,
    masterVolume: 1,
    effects: FACTORY_EFFECTS,
    buses: BUSES.map((source) => ({ source, gain: 1, muted: false })),
    drumTracks: DRUM_TYPES.map((instrument) => ({ instrument, gain: 1 })),
    drumKit: DEFAULT_DRUM_KIT,
    drumKitName: 'default',
    drumFilter: { cutoff: 20000, resonance: 0.7, type: 'lowpass' },
    sequencerParams: synthFixture(),
    loops: [mixdownLoop()],
    ...over,
  };
}

/**
 * A store-free effects object for the renderer's own tests.
 *
 * The values are NOT the store's `INITIAL_EFFECTS` — `reverbDecay` is pinned at
 * 1.5 so the render tail is a clean `max(2, 2.5) = 2.5 s`, which the renderer's
 * length assertions are written against. The dynamics fields below are the
 * store's factory numbers, required by `MasterEffects`' shape; the compressor
 * is disabled and the limiter's threshold only caps occasional peaks, so they
 * do not change what the fixture's single kick measures.
 */
export const FACTORY_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 1.5,
  delayWet: 0.2,
  delayFeedback: 0.3,
  distortionWet: 0,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compressorEnabled: false,
  compressorThreshold: -12,
  compressorRatio: 4,
  compressorAttack: 0.003,
  compressorRelease: 0.25,
  limiterEnabled: true,
  limiterThreshold: -3,
  limiterRatio: 20,
  limiterAttack: 0.003,
  limiterRelease: 0.15,
};

/** The store's `INITIAL_SYNTH_PARAMS`, mirrored — see testFakes' synthParamsFixture. */
function synthFixture(): SynthParams {
  return synthParamsFixture();
}
