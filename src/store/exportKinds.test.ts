import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { buildMixdownSnapshot } from './mixdownSnapshot';
import { readSmf } from '@/audio/export/smfTestReader';
import { STEM_TRACKS } from '@/audio/export/renderStems';
import { readZip } from '@/audio/export/zipTestReader';
import { SOURCE_BUSES } from './sourceBuses';
import {
  EXPORT_KINDS,
  MIDI_FAILURE_MESSAGE,
  MIXDOWN_FAILURE_MESSAGE,
  STEMS_FAILURE_MESSAGE,
  exportKind,
  midiFileName,
  stemsFileName,
  wavFileName,
} from './exportKinds';

// renderMixdown's capability probe reads `globalThis.OfflineAudioContext`, so
// the test provides it the way a browser does.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// tsc resolves bun:test's types without the (name, fn, timeoutMs) overload; Bun provides it at runtime.
type TestWithTimeout = (name: string, fn: () => Promise<void>, timeoutMs: number) => void;

describe('wavFileName', () => {
  test('slugs the project name and swaps the extension', () => {
    expect(wavFileName('My Song')).toBe('my-song.wav');
    expect(wavFileName('')).toBe('project.wav');
    expect(wavFileName('!!!')).toBe('project.wav');
    expect(wavFileName(null)).toBe('project.wav');
  });
});

test('midiFileName slugs the project name', () => {
  expect(midiFileName('My Song')).toBe('my-song.mid');
  expect(midiFileName('')).toBe('project.mid');
  expect(midiFileName('!!!')).toBe('project.mid');
  expect(midiFileName(null)).toBe('project.mid');
});

test('stemsFileName slugs the project name', () => {
  expect(stemsFileName('My Song')).toBe('my-song-stems.zip');
  expect(stemsFileName('')).toBe('project-stems.zip');
  expect(stemsFileName('!!!')).toBe('project-stems.zip');
  expect(stemsFileName(null)).toBe('project-stems.zip');
});

describe('export kind registry', () => {
  test('ids are unique and each resolves to its own spec', () => {
    const ids = EXPORT_KINDS.map((kind) => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of EXPORT_KINDS) expect(exportKind(kind.id)).toBe(kind);
  });

  test('ships the WAV mixdown, MIDI, then stems, in dialog order', () => {
    expect(EXPORT_KINDS.map((kind) => [kind.id, kind.label])).toEqual([
      ['mixdown-wav', 'Export mixdown (WAV)'],
      ['midi', 'Export MIDI (.mid)'],
      ['stems', 'Export stems (WAV, .zip)'],
    ]);
  });

  test('the WAV kind keeps the mixdown wording and incident operation', () => {
    const wav = exportKind('mixdown-wav');
    expect(wav.progressLabels).toEqual({ rendering: 'Rendering mixdown', encoding: 'Encoding WAV' });
    expect(wav.failureMessages).toBe(MIXDOWN_FAILURE_MESSAGE);
    expect(wav.incidentOperation).toBe('mixdown');
  });

  test('the failure sentences are unchanged', () => {
    expect(MIXDOWN_FAILURE_MESSAGE).toEqual({
      'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
      'unsupported-context': 'This browser cannot render audio offline, so the mixdown could not be written.',
      'render-failed': 'The mixdown could not be rendered. Your project is unchanged; try again.',
    });
  });

  test('the MIDI kind wording and incident operation', () => {
    const midi = exportKind('midi');
    expect(midi.progressLabels).toEqual({ rendering: 'Building MIDI', encoding: 'Writing MIDI file' });
    expect(midi.failureMessages).toBe(MIDI_FAILURE_MESSAGE);
    expect(midi.incidentOperation).toBe('midi-export');
    expect(MIDI_FAILURE_MESSAGE).toEqual({
      'empty-arrangement': 'There is nothing to export — the arrangement has no loops.',
      'unsupported-context': 'This browser cannot write the MIDI file.',
      'render-failed': 'The MIDI file could not be written. Your project is unchanged; try again.',
    });
  });

  test('the stems kind wording and incident operation', () => {
    const stems = exportKind('stems');
    expect(stems.progressLabels).toEqual({ rendering: 'Rendering stems', encoding: 'Encoding stems' });
    expect(stems.failureMessages).toBe(STEMS_FAILURE_MESSAGE);
    expect(stems.incidentOperation).toBe('stems-export');
    expect(STEMS_FAILURE_MESSAGE).toEqual({
      'empty-arrangement': 'There is nothing to export — the arrangement has no loops or no notes.',
      'unsupported-context': 'This browser cannot render audio offline, so the stems could not be written.',
      'render-failed': 'The stems could not be rendered. Your project is unchanged; try again.',
    });
  });

  test('STEM_TRACKS covers every source bus exactly once', () => {
    const sources = STEM_TRACKS.map((track) => track.source);
    expect(new Set(sources).size).toBe(sources.length);
    expect([...sources].sort()).toEqual(SOURCE_BUSES.map((bus) => bus.source).sort());
  });
});

