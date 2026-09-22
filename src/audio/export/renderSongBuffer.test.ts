import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  MIXDOWN_SAMPLE_RATE,
  renderMixdown,
  renderSongBuffer,
  type SongRenderLayout,
} from './renderMixdown';
import { beatPatternFixture, mixdownLoop, mixdownMelodyBar, mixdownSnapshot } from './mixdownFixture';

(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = OfflineAudioContext;

const STEREO: SongRenderLayout = { channels: 2 };
const noReport = () => {};

/** Chords (chord, bass, pad), a Lead bar and the fixture kick; FX empty. */
function leadAndChords() {
  return mixdownSnapshot({ loops: [mixdownLoop({ leadMelodySteps: mixdownMelodyBar('E4') })] });
}

function peak(buffer: AudioBuffer): number {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]));
  }
  return max;
}

async function okBuffer(promise: ReturnType<typeof renderSongBuffer>) {
  const result = await promise;
  if (!result.ok) throw new Error(`render failed: ${JSON.stringify(result.reason)}`);
  return result;
}

describe('renderSongBuffer', () => {
  test('reports every bus a walk event targeted, and only those', async () => {
    const { sourcesWithEvents } = await okBuffer(renderSongBuffer(leadAndChords(), STEREO, noReport));
    expect([...sourcesWithEvents].sort()).toEqual(['bass', 'chord', 'pad', 'sequencer', 'synth']);
  });

  test('a chordless loop with no melody and no hit reports no source', async () => {
    const pattern = beatPatternFixture();
    pattern.rows.kick = pattern.rows.kick.map(() => false);
    const snapshot = mixdownSnapshot({ loops: [mixdownLoop({ chords: [], beatPattern: pattern })] });
    const { sourcesWithEvents } = await okBuffer(renderSongBuffer(snapshot, STEREO, noReport));
    expect(sourcesWithEvents.size).toBe(0);
  });

  test('channels comes from the layout; length and rate are the mixdown\'s', async () => {
    const snapshot = leadAndChords();
    const { buffer } = await okBuffer(renderSongBuffer(snapshot, { channels: 4 }, noReport));
    const mix = await renderMixdown(snapshot);
    if (!mix.ok) throw new Error('mixdown failed');
    expect(buffer.numberOfChannels).toBe(4);
    expect(buffer.length).toBe(mix.buffer.length);
    expect(buffer.sampleRate).toBe(MIXDOWN_SAMPLE_RATE);
  });

  test('with two channels and no options it is the mixdown\'s own buffer', async () => {
    const snapshot = leadAndChords();
    const { buffer } = await okBuffer(renderSongBuffer(snapshot, STEREO, noReport));
    const mix = await renderMixdown(snapshot);
    if (!mix.ok) throw new Error('mixdown failed');
    for (let c = 0; c < 2; c += 1) expect(buffer.getChannelData(c)).toEqual(mix.buffer.getChannelData(c));
  });

  test('detachMaster sends nothing to the destination', async () => {
    const { buffer } = await okBuffer(
      renderSongBuffer(leadAndChords(), { channels: 2, detachMaster: true }, noReport),
    );
    expect(peak(buffer)).toBe(0);
  });

  test('wire runs once on the built engine, before the walk', async () => {
    let calls = 0;
    const layout: SongRenderLayout = {
      channels: 2,
      detachMaster: true,
      wire: (engine, ctx) => {
        calls += 1;
        engine.connectSourceStem('chord', ctx.destination);
      },
    };
    const { buffer } = await okBuffer(renderSongBuffer(leadAndChords(), layout, noReport));
    expect(calls).toBe(1);
    expect(peak(buffer)).toBeGreaterThan(1e-3);
  });

  test('guards: an aborted signal is cancelled, no loops is empty-arrangement', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await renderSongBuffer(leadAndChords(), STEREO, noReport, controller.signal))
      .toEqual({ ok: false, reason: { kind: 'cancelled' } });
    expect(await renderSongBuffer(mixdownSnapshot({ loops: [] }), STEREO, noReport))
      .toEqual({ ok: false, reason: { kind: 'empty-arrangement' } });
  });
});
