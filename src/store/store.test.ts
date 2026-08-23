import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import { createChordsSlice } from './chordsSlice';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { deriveChordNotes } from '../utils/musicTheory';
import type { SynthPresetItem } from '../audio/synthPresets';
import type { CustomChordProgressionItem } from '../types';
import {
  INITIAL_CHORDS,
  INITIAL_EFFECTS,
  INITIAL_SEQUENCER_TRACKS,
  INITIAL_SYNTH_PARAMS,
} from './initialState';
import type { AppStore } from './types';

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

  createBuffer(_channels: number, length: number, _sampleRate: number) {
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
  // Reset the transient transport flags so tests are order-independent.
  const { useAppStore } = await getStore();
  useAppStore.setState({ isSequencerPlaying: false, isChordsPlaying: false });
});

afterEach(() => {
  fakeLocalStorage.clear();
});

function getStore(): Promise<typeof import('./store')> {
  storeModule ??= import('./store');
  return storeModule;
}

// bun's spyOn keeps ONE mock per method and accumulates call counts across
// tests — clear the count right after creating each spy.
function freshResetClockSpy() {
  return spyOn(audioEngine, 'resetClock').mockClear();
}

const getState = async (): Promise<AppStore> => (await getStore()).useAppStore.getState();

describe('store defaults', () => {
  test('match the original app initial values', async () => {
    const s = await getState();
    expect(s.bpm).toBe(120);
    expect(s.masterVolume).toBe(0.85);
    expect(s.metronomeActive).toBe(false);
    expect(s.isSequencerPlaying).toBe(false);
    expect(s.isChordsPlaying).toBe(false);
    expect(s.scaleRoot).toBe('A');
    expect(s.scaleType).toBe('Natural Minor');
    expect(s.projectTitle).toBe('Cosmic Horizon Jam');
    expect(s.soundKit).toBe('Retro Drive');
    expect(s.masterSequencerVolume).toBe(0.8);
    expect(s.drumFilterCutoff).toBe(12000);
    expect(s.drumFilterResonance).toBe(0.7);
    expect(s.drumFilterType).toBe('lowpass');
    expect(s.chordRhythmId).toBe('sustained');
    expect(s.chordFeel).toBe(0.5);
    expect(s.chordOctave).toBe(4);
    expect(s.chordMuted).toBe(false);
    expect(s.chordVolume).toBe(1.0);
    expect(s.bassPatternId).toBe(BASS_PATTERNS[0].id);
    expect(s.bassFeel).toBe(0.5);
    expect(s.bassOctave).toBe(2);
    expect(s.bassMuted).toBe(false);
    expect(s.bassVolume).toBe(1.0);
    expect(s.controlTarget).toBe('synth');
    expect(s.activeTab).toBe('synth');
    expect(s.isProjectModalOpen).toBe(false);
    expect(s.synthParams).toEqual(INITIAL_SYNTH_PARAMS);
    expect(s.chordSynthParams).toEqual(INITIAL_SYNTH_PARAMS);
    expect(s.bassSynthParams).toEqual({ ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params });
    expect(s.chords).toEqual(INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)));
    expect(s.sequencerTracks).toEqual(INITIAL_SEQUENCER_TRACKS);
    expect(s.effects).toEqual(INITIAL_EFFECTS);
    expect(s.customSynthPresets).toEqual([]);
    expect(s.customChordProgressions).toEqual([]);
  });
});

