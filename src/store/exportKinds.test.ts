import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { useAppStore } from './store';
import { buildMixdownSnapshot } from './mixdownSnapshot';
import { EXPORT_KINDS, MIXDOWN_FAILURE_MESSAGE, exportKind, wavFileName } from './exportKinds';

// renderMixdown's capability probe reads `globalThis.OfflineAudioContext`, so
// the test provides it the way a browser does.
(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

describe('wavFileName', () => {
  test('slugs the project name and swaps the extension', () => {
    expect(wavFileName('My Song')).toBe('my-song.wav');
    expect(wavFileName('')).toBe('project.wav');
    expect(wavFileName('!!!')).toBe('project.wav');
    expect(wavFileName(null)).toBe('project.wav');
  });
});

describe('export kind registry', () => {
  test('ids are unique and each resolves to its own spec', () => {
    const ids = EXPORT_KINDS.map((kind) => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of EXPORT_KINDS) expect(exportKind(kind.id)).toBe(kind);
  });

  test('ships exactly the WAV mixdown, labelled as the old menu row was', () => {
    expect(EXPORT_KINDS.map((kind) => [kind.id, kind.label])).toEqual([
      ['mixdown-wav', 'Export mixdown (WAV)'],
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