describe('the WAV kind run', () => {
  test('renders the captured song and names the file from the captured project name', async () => {
    const snapshot = { song: buildMixdownSnapshot(useAppStore.getState()), projectName: 'My Song' };
    const phases: string[] = [];
    const result = await exportKind('mixdown-wav').run(
      snapshot,
      (progress) => phases.push(progress.phase),
      new AbortController().signal,
    );
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    expect(result.fileName).toBe('my-song.wav');
    expect(result.blob.type).toBe('audio/wav');
    expect(result.blob.size).toBeGreaterThan(44);
    expect(phases).toContain('rendering');
    expect(phases).toContain('encoding');
  });

  test('an empty arrangement is returned as the renderer reported it', async () => {
    const song = { ...buildMixdownSnapshot(useAppStore.getState()), loops: [] };
    const result = await exportKind('mixdown-wav').run(
      { song, projectName: null },
      () => {},
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('an already-aborted signal returns cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await exportKind('mixdown-wav').run(
      { song: buildMixdownSnapshot(useAppStore.getState()), projectName: null },
      () => {},
      controller.signal,
    );
    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
  });
});

describe('the MIDI kind run', () => {
  test('renders the captured song as audio/midi named from the project', async () => {
    const snapshot = { song: buildMixdownSnapshot(useAppStore.getState()), projectName: 'My Song' };
    const result = await exportKind('midi').run(snapshot, () => {}, new AbortController().signal);
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    expect(result.fileName).toBe('my-song.mid');
    expect(result.blob.type).toBe('audio/midi');
    const bytes = await bytesOf(result.blob);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
  });

  test('an empty arrangement is returned as reported', async () => {
    const song = { ...buildMixdownSnapshot(useAppStore.getState()), loops: [] };
    const result = await exportKind('midi').run(
      { song, projectName: null },
      () => {},
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('an already-aborted signal returns cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await exportKind('midi').run(
      { song: buildMixdownSnapshot(useAppStore.getState()), projectName: null },
      () => {},
      controller.signal,
    );
    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
  });

  test('an empty or whitespace-only project name falls back to the title Solna', async () => {
    for (const projectName of ['', '   ']) {
      const result = await exportKind('midi').run(
        { song: buildMixdownSnapshot(useAppStore.getState()), projectName },
        () => {},
        new AbortController().signal,
      );
      if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
      const bytes = await bytesOf(result.blob);
      const file = readSmf(bytes);
      expect(file.tracks[0].name).toBe('Solna');
    }
  });

  test('solo changes nothing', async () => {
    const baseline = await exportKind('midi').run(
      { song: buildMixdownSnapshot(useAppStore.getState()), projectName: null },
      () => {},
      new AbortController().signal,
    );
    if (!baseline.ok) throw new Error(`expected ok, got ${JSON.stringify(baseline.reason)}`);
    try {
      useAppStore.getState().toggleSoloTrack('lead');
      const soloed = await exportKind('midi').run(
        { song: buildMixdownSnapshot(useAppStore.getState()), projectName: null },
        () => {},
        new AbortController().signal,
      );
      if (!soloed.ok) throw new Error(`expected ok, got ${JSON.stringify(soloed.reason)}`);
      expect(await bytesOf(soloed.blob)).toEqual(await bytesOf(baseline.blob));
    } finally {
      useAppStore.getState().clearSoloTracks();
    }
  });
});

describe('the stems kind run', () => {
  (test as TestWithTimeout)('renders the captured song as one zip named from the project', async () => {
    const snapshot = { song: buildMixdownSnapshot(useAppStore.getState()), projectName: 'My Song' };
    const result = await exportKind('stems').run(snapshot, () => {}, new AbortController().signal);
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
    expect(result.fileName).toBe('my-song-stems.zip');
    expect(result.blob.type).toBe('application/zip');
    const entries = readZip(await bytesOf(result.blob));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.name).toMatch(/^my-song-(chord|bass|pad|lead|fx|beat)\.wav$/);
  }, 30_000);

  test('an empty arrangement is returned as reported', async () => {
    const song = { ...buildMixdownSnapshot(useAppStore.getState()), loops: [] };
    const result = await exportKind('stems').run({ song, projectName: null }, () => {}, new AbortController().signal);
    expect(result).toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('an already-aborted signal returns cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await exportKind('stems').run(
      { song: buildMixdownSnapshot(useAppStore.getState()), projectName: null },
      () => {},
      controller.signal,
    );
    expect(result).toEqual({ ok: false, reason: { kind: 'cancelled' } });
  });

  (test as TestWithTimeout)('solo changes nothing', async () => {
    const run = async () => {
      const result = await exportKind('stems').run(
        { song: buildMixdownSnapshot(useAppStore.getState()), projectName: null },
        () => {},
        new AbortController().signal,
      );
      if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.reason)}`);
      // Entries, not blob bytes: the DOS time in the headers is the export time.
      return readZip(await bytesOf(result.blob));
    };
    const baseline = await run();
    try {
      useAppStore.getState().toggleSoloTrack('lead');
      expect(await run()).toEqual(baseline);
    } finally {
      useAppStore.getState().clearSoloTracks();
    }
  }, 60_000);
});