describe('transport semantics', () => {
  test('toggleMasterPlay starts both views from stopped and stops both when playing', async () => {
    const { useAppStore } = await getStore();
    const resetClock = freshResetClockSpy();
    const init = spyOn(audioEngine, 'init').mockClear();

    useAppStore.getState().toggleMasterPlay();
    expect(useAppStore.getState().isSequencerPlaying).toBe(true);
    expect(useAppStore.getState().isChordsPlaying).toBe(true);
    expect(init).toHaveBeenCalled();
    expect(resetClock).toHaveBeenCalledTimes(1);

    useAppStore.getState().toggleMasterPlay();
    expect(useAppStore.getState().isSequencerPlaying).toBe(false);
    expect(useAppStore.getState().isChordsPlaying).toBe(false);
    // Stopping never restarts the clock
    expect(resetClock).toHaveBeenCalledTimes(1);
  });

  test('toggleSequencerPlay / toggleChordsPlay flip only their own flag and reset the clock only when nothing plays', async () => {
    const { useAppStore } = await getStore();
    const resetClock = freshResetClockSpy();

    // Start the chords view: clock resets (nothing was playing)
    useAppStore.getState().toggleChordsPlay();
    expect(useAppStore.getState().isChordsPlaying).toBe(true);
    expect(useAppStore.getState().isSequencerPlaying).toBe(false);
    expect(resetClock).toHaveBeenCalledTimes(1);

    // Start the sequencer while chords are still playing: no clock reset
    useAppStore.getState().toggleSequencerPlay();
    expect(useAppStore.getState().isSequencerPlaying).toBe(true);
    expect(useAppStore.getState().isChordsPlaying).toBe(true);
    expect(resetClock).toHaveBeenCalledTimes(1);

    // Stop both, then start the sequencer again: clock resets once more
    useAppStore.getState().toggleSequencerPlay();
    useAppStore.getState().toggleChordsPlay();
    expect(useAppStore.getState().isSequencerPlaying).toBe(false);
    expect(useAppStore.getState().isChordsPlaying).toBe(false);
    expect(resetClock).toHaveBeenCalledTimes(1);

    useAppStore.getState().toggleSequencerPlay();
    expect(useAppStore.getState().isSequencerPlaying).toBe(true);
    expect(resetClock).toHaveBeenCalledTimes(2);
  });

  test('resetClockIfStopped resets the engine clock only when both views are stopped', async () => {
    const { useAppStore } = await getStore();
    const resetClock = freshResetClockSpy();
    const count = () => resetClock.mock.calls.length;

    useAppStore.getState().resetClockIfStopped();
    expect(count()).toBe(1);

    useAppStore.getState().setBpm(140);
    useAppStore.getState().resetClockIfStopped();
    expect(count()).toBe(2);

    // Starting a view from a fully stopped state resets the clock once
    // (inside toggleSequencerPlay)...
    useAppStore.getState().toggleSequencerPlay();
    expect(count()).toBe(3);
    // ...but while any view is playing, neither the toggle nor a direct call
    // may reset it
    useAppStore.getState().resetClockIfStopped();
    useAppStore.getState().toggleChordsPlay();
    useAppStore.getState().resetClockIfStopped();
    expect(count()).toBe(3);
  });
});

describe('applyTemplate', () => {
  test('applies every template with the exact values (bpm crosses into the transport slice)', async () => {
    const { useAppStore } = await getStore();
    const templates = [
      { name: 'Synthwave Odyssey', bpm: 120, scaleRoot: 'A', scaleType: 'Natural Minor', projectTitle: 'Synthwave Odyssey' },
      { name: 'Lo-Fi Chill Hop', bpm: 85, scaleRoot: 'C', scaleType: 'Major', projectTitle: 'Lo-Fi Chill Hop' },
      { name: 'Cyber Electro Club', bpm: 128, scaleRoot: 'D', scaleType: 'Dorian', projectTitle: 'Cyber Electro Club' },
      { name: 'Funky Neo-Soul', bpm: 95, scaleRoot: 'F', scaleType: 'Major', projectTitle: 'Funky Neo-Soul' },
    ];

    for (const t of templates) {
      useAppStore.getState().applyTemplate(t.name);
      const s = useAppStore.getState();
      expect(s.bpm).toBe(t.bpm);
      expect(s.scaleRoot).toBe(t.scaleRoot);
      expect(s.scaleType).toBe(t.scaleType);
      expect(s.projectTitle).toBe(t.projectTitle);
    }

    // Unknown template names are ignored
    const before = useAppStore.getState();
    useAppStore.getState().applyTemplate('Not A Template');
    const after = useAppStore.getState();
    expect(after.bpm).toBe(before.bpm);
    expect(after.scaleRoot).toBe(before.scaleRoot);
  });
});

describe('applyDrumPattern', () => {
  test('maps the pattern onto the matching track by instrument and leaves others untouched', async () => {
    const { useAppStore } = await getStore();
    const before = useAppStore.getState().sequencerTracks;
    const newKickSteps = before[0].steps.map((v) => !v);

    useAppStore.getState().applyDrumPattern({ kick: newKickSteps });
    const after = useAppStore.getState().sequencerTracks;

    expect(after[0].instrument).toBe('kick');
    expect(after[0].steps).toEqual(newKickSteps);
    expect(after[0].id).toBe(before[0].id); // rest of the track is preserved
    expect(after[0].volume).toBe(before[0].volume);
    for (let i = 1; i < after.length; i++) {
      expect(after[i]).toEqual(before[i]);
    }

    // A pattern key with no matching instrument changes nothing
    const untouched = useAppStore.getState().sequencerTracks;
    useAppStore.getState().applyDrumPattern({ cowbell: [true, false] });
    expect(useAppStore.getState().sequencerTracks).toEqual(untouched);
  });
});

