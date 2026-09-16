import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import { createChordsSlice } from './chordsSlice';
import { createBassSlice } from './bassSlice';
import { customBassSpans, customChordSpans } from './loop';
import { BASS_PATTERNS, type BassStepChoice } from '@/data/bassPatterns';
import type { SynthPreset } from '../data/synthPresets';
import type { BeatVoiceId, CustomChordProgressionItem } from '../types';
import { faderDbToGain } from './levelUnits';
import {
  INITIAL_CHORDS,
  INITIAL_EFFECTS,
  TRACK_ARP_DEFAULTS,
} from './initialState';
import { TRACK_SYNTH_DEFAULTS } from '@/store/initialState';
import { SYNTH_ARP_FIELD, SYNTH_PARAM_FIELD, SYNTH_PARAM_TARGETS } from './sourceBuses';
import type { AppStore } from './types';
import { BEAT_PRESETS, BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '@/data/beatPresets';
import { buildProjectContent } from './projectFormat';
import type { BeatParams, BeatPatch } from '@/types';
import { getMeter, MAX_STEPS_PER_BAR, type MeterId } from '../utils/meter';

// ---------------------------------------------------------------------------
// Fake browser environment (bun has none of these globals). The store module
// is imported DYNAMICALLY so it evaluates after this setup, and its persist
// storage getter resolves localStorage lazily per call.
// ---------------------------------------------------------------------------

class FakeLocalStorage {
  private data = new Map<string, string>();

  getItem(name: string): string | null {
    return this.data.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.data.set(name, value);
  }

  removeItem(name: string): void {
    this.data.delete(name);
  }

  clear(): void {
    this.data.clear();
  }
}

const fakeLocalStorage = new FakeLocalStorage();

// Minimal WebAudio stand-ins so audioEngine.init() can run for real (same
// approach as src/audio/engine.test.ts): nodes are plain objects whose
// AudioParams accept value assignment.
function fakeNode() {
  return {
    type: '',
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
    gain: { value: 0 },
    frequency: { value: 0 },
    detune: { value: 0 },
    Q: { value: 0 },
    delayTime: { value: 0 },
  };
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};

  resume(): Promise<void> {
    return Promise.resolve();
  }

  createGain() {
    return fakeNode();
  }

  createAnalyser() {
    return { fftSize: 0, smoothingTimeConstant: 0, connect() {} };
  }

  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect() {},
    };
  }

  createBiquadFilter() {
    return fakeNode();
  }

  createDelay() {
    return fakeNode();
  }

  createWaveShaper() {
    return { curve: null, oversample: '', connect() {} };
  }

  createConvolver() {
    return { buffer: null, connect() {} };
  }

  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
}

// The store must not be imported statically: its persist middleware reads
// localStorage during creation, so the fake globals above must be installed
// first. bun caches the module, so every test shares one store instance.
let storeModule: Promise<typeof import('./store')> | null = null;

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, 'AudioContext', { value: FakeAudioContext, configurable: true });
  // bun test runs every test file in one shared process, so another file may
  // already have evaluated the store module before this fake existed (its
  // persist storage then resolved to bun's own storage). Re-evaluate the
  // module under a cache-busting query so this file's store instance binds to
  // the fake installed above.
  storeModule = import(`./store?bust=${Date.now()}`);
});

beforeEach(async () => {
  fakeLocalStorage.clear();
  // Reset the transient transport player states so tests are order-independent.
  const { useAppStore } = await getStore();
  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
});

afterEach(() => {
  fakeLocalStorage.clear();
});

function getStore(): Promise<typeof import('./store')> {
  storeModule ??= import('./store');
  return storeModule;
}

const getState = async (): Promise<AppStore> => (await getStore()).useAppStore.getState();

