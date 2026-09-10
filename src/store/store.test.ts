import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import { createChordsSlice } from './chordsSlice';
import { createDefaultLoop } from './loopSlice';
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
import type { LeadNote } from '../audio/leadMelody';
import { LEAD_TICKS_PER_BAR } from '../utils/stepResolution';
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
      'focusTrack',
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
    const { sanitizePersistedStateForTest } = await getStore();
    expect(sanitizePersistedStateForTest({}).focusTrack).toBe('synth');
    expect(sanitizePersistedStateForTest({ focusTrack: 7 }).focusTrack).toBe('synth');
    expect(sanitizePersistedStateForTest({ focusTrack: 'lead' }).focusTrack).toBe('synth');
    expect(sanitizePersistedStateForTest({ focusTrack: null }).focusTrack).toBe('synth');
  });

  test('sanitize leaves a valid focusTrack untouched, including drum', async () => {
    const { sanitizePersistedStateForTest } = await getStore();
    expect(sanitizePersistedStateForTest({ focusTrack: 'fx' }).focusTrack).toBe('fx');
    expect(sanitizePersistedStateForTest({ focusTrack: 'drum' }).focusTrack).toBe('drum');
  });

  /**
   * The old keys are simply ignored — not read, not translated, not carried
   * forward (CLAUDE.md: no migration chains). A user who had FX selected on
   * Sound reopens on Lead; that is one click.
   */
  test('an old payload carrying controlTarget/patternSegment yields neither, and focusTrack synth', async () => {
    const { sanitizePersistedStateForTest } = await getStore();
    const out = sanitizePersistedStateForTest({ controlTarget: 'bass', patternSegment: 'beat' });
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

describe('persisted payload sanitization', () => {
  test('wrong-typed persisted values hydrate to the store defaults', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();

    // Restore every field under test to its factory default so the fallback
    // values below are observable.
    useAppStore.setState({
      bpm: 120,
      masterVolume: 0, // DEFAULT_FADER_DB (unity 0 dB)
      chordVolume: -6, // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
      bassVolume: -6, // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
      masterSequencerVolume: -6, // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
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
          padVolume: 99,
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
    expect(s.masterVolume).toBe(0); // DEFAULT_FADER_DB (unity 0 dB)
    // DEV-388: both values are already in the -60..+12 dB range, so
    // asFaderDb passes them through untouched — no version-based
    // reconstruction, whatever unit they were originally written in.
    expect(s.chordVolume).toBe(-5);
    expect(s.bassVolume).toBe(2);
    // padVolume is OUT of range, so it defaults like any other source bus. It is
    // asserted by name because it was the one flat fader the hand-written list in
    // sanitizePersistedState omitted: unvalidated, 99 reached faderDbToGain, which
    // fails safe to silence, and the pad bus came back muted instead of trimmed.
    expect(s.padVolume).toBe(-6); // DEFAULT_BUS_TRIM_DB
    expect(s.masterSequencerVolume).toBe(-6); // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
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

  test('a corrupt flat leadStepResolution falls back to the default', async () => {
    // Reachable only when `loops` fails validation, because a valid loops
    // array re-applies its own resolution over the flat key. That is exactly
    // the payload this guard is for: audio survives either way (strideFor
    // falls back), but the controlled <select> would match no <option> and
    // render blank, which no reload fixes.
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.setState({ leadStepResolution: '1/32' });

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 11,
        state: { leadStepResolution: 'garbage', loops: 'not an array' },
      }),
    );

    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().leadStepResolution).toBe('1/16');
  });

  test('a stale enumerated id/name falls back to the default rather than passing through', async () => {
    // The deleted migrateDrumVoices step used to rename '909 Modern' to
    // 'Club Standard'; with the chain gone, a session still holding the old
    // name must not resolve to nothing and silently play the default kit
    // with no sign anything happened — sanitize must catch it itself.
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.setState({
      soundKit: 'Retro Drive',
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      chordRhythmId: 'sustained',
      bassPatternId: BASS_PATTERNS[0].id,
    });

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 19,
        state: {
          loops: 'not an array', // forces the flat legacy fields to be read
          soundKit: '909 Modern',
          scaleRoot: 'H#',
          scaleType: 'bogus-scale',
          chordRhythmId: 'rhythm-ghost',
          bassPatternId: 'bp-ghost',
        },
      }),
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.soundKit).toBe('Retro Drive');
    expect(s.scaleRoot).toBe('A');
    expect(s.scaleType).toBe('Natural Minor');
    expect(s.chordRhythmId).toBe('sustained');
    expect(s.bassPatternId).toBe(BASS_PATTERNS[0].id);
  });

  test('an all-stale sequencerTracks roster backfills to the default roster, not []', async () => {
    // sanitizeSequencerTracks drops any row whose instrument is not a real
    // drum voice; if EVERY row is stale, dropping per-row would leave []
    // with no add-track affordance anywhere to recover it.
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.setState({ sequencerTracks: INITIAL_SEQUENCER_TRACKS });

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 19,
        state: {
          loops: 'not an array',
          sequencerTracks: [{ instrument: 'tom', steps: [true, false] }],
        },
      }),
    );

    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().sequencerTracks).toEqual(INITIAL_SEQUENCER_TRACKS);
  });

  test('valid persisted values pass through; out-of-range numbers are clamped', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    const partialEffects = { reverbWet: 0.9 };

    useAppStore.setState({
      bpm: 120,
      masterVolume: 0, // DEFAULT_FADER_DB (unity 0 dB)
      chordVolume: -6, // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
      bassVolume: -6, // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
      masterSequencerVolume: -6, // DEFAULT_BUS_TRIM_DB (DEV-383 measured headroom)
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
          soundKit: 'Trap Beat',
          effects: partialEffects,
          chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] }],
          sequencerTracks: [],
          customSynthPresets: [],
          customChordProgressions: [],
          scaleRoot: 'D',
          scaleType: 'Major',
          selectedVibeId: 'lofi-chill',
          chordRhythmId: 'offbeatStabs',
          bassPatternId: 'swing-double-approach',
        },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(300); // clamped into [20, 300]
    // DEV-388: no more version-based unit reconstruction. Every level value
    // here is already IN RANGE (-60..+12), so asFaderDb passes it through
    // untouched, whatever unit it was originally written in — the exact
    // trade-off store.ts's PERSIST_VERSION docblock documents.
    expect(s.masterVolume).toBe(2);
    expect(s.chordVolume).toBe(-1);
    expect(s.bassVolume).toBe(0.5);
    expect(s.masterSequencerVolume).toBe(0.1);
    expect(s.drumFilterCutoff).toBe(12000); // clamped into [50, 12000]
    expect(s.drumFilterResonance).toBe(0.1); // clamped into [0.1, 20]
    expect(s.drumFilterType).toBe('highpass');
    expect(s.metronomeActive).toBe(true);
    expect(s.chordMuted).toBe(true);
    expect(s.bassMuted).toBe(true);
    expect(s.soundKit).toBe('Trap Beat');
    // Every numeric MasterEffects field is clamped through the shared
    // EFFECT_LIMITS table (audio/effectLimits.ts) regardless of version — a
    // partial persisted effects object has every missing field backfilled
    // with its EFFECT_LIMITS fallback (which equals INITIAL_EFFECTS), so it
    // must never reach the engine as undefined. DEV-388 deleted the
    // version-gated migrateMasterDynamics step that used to force these same
    // ten values for a different reason (an old pre-fader, always-on
    // compressor no longer describing anything the user chose); sanitize
    // alone produces the identical result for a payload with no dynamics
    // keys at all, so nothing here actually changed.
    // That includes the two ENABLED flags: sanitizeEffectsValue reads their
    // default from INITIAL_EFFECTS too, so a payload predating the limiter
    // toggle loads limiter-ON, the same as a brand-new project would.
    expect(s.effects).toEqual({
      ...INITIAL_EFFECTS,
      ...partialEffects,
    });
    expect(s.chords).toEqual([{ id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4'] }]);
    // An empty array is vacuously valid shape-wise (every element of []
    // passes isSequencerTrack), but an empty roster is not a state any user
    // action can produce and nothing in the UI can add a track back — so
    // sanitizeSequencerTracks backfills an empty result to the full
    // eleven-voice canonical roster rather than letting it survive empty.
    expect(s.sequencerTracks).toEqual(INITIAL_SEQUENCER_TRACKS);
    expect(s.customSynthPresets).toEqual([]);
    expect(s.customChordProgressions).toEqual([]);
    expect(s.scaleRoot).toBe('D');
    expect(s.scaleType).toBe('Major');
    expect(s.selectedVibeId).toBe('lofi-chill');
    expect(s.chordRhythmId).toBe('offbeatStabs');
    expect(s.bassPatternId).toBe('swing-double-approach');
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
    const { useAppStore, flushPersistedWrites, PERSIST_VERSION } = await getStore();

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        // Current version: the dynamics-reset migration step's guard is the
        // literal `version < 16` (never `version < PERSIST_VERSION` — see
        // that constant's own docblock), and it unconditionally overwrites
        // compressorThreshold. Stamping this payload at the current version
        // keeps that reset out of the way, so what's asserted below is
        // sanitize's own clamp on rehydrate, not a migration's reset — and
        // this stays true as later tasks bump PERSIST_VERSION further.
        version: PERSIST_VERSION,
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

  // DEV-386 final review: sanitizeLoops' per-track volume clamp is ONE
  // function reached from both projectFile.ts (asserted in
  // projectFile.test.ts) and here, via sanitizePersistedState on rehydrate.
  // Without this pair, deleting the clamp only reddens the .solna tests.
  test('an out-of-range sequencer track volume rehydrates at its default, not clamped or silenced', async () => {
    const { useAppStore, flushPersistedWrites, PERSIST_VERSION } = await getStore();

    const loop = { ...createDefaultLoop(), sequencerTracks: [{ ...INITIAL_SEQUENCER_TRACKS[0], volume: 999 }] };
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: PERSIST_VERSION, state: { loops: [loop] } })
    );

    await useAppStore.persist.rehydrate();
    // DEFAULT_FADER_DB (unity): 999's UNIT is unknown, not just its
    // magnitude, so it is not clamped to FADER_MAX_DB.
    expect(useAppStore.getState().loops[0].sequencerTracks[0].volume).toBe(0);
  });

  test('a non-numeric sequencer track volume rehydrates at unity, not silence', async () => {
    const { useAppStore, flushPersistedWrites, PERSIST_VERSION } = await getStore();

    const loop = { ...createDefaultLoop(), sequencerTracks: [{ ...INITIAL_SEQUENCER_TRACKS[0], volume: 'loud' }] };
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: PERSIST_VERSION, state: { loops: [loop] } })
    );

    await useAppStore.persist.rehydrate();
    // asFaderDb's fallback for a non-finite/wrong-typed value is
    // DEFAULT_FADER_DB (0 dB, unity), never faderDbToGain's silent 0.
    expect(useAppStore.getState().loops[0].sequencerTracks[0].volume).toBe(0);
  });
});