describe('setChordOctave', () => {
  test('derives the new chord notes inside the same set (atomic octave + notes)', async () => {
    const { useAppStore } = await getStore();
    const chordsBefore = useAppStore.getState().chords;

    const snapshots: AppStore[] = [];
    const unsubscribe = useAppStore.subscribe((s) => snapshots.push(s));
    useAppStore.getState().setChordOctave(6);
    unsubscribe();

    // Exactly one notification: octave and notes changed together
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].chordOctave).toBe(6);
    expect(snapshots[0].chords).toEqual(chordsBefore.map((c) => deriveChordNotes(c, 6)));
    expect(useAppStore.getState().chords).toEqual(chordsBefore.map((c) => deriveChordNotes(c, 6)));
  });
});

describe('chords initial octave', () => {
  // Unit-test the slice factory directly: the shared singleton store is
  // mutated by earlier tests (e.g. setChordOctave(6)), so its live state
  // cannot be assumed pristine.
  test('initial chords are derived at octave 4 (matches the old App mount effect)', () => {
    const slice = createChordsSlice(
      (() => {}) as unknown as StoreApi<AppStore>['setState'],
      (() => ({})) as unknown as StoreApi<AppStore>['getState']
    );
    // The old App ran deriveChordNotes(c, chordOctave) on mount with octave 4
    expect(slice.chords).toEqual(INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)));
    // Sanity: this is NOT the raw INITIAL_CHORDS (those sit one octave lower)
    expect(slice.chords).not.toEqual(INITIAL_CHORDS);
    expect(slice.chords[0].notes).toEqual(deriveChordNotes(INITIAL_CHORDS[0], 4).notes);
  });

  test('persisted hydration returns stored chords verbatim (no re-derivation on load)', async () => {
    const { useAppStore } = await getStore();
    const customChords = [
      { id: 'chord-x', root: 'C', quality: 'maj', bars: 2, notes: ['C3', 'E3', 'G3'] },
    ];

    // Persist custom chords (the persist middleware writes on every setState)
    // and capture the exact payload it wrote.
    useAppStore.setState({ chords: customChords });
    const persistedPayload = fakeLocalStorage.getItem('murva_project_state_v1');
    expect(persistedPayload).toContain('chord-x');

    // Reset the in-memory chords to the initial derived set (simulating a
    // fresh session), then put the captured payload back into storage
    // directly — bypassing the store, whose next setState would overwrite it.
    useAppStore.setState({ chords: INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)) });
    fakeLocalStorage.setItem('murva_project_state_v1', persistedPayload!);

    // Hydration merges the stored value: chords come back as stored, not re-derived
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().chords).toEqual(customChords);
    expect(useAppStore.getState().chords).not.toEqual(
      INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4))
    );
  });
});

describe('persist partialize', () => {
  test('allow-list keeps every persisted field and no ui/playing/actions leak', async () => {
    const { useAppStore } = await getStore();
    const partialize = useAppStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    const snapshot = partialize!(useAppStore.getState());

    const persistedKeys = [
      'bpm',
      'masterVolume',
      'metronomeActive',
      'scaleRoot',
      'scaleType',
      'projectTitle',
      'synthParams',
      'chordSynthParams',
      'bassSynthParams',
      'controlTarget',
      'chords',
      'chordRhythmId',
      'chordFeel',
      'chordOctave',
      'chordMuted',
      'chordVolume',
      'bassPatternId',
      'bassFeel',
      'bassOctave',
      'bassMuted',
      'bassVolume',
      'sequencerTracks',
      'soundKit',
      'masterSequencerVolume',
      'drumFilterCutoff',
      'drumFilterResonance',
      'drumFilterType',
      'effects',
      'customSynthPresets',
      'customChordProgressions',
    ];
    for (const key of persistedKeys) {
      expect(snapshot).toHaveProperty(key);
    }

    const excludedKeys = [
      'activeTab',
      'isProjectModalOpen',
      'isSequencerPlaying',
      'isChordsPlaying',
      'setBpm',
      'setMasterVolume',
      'toggleMetronome',
      'toggleSequencerPlay',
      'toggleChordsPlay',
      'toggleMasterPlay',
      'resetClockIfStopped',
      'applyTemplate',
      'applySynthPreset',
      'setChordOctave',
      'applyDrumPattern',
      'setEffects',
      'setActiveTab',
      'openProjectsModal',
      'closeProjectsModal',
      'saveCustomPreset',
      'updateCustomPreset',
      'deleteCustomPreset',
      'saveCustomChordProgression',
      'deleteCustomChordProgression',
    ];
    for (const key of excludedKeys) {
      expect(snapshot).not.toHaveProperty(key);
    }

    // No function values of any kind survive the allow-list
    expect(Object.values(snapshot).every((v) => typeof v !== 'function')).toBe(true);
  });
});

