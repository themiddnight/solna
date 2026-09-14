import type { SequencerTrack, ChordItem, MasterEffects } from '../types';
import type { ArpSettings } from '@/types/synth';
import type { SynthControlTarget } from '@/utils/synthControl';
import type { ActiveSynth } from '@/types/synth';
import { resolveFactorySynth } from '@/utils/synthPresets';
import type { PadState, FxState } from './types';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { DEFAULT_BUS_TRIM_DB, DEFAULT_FADER_DB } from './levelUnits';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION, LEAD_TICKS_PER_BAR } from '../utils/stepResolution';

/**
 * The factory preset each synth-capable track starts from, by id.
 *
 * Keyed by `SynthControlTarget`, so a sixth bus is a compile error here rather
 * than a track silently inheriting the init patch. Resolved by ID and never by
 * index: these were `FACTORY_BASS_PRESETS[0]` once, and when the arrays merged
 * index 0 became a lead patch and both bass defaults silently turned into
 * leads, with the test agreeing because it asserted the same index expression.
 * `synthPresets.test.ts` pins that each id resolves and that its category fits
 * the track.
 *
 * The neutral init patch is NOT in this table and is not re-exported from
 * here: no track starts there, and it belongs to the library rather than to
 * new-project policy. It is `SUBTRACTIVE_INIT` in `utils/synthPresets.ts`, and
 * it lives there rather than here because `src/audio/` may not import
 * `src/store/` and the engine's own fixtures need it.
 */
export const TRACK_SYNTH_PRESET_IDS: Record<SynthControlTarget, string> = {
  synth: 'factory-cosmic-lead',
  // The DOWN-SWEEP, not the noise riser, and the difference is the attack. A
  // riser's envelope is 1.8 s of attack: a short FX note on a brand-new
  // project would stop about 19 dB below the patch's own peak, so the first
  // thing a new user hears from this track is almost nothing. The down-sweep
  // has zero attack and speaks on the first sample, which is what the FX
  // track's pre-cutover default did too. The riser is one card away in the
  // library for anyone who wants it.
  fx: 'factory-fx-down-sweep',
  chord: 'factory-mellow-epiano',
  bass: 'bass-deep-sine',
  pad: 'factory-warm-polypad',
};

/** Explicit, role-appropriate complete patches for all five synth-capable tracks. */
export const TRACK_SYNTH_DEFAULTS: Record<SynthControlTarget, ActiveSynth<'subtractive'>> = {
  synth: resolveFactorySynth(TRACK_SYNTH_PRESET_IDS.synth),
  fx: resolveFactorySynth(TRACK_SYNTH_PRESET_IDS.fx),
  chord: resolveFactorySynth(TRACK_SYNTH_PRESET_IDS.chord),
  bass: resolveFactorySynth(TRACK_SYNTH_PRESET_IDS.bass),
  pad: resolveFactorySynth(TRACK_SYNTH_PRESET_IDS.pad),
};

/**
 * Arp is performance state, not patch state (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "Domain model" — "Arp is a separate performance-layer object"), so it lives
 * beside the patch defaults rather than inside a preset. Every track starts
 * silent — Arp is an opt-in performance mode, not a default sound.
 */
export const TRACK_ARP_DEFAULTS: Record<SynthControlTarget, ArpSettings> = {
  synth: { active: false, mode: 'up', rate: '16n', octaves: 1 },
  fx: { active: false, mode: 'up', rate: '16n', octaves: 1 },
  chord: { active: false, mode: 'up', rate: '16n', octaves: 1 },
  bass: { active: false, mode: 'up', rate: '16n', octaves: 1 },
  pad: { active: false, mode: 'up', rate: '16n', octaves: 1 },
};

/**
 * A fresh copy of one track's factory patch, and of its Arp settings.
 *
 * COPIES, not the shared literals. A patch holds arrays (`oscillators`,
 * `env2Routes`) and a loop holds five patches, so handing every loop the same
 * object would let one in-place write — a splice into `env2Routes`, a sort —
 * reach every loop and every future default at once. The same reason
 * `defaultPadState` is a factory rather than a constant.
 */
export function defaultTrackSynth(target: SynthControlTarget): ActiveSynth {
  return structuredClone(TRACK_SYNTH_DEFAULTS[target]);
}

export function defaultTrackArp(target: SynthControlTarget): ArpSettings {
  return structuredClone(TRACK_ARP_DEFAULTS[target]);
}

/**
 * One empty bar at the widest storable width. Spread at each use site, never
 * shared: two tracks holding the same array would toggle together.
 */
const SILENT_BAR: boolean[] = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);

export const INITIAL_SEQUENCER_TRACKS: SequencerTrack[] = [
  // Every track starts at unity. Until DEV-386 these were 0.7 .. 0.9 LINEAR and
  // nothing read them; the field is a real gain node now, so unity is what keeps
  // a factory kit sounding the way it always has.
  {
    id: 'track-kick',
    name: 'Kick 808',
    instrument: 'kick',
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-kick',
  },
  {
    id: 'track-snare',
    name: 'Snare Snap',
    instrument: 'snare',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-snare',
  },
  {
    id: 'track-rimshot',
    name: 'Rim Shot',
    instrument: 'rimshot',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-rimshot',
  },
  {
    id: 'track-clap',
    name: 'Hand Clap',
    instrument: 'clap',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-clap',
  },
  {
    id: 'track-hihat',
    name: 'Closed Hat',
    instrument: 'hihat',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-hihat',
  },
  {
    id: 'track-openhat',
    name: 'Open Hat',
    instrument: 'openhat',
    steps: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-openhat',
  },
  {
    id: 'track-hitom',
    name: 'Hi Tom',
    instrument: 'hitom',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-hitom',
  },
  {
    id: 'track-lowtom',
    name: 'Low Tom',
    instrument: 'lowtom',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-lowtom',
  },
  {
    id: 'track-ride',
    name: 'Ride',
    instrument: 'ride',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-ride',
  },
  {
    id: 'track-crash',
    name: 'Crash',
    instrument: 'crash',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-crash',
  },
  {
    id: 'track-bell',
    name: 'Bell',
    instrument: 'bell',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-bell',
  },
];