describe('store defaults', () => {
  test('match the original app initial values', async () => {
    const s = await getState();
    expect(s.bpm).toBe(120);
    expect(s.masterVolume).toBe(0); // DEFAULT_FADER_DB (unity 0 dB)
    expect(s.metronomeActive).toBe(false);
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.scaleRoot).toBe('A');
    expect(s.scaleType).toBe('Natural Minor');
    expect(s.selectedVibeId).toBe(null);
    expect(s.beatParams.basePresetId).toBe('retro-drive');
    expect(s.beatMix.levelDb).toBe(-6); // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
    expect(s.beatParams.filter).toEqual({ type: 'lowpass', cutoff: 12000, resonance: 0.7 });
    expect(s.chordRhythmId).toBe('sustained');
    expect(s.chordFeel).toBe(0.5);
    expect(s.chordOctave).toBe(4);
    expect(s.chordMuted).toBe(false);
    expect(s.chordVolume).toBe(-6); // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
    expect(s.bassPatternId).toBe(BASS_PATTERNS[0].id);
    expect(s.bassFeel).toBe(0.5);
    expect(s.bassOctave).toBe(2);
    expect(s.bassMuted).toBe(false);
    expect(s.bassVolume).toBe(-6); // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
    expect(s.focusTrack).toBe('synth');
    expect(s.activeTab).toBe('sound');
    expect(s.keyboardMode).toBe('scale-locked');
    // Every track starts at its OWN factory patch, and at its own Arp
    // settings beside it. Value equality, not identity: each default is a
    // fresh copy, so one loop editing a nested array can never reach the
    // shared table or another loop.
    for (const target of SYNTH_PARAM_TARGETS) {
      expect(s[SYNTH_PARAM_FIELD[target]]).toEqual(TRACK_SYNTH_DEFAULTS[target]);
      expect(s[SYNTH_PARAM_FIELD[target]]).not.toBe(TRACK_SYNTH_DEFAULTS[target]);
      expect(s[SYNTH_ARP_FIELD[target]]).toEqual(TRACK_ARP_DEFAULTS[target]);
    }
    // Arp is OFF everywhere by default: it is an opt-in performance mode, not
    // a sound, so no preset or factory default may arrive with it armed.
    for (const target of SYNTH_PARAM_TARGETS) {
      expect(s[SYNTH_ARP_FIELD[target]].active).toBe(false);
    }
    // And no patch carries an Arp field at all — Arp lives beside the sound.
    expect(s.synthParams.patch).not.toHaveProperty('arpActive');
    expect(s.chords).toEqual(INITIAL_CHORDS);
    expect(s.effects).toEqual(INITIAL_EFFECTS);
    expect(s.customSynthPresets).toEqual([]);
    expect(s.customChordProgressions).toEqual([]);
  });
});

describe('transport semantics', () => {
  // Engine side-effects (init/resetClock on the fully-stopped -> playing
  // transition) moved to engineSync's transport-flags subscription (see
  // engineSync.test.ts); these tests cover pure state transitions only.
  test('playAll starts both players from stopped, hardStopAll stops both when playing', async () => {
    const { useAppStore } = await getStore();

    useAppStore.getState().playAll();
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
    expect(useAppStore.getState().chordsPlayer).toBe('playing');

    useAppStore.getState().hardStopAll();
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
    expect(useAppStore.getState().chordsPlayer).toBe('stopped');
  });

  test('play/hardStop("sequencer"/"chords") address only their own player', async () => {
    const { useAppStore } = await getStore();

    useAppStore.getState().play('chords');
    expect(useAppStore.getState().chordsPlayer).toBe('playing');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');

    useAppStore.getState().play('sequencer');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
    expect(useAppStore.getState().chordsPlayer).toBe('playing');

    useAppStore.getState().hardStop('sequencer');
    useAppStore.getState().hardStop('chords');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');
    expect(useAppStore.getState().chordsPlayer).toBe('stopped');

    useAppStore.getState().play('sequencer');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
  });
});

describe('replaceBeatPattern, through the real store', () => {
  // The per-action unit coverage lives in beatSlice.test.ts against a harness.
  // What is here is what only the REAL store can show: the action reading the
  // live `meterId`, at a meter that is not the default.
  test('at 3/4 the clear stops at step 12, not at MAX_STEPS_PER_BAR', async () => {
    // Every other test of this action runs at 4/4, where the window (16) and
    // the visible half of the storage array coincide closely enough that a
    // clear path using MAX_STEPS_PER_BAR instead of stepsPerBar would stay
    // green. At 3/4 the window is 12 and steps 12-23 are the user's
    // programming for wider meters, so this is the meter at which that
    // substitution becomes visible. Without this test a change from
    // `stepsPerBar` to `MAX_STEPS_PER_BAR` in the clear path silently destroys
    // programming in every meter narrower than 12/8.
    const { useAppStore } = await getStore();
    useAppStore.getState().setMeter('3/4');
    expect(getMeter(useAppStore.getState().meterId).stepsPerBar).toBe(12);

    // Fill EVERY cell of every voice, so "cleared" and "preserved" are both
    // reads of a `true` that had to be acted on — no cell is incidentally
    // false, which the shipped starter groove would otherwise make several.
    const filled = { rows: {} as Record<BeatVoiceId, boolean[]> };
    for (const voice of BEAT_VOICE_IDS) {
      filled.rows[voice] = new Array<boolean>(MAX_STEPS_PER_BAR).fill(true);
    }
    useAppStore.setState({ beatPattern: filled });

    // Names the kick only: every other voice takes the clear path.
    useAppStore.getState().replaceBeatPattern({ kick: new Array(12).fill(false) });

    for (const voice of BEAT_VOICE_IDS) {
      const row = useAppStore.getState().beatPattern.rows[voice];
      expect(row.length, voice).toBe(MAX_STEPS_PER_BAR);
      expect(row.slice(0, 12), voice).toEqual(new Array(12).fill(false));
      // Steps 12-23 are outside the 3/4 window: untouched, still true.
      expect(row.slice(12), voice).toEqual(new Array(MAX_STEPS_PER_BAR - 12).fill(true));
    }

    useAppStore.getState().setMeter('4/4');
  });
});