describe('legacy preset migration', () => {
  test('hydrate adopts the legacy localStorage presets and removeLegacyKeys cleans them up', async () => {
    const { useAppStore } = await getStore();

    const legacySynthPresets: SynthPresetItem[] = [
      {
        id: 'user-1',
        name: 'My Lead',
        category: 'Lead',
        isFactory: false,
        createdAt: 1000,
        description: 'Custom user preset',
        params: { detune: 12, oscType: 'sawtooth' },
      },
    ];
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

    fakeLocalStorage.setItem('murva_synth_custom_presets_v1', JSON.stringify(legacySynthPresets));
    fakeLocalStorage.setItem('murva_chord_custom_progressions_v1', JSON.stringify(legacyChordProgressions));

    // Start from a fresh persisted project state so this exercises the
    // "no persisted data yet" hydrate path (merge + legacy adoption).
    useAppStore.persist.clearStorage();
    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().customSynthPresets).toEqual(legacySynthPresets);
    expect(useAppStore.getState().customChordProgressions).toEqual(legacyChordProgressions);

    // Legacy keys are removed only after the merged state was written back
    expect(fakeLocalStorage.getItem('murva_synth_custom_presets_v1')).toBeNull();
    expect(fakeLocalStorage.getItem('murva_chord_custom_progressions_v1')).toBeNull();
    // And the new persist key now owns the presets
    expect(fakeLocalStorage.getItem('murva_project_state_v1')).not.toBeNull();
  });

  test('already-persisted presets win over legacy keys (merge only when empty)', async () => {
    const { useAppStore } = await getStore();

    // Write a real preset into the persisted project state first
    useAppStore.getState().saveCustomPreset('Persisted Pad', INITIAL_SYNTH_PARAMS, 'Pad');
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

    expect(setMasterVolume).toHaveBeenCalledWith(0.2);
    expect(updateEffects).toHaveBeenCalledWith(snapshotEffects);
  });
});

