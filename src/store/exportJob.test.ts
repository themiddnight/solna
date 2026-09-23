import { describe, expect, test } from 'bun:test';
import type { MixdownSnapshot } from '@/audio/playback/plan/songSnapshot';
import type { ExportKindSpec } from './exportKinds';
import { DOWNLOAD_FAILED_MESSAGE } from '@/utils/projectFileIO';
import {
  exportSuccessMessage,
  runExportJob,
  type ExportJobDeps,
} from './exportJob';

const WAV = new Blob(['wav'], { type: 'audio/wav' });

function fakeKind(run: ExportKindSpec['run']): ExportKindSpec {
  return {
    id: 'mixdown-wav',
    label: 'Fake',
    progressLabels: { rendering: 'Rendering fake', encoding: 'Encoding fake' },
    failureMessages: {
      'empty-arrangement': 'empty',
      'unsupported-context': 'unsupported',
      'render-failed': 'failed',
    },
    incidentOperation: 'mixdown',
    run,
  };
}

const okRun: ExportKindSpec['run'] = async (_snapshot, onProgress) => {
  onProgress({ phase: 'rendering', percent: 100 });
  return { ok: true, blob: WAV, fileName: 'my-song.wav' };
};

interface Harness {
  deps: ExportJobDeps;
  events: string[];
  notices: string[];
  tones: string[];
  incidents: [string, string][];
  controller: AbortController;
}

function harness(kind: ExportKindSpec, overrides: Partial<ExportJobDeps> = {}): Harness {
  const events: string[] = [];
  const notices: string[] = [];
  const tones: string[] = [];
  const incidents: [string, string][] = [];
  const controller = new AbortController();
  const deps: ExportJobDeps = {
    kind,
    snapshot: { song: {} as MixdownSnapshot, projectName: 'My Song' },
    signal: controller.signal,
    publish: (p) => events.push(p.phase === 'rendering' ? `rendering ${p.percent}` : p.phase),
    notify: (message, tone) => {
      notices.push(message);
      tones.push(tone);
    },
    download: (fileName) => events.push(`download ${fileName}`),
    yieldToTask: async () => {
      events.push('task');
    },
    yieldToBrowserPaint: async () => {
      events.push('paint');
    },
    reportFailure: (operation, detail) => incidents.push([operation, detail]),
    ...overrides,
  };
  return { deps, events, notices, tones, incidents, controller };
}

describe('runExportJob — success and delivery', () => {
  test('yields, renders, paints Downloading, downloads, then says so', async () => {
    const h = harness(fakeKind(okRun));
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'downloaded', fileName: 'my-song.wav' });
    expect(h.events).toEqual(['task', 'rendering 100', 'downloading', 'paint', 'download my-song.wav']);
    expect(h.notices).toEqual(['Exported my-song.wav.']);
    expect(h.tones).toEqual(['success']);
  });

  // The download is the one step that can throw AFTER a full render — a
  // blocked download, a sandboxed frame. Silent here, the user waits out a
  // render, gets no file and is told nothing.
  test('a download that throws is reported, and claims no success', async () => {
    const h = harness(fakeKind(okRun), {
      download: () => {
        throw new Error('blocked');
      },
    });
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'download-failed', fileName: 'my-song.wav' });
    expect(h.notices).toEqual([DOWNLOAD_FAILED_MESSAGE]);
    expect(h.tones).toEqual(['error']);
  });

  test('the messages keep their wording', () => {
    expect(exportSuccessMessage('a.wav')).toBe('Exported a.wav.');
    expect(DOWNLOAD_FAILED_MESSAGE).toBe('Could not write the file. Check the browser’s download settings.');
  });
});

describe('runExportJob — failures', () => {
  test('a render failure writes the kind\'s sentence and downloads nothing', async () => {
    const h = harness(fakeKind(async () => ({ ok: false, reason: { kind: 'empty-arrangement' } })));
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'failed', reason: { kind: 'empty-arrangement' } });
    expect(h.notices).toEqual(['empty']);
    expect(h.tones).toEqual(['error']);
    expect(h.events).toEqual(['task']);
    expect(h.incidents).toEqual([]);
  });

  test('only render-failed is reported as an incident', async () => {
    const h = harness(fakeKind(async () => ({ ok: false, reason: { kind: 'render-failed', detail: 'boom' } })));
    await runExportJob(h.deps);
    expect(h.notices).toEqual(['failed']);
    expect(h.tones).toEqual(['error']);
    expect(h.incidents).toEqual([['mixdown', 'boom']]);
  });

  test('a kind that rejects is a render-failed, never a stuck job', async () => {
    const h = harness(fakeKind(async () => {
      throw new Error('kaput');
    }));
    const outcome = await runExportJob(h.deps);
    expect(outcome).toEqual({ status: 'failed', reason: { kind: 'render-failed', detail: 'kaput' } });
    expect(h.incidents).toEqual([['mixdown', 'kaput']]);
  });
});

describe('runExportJob — cancellation', () => {
  test('a cancelled render writes nothing', async () => {
    const h = harness(fakeKind(async () => ({ ok: false, reason: { kind: 'cancelled' } })));
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(h.notices).toEqual([]);
    expect(h.incidents).toEqual([]);
  });

  test('an abort before the render starts never runs the kind', async () => {
    let ran = false;
    const h = harness(fakeKind(async (...args) => {
      ran = true;
      return okRun(...args);
    }));
    h.controller.abort();
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(ran).toBe(false);
  });

  test('an abort after a successful render skips Downloading entirely', async () => {
    let controller: AbortController | null = null;
    const h = harness(fakeKind(async (...args) => {
      controller?.abort();
      return okRun(...args);
    }));
    controller = h.controller;
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(h.events).not.toContain('downloading');
    expect(h.notices).toEqual([]);
  });

  test('an abort during the paint suppresses download and success', async () => {
    const h = harness(fakeKind(okRun));
    h.deps.yieldToBrowserPaint = async () => {
      h.controller.abort();
    };
    expect(await runExportJob(h.deps)).toEqual({ status: 'cancelled' });
    expect(h.events).not.toContain('download my-song.wav');
    expect(h.notices).toEqual([]);
  });
});