// DEV-388 deleted the chain step this used to pin (migrateDrumTracks
// appending missing canonical tracks, migrateTrackVolumesToDb resetting
// their volume to unity): there is no more auto-completion of a short
// roster, and no more version-based volume reset — see the "drum voices"
// and "old linear levels" describes below for the new, validation-only
// behaviour that replaces both halves of what this block tested.

describe('DEV-388: drum kit + drum filter survive a real refresh', () => {
  // A real refresh is a live edit, a buffered write flushed by pagehide, and a
  // FRESH module instance re-running create() against the same storage — not
  // a helper call. This is the persist layer's half of the DEV-388 report
  // ("kit and filter reset to Retro Drive on every refresh"): it passes,
  // which rules the persist/rehydrate path OUT as the cause. The actual bug
  // was in SequencerView's mount-time grid-to-kit effect, deleted along with
  // `selectedGridId`'s misleading "synthwave" default — see the "DEV-388: the
  // drum-kit-resets-on-refresh fix" describe in SequencerView.test.tsx for
  // what is (and, honestly, is not) exercisable there under this repo's
  // no-DOM constraint. This test is kept because nothing else in the suite
  // exercises all four reported fields through the real round trip.
  test('a live-edited kit and filter, flushed, are read back by a fresh module instance', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    fakeLocalStorage.clear();
    await useAppStore.persist.rehydrate();

    useAppStore.getState().setSoundKit('Trap Beat');
    useAppStore.getState().setDrumFilterCutoff(3000);
    useAppStore.getState().setDrumFilterResonance(5);
    useAppStore.getState().setDrumFilterType('highpass');
    flushPersistedWrites();

    // Simulate an actual page refresh: a fresh module instance re-runs
    // create() and rehydrates synchronously from the SAME fakeLocalStorage.
    const fresh = await import(`./store?bust=refresh-${Date.now()}`);
    const s = fresh.useAppStore.getState();
    expect(s.soundKit).toBe('Trap Beat');
    expect(s.drumFilterCutoff).toBe(3000);
    expect(s.drumFilterResonance).toBe(5);
    expect(s.drumFilterType).toBe('highpass');
  });
});

