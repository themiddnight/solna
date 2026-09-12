import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import { createChordsSlice } from './chordsSlice';
import { presetById } from '../audio/presetRegistry';
import { DEFAULT_BASS_PRESET_ID } from './initialState';
import { BASS_PATTERNS } from '@/data/bassPatterns';
import { deriveChordNotes } from '../utils/musicTheory';
import type { SynthPresetItem } from '../data/synthPresets';
import type { CustomChordProgressionItem } from '../types';
import { faderDbToGain } from './levelUnits';
import {
  INITIAL_CHORDS,
  INITIAL_EFFECTS,
  INITIAL_SEQUENCER_TRACKS,
  INITIAL_SYNTH_PARAMS,
} from './initialState';
import type { AppStore } from './types';
import { getMeter, MAX_STEPS_PER_BAR } from '../utils/meter';

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
    expect(s.soundKit).toBe('Retro Drive');
    expect(s.masterSequencerVolume).toBe(-6); // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
    expect(s.drumFilterCutoff).toBe(12000);
    expect(s.drumFilterResonance).toBe(0.7);
    expect(s.drumFilterType).toBe('lowpass');
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
    expect(s.synthParams).toEqual(INITIAL_SYNTH_PARAMS);
    expect(s.chordSynthParams).toEqual(INITIAL_SYNTH_PARAMS);
    // Pinned by ID, never by index. `bass-deep-sine` was FACTORY_BASS_PRESETS[0]
    // before the arrays merged; SYNTH_PRESETS[0] is `factory-cosmic-lead`, a
    // Lead patch. Asserting the same index the slice reads makes this test agree
    // with the bug instead of catching it — which is what it did, verbatim,
    // until this line. Revert to an index and this must go red.
    const defaultBassPreset = presetById(DEFAULT_BASS_PRESET_ID);
    expect(defaultBassPreset).toBeDefined();
    expect(defaultBassPreset!.category).toBe('Bass');
    expect(s.bassSynthParams).toEqual({
      ...INITIAL_SYNTH_PARAMS,
      ...defaultBassPreset!.params,
    });
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