describe('setChordOctave', () => {
  test('setChordOctave only writes chordOctave', async () => {
    const { useAppStore } = await getStore();
    const before = useAppStore.getState().chords;
    useAppStore.getState().setChordOctave(6);
    expect(useAppStore.getState().chordOctave).toBe(6);
    expect(useAppStore.getState().chords).toBe(before); // same reference: nothing else was touched
  });
});

describe('setKeyboardMode', () => {
  test('defaults to scale-locked and the setter updates it', async () => {
    const { useAppStore } = await getStore();
    expect(useAppStore.getState().keyboardMode).toBe('scale-locked');

    useAppStore.getState().setKeyboardMode('chromatic');
    expect(useAppStore.getState().keyboardMode).toBe('chromatic');

    useAppStore.getState().setKeyboardMode('chord');
    expect(useAppStore.getState().keyboardMode).toBe('chord');
  });
});

describe('chords initial state', () => {
  // Unit-test the slice factory directly: the shared singleton store is
  // mutated by earlier tests (e.g. setChordOctave(6)), so its live state
  // cannot be assumed pristine.
  test('initial chords are INITIAL_CHORDS verbatim (no per-loop derivation)', () => {
    const slice = createChordsSlice(
      (() => {}) as unknown as StoreApi<AppStore>['setState']
    );
    expect(slice.chords).toEqual(INITIAL_CHORDS);
  });

  // The "stored chords come back verbatim, never re-derived" case that used to
  // live here went through localStorage, which no longer carries content at
  // all. It is the SAME contract `applyProjectContent(buildProjectContent(s))`
  // states on the path content now takes, and `chords` is one of
  // LOOP_FLAT_KEYS — so projectFormat.test.ts's round-trip test ("installs
  // loops[0] into the flat per-loop keys in the same patch") is where it is
  // asserted now, at one site instead of two.
});

/** The allow-list `partializeAppState` must declare, key for key. */
const PERSISTED_KEYS = [
  'metronomeActive',
  'selectedVibeId',
  'focusTrack',
  'customSynthPresets',
  'customChordProgressions',
  // The user's Beat library: app-level beside the synth one, and deliberately
  // NOT project content — see PROJECT_CONTENT_KEYS.
  'customBeatPresets',
  'activeLoopId',
];

/**
 * Everything a persisted payload must NOT carry: session and view state,
 * `playing` state, actions, and (v6) the eight representative per-loop fields —
 * the split moved them into loops[], so they must be absent at the top level.
 */
const NON_PERSISTED_KEYS = [
  'bpm',
  'meterId',
  'masterVolume',
  'effects',
  'loops',
  'projectName',
  'projectStoreStatus',
  'projectNotice',
  'activeTab',
  'patternSegment',
  'controlTarget',
  'keyboardMode',
  'isInputPanelOpen',
  'inputPanelMode',
  'sequencerPlayer',
  'chordsPlayer',
  'playheadBeat',
  'playheadChordIndex',
  'playheadChordStartBeat',
  'setPlayheadBeat',
  'setPlayheadChord',
  'setBpm',
  'setMasterVolume',
  'toggleMetronome',
  'play',
  'softStop',
  'hardStop',
  'playAll',
  'softStopAll',
  'hardStopAll',
  'setSelectedVibeId',
  'setChordOctave',
  'replaceDrumPattern',
  'setEffects',
  'setActiveTab',
  'setKeyboardMode',
  'saveCustomPreset',
  'deleteCustomPreset',
  'saveCustomChordProgression',
  'deleteCustomChordProgression',
  'scaleRoot',
  'scaleType',
  'synthParams',
  'chordSynthParams',
  'bassSynthParams',
  'chords',
  'beatPattern',
  // A live top-level LeadSlice field with no partialize entry — the same
  // leak guard as `chords` above, and the mistake this list already made once
  // by swapping it for the custom-pattern keys instead of adding to them.
  'leadMelodySteps',
  // Its FX twin, live for the same reason and unpersisted for the same
  // reason: one melody lane carrying a guard and the other not is how the
  // first omission went unnoticed.
  'fxMelodySteps',
  'customChordRhythm',
  'customChordLoopLength',
  'customChordHoldSteps',
  'customBassPattern',
  'customBassLoopLength',
  'customBassHoldSteps',
];

