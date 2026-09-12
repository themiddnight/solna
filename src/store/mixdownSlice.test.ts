import { afterEach, describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { SOURCE_BUSES } from './sourceBuses';
import { DRUM_TYPES } from '@/data/drumKits';
import { MIXDOWN_FAILURE_MESSAGE, wavFileName } from './mixdownSlice';

// renderMixdown's capability probe reads `globalThis.OfflineAudioContext`, so
// the test provides it the way a browser does — see
// src/audio/export/renderMixdown.test.ts for why there is no injection seam.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('wavFileName', () => {
  test('slugs the project name and swaps the extension', () => {
    expect(wavFileName('My Song')).toBe('my-song.wav');
    expect(wavFileName('')).toBe('project.wav');
    expect(wavFileName('!!!')).toBe('project.wav');
  });
});

describe('buildMixdownSnapshot', () => {
  test('carries one bus row per SOURCE_BUSES entry and one drum row per voice', () => {
    const snapshot = useAppStore.getState().buildMixdownSnapshot();
    expect(snapshot.buses.map((b) => b.source)).toEqual(SOURCE_BUSES.map((b) => b.source));
    expect(snapshot.drumTracks.map((t) => t.instrument)).toEqual([...DRUM_TYPES]);
  });

  test('converts the store\'s dB to linear gain, exactly once', () => {
    useAppStore.setState({ masterVolume: 0, chordVolume: 0, chordMuted: false });
    const snapshot = useAppStore.getState().buildMixdownSnapshot();
    // 0 dB is unity, and faderDbToGain is the SAME boundary engineSync uses —
    // a snapshot carrying dB would make the engine read 0 as silence.
    expect(snapshot.masterVolume).toBeCloseTo(1, 6);
    expect(snapshot.buses.find((b) => b.source === 'chord')?.gain).toBeCloseTo(1, 6);
  });

  test('solo does not leak into the export; mute does', () => {
    useAppStore.setState({ soloTracks: ['drums'], chordMuted: false, bassMuted: true });
    const snapshot = useAppStore.getState().buildMixdownSnapshot();
    // Solo is a session-only monitoring gesture; it never reaches the export.
    expect(snapshot.buses.find((b) => b.source === 'chord')?.muted).toBe(false);
    // Mute is arrangement intent and does.
    expect(snapshot.buses.find((b) => b.source === 'bass')?.muted).toBe(true);
  });

  test('resolves stepsPerBar from the meter, so the renderer never parses a meter string', () => {
    useAppStore.setState({ meterId: '3/4' });
    expect(useAppStore.getState().buildMixdownSnapshot().stepsPerBar).toBe(12);
    useAppStore.setState({ meterId: '4/4' });
    expect(useAppStore.getState().buildMixdownSnapshot().stepsPerBar).toBe(16);
  });

  test('carries project content and derives the mixer from each loop', () => {
    const before = useAppStore.getState();
    const loop = {
      ...before.loops[0],
      chordVolume: -12,
      chordMuted: true,
      drumFilterCutoff: 2170,
      drumFilterResonance: 1,
      drumFilterType: 'lowpass' as const,
    };
    useAppStore.setState({
      loops: [loop],
      // Deliberately disagree with the loop: these flat fields describe the
      // active editor, not every loop in the arrangement.
      chordVolume: 0,
      chordMuted: false,
    });
    try {
      const snapshot = useAppStore.getState().buildMixdownSnapshot();
      expect(snapshot.loops).toHaveLength(1);
      expect(snapshot.loops[0].chords).toEqual(loop.chords);
      const chordBus = snapshot.loops[0].buses.find((b) => b.source === 'chord');
      expect(chordBus?.source).toBe('chord');
      expect(chordBus?.gain).toBeCloseTo(10 ** (-12 / 20), 6);
      expect(chordBus?.muted).toBe(true);
      expect(snapshot.loops[0].drumFilter).toEqual({
        cutoff: 2170,
        resonance: 1,
        type: 'lowpass',
      });
    } finally {
      useAppStore.setState({
        loops: before.loops,
        chordVolume: before.chordVolume,
        chordMuted: before.chordMuted,
      });
    }
  });
});