// DEV-388 deleted the v1 arp fix and migrateTrackColors (v2 -> v3): there is
// no version-based reset left, so a stale value in range simply survives — a
// developer who hits an odd arpActive or a stale Tailwind colour class
// adjusts it by hand, per the DEV-388 decision (no real users to protect).
describe('validation-only persist boundary (DEV-388)', () => {
  test('an old arpActive:true value is not force-disabled — it is in range and survives', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 1,
        state: { synthParams: { ...INITIAL_SYNTH_PARAMS, arpActive: true, filterCutoff: 900 } },
      })
    );
    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState().synthParams;
    expect(s.arpActive).toBe(true);
    expect(s.filterCutoff).toBe(900);
  });

  test('a legacy Tailwind track colour class is not remapped — it is a valid string and survives', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 2,
        state: {
          sequencerTracks: [{ ...INITIAL_SEQUENCER_TRACKS[0], color: 'bg-rose-500' }],
        },
      })
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().sequencerTracks[0].color).toBe('bg-rose-500');
  });

  test('an old LINEAR level value in range is read as that same number of dB, not reset to unity', async () => {
    // The exact trap CLAUDE.md and PERSIST_VERSION's docblock name: a pre-DEV-386
    // masterVolume of 0.85 was linear gain; 0.85 is also a legal dB value, so
    // once there is no version signal left, nothing distinguishes them. This is
    // the accepted DEV-388 trade-off, not a bug — pin it so a future change
    // cannot "fix" it back into a silent reinterpretation the other way.
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 16, state: { masterVolume: 0.85 } })
    );
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().masterVolume).toBe(0.85);
  });

  test('an out-of-range level value still falls back to its default', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({ version: 16, state: { masterVolume: 999 } })
    );
    await useAppStore.persist.rehydrate();
    // Out of range: default-on-invalid, not clamped to the +12 ceiling — the
    // unit of 999 is unknown, not just its magnitude.
    expect(useAppStore.getState().masterVolume).toBe(0); // DEFAULT_FADER_DB
  });
});

