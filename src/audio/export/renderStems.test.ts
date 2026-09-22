import { describe, expect, spyOn, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { renderMixdown, type MixdownRenderProgress } from './renderMixdown';
import { renderStems, STEM_CHANNELS, STEM_TRACKS } from './renderStems';
import * as zipStore from './zipStore';
import { readZip } from './zipTestReader';
import { mixdownLoop, mixdownMelodyBar } from './mixdownFixture';
import { neutralSnapshot, silentBeatPattern } from './stemsFixture';
import * as encodeWav from '@/utils/encodeWav';
import type { MixdownBusState } from '../playback/plan/songSnapshot';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

const DATE = new Date(2026, 8, 22, 12, 0, 0);
const CANCELLED = { ok: false, reason: { kind: 'cancelled' } };

function wavHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bits: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}

function muteLead(buses: readonly MixdownBusState[]): MixdownBusState[] {
  return buses.map((bus) => (bus.source === 'synth' ? { ...bus, muted: true } : bus));
}

describe('renderStems: shape', () => {
  test('STEM_TRACKS is chord, bass, pad, lead, fx, beat over the engine sources', () => {
    expect(STEM_TRACKS.map((track) => [track.source, track.name])).toEqual([
      ['chord', 'chord'], ['bass', 'bass'], ['pad', 'pad'],
      ['synth', 'lead'], ['fx', 'fx'], ['sequencer', 'beat'],
    ]);
    expect(STEM_CHANNELS).toBe(STEM_TRACKS.length * 2);
  });

  test('six stereo 16-bit 44.1 kHz WAVs, as long as the mixdown, in STEM_TRACKS order', async () => {
    const snapshot = neutralSnapshot();
    const result = await renderStems(snapshot, 'my-song', DATE);
    const mix = await renderMixdown(snapshot);
    if (!result.ok || !mix.ok) throw new Error('render failed');
    const names = ['chord', 'bass', 'pad', 'lead', 'fx', 'beat'].map((name) => `my-song-${name}.wav`);
    expect(result.entries).toEqual(names);
    expect(result.blob.type).toBe('application/zip');
    expect(result.buffer.numberOfChannels).toBe(STEM_CHANNELS);
    expect(result.buffer.length).toBe(mix.buffer.length);
    const entries = readZip(new Uint8Array(await result.blob.arrayBuffer()));
    expect(entries.map((entry) => entry.name)).toEqual(names);
    for (const entry of entries) {
      expect(wavHeader(entry.data)).toEqual({
        channels: 2, sampleRate: 44100, bits: 16, dataBytes: mix.buffer.length * 4,
      });
    }
  });
});

describe('renderStems: a stem is written iff a walk event targets its bus', () => {
  test('tracks with no content anywhere have no file', async () => {
    // Chordless: no chord, bass or pad event (there is no pad-off mode); FX empty.
    const loop = mixdownLoop({ chords: [], leadMelodySteps: mixdownMelodyBar('C5') });
    const result = await renderStems(neutralSnapshot({ loops: [loop] }), 'song', DATE);
    if (!result.ok) throw new Error(JSON.stringify(result.reason));
    expect(result.entries).toEqual(['song-lead.wav', 'song-beat.wav']);
  });

  test('a track muted in every loop but with content is written', async () => {
    const base = mixdownLoop({ chords: [], leadMelodySteps: mixdownMelodyBar('C5') });
    const snapshot = neutralSnapshot({ loops: [{ ...base, buses: muteLead(base.buses) }] });
    const result = await renderStems({ ...snapshot, buses: muteLead(snapshot.buses) }, 'song', DATE);
    if (!result.ok) throw new Error(JSON.stringify(result.reason));
    expect(result.entries).toEqual(['song-lead.wav', 'song-beat.wav']);
  });

  test('no event on any bus is empty-arrangement', async () => {
    const loop = mixdownLoop({ chords: [], beatPattern: silentBeatPattern() });
    expect(await renderStems(neutralSnapshot({ loops: [loop] }), 'song', DATE))
      .toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });

  test('no loops is empty-arrangement', async () => {
    expect(await renderStems(neutralSnapshot({ loops: [] }), 'song', DATE))
      .toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });
});

describe('renderStems: progress, cancellation and failure', () => {
  test('reports preparing, then rendering, then encoding', async () => {
    const phases: MixdownRenderProgress['phase'][] = [];
    const result = await renderStems(neutralSnapshot(), 'song', DATE, (progress) => {
      phases.push(progress.phase);
    });
    expect(result.ok).toBe(true);
    expect(phases[0]).toBe('preparing');
    expect(phases).toContain('rendering');
    expect(phases.at(-1)).toBe('encoding');
  });

  test('a throwing progress observer never fails the render', async () => {
    const result = await renderStems(neutralSnapshot(), 'song', DATE, () => {
      throw new Error('observer');
    });
    expect(result.ok).toBe(true);
  });

  test('an already-aborted signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await renderStems(neutralSnapshot(), 'song', DATE, undefined, controller.signal)).toEqual(CANCELLED);
  });

  test('an abort during the schedule walk is cancelled before rendering', async () => {
    const controller = new AbortController();
    const phases: string[] = [];
    // repeatCount 40 → 640 dwell steps, past the 200-step yield interval.
    const snapshot = neutralSnapshot({ loops: [mixdownLoop({ repeatCount: 40 })] });
    const result = await renderStems(snapshot, 'song', DATE, (progress) => {
      phases.push(progress.phase);
      if (progress.phase === 'preparing') controller.abort();
    }, controller.signal);
    expect(result).toEqual(CANCELLED);
    expect(phases).not.toContain('rendering');
  });

  test('an abort between stem encodes is cancelled', async () => {
    const controller = new AbortController();
    const result = await renderStems(neutralSnapshot(), 'song', DATE, (progress) => {
      if (progress.phase === 'encoding') controller.abort();
    }, controller.signal);
    expect(result).toEqual(CANCELLED);
  });

  test('an abort right after the last stem encode is cancelled and builds no Blob', async () => {
    const controller = new AbortController();
    const original = encodeWav.encodeWavBytes;
    let calls = 0;
    const encodeSpy = spyOn(encodeWav, 'encodeWavBytes').mockImplementation((channels, sampleRate) => {
      calls += 1;
      const bytes = original(channels, sampleRate);
      if (calls === STEM_TRACKS.length) controller.abort();
      return bytes;
    });
    const zipSpy = spyOn(zipStore, 'encodeZipStore');
    try {
      const result = await renderStems(neutralSnapshot(), 'song', DATE, undefined, controller.signal);
      expect(result).toEqual(CANCELLED);
      expect(zipSpy).not.toHaveBeenCalled();
    } finally {
      encodeSpy.mockRestore();
      zipSpy.mockRestore();
    }
  });

  test('a throwing ZIP writer is render-failed', async () => {
    const spy = spyOn(zipStore, 'encodeZipStore').mockImplementation(() => {
      throw new RangeError('too big');
    });
    try {
      expect(await renderStems(neutralSnapshot(), 'song', DATE))
        .toEqual({ ok: false, reason: { kind: 'render-failed', detail: 'too big' } });
    } finally {
      spy.mockRestore();
    }
  });
});