export const INITIAL_CHORDS: ChordItem[] = [
  { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
  { id: 'chord-2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
  { id: 'chord-3', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] },
  { id: 'chord-4', root: 'G', quality: '7', bars: 1, notes: ['G3', 'B3', 'D4', 'F4'] },
];

// The ONLY source of truth for the audible effect defaults. setupMasterChain()
// seeds every wet send and EQ gain at zero; these values reach the graph via
// applyEngineSnapshot() on the first user click and are clamped through
// audio/effectLimits.ts on the way in.
//
// NOTE: reverbDecay (2.0) deliberately equals the engine's setupMasterChain
// hardcode so the default sound is unchanged now that the knob is live.
//
// The eight NUMERIC dynamics values equal the engine's historical hardcodes
// for a different reason: they are never heard until a module is switched
// on, so these numbers are what "on" has always meant, not what a fresh
// project sounds like. `compressorEnabled` stays `false` (DEV-385): a
// user must opt into compression shaping the mix.
//
// `limiterEnabled` defaults to `true`, reversing DEV-385's off-by-default
// for this one stage. DEV-385's reason for defaulting both off was honest
// metering — an always-on limiter caps the signal near -3 dBFS, so a meter
// behind it could never show what the user actually made. That reason does
// not hold for the limiter here: the master analysers
// (`rewireMasterDynamics` in audio/engine.ts) are observe-only sends off
// masterGain, wired BEFORE both dynamics stages, so the meter reads the
// pre-limiter mix and the `over` zone stays reachable whether the limiter
// is engaged or not.
// The second reason this is safe: the five source buses default to -6 dB,
// calibrated so a fresh project peaks around -2.75 dBFS. The limiter's
// -3 dB threshold therefore only catches occasional peaks at those
// defaults rather than compressing continuously — a limiter that engaged
// on every dense groove would be the hidden mix-bus compressor DEV-385
// removed. Raise the bus defaults later and re-check this still holds.
export const INITIAL_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 2.0,
  delayWet: 0.2,
  delayFeedback: 0.35,
  distortionWet: 0.1,
  eqLow: 2,
  eqMid: 0,
  eqHigh: 3,
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
 * Every pad key with its NEW-project value. Both migration chains call this
 * and then override `padMuted` to `true`, because a project saved before the
 * pad existed must reopen sounding the way it sounded when it was closed.
 *
 * Do NOT collapse that override into these defaults. Doing so gives every
 * pre-existing project a voice its author never wrote, and nothing in the UI
 * or the build would show it — three tests pin the distinction (see
 * initialState.test.ts, migrate.test.ts and projectFormat.test.ts).
 *
 * A factory, not a constant: `padDroneIntervals` is an array, and a shared one
 * seeded into the live store would let a single in-place sort or push poison
 * every default.
 */
export function defaultPadState(): PadState {
  return {
    padSynthParams: defaultTrackSynth('pad'),
    padArpSettings: defaultTrackArp('pad'),
    padMode: 'pad',
    padOctave: 3,
    padVoicing: 'triad',
    padDroneDegree: 0,
    padDroneIntervals: [1, 5, 8],
    padVolume: DEFAULT_BUS_TRIM_DB,
    padMuted: false,
  };
}

/**
 * The FX track's factory state. A function, not a frozen constant, because
 * `fxMelodySteps` is a fresh array per loop — a shared one would make two loops
 * the same melody the first time a note was drawn.
 *
 * `fxVolume` is DEFAULT_BUS_TRIM_DB, the measured headroom trim every source bus
 * takes (DEV-383), and `fxMuted` is false: a track that has to be unmuted before
 * it can make a sound reads as broken rather than as quiet.
 */
export function defaultFxState(): FxState {
  return {
    fxMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
    fxLoopLength: 1,
    fxStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
    fxMelodyView: 'scale-locked',
    fxMelodyOctave: 3,
    fxGate: DEFAULT_LEAD_GATE,
    ...defaultFxBusState(),
  };
}

/**
 * The FX track's patch and fader, split out because they are declared in TWO
 * places: here, for a new loop's content, and in `createFxSlice`, which owns
 * them for the session (they have no legacy synth slice to inherit from the
 * way lead's `synthVolume`/`synthParams` do). Stated once, so a changed
 * default cannot give a new SESSION and a new LOOP different FX state — the
 * `padVolume` failure `PROJECT_DB_LEVEL_KEYS` records, in advance.
 */
export function defaultFxBusState(): Pick<FxState, 'fxSynthParams' | 'fxArpSettings' | 'fxVolume' | 'fxMuted'> {
  return {
    fxSynthParams: defaultTrackSynth('fx'),
    fxArpSettings: defaultTrackArp('fx'),
    fxVolume: DEFAULT_BUS_TRIM_DB,
    fxMuted: false,
  };
}