describe('exportMixdown', () => {
  const initialNotice = useAppStore.getState().projectNotice;
  const initialLoops = useAppStore.getState().loops;
  const initialProjectName = useAppStore.getState().projectName;
  afterEach(() => {
    useAppStore.setState({
      projectNotice: initialNotice,
      loops: initialLoops,
      projectName: initialProjectName,
      exporting: false,
      mixdownProgress: null,
    });
  });

  test('publishes renderer progress and clears it after export', async () => {
    const updates: unknown[] = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.mixdownProgress !== null) updates.push(state.mixdownProgress);
    });
    try {
      await useAppStore.getState().exportMixdown();
    } finally {
      unsubscribe();
    }

    expect(updates).toContainEqual({ phase: 'preparing' });
    expect(updates).toContainEqual({ phase: 'rendering', percent: 100 });
    expect(updates).toContainEqual({ phase: 'encoding' });
    expect(useAppStore.getState().mixdownProgress).toBeNull();
  });

  test('a successful export returns a WAV blob and a file name, and clears exporting', async () => {
    const result = await useAppStore.getState().exportMixdown();
    if (!result.ok) throw new Error('expected ok');
    expect(result.destination).toBe('download');
    expect(result.fileName.endsWith('.wav')).toBe(true);
    expect(result.blob.type).toBe('audio/wav');
    expect(result.blob.size).toBeGreaterThan(44);
    expect(useAppStore.getState().exporting).toBe(false);
  });

  test('captures the arrangement and file name before yielding to the browser', async () => {
    useAppStore.setState({ projectName: 'First Project' });
    const pending = useAppStore.getState().exportMixdown();

    // A project replacement can land while the preparing state paints. The
    // export must remain one coherent capture, never new content under an old
    // click or old content under a new file name.
    useAppStore.setState({ loops: [], projectName: 'Second Project' });

    const result = await pending;
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    expect(result.fileName).toBe('first-project.wav');
  });

  test('cancel marks the active job and returns no file or failure notice', async () => {
    useAppStore.setState({ projectNotice: null });
    const pending = useAppStore.getState().exportMixdown();

    useAppStore.getState().cancelMixdown();

    expect(useAppStore.getState().mixdownProgress).toEqual({ phase: 'cancelling' });
    expect(await pending).toEqual({ ok: false, reason: { kind: 'cancelled' } });
    expect(useAppStore.getState().projectNotice).toBeNull();
    expect(useAppStore.getState().exporting).toBe(false);
  });

  test('replacing the project cancels the export before installing new content', async () => {
    const pending = useAppStore.getState().exportMixdown();

    useAppStore.getState().newProject();

    expect(useAppStore.getState().mixdownProgress).toEqual({ phase: 'cancelling' });
    expect(await pending).toEqual({ ok: false, reason: { kind: 'cancelled' } });
  });

  test('an empty arrangement fails with a notice, and exporting is cleared anyway', async () => {
    useAppStore.setState({ loops: [] });
    const result = await useAppStore.getState().exportMixdown();
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
    expect(useAppStore.getState().projectNotice).toBe(MIXDOWN_FAILURE_MESSAGE['empty-arrangement']);
    // The `finally`: a failure must not leave the button stuck on "Exporting…".
    expect(useAppStore.getState().exporting).toBe(false);
  });

  test('the store never touches the DOM — it hands the blob back instead', async () => {
    // No `document`, no `URL.createObjectURL`, no anchor click: the component
    // downloads, exactly as it does for a `.solna` written to 'download'.
    const createObjectURL = globalThis.URL.createObjectURL;
    let called = false;
    globalThis.URL.createObjectURL = () => {
      called = true;
      return 'blob:test';
    };
    try {
      await useAppStore.getState().exportMixdown();
      expect(called).toBe(false);
    } finally {
      globalThis.URL.createObjectURL = createObjectURL;
    }
  });
});

describe('exporting is session state', () => {
  test('it is absent from the persisted shape', async () => {
    const { partializeAppState } = await import('./store');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('exporting' in persisted).toBe(false);
    expect('mixdownProgress' in persisted).toBe(false);
  });

  test('it starts false', () => {
    expect(useAppStore.getState().exporting).toBe(false);
    expect(useAppStore.getState().mixdownProgress).toBeNull();
  });
});