describe('replaceDrumPattern', () => {
  test('maps a 16-step pattern onto the matching track window and clears the tracks it does not name', async () => {
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

    // Real callers (DRUM_GRIDS, via the sequencer menu or a vibe) hand in a 16-step row —
    // the width of the default 4/4 window, not the 24-wide storage array.
    const newKickWindow = before[0].steps.slice(0, 16).map((v) => !v);

    useAppStore.getState().replaceDrumPattern({ kick: newKickWindow });
    const after = useAppStore.getState().sequencerTracks;

    expect(after[0].instrument).toBe('kick');
    expect(after[0].steps.slice(0, 16)).toEqual(newKickWindow);
    // Padding invariant: the seeded `true` at index 20 must survive untouched.
    expect(after[0].steps[20]).toBe(true);
    expect(after[0].steps.slice(16)).toEqual(before[0].steps.slice(16));
    expect(after[0].id).toBe(before[0].id); // rest of the track is preserved
    expect(after[0].volume).toBe(before[0].volume);
    // WAS: `for (let i = 1; i < after.length; i++) expect(after[i]).toEqual(before[i]);`
    // — the old merge contract, where an unnamed track was skipped. A grid
    // determines the whole kit now, so an unnamed track is CLEARED. Rewritten,
    // not deleted: this is the assertion that says what happens to the tracks
    // the pattern is silent about, and something has to say it.
    for (let i = 1; i < after.length; i++) {
      expect(after[i].steps.slice(0, 16), after[i].instrument).toEqual(
        new Array(16).fill(false),
      );
      // ...and only the window clears. Everything past stepsPerBar is the
      // wider-meter content and survives, exactly as it does for a named row.
      expect(after[i].steps.length, after[i].instrument).toBe(MAX_STEPS_PER_BAR);
      expect(after[i].steps.slice(16), after[i].instrument).toEqual(
        before[i].steps.slice(16),
      );
      expect(after[i].id).toBe(before[i].id);
      expect(after[i].volume).toBe(before[i].volume);
      expect(after[i].muted).toBe(before[i].muted);
    }
  });

  test('a pattern naming only unknown instruments clears every track', async () => {
    // WAS: "a pattern key with no matching instrument changes nothing".
    // The sharpest statement of the new contract, and the one that would have
    // caught the stale crash on its own: a grid with no `crash` row silences
    // the crash, rather than leaving the previous grid's ringing under it.
    const { useAppStore } = await getStore();
    const before = useAppStore.getState().sequencerTracks;
    useAppStore.getState().replaceDrumPattern({ cowbell: [true, false] });
    const after = useAppStore.getState().sequencerTracks;
    for (const [i, track] of after.entries()) {
      // Non-vacuity guard, and it is not decorative: `before` is whatever the
      // previous test left behind, so if the action ever truncated `steps` to
      // the window BOTH sides of the slice(16) comparison would become [] and
      // this loop would pass while user programming past the window was
      // destroyed. That is the exact shape of the mutation that survived here
      // before. Assert the width first, then the two halves mean something.
      expect(track.steps.length, track.instrument).toBe(MAX_STEPS_PER_BAR);
      expect(track.steps.slice(0, 16), track.instrument).toEqual(new Array(16).fill(false));
      expect(track.steps.slice(16), track.instrument).toEqual(before[i].steps.slice(16));
    }
  });

  test('clearing an unnamed track goes through writeStepWindow, so its padding survives', async () => {
    // The failure this pins: `steps: new Array(stepsPerBar).fill(false)` looks
    // correct, passes the window assertions above, and silently truncates every
    // track to 16 — destroying the wider-meter content the non-destructive
    // scheme stores past stepsPerBar. Seeded like the kick test above, on a
    // track the pattern does NOT name.
    const { useAppStore } = await getStore();
    const initial = useAppStore.getState().sequencerTracks;
    const seeded = initial[1].steps.map((v, i) => (i === 20 ? true : v));
    useAppStore
      .getState()
      .setSequencerTracks(initial.map((t, i) => (i === 1 ? { ...t, steps: seeded } : t)));

    useAppStore.getState().replaceDrumPattern({ kick: new Array(16).fill(true) });

    const after = useAppStore.getState().sequencerTracks;
    expect(after[1].steps.length).toBe(MAX_STEPS_PER_BAR);
    expect(after[1].steps[20]).toBe(true);
    expect(after[1].steps.slice(0, 16)).toEqual(new Array(16).fill(false));
  });

  test('at 3/4 the clear stops at step 12, not at MAX_STEPS_PER_BAR', async () => {
    // Every other test here runs at 4/4, where the window (16) and the visible
    // half of the storage array coincide closely enough that a clear path using
    // MAX_STEPS_PER_BAR instead of stepsPerBar would stay green. At 3/4 the
    // window is 12 and steps 12-23 are the user's programming for wider meters,
    // so this is the meter at which that substitution becomes visible. Without
    // this test a change from `stepsPerBar` to `MAX_STEPS_PER_BAR` in the clear
    // path silently destroys programming in every meter narrower than 12/8.
    const { useAppStore } = await getStore();
    useAppStore.getState().setMeter('3/4');
    expect(getMeter(useAppStore.getState().meterId).stepsPerBar).toBe(12);

    // Fill EVERY cell of every track, so "cleared" and "preserved" are both
    // reads of a `true` that had to be acted on — no cell is incidentally false.
    useAppStore
      .getState()
      .setSequencerTracks(
        useAppStore
          .getState()
          .sequencerTracks.map((t) => ({ ...t, steps: new Array(MAX_STEPS_PER_BAR).fill(true) })),
      );

    // Names the kick only: every other track takes the clear path.
    useAppStore.getState().replaceDrumPattern({ kick: new Array(12).fill(false) });

    for (const track of useAppStore.getState().sequencerTracks) {
      expect(track.steps.length, track.instrument).toBe(MAX_STEPS_PER_BAR);
      expect(track.steps.slice(0, 12), track.instrument).toEqual(new Array(12).fill(false));
      // Steps 12-23 are outside the 3/4 window: untouched, still true.
      expect(track.steps.slice(12), track.instrument).toEqual(
        new Array(MAX_STEPS_PER_BAR - 12).fill(true),
      );
    }

    useAppStore.getState().setMeter('4/4');
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
  'sequencerTracks',
  'leadMelodySteps',
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
