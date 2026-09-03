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
    expect(s.masterVolume).toBe(0.85);
    expect(s.metronomeActive).toBe(false);
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.scaleRoot).toBe('A');
    expect(s.scaleType).toBe('Natural Minor');
    expect(s.selectedVibeId).toBe(null);
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
    expect(s.keyboardMode).toBe('scale-locked');
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

describe('applyDrumPattern', () => {
  test('maps a 16-step pattern onto the matching track window and leaves others untouched', async () => {
    const { useAppStore } = await getStore();
    const initial = useAppStore.getState().sequencerTracks;

    // Seed the padding (indices 16-23, normally all `false` in
    // INITIAL_SEQUENCER_TRACKS) with a distinguishing `true` before the write.
    // An assertion that padding is `false` both before and after cannot tell
    // "genuinely preserved" from "reset to false" — seeding a `true` value that
    // must survive makes this an independent proof of the invariant.
    const seededSteps = initial[0].steps.map((v, i) => (i === 20 ? true : v));
    useAppStore
      .getState()
      .setSequencerTracks(initial.map((t, i) => (i === 0 ? { ...t, steps: seededSteps } : t)));
    const before = useAppStore.getState().sequencerTracks;

    // Real callers (GENRE_PRESETS, VIBE_DRUM_PATTERNS) hand in a 16-step row —
    // the width of the default 4/4 window, not the 24-wide storage array.
    const newKickWindow = before[0].steps.slice(0, 16).map((v) => !v);

    useAppStore.getState().applyDrumPattern({ kick: newKickWindow });
    const after = useAppStore.getState().sequencerTracks;

    expect(after[0].instrument).toBe('kick');
    expect(after[0].steps.slice(0, 16)).toEqual(newKickWindow);
    // Padding invariant: the seeded `true` at index 20 must survive untouched.
    expect(after[0].steps[20]).toBe(true);
    expect(after[0].steps.slice(16)).toEqual(before[0].steps.slice(16));
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

describe('chords initial octave', () => {
  // Unit-test the slice factory directly: the shared singleton store is
  // mutated by earlier tests (e.g. setChordOctave(6)), so its live state
  // cannot be assumed pristine.
  test('initial chords are derived at octave 4 (matches the old App mount effect)', () => {
    const slice = createChordsSlice(
      (() => {}) as unknown as StoreApi<AppStore>['setState']
    );
    // The old App ran deriveChordNotes(c, chordOctave) on mount with octave 4
    expect(slice.chords).toEqual(INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)));
    // Sanity: this is NOT the raw INITIAL_CHORDS (those sit one octave lower)
    expect(slice.chords).not.toEqual(INITIAL_CHORDS);
    expect(slice.chords[0].notes).toEqual(deriveChordNotes(INITIAL_CHORDS[0], 4).notes);
  });

  test('persisted hydration returns stored chords verbatim (no re-derivation on load)', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    const customChords = [
      { id: 'chord-x', root: 'C', quality: 'maj', bars: 2, notes: ['C3', 'E3', 'G3'] },
    ];

    // Persist custom chords (the persist middleware writes on every setState).
    // Seed BOTH the loop copy and the flat slices so the v6 payload carries
    // the chords inside loops[].
    useAppStore.setState({
      loops: [{ ...useAppStore.getState().loops[0], chords: customChords }],
      chords: customChords,
    });
    flushPersistedWrites();
    const persistedPayload = fakeLocalStorage.getItem('musibox_project_state_v1');
    expect(persistedPayload).toContain('chord-x');

    // Reset the in-memory flat chords (simulating a fresh session), then put
    // the captured payload back into storage directly.
    useAppStore.setState({ chords: INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)) });
    flushPersistedWrites();
    fakeLocalStorage.setItem('musibox_project_state_v1', persistedPayload!);

    // Hydration merges the stored value via the loop path: chords come back
    // as stored, not re-derived.
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
      'meterId',
      'masterVolume',
      'metronomeActive',
      'selectedVibeId',
      'controlTarget',
      'effects',
      'customSynthPresets',
      'customChordProgressions',
      'loops',
      'activeLoopId',
    ];
    for (const key of persistedKeys) {
      expect(snapshot).toHaveProperty(key);
    }
    expect(snapshot.loops).toHaveLength(1);
    expect(snapshot.activeLoopId).toBe(snapshot.loops[0].id);

    const excludedKeys = [
      'activeTab',
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
      'applyDrumPattern',
      'setEffects',
      'setActiveTab',
      'setKeyboardMode',
      'saveCustomPreset',
      'deleteCustomPreset',
      'saveCustomChordProgression',
      'deleteCustomChordProgression',
      // v6: the eight representative per-loop fields — the split moved them
      // into loops[], so they must be absent at the top level.
      'scaleRoot',
      'scaleType',
      'synthParams',
      'chordSynthParams',
      'bassSynthParams',
      'chords',
      'sequencerTracks',
      'leadMelodySteps',
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
    const { useAppStore, flushPersistedWrites } = await getStore();

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
    flushPersistedWrites();
    expect(fakeLocalStorage.getItem('musibox_project_state_v1')).not.toBeNull();
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
    const { useAppStore, flushPersistedWrites } = await getStore();

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
      selectedVibeId: null,
      chordRhythmId: 'sustained',
      bassPatternId: BASS_PATTERNS[0].id,
      drumFilterCutoff: 12000,
      drumFilterResonance: 0.7,
      drumFilterType: 'lowpass',
      // Per-loop fields are restored too: the pre-v6 payload wraps into a
      // single loop, so the merge's loop-load re-applies the wrapped loop's
      // content to the flat slices. Restoring the defaults makes "invalid
      // array -> factory default" observable, the same way the restored
      // scalars above are.
      chords: INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)),
      sequencerTracks: INITIAL_SEQUENCER_TRACKS,
    });
    const chordsBefore = useAppStore.getState().chords;
    const tracksBefore = useAppStore.getState().sequencerTracks;
    const presetsBefore = useAppStore.getState().customSynthPresets;
    const progressionsBefore = useAppStore.getState().customChordProgressions;

    // Parseable but wrong-typed payload: JSON.parse accepts all of this.
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
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
          selectedVibeId: 42,
          chordRhythmId: 0,
          bassPatternId: {},
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(120);
    expect(s.masterVolume).toBe(0.85);
    expect(s.chordVolume).toBe(0); // clamped into [0, 1.5]
    expect(s.bassVolume).toBe(1.5); // clamped into [0, 1.5]
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
    expect(s.selectedVibeId).toBe(null);
    expect(s.chordRhythmId).toBe('sustained');
    expect(s.bassPatternId).toBe(BASS_PATTERNS[0].id);
    // Invalid arrays are dropped; the loop-load re-applies the factory
    // defaults that chordsBefore/tracksBefore captured above.
    expect(s.chords).toEqual(chordsBefore);
    expect(s.sequencerTracks).toEqual(tracksBefore);
    expect(s.customSynthPresets).toEqual(presetsBefore);
    expect(s.customChordProgressions).toEqual(progressionsBefore);
  });

  test('valid persisted values pass through; out-of-range numbers are clamped', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
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
      selectedVibeId: null,
      chordRhythmId: 'sustained',
      bassPatternId: BASS_PATTERNS[0].id,
      chords: [],
      sequencerTracks: [],
      customSynthPresets: [],
      customChordProgressions: [],
    });

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
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
          selectedVibeId: 'lofi-chill',
          chordRhythmId: 'stabs',
          bassPatternId: 'bass-1',
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(300); // clamped into [20, 300]
    expect(s.masterVolume).toBe(1); // clamped into [0, 1]
    expect(s.chordVolume).toBe(0); // clamped into [0, 1.5]
    expect(s.bassVolume).toBe(0.5);
    expect(s.masterSequencerVolume).toBe(0.1);
    expect(s.drumFilterCutoff).toBe(12000); // clamped into [50, 12000]
    expect(s.drumFilterResonance).toBe(0.1); // clamped into [0.1, 20]
    expect(s.drumFilterType).toBe('highpass');
    expect(s.metronomeActive).toBe(true);
    expect(s.chordMuted).toBe(true);
    expect(s.bassMuted).toBe(true);
    expect(s.soundKit).toBe('Deep Dub');
    // Every numeric MasterEffects field is clamped through the shared
    // EFFECT_LIMITS table (audio/effectLimits.ts), not just the two former
    // "live knob" fields — a partial persisted effects object has every
    // missing field backfilled with its EFFECT_LIMITS fallback (which equals
    // INITIAL_EFFECTS), so it must never reach the engine as undefined.
    expect(s.effects).toEqual({ ...INITIAL_EFFECTS, ...partialEffects });
    expect(s.chords).toEqual([{ id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] }]);
    expect(s.sequencerTracks).toEqual([]);
    expect(s.customSynthPresets).toEqual([]);
    expect(s.customChordProgressions).toEqual([]);
    expect(s.scaleRoot).toBe('D');
    expect(s.scaleType).toBe('Major');
    expect(s.selectedVibeId).toBe('lofi-chill');
    expect(s.chordRhythmId).toBe('stabs');
    expect(s.bassPatternId).toBe('bass-1');
  });

  test('corrupt JSON in the legacy preset keys is ignored without crashing', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();

    useAppStore.setState({ customSynthPresets: [], customChordProgressions: [] });
    useAppStore.persist.clearStorage();
    fakeLocalStorage.setItem('murva_synth_custom_presets_v1', '{not json!!');
    fakeLocalStorage.setItem('murva_chord_custom_progressions_v1', '[unclosed');

    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().customSynthPresets).toEqual([]);
    expect(useAppStore.getState().customChordProgressions).toEqual([]);
    // Rehydration still ran to completion and wrote the merged state back.
    flushPersistedWrites();
    expect(fakeLocalStorage.getItem('musibox_project_state_v1')).not.toBeNull();
  });

  test('sanitize clamps reverbDecay and compressorThreshold on rehydrate', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 2,
        state: {
          bpm: 120,
          masterVolume: 0.85,
          // Both values out of range: -70 sits below the [-60, 0] floor, and
          // 99 sits above reverbDecay's [0.1, 10] ceiling (the range moved
          // from [0.5, 6.0] once decay became a duration in seconds rather
          // than a curve exponent).
          effects: { ...INITIAL_EFFECTS, reverbDecay: 99, compressorThreshold: -70 },
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const fx = useAppStore.getState().effects;
    expect(fx.reverbDecay).toBe(10);
    expect(fx.compressorThreshold).toBe(-60);
  });
});

