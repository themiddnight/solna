import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
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

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, 'AudioContext', { value: FakeAudioContext, configurable: true });
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

// The store must not be imported statically: its persist middleware reads
// localStorage during creation, so the fake globals above must be installed
// first. bun caches the module, so every test shares one store instance.
let storeModule: Promise<typeof import('./store')> | null = null;
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
    expect(s.isAiModalOpen).toBe(false);
    expect(s.isProjectModalOpen).toBe(false);
    expect(s.synthParams).toEqual(INITIAL_SYNTH_PARAMS);
    expect(s.chordSynthParams).toEqual(INITIAL_SYNTH_PARAMS);
    expect(s.bassSynthParams).toEqual({ ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params });
    expect(s.chords).toEqual(INITIAL_CHORDS);
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
      'effects',
      'customSynthPresets',
      'customChordProgressions',
    ];
    for (const key of persistedKeys) {
      expect(snapshot).toHaveProperty(key);
    }

    const excludedKeys = [
      'activeTab',
      'isAiModalOpen',
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
      'openAiModal',
      'closeAiModal',
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
