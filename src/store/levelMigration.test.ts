import { describe, expect, test } from 'bun:test';
import { normalizeStoredBody } from './projectFile';
import type { ProjectBody } from './projectFormat';

// The persist-side "vN -> vN+1" describes that used to live here (masterVolume,
// bus faders, per-track volumes) tested migrate.ts step functions DEV-388
// deleted along with the rest of the 15-step chain. There is no version-gated
// persist-side sibling of the project-body checks below any more: the persist
// path (store.ts's sanitizePersistedState / sanitizeLoops) now validates every
// level key by RANGE alone, regardless of what version wrote it — an old
// LINEAR value in range is no longer reset to unity, it passes through and is
// read as that same number of dB. See migrate.test.ts for that pinning test.
//
// migrateProjectBody and projectFormatMigrate.ts were deleted in the final
// review fix wave (pure identity function, no production caller). These
// three describes now go through normalizeStoredBody — the actual
// IndexedDB-library reader — which calls sanitizeContent and nothing else.

describe('project body: masterVolume is left exactly as written, at any version', () => {
  test('an older body keeps its stored value and the envelope is left alone', () => {
    const body = {
      formatVersion: 7,
      id: 'p1',
      name: 'Old',
      createdAt: 1,
      updatedAt: 2,
      content: { bpm: 128, masterVolume: 0.85, loops: [] },
    } as unknown as ProjectBody;
    const next = normalizeStoredBody(body);
    expect(next.content.masterVolume).toBe(0.85);
    expect(next.content.bpm).toBe(128);
    expect(next.id).toBe('p1');
  });
});

describe('project body: the five bus faders are left exactly as written, at any version', () => {
  test('an older body keeps every per-loop bus fader value', () => {
    const body = {
      formatVersion: 8,
      id: 'p1',
      content: {
        masterVolume: -6,
        loops: [
          { id: 'l1', synthVolume: 1, chordVolume: 0.5, bassVolume: 0, padVolume: 1.5, masterSequencerVolume: 0.8 },
        ],
      },
    } as unknown as ProjectBody;
    const content = normalizeStoredBody(body).content;
    const loop = content.loops[0] as unknown as Record<string, number>;
    expect(content.masterVolume).toBe(-6);
    expect(loop.synthVolume).toBe(1);
    expect(loop.chordVolume).toBe(0.5);
    expect(loop.bassVolume).toBe(0);
    expect(loop.padVolume).toBe(1.5);
    expect(loop.masterSequencerVolume).toBe(0.8);
  });
});

describe('project body: sequencer track volumes are left exactly as written, at any version', () => {
  test('an older body keeps every per-loop track volume', () => {
    const body = {
      formatVersion: 9,
      content: { loops: [{ id: 'l1', sequencerTracks: [{ id: 't1', instrument: 'kick', volume: 0.85, steps: [] }] }] },
    } as unknown as ProjectBody;
    const content = normalizeStoredBody(body).content;
    const loop = content.loops[0] as unknown as Record<string, unknown>;
    expect((loop.sequencerTracks as Record<string, number>[])[0].volume).toBe(0.85);
  });

  test('a body at the current version is left alone', () => {
    const body = {
      formatVersion: 10,
      content: { loops: [{ sequencerTracks: [{ instrument: 'kick', volume: -9, steps: [] }] }] },
    } as unknown as ProjectBody;
    const content = normalizeStoredBody(body).content;
    const loop = content.loops[0] as unknown as Record<string, unknown>;
    expect((loop.sequencerTracks as Record<string, number>[])[0].volume).toBe(-9);
  });
});
