import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { setOperationFailureSink } from '@/incidents/operationFailure';
import { MIXDOWN_FAILURE_MESSAGE } from './exportKinds';
import { selectExportBusy } from './exportSlice';
import { createDefaultLoop } from './loopSlice';
import type { ExportJob } from './exportJob';
import type { Loop } from './types';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

/**
 * `downloadBlob` drives an `<a download>` through `document` and the object-URL
 * pair. The suite has no DOM, so a minimal fake records which file names were
 * "clicked" — the store now owns the download (ADR-0035).
 */
interface FakeDownloads {
  names: string[];
  restore: () => void;
}

function installFakeDownloads(): FakeDownloads {
  const names: string[] = [];
  const g = globalThis as { document?: unknown };
  const previousDocument = g.document;
  const { createObjectURL, revokeObjectURL } = URL;
  g.document = {
    body: { appendChild: () => {} },
    createElement: () => {
      const anchor = { href: '', download: '', click: () => names.push(anchor.download), remove: () => {} };
      return anchor;
    },
  };
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
  return {
    names,
    restore: () => {
      if (previousDocument === undefined) delete g.document;
      else g.document = previousDocument;
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    },
  };
}

const initial = useAppStore.getState();
let downloads: FakeDownloads;

/**
 * The default loop's chord progression is `INITIAL_CHORDS` (4 bars); a full
 * mixdown render of it runs long enough (~1.5s through node-web-audio-api)
 * that this file's 5 real renders together crowd bun's per-test timeout. A
 * one-bar progression renders in milliseconds instead, and nothing in this
 * file asserts on the rendered audio — only the job lifecycle and the
 * downloaded file name — so a shorter arrangement changes nothing a test
 * checks.
 */
function fastLoop(): Loop {
  return { ...createDefaultLoop(), chords: [{ id: 'chord-1', root: 'C', quality: 'maj', bars: 1 }] };
}

beforeEach(() => {
  downloads = installFakeDownloads();
  useAppStore.setState({ loops: [fastLoop()] });
});

afterEach(() => {
  downloads.restore();
  useAppStore.setState({
    projectNotice: initial.projectNotice,
    loops: initial.loops,
    projectName: initial.projectName,
  });
  // A stranded job (the lock still held while the store thinks it is idle)
  // must fail the test that left it that way, not the next test that
  // happens to call startExport.
  expect(useAppStore.getState().exportJob).toBeNull();
});

describe('startExport — a successful job', () => {
  test('publishes every phase, then clears the job', async () => {
    const phases: unknown[] = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.exportJob !== null) phases.push(state.exportJob);
    });
    try {
      await useAppStore.getState().startExport('mixdown-wav');
    } finally {
      unsubscribe();
    }
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'preparing' });
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'rendering', percent: 100 });
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'encoding' });
    expect(phases).toContainEqual({ kind: 'mixdown-wav', phase: 'downloading' });
    expect(useAppStore.getState().exportJob).toBeNull();
    expect(selectExportBusy(useAppStore.getState())).toBe(false);
  });

  test('downloads one WAV named after the project and says so', async () => {
    useAppStore.setState({ projectName: 'My Song' });
    const outcome = await useAppStore.getState().startExport('mixdown-wav');
    expect(outcome).toEqual({ status: 'downloaded', fileName: 'my-song.wav' });
    expect(downloads.names).toEqual(['my-song.wav']);
    expect(useAppStore.getState().projectNotice).toBe('Exported my-song.wav.');
  });

  test('captures the arrangement and file name before yielding to the browser', async () => {
    useAppStore.setState({ projectName: 'First Project' });
    const pending = useAppStore.getState().startExport('mixdown-wav');
    // A project replacement can land while the preparing state paints. The
    // export must remain one coherent capture.
    useAppStore.setState({ loops: [], projectName: 'Second Project' });
    expect(await pending).toEqual({ status: 'downloaded', fileName: 'first-project.wav' });
  });

  test('a second start while a job runs is ignored', async () => {
    useAppStore.setState({ projectName: 'My Song' });
    const first = useAppStore.getState().startExport('mixdown-wav');
    expect(await useAppStore.getState().startExport('mixdown-wav')).toEqual({ status: 'ignored' });
    await first;
    expect(downloads.names).toEqual(['my-song.wav']);
  });
});

