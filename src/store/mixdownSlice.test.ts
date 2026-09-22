import { afterEach, describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { setOperationFailureSink } from '@/incidents/operationFailure';
import { MIXDOWN_FAILURE_MESSAGE } from './exportKinds';

// renderMixdown's capability probe reads `globalThis.OfflineAudioContext`, so
// the test provides it the way a browser does — see
// src/audio/export/renderMixdown.test.ts for why there is no injection seam.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

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

describe('mixdown incident reporting', () => {
  const initialLoops = useAppStore.getState().loops;
  afterEach(() => {
    useAppStore.setState({ loops: initialLoops, exporting: false, mixdownProgress: null, projectNotice: null });
  });

  test('reports a render-failed as an incident but not an empty arrangement or a cancellation', async () => {
    const incidents: string[] = [];
    setOperationFailureSink((input) => incidents.push(input.summary));
    const original = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
    try {
      useAppStore.setState({ loops: [] });
      await useAppStore.getState().exportMixdown();
      expect(incidents).toEqual([]);

      useAppStore.setState({ loops: initialLoops });
      (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = class {
        constructor() {
          throw new Error('boom');
        }
      };
      const result = await useAppStore.getState().exportMixdown();
      expect(result.ok === false && result.reason.kind).toBe('render-failed');
      expect(useAppStore.getState().projectNotice).toBe(MIXDOWN_FAILURE_MESSAGE['render-failed']);
      expect(incidents).toEqual(['Unexpected failure during mixdown']);
    } finally {
      (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = original;
      setOperationFailureSink(null);
    }
  });
});
