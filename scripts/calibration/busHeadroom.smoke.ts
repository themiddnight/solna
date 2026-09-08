/**
 * One-off measurement for DEV-383: how much default trim the five source
 * buses (`synthVolume`, `chordVolume`, `bassVolume`, `padVolume`,
 * `masterSequencerVolume`) need so an ordinary just-created project — every
 * fader at unity, compressor and limiter both off — does not clip on its own.
 *
 * Not a `bun test` file, for the same reason as the other `*.smoke.ts` files
 * here: it renders through an OfflineAudioContext and shells out to ffmpeg.
 * Run: `bun scripts/calibration/busHeadroom.smoke.ts`.
 *
 * SOURCES RENDERED — one drum kit plus three synth-engine voices, matching
 * the brief exactly:
 *   - drum kit: "Club Standard" through the existing reference backbeat
 *     (`renderDrumKit`, trim applied). Picked for its name: a generic,
 *     middle-of-the-road kit, not the loudest (Trap Beat) or the quietest
 *     pre-trim (Tight Pocket) in the roster.
 *   - lead: "factory-cosmic-lead" (category Lead) for `synthVolume`.
 *   - chord: "factory-dream-keys" (category Keys) for `chordVolume` — chords
 *     are typically played through a sustained keys-style patch.
 *   - bass: "factory-808-deep-bass" (category Bass) for `bassVolume`.
 *   All three are each category's plainest, least extreme entry — not
 *   "Cyber Drone", not "Wobble Bass", not "Trance Pluck" (the catalogue's
 *   quietest patch, +10.5 dB trim). Preset choice barely matters for THIS
 *   measurement, though: `trimTable.ts` shows every factory preset with its
 *   trim applied lands within a few tenths of a dB of -18 dBFS regardless of
 *   which one you pick, and the same is true for kits (Club Standard -18.0,
 *   every other kit within ~1 dB) — that convergence is calibration doing
 *   its job, and it is why "typical" was a real choice here, not a coin
 *   flip that happened to not matter.
 *
 * `padVolume` is deliberately NOT rendered as a fifth simultaneous source:
 * the brief names exactly four sources (kit, chord, bass, lead) for the
 * representative set. Flagging this rather than quietly matching bus count
 * to source count: a fifth simultaneous synth-engine voice would only ADD
 * energy to the sum, so omitting pad is not a conservative simplification —
 * it very slightly UNDER-states the worst case a project with an active pad
 * layer would sum to. See the report for how much margin that costs.
 *
 * PROXY, NOT A MIX: the four sources are independent renders, each on its
 * own clock starting at t=0, not four tracks playing the same arrangement
 * together. Summing them measures an upper bound on simultaneous energy
 * assuming all four attack at once with no rhythmic separation — worse than
 * most real moments, better than none. Read every number here as "how bad
 * can it get", not "what a mix sounds like".
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { dbToGain, toDecibels } from '@/utils/gainUnits';
import { encodeWav } from './encodeWav.ts';
import { measureLoudness } from './measureLoudness.ts';
import { CALIBRATION_HEADROOM_DB, CALIBRATION_SAMPLE_RATE, renderDrumKit, renderPreset } from './renderOffline.ts';

const DRUM_KIT_NAME = 'Club Standard';
const LEAD_PRESET_ID = 'factory-cosmic-lead';
const CHORD_PRESET_ID = 'factory-dream-keys';
const BASS_PRESET_ID = 'factory-808-deep-bass';

/** Candidates named by the brief (0, -3, -6) plus two informative in-between
 *  points, so the margin curve isn't just three dots. */
const CANDIDATES_DB = [0, -2, -3, -4, -5, -6];

/** Decodes a WAV this repo's own `encodeWav` produced: 16-bit PCM, a fixed
 *  44-byte header, N interleaved channels. Not a general-purpose WAV parser —
 *  it only ever reads bytes this script itself rendered. */
function decodeWav16(bytes: Uint8Array): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channelCount = view.getUint16(22, true);
  const dataBytes = view.getUint32(40, true);
  const frameCount = Math.floor(dataBytes / (channelCount * 2));
  const channels: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = view.getInt16(offset, true);
      channels[channel][frame] = sample / (sample < 0 ? 0x8000 : 0x7fff);
      offset += 2;
    }
  }
  return channels;
}

function findPreset(id: string) {
  const preset = SYNTH_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`No such synth preset: ${id}`);
  return preset;
}

async function measureCandidate(candidateDb: number, sources: Float32Array[][]): Promise<{ peakDbfs: number; lufs: number }> {
  const gain = dbToGain(toDecibels(candidateDb));
  const channelCount = sources[0]?.length ?? 0;
  const maxFrames = Math.max(...sources.map((source) => source[0]?.length ?? 0));
  const summed: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(maxFrames));
  for (const source of sources) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const src = source[channel];
      const dst = summed[channel];
      if (!src || !dst) continue;
      for (let i = 0; i < src.length; i += 1) dst[i] += src[i] * gain;
    }
  }

  // True peak (unclamped, straight off the summed floats) computed BEFORE
  // encoding, because encodeWav clamps to +/-1 — clamping first would hide
  // exactly the overs this measurement exists to catch.
  let peak = 0;
  for (const channel of summed) {
    for (const sample of channel) {
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }
  }
  const peakDbfs = peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;

  const wav = encodeWav(summed, CALIBRATION_SAMPLE_RATE);
  const dir = mkdtempSync(join(tmpdir(), 'solna-bus-headroom-'));
  try {
    const wavPath = join(dir, `candidate-${candidateDb}.wav`);
    writeFileSync(wavPath, wav);
    const lufs = await measureLoudness(wavPath, `candidate ${candidateDb} dB`);
    return { peakDbfs, lufs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Rendering sources...');
  const kitWav = await renderDrumKit(DRUM_KIT_NAME, true);
  const leadWav = await renderPreset(findPreset(LEAD_PRESET_ID), true);
  const chordWav = await renderPreset(findPreset(CHORD_PRESET_ID), true);
  const bassWav = await renderPreset(findPreset(BASS_PRESET_ID), true);

  // The kit render is deliberately CALIBRATION_HEADROOM_DB quieter than live
  // (see renderOffline.ts) so it doesn't clip the WAV encoder on its own nine
  // overlapping voices; adding the headroom back onto the decoded samples
  // recovers the true, live-level signal before it enters the sum, the same
  // way measureDrumKit() adds it back onto the measured LUFS reading.
  const headroomGain = dbToGain(toDecibels(CALIBRATION_HEADROOM_DB));
  const kitChannels = decodeWav16(kitWav).map((channel) => channel.map((sample) => sample * headroomGain));
  const leadChannels = decodeWav16(leadWav);
  const chordChannels = decodeWav16(chordWav);
  const bassChannels = decodeWav16(bassWav);

  const sources = [kitChannels, leadChannels, chordChannels, bassChannels];

  console.log('\nCandidate  Peak dBFS   Short-term LUFS');
  for (const candidateDb of CANDIDATES_DB) {
    const { peakDbfs, lufs } = await measureCandidate(candidateDb, sources);
    console.log(
      `${candidateDb.toString().padStart(4)} dB   ${peakDbfs.toFixed(2).padStart(8)}    ${lufs.toFixed(2).padStart(8)}`,
    );
  }
}

await main();
// See verifyApplied.smoke.ts's comment: the OfflineAudioContext render plus
// the engine's own idle/teardown timers hold the process open without this.
process.exit(0);