describe('persisted payload sanitization', () => {
  test('wrong-typed persisted values hydrate to the store defaults', async () => {
    const { useAppStore } = await getStore();

    // Restore every field under test to its factory default so the fallback
    // values below are observable.
    useAppStore.setState({
      bpm: 120,
      masterVolume: 0.85,
      chordVolume: 1.0,
      bassVolume: 1.0,
      masterSequencerVolume: 0.8,
      metronomeActive: false,
      chordMuted: false,
      bassMuted: false,
      soundKit: 'Retro Drive',
      effects: INITIAL_EFFECTS,
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      projectTitle: 'Cosmic Horizon Jam',
      chordRhythmId: 'sustained',
      bassPatternId: BASS_PATTERNS[0].id,
      drumFilterCutoff: 12000,
      drumFilterResonance: 0.7,
      drumFilterType: 'lowpass',
    });
    const chordsBefore = useAppStore.getState().chords;
    const tracksBefore = useAppStore.getState().sequencerTracks;
    const presetsBefore = useAppStore.getState().customSynthPresets;
    const progressionsBefore = useAppStore.getState().customChordProgressions;

    // Parseable but wrong-typed payload: JSON.parse accepts all of this.
    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({
        version: 1,
        state: {
          bpm: 'fast',
          masterVolume: 'loud',
          chordVolume: -5,
          bassVolume: 2,
          masterSequencerVolume: null,
          drumFilterCutoff: 'dark',
          drumFilterResonance: null,
          drumFilterType: 42,
          metronomeActive: 'yes',
          chordMuted: 1,
          bassMuted: null,
          soundKit: 42,
          effects: 42,
          chords: 'not-an-array',
          sequencerTracks: 7,
          customSynthPresets: { id: 'x' },
          customChordProgressions: 'nope',
          scaleRoot: 42,
          scaleType: true,
          projectTitle: null,
          chordRhythmId: 0,
          bassPatternId: {},
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(120);
    expect(s.masterVolume).toBe(0.85);
    expect(s.chordVolume).toBe(0); // clamped into [0, 1]
    expect(s.bassVolume).toBe(1); // clamped into [0, 1]
    expect(s.masterSequencerVolume).toBe(0.8);
    expect(s.drumFilterCutoff).toBe(12000);
    expect(s.drumFilterResonance).toBe(0.7);
    expect(s.drumFilterType).toBe('lowpass');
    expect(s.metronomeActive).toBe(false);
    expect(s.chordMuted).toBe(false);
    expect(s.bassMuted).toBe(false);
    expect(s.soundKit).toBe('Retro Drive');
    expect(s.effects).toEqual(INITIAL_EFFECTS);
    expect(s.scaleRoot).toBe('A');
    expect(s.scaleType).toBe('Natural Minor');
    expect(s.projectTitle).toBe('Cosmic Horizon Jam');
    expect(s.chordRhythmId).toBe('sustained');
    expect(s.bassPatternId).toBe(BASS_PATTERNS[0].id);
    // Invalid arrays are dropped, leaving the pre-hydration state untouched.
    expect(s.chords).toEqual(chordsBefore);
    expect(s.sequencerTracks).toEqual(tracksBefore);
    expect(s.customSynthPresets).toEqual(presetsBefore);
    expect(s.customChordProgressions).toEqual(progressionsBefore);
  });

  test('valid persisted values pass through; out-of-range numbers are clamped', async () => {
    const { useAppStore } = await getStore();
    const partialEffects = { reverbWet: 0.9 };

    useAppStore.setState({
      bpm: 120,
      masterVolume: 0.85,
      chordVolume: 1.0,
      bassVolume: 1.0,
      masterSequencerVolume: 0.8,
      metronomeActive: false,
      chordMuted: false,
      bassMuted: false,
      soundKit: 'Retro Drive',
      effects: INITIAL_EFFECTS,
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      projectTitle: 'Cosmic Horizon Jam',
      chordRhythmId: 'sustained',
      bassPatternId: BASS_PATTERNS[0].id,
      chords: [],
      sequencerTracks: [],
      customSynthPresets: [],
      customChordProgressions: [],
    });

    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({
        version: 1,
        state: {
          bpm: 500,
          masterVolume: 2,
          chordVolume: -1,
          bassVolume: 0.5,
          masterSequencerVolume: 0.1,
          drumFilterCutoff: 99999,
          drumFilterResonance: -1,
          drumFilterType: 'highpass',
          metronomeActive: true,
          chordMuted: true,
          bassMuted: true,
          soundKit: 'Deep Dub',
          effects: partialEffects,
          chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] }],
          sequencerTracks: [],
          customSynthPresets: [],
          customChordProgressions: [],
          scaleRoot: 'D',
          scaleType: 'Major',
          projectTitle: 'My Project',
          chordRhythmId: 'stabs',
          bassPatternId: 'bass-1',
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(300); // clamped into [20, 300]
    expect(s.masterVolume).toBe(1); // clamped into [0, 1]
    expect(s.chordVolume).toBe(0); // clamped into [0, 1]
    expect(s.bassVolume).toBe(0.5);
    expect(s.masterSequencerVolume).toBe(0.1);
    expect(s.drumFilterCutoff).toBe(12000); // clamped into [50, 12000]
    expect(s.drumFilterResonance).toBe(0.1); // clamped into [0.1, 20]
    expect(s.drumFilterType).toBe('highpass');
    expect(s.metronomeActive).toBe(true);
    expect(s.chordMuted).toBe(true);
    expect(s.bassMuted).toBe(true);
    expect(s.soundKit).toBe('Deep Dub');
    expect(s.effects).toEqual(partialEffects);
    expect(s.chords).toEqual([{ id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] }]);
    expect(s.sequencerTracks).toEqual([]);
    expect(s.customSynthPresets).toEqual([]);
    expect(s.customChordProgressions).toEqual([]);
    expect(s.scaleRoot).toBe('D');
    expect(s.scaleType).toBe('Major');
    expect(s.projectTitle).toBe('My Project');
    expect(s.chordRhythmId).toBe('stabs');
    expect(s.bassPatternId).toBe('bass-1');
  });

  test('corrupt JSON in the legacy preset keys is ignored without crashing', async () => {
    const { useAppStore } = await getStore();

    useAppStore.setState({ customSynthPresets: [], customChordProgressions: [] });
    useAppStore.persist.clearStorage();
    fakeLocalStorage.setItem('murva_synth_custom_presets_v1', '{not json!!');
    fakeLocalStorage.setItem('murva_chord_custom_progressions_v1', '[unclosed');

    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().customSynthPresets).toEqual([]);
    expect(useAppStore.getState().customChordProgressions).toEqual([]);
    // Rehydration still ran to completion and wrote the merged state back.
    expect(fakeLocalStorage.getItem('murva_project_state_v1')).not.toBeNull();
  });
});

describe('arp migration off stale persisted state', () => {
  // A v1 payload could pin arpActive:true while the arpeggiator produced no
  // notes at all, which silenced the keyboard on every later session. The
  // version bump has to clear that flag so those users get their keys back.
  test('a version-1 payload with arpActive:true hydrates with the arp disabled', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();

    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({
        version: 1,
        state: {
          synthParams: { ...INITIAL_SYNTH_PARAMS, arpActive: true },
          chordSynthParams: { ...INITIAL_SYNTH_PARAMS, arpActive: true },
          bassSynthParams: { ...INITIAL_SYNTH_PARAMS, arpActive: true },
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.synthParams.arpActive).toBe(false);
    expect(s.chordSynthParams.arpActive).toBe(false);
    expect(s.bassSynthParams.arpActive).toBe(false);
  });

  test('a version-1 payload keeps every other synth param it stored', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();

    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({
        version: 1,
        state: {
          synthParams: {
            ...INITIAL_SYNTH_PARAMS,
            arpActive: true,
            filterCutoff: 900,
            attack: 0.3,
            preset: 'Acid Synth',
          },
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.synthParams.filterCutoff).toBe(900);
    expect(s.synthParams.attack).toBe(0.3);
    expect(s.synthParams.preset).toBe('Acid Synth');
  });

  test('a current-version payload keeps arpActive:true so the arp stays usable', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();

    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({
        version: 2,
        state: {
          synthParams: { ...INITIAL_SYNTH_PARAMS, arpActive: true },
        },
      })
    );

    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().synthParams.arpActive).toBe(true);
  });
});