describe('arp migration off stale persisted state', () => {
  // A v1 payload could pin arpActive:true while the arpeggiator produced no
  // notes at all, which silenced the keyboard on every later session. The
  // version bump has to clear that flag so those users get their keys back.
  test('a version-1 payload with arpActive:true hydrates with the arp disabled', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
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
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
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
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
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

describe('sequencer track colour migration wiring (v2 -> v3)', () => {
  // The map (migrateTrackColors) is unit-tested in migrate.test.ts. These
  // tests drive the store's actual `migrate` callback end-to-end, so a
  // future refactor that inverts the `version >= 3` / `version >= 2`
  // ordering (store.ts) breaks a test here, not just in production.
  test('a version-2 payload with legacy palette track colours rehydrates with daisyUI tokens', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 2,
        state: {
          sequencerTracks: [
            { ...INITIAL_SEQUENCER_TRACKS[0], color: 'bg-rose-500' },
            { ...INITIAL_SEQUENCER_TRACKS[1], color: 'bg-amber-500' },
            { ...INITIAL_SEQUENCER_TRACKS[2], color: 'bg-emerald-500' },
            { ...INITIAL_SEQUENCER_TRACKS[3], color: 'bg-cyan-500' },
            { ...INITIAL_SEQUENCER_TRACKS[4], color: 'bg-purple-500' },
          ],
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const colors = useAppStore.getState().sequencerTracks.map((t) => t.color);
    expect(colors).toEqual([
      'bg-error',
      'bg-warning',
      'bg-success',
      'bg-accent',
      'bg-secondary',
    ]);
    // steps are the user's actual musical content — must survive untouched.
    expect(useAppStore.getState().sequencerTracks[0].steps).toEqual(
      INITIAL_SEQUENCER_TRACKS[0].steps
    );
  });

  test('a version-3 payload passes through untouched (no double-remap, no clobber)', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 3,
        state: {
          sequencerTracks: [
            { ...INITIAL_SEQUENCER_TRACKS[0], color: 'bg-error' },
            // An already-current-version payload should never be rewritten,
            // even if it holds a colour outside the legacy map's keys.
            { ...INITIAL_SEQUENCER_TRACKS[1], color: 'bg-custom-brand' },
          ],
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const colors = useAppStore.getState().sequencerTracks.map((t) => t.color);
    expect(colors).toEqual(['bg-error', 'bg-custom-brand']);
  });
});

describe('meter migration wiring (v4 -> v5)', () => {
  // migrateMeterAndStepWidth is unit-tested directly in migrate.test.ts. These
  // tests drive the store's actual `migrate` callback end-to-end, through the
  // real version-chained pipeline in store.ts, the way the v2->v3 tests above
  // do for track colours — the standalone unit alone never exercised this
  // wiring end-to-end.
  test('a pre-v5 payload with no meterId and 16-wide steps hydrates with a defaulted meterId and 24-wide steps', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    const kickSteps = [
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
    ];
    const snareSteps = [
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false,
    ];

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 4,
        state: {
          sequencerTracks: [
            { ...INITIAL_SEQUENCER_TRACKS[0], steps: kickSteps },
            { ...INITIAL_SEQUENCER_TRACKS[1], steps: snareSteps },
          ],
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();

    // meterId did not exist on a pre-v5 payload: defaults to 4/4.
    expect(s.meterId).toBe('4/4');

    // Legacy 16-wide rows widen to the 24-wide storage array, padded with
    // silence — never truncated, never left at their old width.
    expect(s.sequencerTracks[0].steps.length).toBe(24);
    expect(s.sequencerTracks[1].steps.length).toBe(24);
    expect(s.sequencerTracks[0].steps).toEqual([
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
      false, false, false, false, false, false, false, false,
    ]);
    expect(s.sequencerTracks[1].steps).toEqual([
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false,
      false, false, false, false, false, false, false, false,
    ]);
  });

  test('a current-version payload with an explicit non-4/4 meterId and 24-wide steps passes through untouched', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    const wide = Array.from({ length: 24 }, (_, i) => i % 6 === 0);

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 5,
        state: {
          meterId: '6/8',
          sequencerTracks: [{ ...INITIAL_SEQUENCER_TRACKS[0], steps: wide }],
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();

    expect(s.meterId).toBe('6/8');
    expect(s.sequencerTracks[0].steps).toEqual(wide);
  });
});

describe('loop wrap migration wiring (v5 -> v6)', () => {
  test('a version-5 payload wraps into a single loop and hydrates the flat slices from it', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    const wide = Array.from({ length: 24 }, (_, i) => i % 2 === 0);
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 5,
        state: {
          meterId: '4/4',
          bpm: 96,
          scaleRoot: 'D',
          scaleType: 'Major',
          sequencerTracks: [{ ...INITIAL_SEQUENCER_TRACKS[0], steps: wide }],
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.loops).toHaveLength(1);
    expect(s.loops[0].name).toBe('Loop 1');
    expect(s.loops[0].scaleRoot).toBe('D');
    expect(s.activeLoopId).toBe(s.loops[0].id);
    // The wrapped loop's content reached the flat editing surface.
    expect(s.scaleRoot).toBe('D');
    expect(s.loops[0].sequencerTracks[0].steps).toEqual(wide);
    expect(s.bpm).toBe(96);
  });

  test('a corrupt loops array falls back to a valid single default loop', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    useAppStore.setState({ scaleRoot: 'A' });

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 6, state: { loops: [null, 7, 'x'], activeLoopId: 'nope' } })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.loops).toHaveLength(1);
    expect(s.loops[0].name).toBe('Loop 1');
    expect(s.activeLoopId).toBe(s.loops[0].id);
    expect(s.scaleRoot).toBe('A');
  });
});