describe('persist partialize', () => {
  test('hydration drops old project content and non-persisted keys before merging', async () => {
    const { useAppStore } = await getStore();
    const initial = useAppStore.getInitialState();
    const merge = useAppStore.persist.getOptions().merge!;
    const merged = merge({
      bpm: 'broken', loops: [{ id: 'stale' }], synthParams: null,
      projectName: 'Old project', loadProject: null, sequencerPlayer: 'playing',
      focusTrack: 'bass', activeLoopId: 'saved-loop', metronomeActive: true,
    }, initial);
    expect(merged.bpm).toBe(initial.bpm);
    expect(merged.loops).toBe(initial.loops);
    expect(merged.synthParams).toBe(initial.synthParams);
    expect(merged.projectName).toBe(initial.projectName);
    expect(merged.loadProject).toBe(initial.loadProject);
    expect(merged.sequencerPlayer).toBe(initial.sequencerPlayer);
    expect(merged.focusTrack).toBe('bass');
    expect(merged.activeLoopId).toBe('saved-loop');
    expect(merged.metronomeActive).toBe(true);
  });

  test('allow-list keeps every persisted field and no ui/playing/actions leak', async () => {
    const { useAppStore } = await getStore();
    const partialize = useAppStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    const snapshot = partialize!(useAppStore.getState());

    for (const key of PERSISTED_KEYS) {
      expect(snapshot).toHaveProperty(key);
    }

    for (const key of NON_PERSISTED_KEYS) {
      expect(snapshot).not.toHaveProperty(key);
    }

    // No function values of any kind survive the allow-list
    expect(Object.values(snapshot).every((v) => typeof v !== 'function')).toBe(true);
  });

  test('the content keys are not persisted at all — IndexedDB owns them now', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.setState({ bpm: 199, masterVolume: -3 });
    flushPersistedWrites();
    const stored = JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}');
    expect('bpm' in stored.state).toBe(false);
    expect('loops' in stored.state).toBe(false);
    expect('effects' in stored.state).toBe(false);
  });

  // The four custom pattern fields are per-loop CONTENT, like `chords`, so a
  // payload still carrying them — one written before loops moved to IndexedDB —
  // must not resurrect them through the merge. This is the persistence half of
  // the cross-boundary fixture: the lanes travel through the `.solna` body and
  // the IndexedDB slot record, and nowhere else.
  test('a stale payload carrying the custom pattern lanes is dropped whole', async () => {
    const { useAppStore } = await getStore();
    const initial = useAppStore.getInitialState();
    const merge = useAppStore.persist.getOptions().merge!;

    const chord = new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false);
    chord[0] = true;
    chord[MAX_STEPS_PER_BAR] = true;
    const bass = new Array<BassStepChoice>(4 * MAX_STEPS_PER_BAR).fill('rest');
    bass[3 * MAX_STEPS_PER_BAR] = 'seventh';

    const merged = merge(
      {
        loops: [{ id: 'loop-default-1', customChordRhythm: chord, customBassPattern: bass }],
        customChordRhythm: chord,
        customChordLoopLength: 2,
        customChordHoldSteps: new Array<number>(2 * MAX_STEPS_PER_BAR).fill(12),
        customBassPattern: bass,
        customBassLoopLength: 4,
        customBassHoldSteps: new Array<number>(4 * MAX_STEPS_PER_BAR).fill(12),
      },
      initial,
    );

    expect(merged.loops).toBe(initial.loops);
    expect(merged.customChordRhythm).toBe(initial.customChordRhythm);
    expect(merged.customChordLoopLength).toBe(initial.customChordLoopLength);
    expect(merged.customChordHoldSteps).toBe(initial.customChordHoldSteps);
    expect(merged.customBassPattern).toBe(initial.customBassPattern);
    expect(merged.customBassLoopLength).toBe(initial.customBassLoopLength);
    expect(merged.customBassHoldSteps).toBe(initial.customBassHoldSteps);
  });
});

/**
 * The user's Beat preset library: saved app-level, beside custom Synth presets,
 * and never inside a project.
 */
