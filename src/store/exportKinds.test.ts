import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { buildMixdownSnapshot } from './mixdownSnapshot';
import { readSmf } from '@/audio/export/smfTestReader';
import {
  EXPORT_KINDS,
  MIDI_FAILURE_MESSAGE,
  MIXDOWN_FAILURE_MESSAGE,
  exportKind,
  midiFileName,
  wavFileName,
} from './exportKinds';

// renderMixdown's capability probe reads `globalThis.OfflineAudioContext`, so
// the test provides it the way a browser does.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

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

describe('export kind registry', () => {
  test('ids are unique and each resolves to its own spec', () => {
    const ids = EXPORT_KINDS.map((kind) => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of EXPORT_KINDS) expect(exportKind(kind.id)).toBe(kind);
  });

  test('ships the WAV mixdown then MIDI, in dialog order', () => {
    expect(EXPORT_KINDS.map((kind) => [kind.id, kind.label])).toEqual([
      ['mixdown-wav', 'Export mixdown (WAV)'],
      ['midi', 'Export MIDI (.mid)'],
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
