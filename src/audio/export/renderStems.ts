/**
 * Dry stems (ADR-0038, R307–R311): one WAV per track bus, zipped.
 *
 * One offline render of `STEM_CHANNELS` channels through `renderSongBuffer` —
 * the mixdown's seed, walk, sample rate and length — with the master rack built
 * but detached, and each source bus tapped at its output (after fader and mute,
 * before any send) onto channels 2i / 2i+1. A stem is written iff a walk event
 * targeted its bus (R310). No normalisation: samples clamp at ±1 in the encoder.
 *
 * Imports only src/audio/ and src/utils/ — no store (R028); no lane planner
 * (R287): the walk arrives only through `renderSongBuffer` (R288).
 */
import type { AudioEngine } from '../engine';
import type { MixdownSnapshot } from '../playback/plan/songSnapshot';
import {
  MIXDOWN_SAMPLE_RATE,
  renderSongBuffer,
  safeProgressReporter,
  type MixdownFailureReason,
  type MixdownProgressReporter,
  type SongRenderLayout,
} from './renderMixdown';
import { encodeZipStore, type ZipEntry } from './zipStore';
import { encodeWavBytes } from '@/utils/encodeWav';

/**
 * Zip order and file suffix per engine source: the MIDI lane order. A store
 * test asserts it covers `SOURCE_BUSES` once (this layer may not import it).
 */
export const STEM_TRACKS: readonly { source: string; name: string }[] = [
  { source: 'chord', name: 'chord' },
  { source: 'bass', name: 'bass' },
  { source: 'pad', name: 'pad' },
  { source: 'synth', name: 'lead' },
  { source: 'fx', name: 'fx' },
  { source: 'sequencer', name: 'beat' },
];

export const STEM_CHANNELS = STEM_TRACKS.length * 2;

export type StemsRenderResult =
  | { ok: true; buffer: AudioBuffer; blob: Blob; entries: readonly string[] }
  | { ok: false; reason: MixdownFailureReason };

/**
 * Stem i → destination channels 2i, 2i+1. The tap is an explicit 2-channel
 * 'speakers' gain, so a mono bus up-mixes to L = R exactly as the mixdown's
 * stereo destination does. Adds edges and nodes only; draws no random number.
 */
function wireStemTaps(engine: AudioEngine, ctx: OfflineAudioContext): void {
  ctx.destination.channelInterpretation = 'discrete';
  const merger = ctx.createChannelMerger(STEM_CHANNELS);
  merger.connect(ctx.destination);
  STEM_TRACKS.forEach(({ source }, i) => {
    const tap = ctx.createGain();
    tap.channelCount = 2;
    tap.channelCountMode = 'explicit';
    tap.channelInterpretation = 'speakers';
    const splitter = ctx.createChannelSplitter(2);
    tap.connect(splitter);
    splitter.connect(merger, 0, 2 * i);
    splitter.connect(merger, 1, 2 * i + 1);
    engine.connectSourceStem(source, tap);
  });
}

const STEMS_LAYOUT: SongRenderLayout = { channels: STEM_CHANNELS, detachMaster: true, wire: wireStemTaps };

/** Renders every track with content to `${baseName}-${name}.wav` inside one ZIP. NEVER THROWS. */
export async function renderStems(
  snapshot: MixdownSnapshot,
  baseName: string,
  modified: Date,
  onProgress?: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<StemsRenderResult> {
  const report = safeProgressReporter(onProgress);
  try {
    const rendered = await renderSongBuffer(snapshot, STEMS_LAYOUT, report, signal);
    if (!rendered.ok) return rendered;
    const { buffer, sourcesWithEvents } = rendered;
    const kept = STEM_TRACKS
      .map((track, index) => ({ ...track, index }))
      .filter((track) => sourcesWithEvents.has(track.source));
    if (kept.length === 0) return { ok: false, reason: { kind: 'empty-arrangement' } };

    report({ phase: 'encoding' });
    const entries: ZipEntry[] = [];
    for (const track of kept) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) return { ok: false, reason: { kind: 'cancelled' } };
      entries.push({
        name: `${baseName}-${track.name}.wav`,
        data: encodeWavBytes(
          [buffer.getChannelData(2 * track.index), buffer.getChannelData(2 * track.index + 1)],
          MIXDOWN_SAMPLE_RATE,
        ),
      });
    }
    const blob = new Blob(encodeZipStore(entries, modified), { type: 'application/zip' });
    return { ok: true, buffer, blob, entries: entries.map((entry) => entry.name) };
  } catch (err) {
    return {
      ok: false,
      reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) },
    };
  }
}
