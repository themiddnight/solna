/**
 * Builders for a minimal renderable song, shared by the renderer's own tests
 * and the store slice's.
 *
 * One bar, one chord, one loop, one kick: every assertion the renderer makes
 * (a non-silent buffer, an exact sample count, byte-identical repeat renders)
 * is easier to read against the smallest arrangement that produces sound than
 * against a five-loop fixture whose silent bar could be hiding the bug.
 */
import { BEAT_PRESETS, BEAT_VOICE_IDS } from '@/data/beatPresets';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import { LEAD_TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from '@/utils/stepResolution';
import type { BeatMix, BeatParams, BeatPattern, BeatVoiceId, BeatVoiceMix, MasterEffects } from '@/types';
import type { ActiveSynth, ArpSettings } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import type { MixdownLoop, MixdownSnapshot } from '../playback/plan/songSnapshot';

/**
 * The six source buses, spelled out.
 *
 * `SOURCE_BUSES` (src/store/sourceBuses.ts) is the real roster, and the SLICE
 * iterates it — this module may not import it, because the eslint block
 * covering src/audio/** has no allowTypeImports exemption and this is a runtime
 * value. So the fixture states its own list, and `mixdownSnapshot.test.ts` asserts
 * the snapshot's output names exactly the SOURCE_BUSES roster. Keep the two in
 * step by hand; the test is what fails when they drift.
 */
const BUSES = ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer'] as const;

/**
 * One bar of a melody track holding a single note at tick 0, four 16ths long.
 *
 * Bar-major at `LEAD_TICKS_PER_BAR`, the stored coordinate space — NOT the
 * active resolution — because that is what the two melody columns hold; the
 * renderer strides into it. A fixture that indexed by 16th would put the note
 * at the wrong tick the moment a test changed `leadStepResolution`.
 *
 * Both melody tracks default to EMPTY above, and this is opt-in, because most
 * of the renderer's assertions are about the chord/bass/drum material and a
 * lead note sounding over all of them is energy in every window they measure.
 */
export function mixdownMelodyBar(note: string): { note: string; len: number }[][] {
  const bar: { note: string; len: number }[][] = Array.from(
    { length: LEAD_TICKS_PER_BAR },
    () => [],
  );
  bar[0] = [{ note, len: 4 * TICKS_PER_SIXTEENTH }];
  return bar;
}

/** The kick row of a one-bar 4/4 grid: steps 0 and 8. */
const KICK_STEPS = Array.from({ length: 16 }, (_, i) => i === 0 || i === 8);

/**
 * A complete factory Beat patch with the provenance a loop's params carry.
 * Built from the catalogue rather than hand-written: every voice must be
 * complete, and a fixture that stated its own eleven voices would be a second
 * roster to keep in step.
 */
export function beatParamsFixture(over: Partial<BeatParams> = {}): BeatParams {
  const preset = BEAT_PRESETS[0];
  return structuredClone({ basePresetId: preset.id, ...preset.patch, ...over });
}

/** Silent rows at the stored width, with the kick playing the fixture's bar. */
export function beatPatternFixture(): BeatPattern {
  const rows = {} as Record<BeatVoiceId, boolean[]>;
  for (const voice of BEAT_VOICE_IDS) {
    rows[voice] = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
  }
  rows.kick = [...KICK_STEPS, ...new Array<boolean>(MAX_STEPS_PER_BAR - KICK_STEPS.length).fill(false)];
  return { rows };
}

/** Unity faders, nothing muted — the mix a fixture's loudness assertions assume. */
export function beatMixFixture(over: Partial<BeatMix> = {}): BeatMix {
  const voices = {} as Record<BeatVoiceId, BeatVoiceMix>;
  for (const voice of BEAT_VOICE_IDS) voices[voice] = { levelDb: 0, muted: false };
  return { levelDb: 0, muted: false, voices, ...over };
}

export function mixdownLoop(over: Partial<MixdownLoop> = {}): MixdownLoop {
  return {
    id: 'loop-1',
    repeatCount: 1,
    scaleRoot: 'C',
    scaleType: 'major',
    chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 1 }],
    chordSynthParams: synthFixture(),
    chordArpSettings: arpFixture(),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: [],
    // One bar of the widest-meter row: the store's own default, so a preset
    // loop's cycle resolves to `stepsPerBar` exactly as it does live.
    customChordLoopLength: 1,
    customChordHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
    chordFeel: 0.5,
    chordOctave: 4,
    bassSynthParams: synthFixture(),
    bassArpSettings: arpFixture(),
    bassPatternId: 'whole-note-root',
    bassPatternMode: 'preset',
    customBassPattern: [],
    customBassLoopLength: 1,
    customBassHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
    bassFeel: 0.5,
    bassOctave: 2,
    padSynthParams: synthFixture(),
    padArpSettings: arpFixture(),
    padMode: 'drone',
    padOctave: 4,
    padVoicing: 'triad',
    padDroneDegree: 1,
    padDroneIntervals: [1, 5, 8],
    beatParams: beatParamsFixture(),
    beatPattern: beatPatternFixture(),
    beatMix: beatMixFixture(),
    beatVoiceGains: BEAT_VOICE_IDS.map((voice) => ({ voice, gain: 1 })),
    synthParams: synthFixture(),
    fxSynthParams: synthFixture(),
    synthArpSettings: arpFixture(),
    fxArpSettings: arpFixture(),
    leadMelodySteps: [],
    leadLoopLength: 1,
    leadStepResolution: '1/16',
    leadGate: 0.85,
    fxMelodySteps: [],
    fxLoopLength: 1,
    fxStepResolution: '1/16',
    fxGate: 0.85,
    buses: BUSES.map((source) => ({ source, gain: 1, muted: false })),
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

/**
 * The factory patch, one fresh copy per call.
 *
 * A COPY, for the same reason `defaultTrackSynth` clones: a fixture loop holds
 * five patches, and a test that edited one shared object would change the
 * snapshot every other test in the file builds.
 */
function synthFixture(): ActiveSynth {
  return structuredClone(SUBTRACTIVE_INIT);
}

/** Arp off — a fixture renders what is written, never an arpeggio over it. */
function arpFixture(): ArpSettings {
  return { active: false, mode: 'up', rate: '16n', octaves: 1 };
}