describe('startExport — cancellation', () => {
  test('cancel marks the job cancelling and ends it silently', async () => {
    useAppStore.setState({ projectNotice: null });
    const pending = useAppStore.getState().startExport('mixdown-wav');
    useAppStore.getState().cancelExport();
    expect(useAppStore.getState().exportJob).toEqual({ kind: 'mixdown-wav', phase: 'cancelling' });
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(useAppStore.getState().projectNotice).toBeNull();
    expect(downloads.names).toEqual([]);
    expect(useAppStore.getState().exportJob).toBeNull();
  });

  test('a start while cancelling drains is ignored', async () => {
    const pending = useAppStore.getState().startExport('mixdown-wav');
    useAppStore.getState().cancelExport();
    expect(await useAppStore.getState().startExport('mixdown-wav')).toEqual({ status: 'ignored' });
    await pending;
  });

  test('cancelExport with no job is a no-op', () => {
    useAppStore.getState().cancelExport();
    expect(useAppStore.getState().exportJob).toBeNull();
  });

  test('replacing the project cancels the export before installing new content', async () => {
    const before = useAppStore.getState();
    const pending = useAppStore.getState().startExport('mixdown-wav');
    await useAppStore.getState().newProject();
    expect(useAppStore.getState().exportJob).toEqual({ kind: 'mixdown-wav', phase: 'cancelling' });
    expect(await pending).toEqual({ status: 'cancelled' });
    // newProject() installs a whole factory project, far more than the three
    // fields the shared afterEach resets; restore everything it touched so
    // later tests see this file's own fixture again.
    useAppStore.setState(before);
  });

  test('cancel mid-render drops every later phase (the publish guard, not a store reset)', async () => {
    const phases: ExportJob[] = [];
    let cancelled = false;
    const unsubscribe = useAppStore.subscribe((state) => {
      const job = state.exportJob;
      if (job === null) return;
      phases.push(job);
      if (!cancelled && job.phase === 'rendering') {
        cancelled = true;
        useAppStore.getState().cancelExport();
      }
    });
    let outcome: unknown;
    try {
      outcome = await useAppStore.getState().startExport('mixdown-wav');
    } finally {
      unsubscribe();
    }
    expect(outcome).toEqual({ status: 'cancelled' });
    const cancellingIndex = phases.findIndex((job) => job.phase === 'cancelling');
    expect(cancellingIndex).toBeGreaterThanOrEqual(0);
    // Every phase published after the cancel is dropped by startExport's own
    // `publish` guard (`activeJob === job && !signal.aborted`) — nothing later
    // ever reaches the store, so `cancelling` is the last phase observed.
    expect(phases.slice(cancellingIndex + 1)).toEqual([]);
  });
});

describe('startExport — failures', () => {
  afterEach(() => setOperationFailureSink(null));

  test('an empty arrangement fails with a notice, and the job is cleared anyway', async () => {
    useAppStore.setState({ loops: [] });
    const outcome = await useAppStore.getState().startExport('mixdown-wav');
    expect(outcome).toEqual({ status: 'failed', reason: { kind: 'empty-arrangement' } });
    expect(useAppStore.getState().projectNotice).toBe(MIXDOWN_FAILURE_MESSAGE['empty-arrangement']);
    expect(useAppStore.getState().exportJob).toBeNull();
  });

  test('reports a render-failed as an incident but not an empty arrangement', async () => {
    const incidents: string[] = [];
    setOperationFailureSink((input) => incidents.push(input.summary));
    const original = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
    try {
      useAppStore.setState({ loops: [] });
      await useAppStore.getState().startExport('mixdown-wav');
      expect(incidents).toEqual([]);

      useAppStore.setState({ loops: initial.loops });
      (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = class {
        constructor() {
          throw new Error('boom');
        }
      };
      const outcome = await useAppStore.getState().startExport('mixdown-wav');
      expect(outcome.status === 'failed' && outcome.reason.kind).toBe('render-failed');
      expect(useAppStore.getState().projectNotice).toBe(MIXDOWN_FAILURE_MESSAGE['render-failed']);
      expect(incidents).toEqual(['Unexpected failure during mixdown']);
    } finally {
      (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = original;
    }
  });
});

describe('the export job is session state', () => {
  test('it is absent from the persisted shape', async () => {
    const { partializeAppState } = await import('./store');
    const persisted = partializeAppState(useAppStore.getState()) as unknown as Record<string, unknown>;
    expect('exportJob' in persisted).toBe(false);
  });

  test('it starts null', () => {
    expect(initial.exportJob).toBeNull();
  });
});