describe('synth param payload sanitization', () => {
  test('a non-object synthParams payload falls back to the factory defaults', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();
    useAppStore.setState({ synthParams: INITIAL_SYNTH_PARAMS });

    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({ version: 2, state: { synthParams: 'not-an-object' } })
    );

    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().synthParams).toEqual(INITIAL_SYNTH_PARAMS);
  });

  test('wrong-typed numeric synth params fall back instead of reaching the engine as NaN', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();
    useAppStore.setState({ synthParams: INITIAL_SYNTH_PARAMS });

    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({
        version: 2,
        state: {
          synthParams: {
            ...INITIAL_SYNTH_PARAMS,
            filterCutoff: 'bright',
            attack: null,
            release: 'long',
            octave: {},
          },
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const p = useAppStore.getState().synthParams;
    expect(p.filterCutoff).toBe(INITIAL_SYNTH_PARAMS.filterCutoff);
    expect(p.attack).toBe(INITIAL_SYNTH_PARAMS.attack);
    expect(p.release).toBe(INITIAL_SYNTH_PARAMS.release);
    expect(p.octave).toBe(INITIAL_SYNTH_PARAMS.octave);
  });

  test('an invalid arpMode falls back to a mode the arpeggiator understands', async () => {
    const { useAppStore } = await getStore();
    useAppStore.persist.clearStorage();

    fakeLocalStorage.setItem(
      'murva_project_state_v1',
      JSON.stringify({
        version: 2,
        state: { synthParams: { ...INITIAL_SYNTH_PARAMS, arpMode: 'sideways', arpOctaves: 'two' } },
      })
    );

    await useAppStore.persist.rehydrate();
    const p = useAppStore.getState().synthParams;
    expect(p.arpMode).toBe('up');
    expect(p.arpOctaves).toBe(1);
  });
});