describe('sequencerTracks steps width (DEV-388: no more version-based padding)', () => {
  // DEV-388 deleted migrateMeterAndStepWidth. isSequencerTrack never checked
  // `steps.length`, so a pre-v5, 16-wide steps array was already a "valid
  // shape" and simply passes through at its old width now — nothing pads it
  // to MAX_STEPS_PER_BAR (24) any more. meterId still defaults, but only
  // because sanitizePersistedState's `isMeterId` check is a plain validation
  // rule, unrelated to the deleted chain.
  test('a pre-v5 payload with no meterId and 16-wide steps keeps its 16-wide steps and gets a defaulted meterId', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();

    const kickSteps = [
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
    ];

    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 4,
        state: { sequencerTracks: [{ ...INITIAL_SEQUENCER_TRACKS[0], steps: kickSteps }] },
      })
    );

    await useAppStore.persist.rehydrate();
    const s = useAppStore.getState();
    expect(s.meterId).toBe('4/4');
    expect(s.sequencerTracks[0].steps).toEqual(kickSteps);
    expect(s.sequencerTracks[0].steps.length).toBe(16);
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

describe('flat (pre-loop) payload: DEV-388 deleted the wrap, so it hydrates flat, not wrapped', () => {
  test('a version-5 flat payload has no loops array, but its flat keys still hydrate the top-level slices', async () => {
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
    // No chain step wraps this into loops[0] any more: the default single
    // loop (from createDefaultLoop) wins instead, and never sees 'D'/96.
    expect(s.loops).toHaveLength(1);
    expect(s.loops[0].scaleRoot).not.toBe('D');
    // But the flat top-level keys the payload actually carried are still
    // sanitized and hydrated directly — nothing here depended on the wrap.
    expect(s.scaleRoot).toBe('D');
    expect(s.bpm).toBe(96);
    expect(s.sequencerTracks[0].steps).toEqual(wide);
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
    expect(s.loops[0].name).toBe('');
    expect(s.loops[0].tempName).toBe('untitled-1');
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

  test('a version-1 payload still terminates in the current persist shape', async () => {
    const { useAppStore, flushPersistedWrites, PERSIST_VERSION } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem('musibox_project_state_v1', JSON.stringify({ version: 1, state: { bpm: 100 } }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().currentProjectId).toBeNull();
    flushPersistedWrites();
    expect(JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}').version).toBe(
      PERSIST_VERSION
    );
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

/**
 * The persist chain's lead steps, through the REAL wiring rather than by
 * calling the two migrate functions by hand. migrate.test.ts covers the steps;
 * this covers `store.ts`'s composition of them, which is the part that can
 * regress silently: a widening that never runs leaves a 24-wide melody whose
 * `len` still counts 16ths, and asLeadNoteMatrix ACCEPTS that shape (it hands
 * it straight back). Nothing
 * throws and nothing blanks — the back half of every bar just disappears and
 * every note is half as long.
 *
 * A genuine v1 payload is FLAT (pre-loop-wrap), so the melody is a top-level
 * key: wrapFlatStateIntoLoop is what turns it into loops[0], and it overwrites
 * `loops` wholesale, so a v1 fixture carrying a `loops` array would not be a v1
 * fixture at all.
 */
describe('lead melody at an old step resolution (DEV-388: no more widening)', () => {
  test('a version-10, narrow-width melody is a valid shape and passes through UNWIDENED', async () => {
    // DEV-388 deleted migrateLeadStepResolution. asLeadNoteMatrix accepts an
    // array of arrays of {note,len} at ANY width, so a pre-DEV-369 narrow
    // melody is "valid shape, different resolution" — exactly the case the
    // DEV-388 decision says to let through rather than reconstruct.
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    const melody: LeadNote[][] = Array.from({ length: MAX_STEPS_PER_BAR }, () => []);
    melody[0] = [{ note: 'C4', len: 1 }];
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 10,
        state: {
          loops: [{ id: 'loop-1', name: 'Loop 1', leadLoopLength: 1, leadMelodySteps: melody }],
          activeLoopId: 'loop-1',
        },
      })
    );
    await useAppStore.persist.rehydrate();

    const s = useAppStore.getState();
    expect(s.loops[0].leadMelodySteps).toHaveLength(MAX_STEPS_PER_BAR);
    expect(s.loops[0].leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
    expect(s.loops[0].leadMelodySteps).not.toHaveLength(LEAD_TICKS_PER_BAR);
  });
});

/**
 * The persist chain's pad step, through the REAL wiring rather than by
 * calling migratePadLayer by hand (migrate.test.ts covers the function
 * itself). This is the test the review flagged as missing: without it,
 * deleting `if (version < 12) next = migratePadLayer(next);` from store.ts's
 * chain leaves every other test green — a loop missing the eight pad keys
 * simply falls back to whatever loopStatePatch happens to write, and nothing
 * here would have caught an unwired step.
 */
describe('pad layer migration wiring (v11 -> v12)', () => {
  test('a version-11 payload with no pad keys hydrates with the pad AUDIBLE (missing key takes the default)', async () => {
    // DEV-388 deleted migratePadLayer, which used to force padMuted:true for
    // a pre-pad-layer loop. asBoolean(undefined) is false, so a missing key
    // now takes the live default — audible — per the DEV-388 decision: "the
    // default being audible rather than silent is acceptable now."
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 11,
        state: { loops: [{ id: 'loop-1', name: 'Loop 1', bassOctave: 2 }], activeLoopId: 'loop-1' },
      })
    );
    await useAppStore.persist.rehydrate();

    const s = useAppStore.getState();
    expect(s.loops[0].padMuted).toBe(false);
    expect(s.padMuted).toBe(false);
  });

  // The cheapest end-to-end proof that LOOP_FLAT_KEYS -> loopSync -> loops ->
  // fingerprint is connected for the pad's fields specifically. It is the
  // only test on the branch that would catch a pad key falling out of
  // loopSync's mirror: setPadVolume writes the flat slice, loopSync must
  // mirror it back into loops[] (a content key) for the dirty pass to ever
  // see it.
  test('editing a pad control marks the project dirty', async () => {
    const { useAppStore, flushBeforeHide } = await getStore();
    useAppStore.getState().newProject();
    expect(useAppStore.getState().dirty).toBe(false);
    useAppStore.getState().setPadVolume(0.42);
    flushBeforeHide();
    expect(useAppStore.getState().dirty).toBe(true);
  });
});

describe('drum instrument validation (DEV-388: dropped per-row, not renamed or wiped)', () => {
  // DEV-388 deleted migrateDrumVoices, which used to rename a `tom` row to
  // `lowtom`. Under validation-only, 'tom' is not a member of DRUM_TYPES, so
  // isSequencerTrack rejects it. sequencerTracks is a SET keyed by
  // instrument, not a sequence, so the final review fix wave switched this
  // to a per-row DROP rather than sanitizeLoops' old all-or-nothing
  // behaviour: one bad row loses one voice, and the rest of the programmed
  // kit survives untouched — a real improvement on the deleted chain, which
  // used to leave a stray 'tom' row silently dead between its steps.
  test('a loop with one invalid "tom" row drops only that row; the rest of the kit survives', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 13,
        state: {
          loops: [{
            id: 'loop-1',
            name: 'Loop 1',
            sequencerTracks: [
              {
                id: 'track-tom', name: 'My Tom', instrument: 'tom',
                steps: [true, false, false, true], volume: 0.6, muted: false, color: 'bg-primary',
              },
              {
                id: 'track-kick', name: 'Kick', instrument: 'kick',
                steps: [true, false, false, false], volume: -3, muted: false, color: 'bg-drum-kick',
              },
            ],
          }],
          activeLoopId: 'loop-1',
        },
      })
    );
    await useAppStore.persist.rehydrate();

    const s = useAppStore.getState();
    expect(s.sequencerTracks.some((t) => t.instrument === 'tom')).toBe(false);
    // The valid row survives, unrelated to the dropped one, at its own volume.
    expect(s.sequencerTracks).toHaveLength(1);
    expect(s.sequencerTracks[0].instrument).toBe('kick');
    expect(s.sequencerTracks[0].steps).toEqual([true, false, false, false]);
    expect(s.sequencerTracks[0].volume).toBe(-3);
  });

  test('a short but validly-shaped roster (no lowtom/rimshot/hitom/ride/bell/crash) is kept as-is, not auto-completed', async () => {
    // DEV-388 deleted migrateDrumTracks/migrateDrumVoices' auto-completion.
    // Every named instrument here IS in DRUM_TYPES, so the array is valid
    // shape whole, and there is no more version-based backfill of missing
    // canonical tracks — the roster simply stays short.
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.persist.clearStorage();
    flushPersistedWrites();
    const five = ['kick', 'snare', 'hihat', 'openhat', 'clap'].map((v) => ({
      id: `track-${v}`, name: v, instrument: v,
      steps: [false, false, false, false], volume: 0.8, muted: false, color: 'bg-error',
    }));
    fakeLocalStorage.setItem(
      'musibox_project_state_v1',
      JSON.stringify({
        version: 13,
        state: { loops: [{ id: 'loop-1', name: 'Loop 1', sequencerTracks: five }], activeLoopId: 'loop-1' },
      })
    );
    await useAppStore.persist.rehydrate();

    const s = useAppStore.getState();
    expect(s.sequencerTracks.length).toBe(5);
    expect(s.sequencerTracks.map((t) => t.instrument)).toEqual([
      'kick', 'snare', 'hihat', 'openhat', 'clap',
    ]);
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