describe('the user Beat preset library', () => {
  const patchOf = (params: BeatParams): BeatPatch => ({
    outputTrimDb: params.outputTrimDb,
    filter: params.filter,
    voices: params.voices,
  });

  test('a saved preset carries the LIVE patch, is persisted, and is not project content', async () => {
    const { useAppStore, partializeAppState } = await getStore();
    // Edit first, and pass the live object rather than a clone: a save that
    // merely echoed its argument back would pass either way, so the value that
    // must come out is one only the live state has.
    useAppStore.getState().updateBeatVoice('kick', { decay: 0.31 });
    useAppStore.getState().updateBeatVoice('snare', { noiseDecay: 0.27 });
    const live = useAppStore.getState().beatParams;

    const saved = useAppStore.getState().saveCustomBeatPreset('My Beat', live);

    expect(saved.origin).toBe('user');
    expect(saved.name).toBe('My Beat');
    expect(saved.patch).toEqual(patchOf(live));
    expect(saved.patch.voices.kick.decay).toBe(0.31);
    expect(saved.patch.voices.snare.noiseDecay).toBe(0.27);
    // A COPY, not the live object: the library would otherwise be rewritten by
    // the next knob edit, exactly as saveCustomPreset clones its patch.
    expect(saved.patch.voices.kick).not.toBe(live.voices.kick);
    useAppStore.getState().updateBeatVoice('kick', { decay: 0.62 });
    expect(saved.patch.voices.kick.decay).toBe(0.31);
    expect(partializeAppState(useAppStore.getState()).customBeatPresets).toContainEqual(saved);
    expect(buildProjectContent(useAppStore.getState())).not.toHaveProperty('customBeatPresets');
    useAppStore.getState().deleteCustomBeatPreset(saved.id);
  });

  test('saving makes the new preset the base without changing the live sound', async () => {
    const { useAppStore } = await getStore();
    useAppStore.getState().updateBeatVoice('kick', { decay: 0.44 });
    const before = structuredClone(useAppStore.getState().beatParams);
    // A DIFFERENT patch as the argument, so "the live sound is untouched"
    // cannot pass by the argument happening to equal the live state: the saved
    // entry takes these values, and `beatParams` keeps its own.
    const other = structuredClone(before);
    other.voices.kick.decay = 0.19;
    other.filter.cutoff = 3000;

    const saved = useAppStore.getState().saveCustomBeatPreset('Quick Save', other);

    const after = useAppStore.getState().beatParams;
    expect(saved.patch.voices.kick.decay).toBe(0.19);
    expect(after.basePresetId).toBe(saved.id);
    expect(after.voices.kick.decay).toBe(0.44);
    expect(patchOf(after)).toEqual(patchOf(before));
    useAppStore.getState().deleteCustomBeatPreset(saved.id);
  });

  test('deleting returns the remaining library and leaves every loop patch alone', async () => {
    const { useAppStore } = await getStore();
    const keep = useAppStore.getState().saveCustomBeatPreset('Keep', useAppStore.getState().beatParams);
    const drop = useAppStore.getState().saveCustomBeatPreset('Drop', useAppStore.getState().beatParams);

    const loopsBefore = structuredClone(useAppStore.getState().loops.map((l) => l.beatParams));
    const paramsBefore = structuredClone(useAppStore.getState().beatParams);

    const remaining = useAppStore.getState().deleteCustomBeatPreset(drop.id);

    expect(remaining.map((p) => p.id)).not.toContain(drop.id);
    expect(remaining).toContainEqual(keep);
    expect(useAppStore.getState().customBeatPresets).toEqual(remaining);
    // The sound a loop was built on survives its source preset: a project
    // stores the complete patch, so deleting a preset is a library edit only.
    expect(useAppStore.getState().loops.map((l) => l.beatParams)).toEqual(loopsBefore);
    expect(useAppStore.getState().beatParams).toEqual(paramsBefore);
  });

  test('a persisted library is sanitized before it enters the store', async () => {
    const { useAppStore } = await getStore();
    const initial = useAppStore.getInitialState();
    const merge = useAppStore.persist.getOptions().merge!;
    const good = structuredClone(BEAT_PRESETS[1]);

    const merged = merge(
      {
        customBeatPresets: [
          // Kept, with the factory-only `reference` dropped and the patch read
          // field by field.
          { id: 'user-beat-1', name: 'Mine', origin: 'user', patch: good.patch },
          // Dropped whole: no id, no name, no patch at all.
          { name: 'No id', origin: 'user', patch: good.patch },
          { id: 'user-beat-2', name: '', origin: 'user', patch: good.patch },
          { id: 'user-beat-3', name: 'No patch', origin: 'user' },
          'not an object',
        ],
      },
      initial,
    );

    const library = (merged as AppStore).customBeatPresets;
    expect(library.map((p) => p.id)).toEqual(['user-beat-1']);
    expect(library[0]).toEqual({
      id: 'user-beat-1',
      name: 'Mine',
      origin: 'user',
      patch: good.patch,
    });
  });

  test('a stored entry with a broken field keeps the rest of its patch', async () => {
    const { useAppStore } = await getStore();
    const initial = useAppStore.getInitialState();
    const merge = useAppStore.persist.getOptions().merge!;
    // NOT the default preset: the per-field fallback IS the default preset's
    // value, so a source that already matched it could not fail this test.
    const source = structuredClone(BEAT_PRESETS[1]);
    const broken = structuredClone(source.patch);
    (broken.voices.kick as unknown as Record<string, unknown>).decay = 'loud';

    const merged = merge(
      { customBeatPresets: [{ id: 'user-beat-9', name: 'Half', origin: 'user', patch: broken }] },
      initial,
    );

    const [entry] = (merged as AppStore).customBeatPresets;
    // Per field, never per patch: one unreadable number falls back to the
    // default preset's value and its siblings survive.
    const fallback = BEAT_PRESETS.find((p) => p.id === DEFAULT_BEAT_PRESET_ID)!;
    expect(fallback.patch.voices.kick.decay).not.toBe(source.patch.voices.kick.decay);
    expect(entry.patch.voices.kick.decay).toBe(fallback.patch.voices.kick.decay);
    expect(entry.patch.voices.snare).toEqual(source.patch.voices.snare);
    expect(entry.patch.filter).toEqual(source.patch.filter);
  });
});