describe('synth param payload sanitization', () => {
  test('a non-object synthParams payload falls back to the factory defaults', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    useAppStore.setState({ synthParams: INITIAL_SYNTH_PARAMS });

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 2, state: { synthParams: 'not-an-object' } })
    );

    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().synthParams).toEqual(INITIAL_SYNTH_PARAMS);
  });

  test('wrong-typed numeric synth params fall back instead of reaching the engine as NaN', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    useAppStore.setState({ synthParams: INITIAL_SYNTH_PARAMS });

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
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
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
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

describe('project identity migration wiring (v8 -> v9)', () => {
  test('a version-8 payload hydrates with a null project id and baseline', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 8, state: { bpm: 111 } })
    );
    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(111);
    expect(s.currentProjectId).toBeNull();
    expect(s.projectBaselineHash).toBeNull();
  });

  test('a version-1 payload still terminates in the v9 shape', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem('musibox_project_state_v1', JSON.stringify({ version: 1, state: { bpm: 100 } }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().currentProjectId).toBeNull();
    flushPersistedWrites();
    expect(JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}').version).toBe(9);
  });

  test('a wrong-typed currentProjectId / projectBaselineHash is coerced to null', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 9, state: { currentProjectId: 42, projectBaselineHash: { x: 1 } } })
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().currentProjectId).toBeNull();
    expect(useAppStore.getState().projectBaselineHash).toBeNull();
  });

  test('the two identity fields are persisted and nothing transient rides along', async () => {
    const { useAppStore, flushPersistedWrites, partializeAppState } = await getStore();
    useAppStore.setState({ currentProjectId: 'p-9', projectBaselineHash: 'h' });
    flushPersistedWrites();
    const stored = JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}');
    expect(stored.state.currentProjectId).toBe('p-9');
    expect(stored.state.projectBaselineHash).toBe('h');
    expect('dirty' in partializeAppState(useAppStore.getState())).toBe(false);
  });
});

describe('flushBeforeHide', () => {
  test('runs the dirty pass before the persisted flush, so storage never carries a stale dirty:false', async () => {
    const { useAppStore, flushBeforeHide } = await getStore();
    useAppStore.getState().newProject();
    useAppStore.setState({ bpm: 133 });
    expect(useAppStore.getState().dirty).toBe(false); // not yet — idle-debounced
    flushBeforeHide();
    expect(useAppStore.getState().dirty).toBe(true);
    const stored = JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}');
    // Untitled after New: the baseline stays null; dirty came from the default-project comparison.
    expect(stored.state.projectBaselineHash).toBeNull();
    expect(stored.state.currentProjectId).toBeNull();
  });
});