/**
 * A chord + bass slice pair over ONE mutable state object, driven at a meter
 * the test chooses.
 *
 * Built from the factories rather than the singleton for the same reason the
 * octave test below is: earlier tests mutate the shared store, and these lanes
 * have to be exercised in a NON-4/4 meter without disturbing the transport
 * state the rest of this file reads. `set` applies each updater to the
 * harness's own object, so both lanes resolve their bar length through
 * `getMeter(state.meterId)` exactly as they do in the composed store.
 */
function customPatternLanes(meterId: MeterId) {
  let state = {} as unknown as AppStore;
  const set = ((partial: unknown) => {
    const patch =
      typeof partial === 'function'
        ? (partial as (s: AppStore) => Partial<AppStore>)(state)
        : (partial as Partial<AppStore>);
    state = { ...state, ...patch } as unknown as AppStore;
  }) as StoreApi<AppStore>['setState'];

  const slice = { ...createChordsSlice(set), ...createBassSlice(set) };
  state = { ...slice, meterId } as unknown as AppStore;
  return { slice, state: () => state };
}

/**
 * The cross-boundary fixture's meter: a twelve-column bar. The lanes store
 * bar-major at `MAX_STEPS_PER_BAR`, so in this meter a visible column and its
 * stored slot are never the same number above bar one.
 */
const THREE_FOUR = 12; // `METERS['3/4'].stepsPerBar`

describe('the custom pattern lanes in a non-4/4 meter', () => {
  // 3/4 is a twelve-step bar; storage is bar-major at MAX_STEPS_PER_BAR (24),
  // so a column and its stored slot agree only in the widest meter.
  test('a write lands on the STORED slot while the lane reads back active-meter columns', () => {
    const lanes = customPatternLanes('3/4');
    lanes.slice.setCustomChordLoopLength(2);

    // Column 12 is bar two beat one of a 3/4 bar → stored slot 24.
    lanes.slice.setCustomChordEvent(12, true);
    lanes.slice.setCustomChordEventLength(12, 12);

    const s = lanes.state();
    expect(s.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(s.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
    expect(s.customChordRhythm[12]).toBe(false);
    expect(s.customChordHoldSteps[MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
    expect(s.customChordHoldSteps[12]).toBe(1);

    // The same lane is TWO bars wide to whoever plays it — 24 columns, not the
    // 48 stored slots — and the span the player reads is the stored one.
    const spans = customChordSpans(s);
    expect(spans.stepsPerBar).toBe(THREE_FOUR);
    expect(spans.cycleSteps).toBe(2 * THREE_FOUR);
    expect(spans.holds[MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
  });

  test('a span is capped by the folded chord boundary in the ACTIVE meter', () => {
    const lanes = customPatternLanes('3/4');
    lanes.slice.setCustomChordLoopLength(2);
    lanes.slice.setCustomChordEvent(0, true);

    // Four one-bar chords fold a boundary onto column 12 of a two-bar 3/4
    // cycle, so two whole bars is twelve columns, not twenty-four steps.
    lanes.slice.setCustomChordEventLength(0, 24);

    const s = lanes.state();
    expect(s.customChordHoldSteps[0]).toBe(THREE_FOUR);
    // The span stops short of the next bar's onset rather than swallowing it.
    expect(s.customChordRhythm[0]).toBe(true);
  });

  test('each lane’s cycle is its own divisor of the progression', () => {
    const lanes = customPatternLanes('3/4');
    lanes.slice.setCustomChordLoopLength(2);
    lanes.slice.setCustomBassLoopLength(4);

    const s = lanes.state();
    expect(s.customChordLoopLength).toBe(2);
    expect(s.customBassLoopLength).toBe(4);
    expect(s.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(s.customBassPattern).toHaveLength(4 * MAX_STEPS_PER_BAR);
    expect(customBassSpans(s).cycleSteps).toBe(4 * THREE_FOUR);

    // The bass lane's four bars do not move when the chord lane is resized.
    lanes.slice.setCustomChordLoopLength(4);
    expect(lanes.state().customBassLoopLength).toBe(4);

    // A length the progression cannot divide repeats unevenly, so it lowers to
    // the largest divisor at or below it: 3 bars over four one-bar chords → 2.
    lanes.slice.setCustomChordLoopLength(3);
    expect(lanes.state().customChordLoopLength).toBe(2);
  });

  test('the bass lane writes stored slots too, and keeps its own holds', () => {
    const lanes = customPatternLanes('3/4');
    lanes.slice.setCustomBassLoopLength(4);

    lanes.slice.setCustomBassEvent(12, 'fifth');
    lanes.slice.setCustomBassEventLength(12, THREE_FOUR);

    const s = lanes.state();
    expect(s.customBassPattern[MAX_STEPS_PER_BAR]).toBe('fifth');
    expect(s.customBassPattern[12]).toBe('rest');
    expect(s.customBassHoldSteps[MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
  });
});

describe('focusTrack', () => {
  test('starts on synth — Lead, the track a new loop is most likely opened for', async () => {
    const { useAppStore } = await getStore();
    expect(useAppStore.getState().focusTrack).toBe('synth');
  });

  test('the setter moves it and nothing else', async () => {
    const { useAppStore } = await getStore();
    useAppStore.getState().setFocusTrack('drum');
    expect(useAppStore.getState().focusTrack).toBe('drum');
    expect(useAppStore.getState().activeTab).toBe('sound');
    useAppStore.getState().setFocusTrack('synth');
  });
});

describe('focusTrack persistence', () => {
  /**
   * `controlTarget` was persisted with NO sanitize clause at all — nothing
   * validated it on read, and `resolveSynthControlChannel`'s trailing
   * `?? channels.synth` was standing in for the validation. That fallback
   * becomes a trap once the roster includes 'drum', so the clause below is
   * written from nothing; there is no old clause to rename.
   */
  test('sanitize maps a missing, non-string or out-of-roster focusTrack to synth', async () => {
    const { sanitizePersistedState } = await getStore();
    expect(sanitizePersistedState({}).focusTrack).toBe('synth');
    expect(sanitizePersistedState({ focusTrack: 7 }).focusTrack).toBe('synth');
    expect(sanitizePersistedState({ focusTrack: 'lead' }).focusTrack).toBe('synth');
    expect(sanitizePersistedState({ focusTrack: null }).focusTrack).toBe('synth');
  });

  test('sanitize leaves a valid focusTrack untouched, including drum', async () => {
    const { sanitizePersistedState } = await getStore();
    expect(sanitizePersistedState({ focusTrack: 'fx' }).focusTrack).toBe('fx');
    expect(sanitizePersistedState({ focusTrack: 'drum' }).focusTrack).toBe('drum');
  });

  /**
   * The old keys are simply ignored — not read, not translated, not carried
   * forward (CLAUDE.md: no migration chains). A user who had FX selected on
   * Sound reopens on Lead; that is one click.
   */
  test('an old payload carrying only controlTarget/patternSegment still resolves focusTrack to synth', async () => {
    const { sanitizePersistedState } = await getStore();
    const out = sanitizePersistedState({ controlTarget: 'bass', patternSegment: 'beat' });
    expect(out.focusTrack).toBe('synth');
  });
});

describe('legacy preset migration', () => {
  test('hydrate adopts the legacy localStorage presets and removeLegacyKeys cleans them up', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();

    // One adoptable entry (the complete engine-discriminated shape) and one
    // pre-cutover flat body. Both come in through the legacy key; only the
    // first survives `sanitizeCustomSynthPresets`, because a flat body is not
    // an old version of a patch, it is an invalid one.
    const legacySynthPresets: SynthPreset[] = [
      {
        id: 'user-1',
        name: 'My Lead',
        category: 'Lead',
        engine: 'subtractive',
        patch: TRACK_SYNTH_DEFAULTS.synth.patch,
        tags: [],
        isFactory: false,
        createdAt: 1000,
        description: 'Custom user preset',
      },
    ];
    const flatLegacyPreset = {
      id: 'user-flat',
      name: 'Pre-Cutover Lead',
      category: 'Lead',
      isFactory: false,
      createdAt: 900,
      description: 'Custom user preset',
      params: { detune: 12, oscType: 'sawtooth' },
    };
    const legacyChordProgressions: CustomChordProgressionItem[] = [
      {
        id: 'chord-prog-1',
        name: 'My Progression',
        category: 'User',
        description: '',
        roman: 'i - iv',
        chords: [{ id: 'c1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] }],
        createdAt: 2000,
      },
    ];

    fakeLocalStorage.setItem(
      'murva_synth_custom_presets_v1',
      JSON.stringify([...legacySynthPresets, flatLegacyPreset]),
    );
    fakeLocalStorage.setItem('murva_chord_custom_progressions_v1', JSON.stringify(legacyChordProgressions));

    // Start from a fresh persisted project state so this exercises the
    // "no persisted data yet" hydrate path (merge + legacy adoption).
    useAppStore.persist.clearStorage();
    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().customSynthPresets).toEqual(legacySynthPresets);
    expect(useAppStore.getState().customSynthPresets.map((p) => p.id)).not.toContain('user-flat');
    expect(useAppStore.getState().customChordProgressions).toEqual(legacyChordProgressions);

    // Legacy keys are removed only after the merged state was written back
    expect(fakeLocalStorage.getItem('murva_synth_custom_presets_v1')).toBeNull();
    expect(fakeLocalStorage.getItem('murva_chord_custom_progressions_v1')).toBeNull();
    // And the new persist key now owns the presets
    flushPersistedWrites();
    expect(fakeLocalStorage.getItem('musibox_project_state_v1')).not.toBeNull();
  });

  test('already-persisted presets win over legacy keys (merge only when empty)', async () => {
    const { useAppStore } = await getStore();

    // Write a real preset into the persisted project state first
    useAppStore.getState().saveCustomPreset('Persisted Pad', TRACK_SYNTH_DEFAULTS.pad, 'Pad');
    const savedId = useAppStore.getState().customSynthPresets[0].id;
    expect(savedId).toBeTruthy();

    fakeLocalStorage.setItem('murva_synth_custom_presets_v1', JSON.stringify([
      { id: 'legacy-1', name: 'Legacy Lead', category: 'Lead', isFactory: false, createdAt: 2, params: {} },
    ]));

    await useAppStore.persist.rehydrate();
    const ids = useAppStore.getState().customSynthPresets.map((p) => p.id);
    expect(ids).toContain(savedId);
    expect(ids).not.toContain('legacy-1');
    expect(fakeLocalStorage.getItem('murva_synth_custom_presets_v1')).toBeNull();
  });
});

describe('applyEngineSnapshot', () => {
  test('pushes the persisted masterVolume and effects into the engine (post-init re-apply)', async () => {
    // bun's spyOn calls through to the original by default, and the engine is
    // already initialized by earlier tests, so suppress the real setters.
    const setMasterVolume = spyOn(audioEngine, 'setMasterVolume').mockImplementation(() => {});
    const updateEffects = spyOn(audioEngine, 'updateEffects').mockImplementation(() => {});

    // engineSync imports the canonical (non-bust) store module, so the
    // snapshot must be driven through that same instance.
    const canonicalStore = (await import('./store')).useAppStore;
    const snapshotEffects = { ...INITIAL_EFFECTS, reverbWet: 0.8 };
    canonicalStore.setState({ masterVolume: 0.2, effects: snapshotEffects });

    const { applyEngineSnapshot } = await import('./engineSync');
    applyEngineSnapshot();

    // 0.2 is now DECIBELS. The snapshot pushes a linear gain, so the
    // expectation has to convert — comparing 0.2 against 0.2 here would be
    // asserting that the unit change did not happen.
    expect(setMasterVolume).toHaveBeenCalledWith(faderDbToGain(0.2));
    expect(updateEffects).toHaveBeenCalledWith(snapshotEffects);
  });
});

describe('flushBeforeHide', () => {
  test('flushes the pending autosave write and the buffered persist write', async () => {
    const { useAppStore, flushBeforeHide, projectAutosave } = await getStore();
    // Armed by hand: `bootProject()` is what arms it in the app, and this file
    // never boots (boot would open the project slot, which bun has no
    // IndexedDB for). Arming is the state flushBeforeHide's first branch needs.
    projectAutosave.arm();
    const saves: string[] = [];
    useAppStore.setState({ save: async () => { saves.push('save'); return { ok: true, value: null } as never; } });
    useAppStore.setState({ bpm: 133 });
    expect(projectAutosave.isScheduled()).toBe(true);
    flushBeforeHide();
    expect(saves).toEqual(['save']);
    expect(projectAutosave.isScheduled()).toBe(false);
    expect(fakeLocalStorage.getItem('musibox_project_state_v1')).not.toBeNull();
  });

  test('a hide with nothing pending writes nothing', async () => {
    const { useAppStore, flushBeforeHide, projectAutosave } = await getStore();
    projectAutosave.arm();
    const saves: string[] = [];
    useAppStore.setState({ save: async () => { saves.push('save'); return { ok: true, value: null } as never; } });
    flushBeforeHide();
    expect(saves).toEqual([]);
    expect(projectAutosave.isScheduled()).toBe(false);
  });
});

describe('the merged navigation state', () => {
  /**
   * `controlTarget` and `patternSegment` are gone from the store, not renamed
   * around. A field that still exists but nothing reads is the shape this
   * change exists to delete, and it would go on being written by every old
   * call site with nothing failing.
   */
  test('neither controlTarget nor patternSegment is a field any more', async () => {
    const { useAppStore } = await getStore();
    const s = useAppStore.getState() as unknown as Record<string, unknown>;
    expect('controlTarget' in s).toBe(false);
    expect('patternSegment' in s).toBe(false);
    expect('setControlTarget' in s).toBe(false);
    expect('setPatternSegment' in s).toBe(false);
  });
});
