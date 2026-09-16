/* eslint-disable @typescript-eslint/no-explicit-any -- the engine's public
   surface is typed against the DOM's BaseAudioContext, and node-web-audio-api
   implements the same spec with its own class objects. The casts are at that
   seam only, in a test, exactly as engine.render.test.ts does them. */
/**
 * What the subtractive voice SOUNDS like, measured off real rendered samples.
 *
 * Every other test of this engine inspects the node graph through a fake
 * context: it proves the right param was scheduled with the right value at the
 * right time. That is necessary and it is not sufficient — a route wired to the
 * wrong destination, a filter type mapped to the wrong Web Audio string, or a
 * noise colour whose spectrum is flat all schedule perfectly well and produce
 * the wrong sound. These render through `createRenderEngine` against a real
 * `OfflineAudioContext` and ask the only question a graph assertion cannot:
 * what came out.
 *
 * Deliberately NOT a second implementation of the DSP. Nothing here recomputes
 * an envelope or a frequency; every assertion is a COMPARISON — this window
 * against that window, this patch against its one-field-different twin — so a
 * test can fail only because the audio changed, never because a model of the
 * audio drifted.
 *
 * The two sweep fixtures are the library's own `factory-fx-down-sweep` and
 * `factory-fx-up-sweep`, which are authored as acceptance fixtures as well as
 * sounds (one oscillator, no filter movement, so a pitch reading off them is
 * unambiguous — see their comments in src/data/synthPresets.ts).
 */
import { describe, expect, test } from 'bun:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { createRenderEngine } from '../engine';
import { createSubtractiveVoice } from './subtractiveVoice';
import { withSeededRandom } from '../rng';
import { SUBTRACTIVE_INIT, presetById } from '@/utils/synthPresets';
import { noteFrequency } from '@/utils/musicTheory';
import type { ActiveSynth, FilterType, LfoTriggerMode, ModRoute, ModTarget, NoiseColor, SubtractiveParams } from '@/types/synth';

const SAMPLE_RATE = 44100;
/** The note every fixture plays. C3 — the same note the calibration harness uses. */
const NOTE = 'C3';
const NOTE_FREQ = noteFrequency(NOTE);
/**
 * Every render here runs on a seeded random source, and the noise comparisons
 * are the reason. A noise buffer is drawn from `src/audio/rng.ts`'s shared
 * source, so unseeded renders draw three DIFFERENT buffers — and the high-band
 * share of one 371 ms window of white noise varies by several hundredths
 * between draws, which is wider than the gap a wrong colour would leave.
 * Measured, not assumed: with the colour forced to white in the voice, three
 * unseeded renders read 0.354 / 0.419 / 0.348 and an ordering assertion over
 * them is a coin toss. Seeded, all three colours are shaped from the same
 * sequence and the comparison is between colours instead of between draws.
 */
const RENDER_SEED = 0x5015a;

interface Rendered {
  left: Float32Array;
  right: Float32Array;
}

/**
 * One note, rendered through the same public API realtime playback calls.
 *
 * `createRenderEngine` rather than the singleton: an offline render must not
 * disturb the session's engine and must not be disturbed by it.
 *
 * `holdSeconds` is free to land anywhere now that a release preserves the
 * envelope it interrupts (`releaseScheduledParamTo`), and the last describe in
 * this file is what holds that true — it renders one patch released early and
 * one released late and requires the two to agree sample for sample. The
 * fixtures above still hold past their windows, because a fixture should
 * measure one thing: the filter and noise tests are about a sustained spectrum,
 * and a release inside the window would put an amplitude contour on top of it.
 */
async function renderNote(
  synth: ActiveSynth,
  { seconds, holdSeconds }: { seconds: number; holdSeconds: number },
): Promise<Rendered> {
  return withSeededRandom(RENDER_SEED, async () => {
    const ctx: any = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * seconds), SAMPLE_RATE);
    const engine = createRenderEngine(ctx);
    engine.setMasterVolume(1);
    const voiceId = engine.triggerSynthNoteOn(NOTE_FREQ, synth, 1, 0, 'synth', 1, 'sequencer');
    if (!voiceId) throw new Error('the render engine returned no voice id — nothing was scheduled');
    engine.triggerSynthNoteOff(voiceId, synth.patch.synth.ampEnvelope.release, holdSeconds);
    const buffer: any = await ctx.startRendering();
    return { left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
  });
}

/**
 * `count` samples starting at `atSeconds`, mean-removed and Hann-windowed.
 *
 * Both steps are load-bearing rather than ritual. The mean: a waveshaper with
 * drive puts a DC offset on an asymmetric wave, and DC lands in the lowest
 * probe bin as an enormous magnitude that wins every `dominantFrequencyHz`
 * comparison — measured, not feared, on the up sweep. The Hann taper: a
 * rectangular window of a sweep leaks the discontinuity at each end across the
 * whole spectrum, and the leak is largest at the bottom, where the sweep starts.
 */
function windowAt(data: Float32Array, atSeconds: number, count: number): Float32Array {
  const start = Math.round(atSeconds * SAMPLE_RATE);
  const raw = data.subarray(start, Math.min(start + count, data.length));
  const n = raw.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += raw[i]!;
  mean /= n;
  const shaped = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    shaped[i] = (raw[i]! - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return shaped;
}

/**
 * One bin of a DFT, by Goertzel — the cheapest honest way to ask "how much
 * energy is at this frequency" without carrying an FFT this file would then
 * have to be trusted not to have got wrong.
 */
function goertzelMagnitude(data: Float32Array, hz: number): number {
  const k = (2 * Math.PI * hz) / SAMPLE_RATE;
  const coeff = 2 * Math.cos(k);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < data.length; i += 1) {
    const s = data[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

/**
 * Log-spaced probe frequencies. Log rather than linear because every question
 * below is musical — octaves, not hertz — and because a linear grid fine
 * enough for the up sweep's ~12 Hz start would be thousands of bins wide at
 * the top.
 */
const BINS_PER_OCTAVE = 24;
const LOWEST_BIN_HZ = 10;
const HIGHEST_BIN_HZ = 12_000;
const PROBE_HZ: readonly number[] = (() => {
  const bins: number[] = [];
  for (let hz = LOWEST_BIN_HZ; hz <= HIGHEST_BIN_HZ; hz *= 2 ** (1 / BINS_PER_OCTAVE)) bins.push(hz);
  return bins;
})();

/** The probe frequency carrying the most energy in this window. */
function dominantFrequencyHz(data: Float32Array): number {
  let best = PROBE_HZ[0]!;
  let bestMagnitude = -1;
  for (const hz of PROBE_HZ) {
    const magnitude = goertzelMagnitude(data, hz);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      best = hz;
    }
  }
  return best;
}

/** Summed squared magnitude of every probe inside [lowHz, highHz). */
function bandEnergy(data: Float32Array, lowHz: number, highHz: number): number {
  let energy = 0;
  for (const hz of PROBE_HZ) {
    if (hz < lowHz || hz >= highHz) continue;
    const magnitude = goertzelMagnitude(data, hz);
    energy += magnitude * magnitude;
  }
  return energy;
}

function peakOf(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]!));
  return peak;
}

/**
 * Energy in the difference of the two channels — zero for a mono signal
 * however loud, non-zero the moment the two channels stop being identical.
 * The mid/side convention, with the side channel being (L-R)/2.
 */
function sideEnergy({ left, right }: Rendered): number {
  let energy = 0;
  for (let i = 0; i < left.length; i += 1) {
    const side = (left[i]! - right[i]!) / 2;
    energy += side * side;
  }
  return energy;
}

/** The other half of the mid/side pair: (L+R)/2, the summed-to-mono energy. */
function midEnergy({ left, right }: Rendered): number {
  let energy = 0;
  for (let i = 0; i < left.length; i += 1) {
    const mid = (left[i]! + right[i]!) / 2;
    energy += mid * mid;
  }
  return energy;
}

function factoryPatch(id: string): ActiveSynth<'subtractive'> {
  const preset = presetById(id);
  if (!preset) throw new Error(`No such factory preset: ${id}`);
  return { engine: 'subtractive', patch: structuredClone(preset.patch), sourcePresetId: preset.id };
}

/** The init patch with `synth` fields overridden — a fresh clone every call. */
function initPatchWith(
  synth: Partial<SubtractiveParams>,
  common: Partial<ActiveSynth<'subtractive'>['patch']['common']> = {},
): ActiveSynth<'subtractive'> {
  const base = structuredClone(SUBTRACTIVE_INIT);
  return {
    ...base,
    patch: {
      common: { ...base.patch.common, ...common },
      synth: { ...base.patch.synth, ...synth },
    },
  };
}

describe('a pitch-enveloped sweep actually sweeps', () => {
  /**
   * Four windows spanning the ENV2 decay. 16384 samples is 371 ms — long
   * enough to resolve the bottom of the up sweep, which starts at 42 semitones
   * BELOW C3 and is therefore a ~12 Hz fundamental for its first window.
   */
  const WINDOW_SAMPLES = 16_384;
  const WINDOW_STARTS_S = [0.05, 0.35, 0.7, 1.1];
  /** Past every window's end (1.1 + 0.371), and past both fixtures' decay. */
  const HOLD_S = 1.8;
  /**
   * Both fixtures measure several octaves of travel — the down sweep 7.6x
   * across these windows, the up sweep 4.9x. The floor is 3x: enough that a
   * route reaching the wrong destination, or a depth collapsed to a fraction
   * of what the patch asks for, cannot clear it, and loose enough that it is
   * not a second, undeclared assertion about the exact envelope curve.
   */
  const MIN_SPAN = 3;

  test('the down sweep`s dominant frequency falls across every window', async () => {
    const { left } = await renderNote(factoryPatch('factory-fx-down-sweep'), {
      seconds: 2.4,
      holdSeconds: HOLD_S,
    });
    const dominants = WINDOW_STARTS_S.map((at) =>
      dominantFrequencyHz(windowAt(left, at, WINDOW_SAMPLES)),
    );
    // Strictly monotone, not merely "ends lower": a patch whose ENV2 reached
    // the wrong destination, or whose route sign was dropped, can still end
    // lower than it started by accident.
    for (let i = 1; i < dominants.length; i += 1) {
      expect(dominants[i]!).toBeLessThan(dominants[i - 1]!);
    }
    // And it is a SWEEP, not a wobble: +48 semitones is four octaves, so the
    // measured span has to be octaves wide, not a few bins.
    expect(dominants[0]! / dominants[dominants.length - 1]!).toBeGreaterThan(MIN_SPAN);
  });

  test('the up sweep`s dominant frequency rises across every window', async () => {
    const { left } = await renderNote(factoryPatch('factory-fx-up-sweep'), {
      seconds: 2.4,
      holdSeconds: HOLD_S,
    });
    const dominants = WINDOW_STARTS_S.map((at) =>
      dominantFrequencyHz(windowAt(left, at, WINDOW_SAMPLES)),
    );
    for (let i = 1; i < dominants.length; i += 1) {
      expect(dominants[i]!).toBeGreaterThan(dominants[i - 1]!);
    }
    // The sign of the route is the ONLY difference between the two fixtures,
    // and this is the assertion that reads it.
    expect(dominants[dominants.length - 1]! / dominants[0]!).toBeGreaterThan(MIN_SPAN);
  });
});

describe('the four filter types shape four different spectra', () => {
  const CUTOFF_HZ = 1000;
  /** Below, around and above the cutoff. Chosen so the mid band straddles it. */
  const LOW = [60, 600] as const;
  const MID = [700, 1400] as const;
  const HIGH = [2000, 9000] as const;

  /**
   * A bright, static source: a full-level saw, no modulation, so the only
   * thing that can move the spectrum is the filter. Resonance stays low —
   * a resonant peak would let a mis-mapped type pass a band comparison on
   * the strength of its peak alone.
   */
  function filteredSaw(type: FilterType): ActiveSynth<'subtractive'> {
    return initPatchWith({
      filter: { type, cutoffHz: CUTOFF_HZ, resonance: 0.2, driveDb: 0, keyTrack: 0 },
      ampEnvelope: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.1 },
    });
  }

  async function shares(type: FilterType): Promise<{ low: number; mid: number; high: number }> {
    const { left } = await renderNote(filteredSaw(type), { seconds: 1, holdSeconds: 0.8 });
    // Mid-sustain, clear of both the attack and the release.
    const window = windowAt(left, 0.3, 16_384);
    const low = bandEnergy(window, ...LOW);
    const mid = bandEnergy(window, ...MID);
    const high = bandEnergy(window, ...HIGH);
    const total = low + mid + high;
    return { low: low / total, mid: mid / total, high: high / total };
  }

  test('each type wins or loses the band it is named for', async () => {
    const lp = await shares('lowpass');
    const bp = await shares('bandpass');
    const hp = await shares('highpass');
    const notch = await shares('notch');

    // Two full orderings and one minimum — every type is named by at least
    // two of them, and no two types share a position in all three. Written as
    // SHARES of the same window's total energy, so a difference in overall
    // level (a bandpass is far quieter than a lowpass on the same source)
    // cannot stand in for a difference in shape.
    //
    // The two ladders are the biquad's own rolloffs, not observations fitted
    // afterwards: a bandpass rolls off 6 dB/octave on each side where a
    // lowpass and a highpass roll off 12, so the bandpass sits BETWEEN them at
    // both ends — more low than a highpass, more high than a lowpass.
    expect(lp.low).toBeGreaterThan(bp.low);
    expect(bp.low).toBeGreaterThan(hp.low);

    expect(hp.high).toBeGreaterThan(bp.high);
    expect(bp.high).toBeGreaterThan(lp.high);

    // The notch is the one type defined by what it REMOVES, so it is the only
    // one asserted on the band around the cutoff itself. A notch silently
    // mapped to a peaking filter — or to any of the other three — fails here.
    expect(notch.mid).toBeLessThan(lp.mid);
    expect(notch.mid).toBeLessThan(bp.mid);
    expect(notch.mid).toBeLessThan(hp.mid);
  });
});

describe('the three noise colours have three different tilts', () => {
  /** Noise only: both oscillators off, so nothing tonal masks the spectrum. */
  function noisePatch(color: NoiseColor): ActiveSynth<'subtractive'> {
    const base = structuredClone(SUBTRACTIVE_INIT.patch.synth);
    return initPatchWith({
      oscillators: [
        { ...base.oscillators[0], enabled: false, levelDb: -96 },
        { ...base.oscillators[1], enabled: false, levelDb: -96 },
      ],
      utility: { ...base.utility, noiseEnabled: true, noiseColor: color, noiseLevelDb: 0 },
      // Wide open: the point is the GENERATOR's tilt, and a filter would put
      // its own on top of it.
      filter: { type: 'lowpass', cutoffHz: 20_000, resonance: 0, driveDb: 0, keyTrack: 0 },
      ampEnvelope: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.1 },
    });
  }

  async function highBandShare(color: NoiseColor): Promise<number> {
    const { left } = await renderNote(noisePatch(color), { seconds: 1, holdSeconds: 0.8 });
    const window = windowAt(left, 0.3, 16_384);
    const low = bandEnergy(window, 40, 400);
    const high = bandEnergy(window, 2000, 12_000);
    return high / (low + high);
  }

  test('pink sits below white and brown below pink, as rendered', async () => {
    // The same ordering `noise.test.ts` asserts on the raw generated buffer,
    // asked one layer out: this one fails if the colour never reaches the
    // voice, or reaches it as the wrong buffer, both of which that test passes.
    const white = await highBandShare('white');
    const pink = await highBandShare('pink');
    const brown = await highBandShare('brown');
    expect(pink).toBeLessThan(white);
    expect(brown).toBeLessThan(pink);
  });
});

describe('unison width is stereo, not just detune', () => {
  function unisonPatch(voices: number, stereoWidth: number): ActiveSynth<'subtractive'> {
    return initPatchWith(
      { ampEnvelope: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.1 } },
      { unisonVoices: voices, unisonDetuneCents: voices > 1 ? 18 : 0, stereoWidth },
    );
  }

  test('a wide unison patch has side energy its mono twin does not, and still clears the peak ceiling', async () => {
    const wide = await renderNote(unisonPatch(6, 1), { seconds: 1, holdSeconds: 0.8 });
    const mono = await renderNote(unisonPatch(1, 0), { seconds: 1, holdSeconds: 0.8 });

    // The mono twin is bit-identical across the two channels, so its side
    // energy is exactly 0 — which is why `wide > mono` would be satisfied by
    // any stray sample and prove nothing. The claim is that the spread is
    // AUDIBLE, so it is measured as a ratio against the wide render's own mid
    // energy: a stereo field this wide puts a real fraction of its power in
    // the side channel, not a rounding error's worth.
    expect(sideEnergy(mono)).toBe(0);
    expect(sideEnergy(wide) / midEnergy(wide)).toBeGreaterThan(0.05);

    // Equal power across the stack is the other half of the contract: six
    // detuned voices must not be six times as loud as one. The ceiling is
    // full scale, which is what the WAV encoder clamps at.
    expect(peakOf(wide.left)).toBeLessThan(1);
    expect(peakOf(wide.right)).toBeLessThan(1);
  });
});

/**
 * A release does not erase the note that came before it.
 *
 * `releaseScheduledParamTo` opens with `param.cancelScheduledValues(at)`, which
 * removes every event at time >= `at`. That reaches BACKWARDS in effect, and the
 * reason is not offline rendering: the cancel runs when `triggerSynthNoteOff` is
 * CALLED, not at `at`, and every sequenced player books its note-off in the same
 * breath as its note-on (`chordPlayback.ts`, `arpPlayback.ts`,
 * `voiceManager.ts`, one `CLOCK_LOOKAHEAD` ahead). So the attack and decay ramps
 * are erased before a sample of them has been rendered, in realtime just as much
 * as offline, and the param holds its pre-ramp value flat for the whole note.
 * Only a live key-up — where the cancel genuinely follows the audio — was ever
 * safe.
 *
 * These are the samples that say so. They render ONE patch two ways, differing
 * only in when the note-off is booked, and compare windows that both renders
 * should agree on exactly.
 */
describe('a sequenced release preserves the envelope it interrupts', () => {
  /** 1.0 s decay to sustain 0.2 — long enough that a 0.5 s gate lands inside it. */
  function decayingPatch(): ActiveSynth<'subtractive'> {
    return initPatchWith({ ampEnvelope: { attack: 0.005, decay: 1.0, sustain: 0.2, release: 0.3 } });
  }

  const RMS_POINTS_S = [0.05, 0.2, 0.35, 0.45];

  function rmsAt(data: Float32Array, atSeconds: number): number {
    const w = data.subarray(Math.round(atSeconds * SAMPLE_RATE), Math.round(atSeconds * SAMPLE_RATE) + 2048);
    let sum = 0;
    for (let i = 0; i < w.length; i += 1) sum += w[i]! * w[i]!;
    return Math.sqrt(sum / w.length);
  }

  test('the decay still decays when the note-off is booked ahead of it', async () => {
    // The reference: a note-off so late it cannot interfere with the decay.
    const reference = await renderNote(decayingPatch(), { seconds: 3, holdSeconds: 2.5 });
    // The case: released at 0.5 s, halfway down a 1.0 s decay.
    const released = await renderNote(decayingPatch(), { seconds: 3, holdSeconds: 0.5 });

    const ref = RMS_POINTS_S.map((t) => rmsAt(reference.left, t));
    const cut = RMS_POINTS_S.map((t) => rmsAt(released.left, t));

    // Every sample before the release is identical audio, so the two renders
    // must agree to the bit. Before the fix the released render read FLAT at
    // the attack peak across all four points — 4.1 dB hot at t = 0.45.
    for (let i = 0; i < RMS_POINTS_S.length; i += 1) {
      expect(cut[i]!).toBeCloseTo(ref[i]!, 5);
    }

    // And it is a DECAY that is being preserved, not a flat line that happens
    // to match: the reference itself must fall across the same window, or the
    // assertion above would hold for a patch with no decay at all.
    for (let i = 1; i < ref.length; i += 1) expect(ref[i]!).toBeLessThan(ref[i - 1]!);

    // After the release the two must diverge, or `holdSeconds` reached nothing.
    expect(rmsAt(released.left, 0.7)).toBeLessThan(rmsAt(reference.left, 0.7) * 0.5);
  });

  test('an ENV2 pitch contour survives a note-off booked inside it', async () => {
    // The down sweep released mid-contour used to freeze at its starting pitch
    // for the whole note. Four windows, all before a 1.2 s release.
    const starts = [0.05, 0.35, 0.7, 1.1];
    const patch = factoryPatch('factory-fx-down-sweep');
    const reference = await renderNote(patch, { seconds: 2.4, holdSeconds: 1.8 });
    const released = await renderNote(patch, { seconds: 2.4, holdSeconds: 1.2 });

    const dominants = (r: Rendered) => starts.map((t) => dominantFrequencyHz(windowAt(r.left, t, 16_384)));
    expect(dominants(released)).toEqual(dominants(reference));
  });
});


/**
 * `pitch-all` means every pitched source, INCLUDING the sub oscillator.
 *
 * The two sweep fixtures above both disable the sub, which is why they can
 * pass while a `pitch-all` route leaves the sub behind at its original pitch:
 * nothing is there to be left behind. `factory-808-deep-bass` is the shipped
 * patch where both are true at once — a +12 semitone ENV2 `pitch-all` route
 * over `subEnabled: true` at -6 dB — and what a listener hears there is the
 * swept pair and an un-swept drone under it.
 *
 * Measured as a COMPARISON, per this file's rule: the same patch rendered
 * with the sub on and with it off. Enabling the sub must add energy an
 * octave BELOW where the route has taken the oscillator, and must not add
 * any at the pitch the note started on.
 */
describe('a pitch-all route takes the sub oscillator with it', () => {
  /** C3, the note every fixture here plays. */
  const C3_HZ = 130.81;
  const SEMITONES = 24;
  const RATIO = 2 ** (SEMITONES / 12);
  /** A quarter-tone either side of a partial — one probe bin at 24 bins/octave. */
  const BAND = 2 ** (1 / 48);
  /** Past the 5 ms attack of both envelopes, and inside a flat sustain. */
  const WINDOW_AT_S = 0.3;
  const WINDOW_SAMPLES = 16_384;

  function band(hz: number): [number, number] {
    return [hz / BAND, hz * BAND];
  }

  function sweptSine(subEnabled: boolean): ActiveSynth<'subtractive'> {
    return initPatchWith({
      // Sines, so every partial measured below belongs to exactly one source.
      oscillators: [
        { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
        { enabled: false, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
      ],
      utility: { subEnabled, subOctave: -1, subLevelDb: -3, noiseEnabled: false, noiseColor: 'white', noiseLevelDb: -96 },
      filter: { type: 'lowpass', cutoffHz: 20_000, resonance: 0, driveDb: 0, keyTrack: 0 },
      // Both envelopes sustain flat, so the window measures pitch alone.
      ampEnvelope: { attack: 0.005, decay: 0.05, sustain: 1, release: 0.3 },
      modEnvelope: { attack: 0.005, decay: 0.05, sustain: 1, release: 0.3 },
      env2Routes: [{ target: 'pitch-all', unit: 'semitones', amount: SEMITONES }],
    });
  }

  test('the sub is heard under the swept oscillator, not under the note', async () => {
    const withSub = await renderNote(sweptSine(true), { seconds: 1.2, holdSeconds: 1.0 });
    const noSub = await renderNote(sweptSine(false), { seconds: 1.2, holdSeconds: 1.0 });
    const on = windowAt(withSub.left, WINDOW_AT_S, WINDOW_SAMPLES);
    const off = windowAt(noSub.left, WINDOW_AT_S, WINDOW_SAMPLES);

    // Three partials, one window: where the oscillator ended up, where the
    // sub belongs (an octave under THAT), and where the sub started.
    const sweptOscHz = C3_HZ * RATIO;
    const sweptSubHz = sweptOscHz * 0.5;
    const staticSubHz = C3_HZ * 0.5;
    const atSweptSub = bandEnergy(on, ...band(sweptSubHz));
    const atStaticSub = bandEnergy(on, ...band(staticSubHz));

    // The sub-off render is the control: it has nothing at either of the two
    // sub partials, so any energy there belongs to the sub and to nothing else.
    expect(bandEnergy(off, ...band(sweptSubHz))).toBeLessThan(bandEnergy(off, ...band(sweptOscHz)) * 1e-6);
    expect(bandEnergy(off, ...band(staticSubHz))).toBeLessThan(bandEnergy(off, ...band(sweptOscHz)) * 1e-6);

    // The sub is AUDIBLE at the swept partial: it and the oscillator are both
    // authored at -3 dB, so an order of magnitude is a generous floor and a
    // sub that never moved cannot creep over it on leakage alone.
    expect(atSweptSub).toBeGreaterThan(bandEnergy(on, ...band(sweptOscHz)) * 0.1);

    // And it left nothing behind at the note's original pitch — the un-swept
    // drone the listener heard under the sweep. Before the fix this band read
    // 337258 against 26 at the swept one: the whole sub, still at C2.
    expect(atStaticSub).toBeLessThan(atSweptSub * 0.01);
  });
});

/**
 * The LFO is audible, in the unit its route is authored in.
 *
 * `SynthLfoBank` scales one shared -1..1 generator by `modulationAmount`
 * (`depth * route.amount`) and connects THAT gain straight to the
 * destination `AudioParam`. Web Audio sums a connected signal into a param
 * in the PARAM's own unit, and a route's unit is not that unit: semitones
 * against `detune`'s cents, semitones against `frequency`'s hertz, dB
 * against a `GainNode`'s linear gain. The whole existing LFO suite runs
 * against a fake context and asserts which param a gain was connected to and
 * what value that gain held — never what the sum sounded like — so a route
 * arriving two orders of magnitude short passes every one of them.
 *
 * These two render it. A square LFO holds each half of its cycle flat, so a
 * window inside each half measures one steady modulated value rather than a
 * smear, and the two windows compare directly.
 */
describe('an LFO route moves its destination by the amount it asks for', () => {
  /** 1 Hz: each half-cycle is 500 ms, comfortably wider than a 371 ms window. */
  const LFO_HZ = 1;
  const WINDOW_SAMPLES = 16_384;
  /** Inside the first (+1) half-cycle and inside the second (-1) one. */
  const PEAK_AT_S = 0.08;
  const TROUGH_AT_S = 0.58;

  function lfoPatch(lfo: SubtractiveParams['lfo'], synth: Partial<SubtractiveParams> = {}): ActiveSynth<'subtractive'> {
    return initPatchWith({
      // One sine, flat amp sustain: nothing but the LFO can move the spectrum.
      oscillators: [
        { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
        { enabled: false, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
      ],
      filter: { type: 'lowpass', cutoffHz: 20_000, resonance: 0, driveDb: 0, keyTrack: 0 },
      ampEnvelope: { attack: 0.005, decay: 0.05, sustain: 1, release: 0.3 },
      env2Routes: [],
      lfo,
      ...synth,
    });
  }

  test('a 12-semitone pitch route swings an octave each way, not 12 cents', async () => {
    const { left } = await renderNote(
      lfoPatch({
        waveform: 'square',
        depth: 1,
        phaseDegrees: 0,
        triggerMode: 'note',
        rate: { mode: 'hz', hz: LFO_HZ },
        route: { target: 'pitch-all', unit: 'semitones', amount: 12 },
      }),
      { seconds: 1.4, holdSeconds: 1.2 },
    );

    const high = dominantFrequencyHz(windowAt(left, PEAK_AT_S, WINDOW_SAMPLES));
    const low = dominantFrequencyHz(windowAt(left, TROUGH_AT_S, WINDOW_SAMPLES));
    // +12 against -12 is two octaves apart. The floor is 2x rather than 4x so
    // the assertion reads the DEPTH, not the band-limited square's overshoot.
    // Before the fix both windows read the same probe bin: 12 CENTS apart,
    // which is a quarter of one bin at 24 bins per octave.
    expect(high / low).toBeGreaterThan(2);
  });

  test('a 24-semitone cutoff route opens and closes the filter', async () => {
    /** A saw through a closed lowpass: the only bright thing is what the LFO lets through. */
    const patch = lfoPatch(
      {
        waveform: 'square',
        depth: 1,
        phaseDegrees: 0,
        triggerMode: 'note',
        rate: { mode: 'hz', hz: LFO_HZ },
        route: { target: 'filter-cutoff', unit: 'semitones', amount: 24 },
      },
      {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
          { enabled: false, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
        ],
        filter: { type: 'lowpass', cutoffHz: 400, resonance: 0.1, driveDb: 0, keyTrack: 0 },
      },
    );
    const { left } = await renderNote(patch, { seconds: 1.4, holdSeconds: 1.2 });

    const open = bandEnergy(windowAt(left, PEAK_AT_S, WINDOW_SAMPLES), 1200, 6000);
    const shut = bandEnergy(windowAt(left, TROUGH_AT_S, WINDOW_SAMPLES), 1200, 6000);
    // +24 semitones is 400 Hz -> 1600 Hz and -24 is 400 -> 100, so the band
    // above 1200 Hz is the difference between wide open and firmly shut.
    // Before the fix the swing was +/-24 HERTZ on a 400 Hz cutoff and the two
    // windows were indistinguishable.
    expect(open).toBeGreaterThan(shut * 20);
  });
});

/**
 * An LFO edit made while a note is sounding reaches that note.
 *
 * `SynthLfoBank.updateSource` is the bank's whole live-edit surface — the one
 * method that re-rates a running generator, re-points a route, and revives a
 * channel whose depth had been turned down to nothing. It had no production
 * caller at all: `VoiceLfoBank`, the interface the voice manager holds the
 * bank through, declared only `connectVoice`/`disconnectVoice`. So a knob
 * move reached the patch, the patch reached `updatePatch`, and the LFO half
 * of it stopped there — which is the other half of "adjusting the LFO does
 * nothing", the half a correct unit conversion cannot fix.
 *
 * Rendered rather than asserted as a call: a forwarding test would have
 * passed against a bank that forwarded to a method that did nothing.
 */
describe('an LFO edit reaches a voice that is already sounding', () => {
  const WINDOW_SAMPLES = 16_384;
  const PEAK_AT_S = 0.08;
  const TROUGH_AT_S = 0.58;

  function withLfoDepth(depth: number, triggerMode: LfoTriggerMode): ActiveSynth<'subtractive'> {
    return initPatchWith({
      oscillators: [
        { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
        { enabled: false, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
      ],
      filter: { type: 'lowpass', cutoffHz: 400, resonance: 0.1, driveDb: 0, keyTrack: 0 },
      ampEnvelope: { attack: 0.005, decay: 0.05, sustain: 1, release: 0.3 },
      env2Routes: [],
      lfo: {
        waveform: 'square',
        depth,
        phaseDegrees: 0,
        triggerMode,
        rate: { mode: 'hz', hz: 1 },
        route: { target: 'filter-cutoff', unit: 'semitones', amount: 24 },
      },
    });
  }

  /** Note on, knob moved with the note still held, note released well after both windows. */
  async function renderLiveEdit(before: ActiveSynth<'subtractive'>, after: ActiveSynth<'subtractive'>): Promise<Float32Array> {
    return withSeededRandom(RENDER_SEED, async () => {
      const ctx: any = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * 1.4), SAMPLE_RATE);
      const engine = createRenderEngine(ctx);
      engine.setMasterVolume(1);
      const voiceId = engine.triggerSynthNoteOn(NOTE_FREQ, before, 1, 0, 'synth', 1, 'sequencer');
      if (!voiceId) throw new Error('the render engine returned no voice id — nothing was scheduled');
      engine.updateSynthPatch(before, after, 'synth');
      engine.triggerSynthNoteOff(voiceId, after.patch.synth.ampEnvelope.release, 1.2);
      const buffer: any = await ctx.startRendering();
      return buffer.getChannelData(0) as Float32Array;
    });
  }

  function openVsShut(rendered: Float32Array): [number, number] {
    return [
      bandEnergy(windowAt(rendered, PEAK_AT_S, WINDOW_SAMPLES), 1200, 6000),
      bandEnergy(windowAt(rendered, TROUGH_AT_S, WINDOW_SAMPLES), 1200, 6000),
    ];
  }

  /**
   * Both trigger modes, because they are two different lifetimes and only one
   * of them was ever reachable. `'transport'` is a shared per-channel
   * generator that `updateSource`'s channel half reconfigures; `'note'` is a
   * generator per voice, which that half skips by construction
   * (`allVoicesFor` filters `triggerMode === 'transport'`) — and 24 of the 32
   * LFO blocks in the factory library are `'note'`, so that is the mode most
   * users are turning the knob on.
   */
  for (const triggerMode of ['transport', 'note'] as const) {
    test(`raising depth from zero opens the filter on a held ${triggerMode}-triggered note`, async () => {
      // The note starts at depth 0, so `connectVoice` marks the voice dormant
      // and builds no generator at all. Everything after the edit is revival.
      const [open, shut] = openVsShut(await renderLiveEdit(withLfoDepth(0, triggerMode), withLfoDepth(1, triggerMode)));
      expect(open).toBeGreaterThan(shut * 20);
    });

    test(`deepening a live ${triggerMode}-triggered LFO widens its swing on a held note`, async () => {
      // Not the revival path: the LFO is already running and audible at 0.2,
      // and the edit only has to rescale it. A fix that covered only
      // "depth 0 -> on" would pass the test above and fail this one.
      //
      // The control is the SAME edit made to the same value — so the two
      // renders differ in the edited depth and in nothing else, and the
      // comparison is between two measured swings rather than against a
      // threshold that would encode an opinion about how wide 0.2 should be.
      const [shallowOpen, shallowShut] = openVsShut(await renderLiveEdit(withLfoDepth(0.2, triggerMode), withLfoDepth(0.2, triggerMode)));
      const [deepOpen, deepShut] = openVsShut(await renderLiveEdit(withLfoDepth(0.2, triggerMode), withLfoDepth(1, triggerMode)));
      expect(deepOpen / deepShut).toBeGreaterThan((shallowOpen / shallowShut) * 3);
    });
  }
});

/**
 * Every LFO target, rendered.
 *
 * `LFO_DESTINATION_SELECTORS` is a table of nine targets mapping to nine
 * `AudioParam`s, and until this block seven of the nine were held to account
 * by nothing at all: `grep -rn lfoDestination src --include=*.test.ts`
 * returned two fakes and no assertion. The proof that it mattered is in this
 * branch's own history — `filter-cutoff` moved from `filter.frequency` to
 * `filter.detune`, a different param on a different node, and not one
 * existing test needed changing. A mapping no test reads is a mapping that
 * can be wrong for as long as it likes.
 *
 * One test per target, each written so a route landing on the WRONG param
 * fails it rather than passing quietly. That is why most carry a second
 * oscillator that must NOT move: `osc1-level` and `amplitude` both make
 * oscillator 1 louder, and the only thing that tells them apart is what
 * happened to oscillator 2 at the same instant.
 *
 * All of them share one shape — a square LFO at 1 Hz, one window inside each
 * half-cycle — so the two windows are two steady states of the same voice and
 * every assertion is one compared against the other.
 */

const WINDOW_SAMPLES = 16_384;
const PEAK_AT_S = 0.08;
const TROUGH_AT_S = 0.58;
/**
 * C3, and very nearly three octaves above it. The gap is that wide by
 * arithmetic, not taste: a +-1 octave pitch route measured in bands
 * `MOVED_BAND` wide sweeps each oscillator across 2.67 octaves, so anything
 * closer than that lets oscillator 1's swung-up partial land inside the
 * band oscillator 2's swung-down partial is measured in and makes "this one
 * moved and that one did not" unanswerable. A fifth apart, which reads as
 * the obvious choice, fails exactly that way.
 */
const OSC1_HZ = 130.813;
const OSC2_SEMITONES = 34;
const OSC2_HZ = OSC1_HZ * 2 ** (OSC2_SEMITONES / 12);
/**
 * Both oscillators well below unity, because the voice's drive stage is a
 * `WaveShaper` and a `WaveShaper` CLAMPS its input to the ends of its curve.
 * Two sources at -3 dB sum to 1.41 and clip there even at `driveDb: 0`, and
 * a clipped sum redistributes energy between the partials — measured: an
 * `osc1-level` route moved oscillator 2's own bin by 1.43x, purely through
 * the clipping, which would have made every "and that one did not move"
 * assertion below unreadable. Not a defect in the route under test; a
 * property of the fixture that has to be kept out of the measurement.
 */
const LEVEL_DB = -12;
/**
 * Half-width of the band a MOVED partial is measured in. A band, not a bin:
 * the LFO's square is a 16-harmonic `PeriodicWave`, so its plateau carries
 * the Fourier series' ripple and a pitch route's held value wanders a
 * couple of semitones around its nominal one. Measured: a +12 semitone
 * route reads its strongest energy near +10. That is the shape of a
 * band-limited square and not something to assert against — the question
 * here is WHICH param moved, not how flat a square is.
 */
const MOVED_BAND = 2 ** (4 / 12);

function route(target: ModTarget, unit: ModRoute['unit'], amount: number): ModRoute {
  return { target, unit, amount } as ModRoute;
}

/**
 * Two sine partials and an open filter, modulated by one square LFO. Sines
 * because a partial has to belong to exactly one oscillator for "this one
 * moved and that one did not" to mean anything.
 */
function twoTone(modRoute: ModRoute, over: Partial<SubtractiveParams> = {}): ActiveSynth<'subtractive'> {
  return initPatchWith({
    oscillators: [
      { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: LEVEL_DB },
      { enabled: true, waveform: 'sine', octave: 0, semitone: OSC2_SEMITONES, fineCents: 0, levelDb: LEVEL_DB },
    ],
    filter: { type: 'lowpass', cutoffHz: 20_000, resonance: 0, driveDb: 0, keyTrack: 0 },
    ampEnvelope: { attack: 0.005, decay: 0.05, sustain: 1, release: 0.3 },
    env2Routes: [],
    lfo: {
      waveform: 'square',
      depth: 1,
      phaseDegrees: 0,
      triggerMode: 'note',
      rate: { mode: 'hz', hz: 1 },
      route: modRoute,
    },
    ...over,
  });
}

/** One saw through a closed filter — the fixture the two filter targets need. */
function filteredSawWith(modRoute: ModRoute, filter: SubtractiveParams['filter']): ActiveSynth<'subtractive'> {
  return twoTone(modRoute, {
    oscillators: [
      { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: LEVEL_DB },
      { enabled: false, waveform: 'sine', octave: 0, semitone: OSC2_SEMITONES, fineCents: 0, levelDb: -96 },
    ],
    filter,
  });
}

/** The two steady half-cycles of one render, as windows ready to measure. */
async function halves(patch: ActiveSynth<'subtractive'>): Promise<{ peak: Rendered; trough: Rendered }> {
  const rendered = await renderNote(patch, { seconds: 1.4, holdSeconds: 1.2 });
  const at = (t: number): Rendered => ({
    left: windowAt(rendered.left, t, WINDOW_SAMPLES),
    right: windowAt(rendered.right, t, WINDOW_SAMPLES),
  });
  return { peak: at(PEAK_AT_S), trough: at(TROUGH_AT_S) };
}

/** One partial's own bin — for a partial that is supposed to stay put. */
const level = (w: Rendered, hz: number): number => goertzelMagnitude(w.left, hz);

/** The band a partial swung somewhere into — for one that is supposed to move. */
const moved = (w: Rendered, hz: number): number => bandEnergy(w.left, hz / MOVED_BAND, hz * MOVED_BAND);

function rms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i]! * data[i]!;
  return Math.sqrt(sum / data.length);
}

/** How far apart two readings are, as a factor >= 1. 1.0 is identical. */
function spread(a: number, b: number): number {
  return Math.max(a, b) / Math.min(a, b);
}

/** A partial that must not have moved or changed level between the two windows. */
function expectUnmoved(peak: Rendered, trough: Rendered, hz: number): void {
  expect(spread(level(peak, hz), level(trough, hz))).toBeLessThan(1.1);
}

/**
 * Both windows are real audio, asserted before anything is compared.
 *
 * Every measurement in this block is a RATIO between the two windows, and a
 * ratio whose denominator is silence passes whatever its numerator is. That
 * is not hypothetical: pointing `filter-cutoff` at `filter.Q` instead of
 * `filter.detune` — the exact mis-landing this block exists to catch —
 * feeds a cutoff-sized amount into Q, drives it to +-2400, and renders the
 * second half-cycle as exact zeros. Every ratio then read `x > 0` and the
 * whole block passed the mutation. 1 % is 40 dB of headroom, which is wider
 * than the deepest swing any test here asks for.
 */
function expectBothSounding(peak: Rendered, trough: Rendered): void {
  const loudest = Math.max(peakOf(peak.left), peakOf(trough.left));
  expect(Math.min(peakOf(peak.left), peakOf(trough.left))).toBeGreaterThan(loudest * 0.01);
}

describe('every LFO target reaches the param it names: oscillators', () => {
  test('osc1-pitch moves oscillator 1 and leaves oscillator 2 where it is', async () => {
    const { peak, trough } = await halves(twoTone(route('osc1-pitch', 'semitones', 12)));
    expectBothSounding(peak, trough);

    // An octave up in one half of the cycle and an octave down in the other.
    expect(moved(peak, OSC1_HZ * 2)).toBeGreaterThan(moved(trough, OSC1_HZ * 2) * 50);
    expect(moved(trough, OSC1_HZ / 2)).toBeGreaterThan(moved(peak, OSC1_HZ / 2) * 50);
    // And oscillator 2 has not moved — what a route landing on the wrong slot
    // would break, and what a dominant-frequency reading could not see.
    expectUnmoved(peak, trough, OSC2_HZ);
  });

  test('osc2-pitch moves oscillator 2 and leaves oscillator 1 where it is', async () => {
    const { peak, trough } = await halves(twoTone(route('osc2-pitch', 'semitones', 12)));
    expectBothSounding(peak, trough);

    expect(moved(peak, OSC2_HZ * 2)).toBeGreaterThan(moved(trough, OSC2_HZ * 2) * 50);
    expect(moved(trough, OSC2_HZ / 2)).toBeGreaterThan(moved(peak, OSC2_HZ / 2) * 50);
    expectUnmoved(peak, trough, OSC1_HZ);
  });

  test('pitch-all moves both oscillators together', async () => {
    const { peak, trough } = await halves(twoTone(route('pitch-all', 'semitones', 12)));
    expectBothSounding(peak, trough);

    expect(moved(peak, OSC1_HZ * 2)).toBeGreaterThan(moved(trough, OSC1_HZ * 2) * 50);
    expect(moved(peak, OSC2_HZ * 2)).toBeGreaterThan(moved(trough, OSC2_HZ * 2) * 50);
    // Neither is left behind at its own pitch — the defect the sub fix was
    // about, asked here of the two oscillators.
    expect(moved(trough, OSC1_HZ / 2)).toBeGreaterThan(moved(peak, OSC1_HZ / 2) * 50);
    expect(moved(trough, OSC2_HZ / 2)).toBeGreaterThan(moved(peak, OSC2_HZ / 2) * 50);
  });

  test('osc1-level moves oscillator 1`s gain and not oscillator 2`s', async () => {
    const { peak, trough } = await halves(twoTone(route('osc1-level', 'db', 9)));
    expectBothSounding(peak, trough);

    expect(level(peak, OSC1_HZ)).toBeGreaterThan(level(trough, OSC1_HZ) * 6);
    expectUnmoved(peak, trough, OSC2_HZ);
  });

  test('osc2-level moves oscillator 2`s gain and not oscillator 1`s', async () => {
    const { peak, trough } = await halves(twoTone(route('osc2-level', 'db', 9)));
    expectBothSounding(peak, trough);

    expect(level(peak, OSC2_HZ)).toBeGreaterThan(level(trough, OSC2_HZ) * 6);
    expectUnmoved(peak, trough, OSC1_HZ);
  });

  test('amplitude moves the whole voice, both oscillators in step', async () => {
    const { peak, trough } = await halves(twoTone(route('amplitude', 'db', 6)));
    expectBothSounding(peak, trough);

    const osc1 = level(peak, OSC1_HZ) / level(trough, OSC1_HZ);
    const osc2 = level(peak, OSC2_HZ) / level(trough, OSC2_HZ);
    expect(osc1).toBeGreaterThan(3);
    // IN STEP — the one thing separating this target from an `osc1-level`
    // and an `osc2-level` route side by side, and why both are worth having.
    expect(spread(osc1, osc2)).toBeLessThan(1.05);
  });
});

describe('every LFO target reaches the param it names: filter, amplitude and pan', () => {
  test('filter-cutoff opens and closes the filter', async () => {
    const { peak, trough } = await halves(
      filteredSawWith(route('filter-cutoff', 'semitones', 24), {
        type: 'lowpass',
        cutoffHz: 400,
        resonance: 0.1,
        driveDb: 0,
        keyTrack: 0,
      }),
    );
    expectBothSounding(peak, trough);

    // The CORNER moved, which needs two bands to say. The high one alone is
    // satisfied by anything that lets more treble through — a route landing
    // on `filter.Q` passes it on the strength of a resonant peak, measured.
    // The second band is inside the passband at +24 semitones and above the
    // cutoff at -24, so only an actual cutoff move can swing it; resonance,
    // whose whole effect is local to the corner, leaves it alone.
    expect(bandEnergy(peak.left, 1200, 6000)).toBeGreaterThan(bandEnergy(trough.left, 1200, 6000) * 20);
    expect(bandEnergy(peak.left, 150, 350)).toBeGreaterThan(bandEnergy(trough.left, 150, 350) * 3);
  });

  test('filter-resonance moves the peak at the cutoff, not the level below it', async () => {
    const CUTOFF_HZ = 1000;
    const { peak, trough } = await halves(
      filteredSawWith(route('filter-resonance', 'normalized', 0.25), {
        type: 'lowpass',
        cutoffHz: CUTOFF_HZ,
        resonance: 0.5,
        driveDb: 0,
        keyTrack: 0,
      }),
    );
    expectBothSounding(peak, trough);

    // Measured as the SHAPE of the passband, not its level: resonance lifts
    // the band around the cutoff and leaves the passband well below it alone.
    // That is exactly what separates it from `filter-cutoff` and from
    // `amplitude`, either of which moves both bands.
    const emphasis = (w: Rendered): number => bandEnergy(w.left, 850, 1200) / bandEnergy(w.left, 150, 400);
    expect(emphasis(peak)).toBeGreaterThan(emphasis(trough) * 2);
    expect(spread(bandEnergy(peak.left, 150, 400), bandEnergy(trough.left, 150, 400))).toBeLessThan(1.2);
  });

  test('pan swings the voice between the channels without changing its level', async () => {
    const { peak, trough } = await halves(twoTone(route('pan', 'pan', 0.8)));
    expectBothSounding(peak, trough);

    const balance = (w: Rendered): number => rms(w.right) / rms(w.left);
    expect(balance(peak)).toBeGreaterThan(balance(trough) * 5);
    // Still the same voice, only moved: the summed-to-mono energy of the two
    // windows agrees, which an `amplitude` route landing here would not.
    expect(spread(midEnergy(peak), midEnergy(trough))).toBeLessThan(1.3);
  });
});

/**
 * Equal-power polyphony, measured off samples rather than off a call log.
 *
 * Built through `createSubtractiveVoice` directly instead of through
 * `createRenderEngine`: the engine's `setPolyphonyScale` applies at
 * `ctx.currentTime`, which on an `OfflineAudioContext` is 0 until rendering
 * starts, so two scales 8 ms apart cannot be expressed through the public API
 * at all. The voice is the unit that owns the ramp, and it is the unit under
 * test here.
 *
 * The defect, measured: the anchor was read off `polyGain.gain.value` after
 * `cancelScheduledValues`. `value` is the param's [[current value]] — its
 * intrinsic value at the START of the current render quantum — so it answers
 * a question about NOW, never about `scaleAt`, while the cancel removes the
 * in-flight ramp WHOLE (a ramp is anchored only by its end event). Scheduled
 * ahead, as here, the first duck is erased before a sample of it is rendered
 * and the level sits FLAT at unity until the second scale steps it down. That
 * flat is what this reads, and no call-log assertion can see it.
 *
 * `subtractiveVoice.test.ts` asks whether the voice COMPUTES the right anchor;
 * a fake param cannot interpolate, so only this can ask what came out.
 */
describe('a polyphony re-balance keeps the ramp it interrupts', () => {
  /** C7, ~2093 Hz: six cycles fit in the 3 ms window, so a short RMS is steady. */
  const NOTE_HZ_NAME = 'C7';
  const NOTE_HZ = noteFrequency(NOTE_HZ_NAME);
  const SETTLED_AT_S = 0.05;
  const FIRST_AT_S = 0.1;
  /** 8 ms into the first ramp's 15 ms — inside it, which is the whole case. */
  const SECOND_AT_S = 0.108;
  const WINDOW_S = 0.003;

  /** One steady sine, flat amp envelope, nothing modulating: only the scale can move it. */
  function steadyTone(): ActiveSynth<'subtractive'> {
    return initPatchWith({
      oscillators: [
        { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -6 },
        { enabled: false, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
      ],
      filter: { type: 'lowpass', cutoffHz: 20_000, resonance: 0, driveDb: 0, keyTrack: 0 },
      ampEnvelope: { attack: 0.002, decay: 0.002, sustain: 1, release: 0.3 },
      env2Routes: [],
    });
  }

  function windowRms(data: Float32Array, atSeconds: number, seconds: number): number {
    const start = Math.round(atSeconds * SAMPLE_RATE);
    return rms(data.subarray(start, start + Math.round(seconds * SAMPLE_RATE)));
  }

  async function renderTwoScales(): Promise<Float32Array> {
    const ctx: any = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * 0.2), SAMPLE_RATE);
    const voice = createSubtractiveVoice(
      ctx,
      steadyTone().patch,
      { source: 'synth', owner: 'live', frequency: NOTE_HZ, velocity: 1, at: 0 },
      { output: ctx.destination },
    );
    // The two scales a third key-down produces: 1 -> 1/5 -> 1/10. Deeper than
    // the 1/sqrt(N) the manager computes, so the step the defect makes is
    // large enough to read off a 3 ms window rather than inferred from one.
    voice.setPolyphonyScale(0.2, FIRST_AT_S);
    voice.setPolyphonyScale(0.1, SECOND_AT_S);
    const buffer: any = await ctx.startRendering();
    return buffer.getChannelData(0);
  }

  test('the first duck is still rendered, and the second continues it downward', async () => {
    const left = await renderTwoScales();

    const settled = windowRms(left, SETTLED_AT_S, WINDOW_S);
    const before = windowRms(left, SECOND_AT_S - WINDOW_S, WINDOW_S);
    const after = windowRms(left, SECOND_AT_S, WINDOW_S);

    // Real audio in all three windows first. Every assertion below is a ratio,
    // and a ratio over silence says whatever the reader wants it to say — the
    // failure this whole file exists to refuse.
    expect(settled).toBeGreaterThan(0.05);
    expect(after).toBeGreaterThan(settled * 0.2);

    // THE assertion. 8 ms into a 15 ms ramp from 1 to 0.2 the voice is at
    // ~0.57, so the window ending at the second scale averages ~0.65 of the
    // settled level. Read off `.value`, the cancel had erased that ramp whole
    // and this window measured the full settled level — the ducking the user
    // asked for was never rendered at all, and the level then STEPPED down.
    expect(before).toBeLessThan(settled * 0.8);
    expect(before).toBeGreaterThan(settled * 0.4);

    // And the second scale continues the descent rather than restarting it
    // from wherever the param happened to read.
    expect(after).toBeLessThan(before);
    expect(windowRms(left, SECOND_AT_S + 0.015, WINDOW_S)).toBeLessThan(after);
  });
});

/**
 * The four ENV2 router destinations that ship in factory presets and had no
 * rendered test: `osc2-level` (5 presets), `filter-resonance` (3), `amplitude`
 * (3) and `pan` (2). `filter-cutoff` and `pitch-all` are covered by the sweep
 * fixtures at the top of this file. `osc1-pitch`, `osc2-pitch` and `osc1-level`
 * are deliberately NOT covered: no factory preset routes ENV2 to any of them,
 * so they are reachable only by hand-editing, and the same three params are
 * already pinned as LFO destinations above.
 *
 * ENV2 and the LFO write DIFFERENT params on purpose — the router writes the
 * intrinsic value (`filter.frequency`, `oscillators[n].frequency`) where the
 * LFO connects to the offset (`filter.detune`, `.detune`) — so the LFO block
 * above proves nothing at all about these. A route landing on the wrong one of
 * a pair is exactly the mis-wiring this file exists to catch.
 *
 * Every test here is one render against its one-field-different twin: the same
 * patch with `env2Routes` empty. The contour is held — attack and decay of
 * 2 ms into a sustain of 1 — so both windows are steady states and the only
 * difference between them is the route.
 */
describe('every ENV2 route reaches the param it names', () => {
  const ENV2_WINDOW_AT_S = 0.3;
  /** Flat within 4 ms of note-on and held there for the whole window. */
  const HELD: SubtractiveParams['modEnvelope'] = { attack: 0.002, decay: 0.002, sustain: 1, release: 0.05 };
  /** Depth 0 and an amount of 0: the LFO exists in the patch and does nothing. */
  const SILENT_LFO: SubtractiveParams['lfo'] = {
    waveform: 'sine',
    depth: 0,
    phaseDegrees: 0,
    triggerMode: 'note' as LfoTriggerMode,
    rate: { mode: 'hz', hz: 1 },
    route: { target: 'filter-cutoff', unit: 'semitones', amount: 0 } as ModRoute,
  };

  function env2Patch(routes: ModRoute[], over: Partial<SubtractiveParams> = {}): ActiveSynth<'subtractive'> {
    return initPatchWith({
      oscillators: [
        { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: LEVEL_DB },
        { enabled: true, waveform: 'sine', octave: 0, semitone: OSC2_SEMITONES, fineCents: 0, levelDb: LEVEL_DB },
      ],
      filter: { type: 'lowpass', cutoffHz: 20_000, resonance: 0, driveDb: 0, keyTrack: 0 },
      ampEnvelope: { attack: 0.005, decay: 0.05, sustain: 1, release: 0.3 },
      modEnvelope: HELD,
      lfo: SILENT_LFO,
      ...over,
      env2Routes: routes,
    });
  }

  /** One window of the routed patch and the same window of its unrouted twin. */
  async function routedAndPlain(
    routes: ModRoute[],
    over: Partial<SubtractiveParams> = {},
  ): Promise<{ routed: Rendered; plain: Rendered }> {
    const window = async (rs: ModRoute[]): Promise<Rendered> => {
      const r = await renderNote(env2Patch(rs, over), { seconds: 0.8, holdSeconds: 0.6 });
      return {
        left: windowAt(r.left, ENV2_WINDOW_AT_S, WINDOW_SAMPLES),
        right: windowAt(r.right, ENV2_WINDOW_AT_S, WINDOW_SAMPLES),
      };
    };
    return { routed: await window(routes), plain: await window([]) };
  }

  test('osc2-level moves oscillator 2`s gain and not oscillator 1`s', async () => {
    const { routed, plain } = await routedAndPlain([route('osc2-level', 'db', 9)]);
    expectBothSounding(routed, plain);

    expect(level(routed, OSC2_HZ)).toBeGreaterThan(level(plain, OSC2_HZ) * 2);
    // The whole point of the pair: an `amplitude` route would lift both.
    expectUnmoved(routed, plain, OSC1_HZ);
  });

  test('amplitude moves the whole voice, both oscillators in step', async () => {
    const { routed, plain } = await routedAndPlain([route('amplitude', 'db', 6)]);
    expectBothSounding(routed, plain);

    const osc1 = level(routed, OSC1_HZ) / level(plain, OSC1_HZ);
    const osc2 = level(routed, OSC2_HZ) / level(plain, OSC2_HZ);
    expect(osc1).toBeGreaterThan(1.5);
    // IN STEP — what separates this from an `osc1-level` and an `osc2-level`
    // route sitting side by side, and the reason the route exists.
    expect(spread(osc1, osc2)).toBeLessThan(1.05);
  });

  test('filter-resonance moves the peak at the cutoff, not the level below it', async () => {
    const CUTOFF_HZ = 1000;
    const { routed, plain } = await routedAndPlain([route('filter-resonance', 'normalized', 0.3)], {
      oscillators: [
        { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: LEVEL_DB },
        { enabled: false, waveform: 'sine', octave: 0, semitone: OSC2_SEMITONES, fineCents: 0, levelDb: -96 },
      ],
      filter: { type: 'lowpass', cutoffHz: CUTOFF_HZ, resonance: 0.5, driveDb: 0, keyTrack: 0 },
    });
    expectBothSounding(routed, plain);

    // The SHAPE of the passband, not its level: resonance lifts the band around
    // the cutoff and leaves the passband well below it where it was. A route
    // landing on `filter.frequency` or on the amp would move both bands.
    const emphasis = (w: Rendered): number => bandEnergy(w.left, 850, 1200) / bandEnergy(w.left, 150, 400);
    expect(emphasis(routed)).toBeGreaterThan(emphasis(plain) * 2);
    expect(spread(bandEnergy(routed.left, 150, 400), bandEnergy(plain.left, 150, 400))).toBeLessThan(1.2);
  });

  test('pan swings the voice between the channels without changing its level', async () => {
    const { routed, plain } = await routedAndPlain([route('pan', 'pan', 0.8)]);
    expectBothSounding(routed, plain);

    const balance = (w: Rendered): number => rms(w.right) / rms(w.left);
    expect(balance(routed)).toBeGreaterThan(balance(plain) * 5);
    // Moved, not made louder — measured as TOTAL energy across the two
    // channels, which `midEnergy + sideEnergy` is exactly half of. The
    // summed-to-mono energy is the wrong question here and the LFO test above
    // only gets away with it because it compares +0.8 against -0.8: a
    // `StereoPannerNode` is equal-POWER, so panning away from centre drops the
    // mono sum by design (0.71 -> 0.57 at 0.8) while keeping L^2 + R^2 where it
    // was. An `amplitude` route landing here moves that total; a pan cannot.
    const totalEnergy = (w: Rendered): number => midEnergy(w) + sideEnergy(w);
    expect(spread(totalEnergy(routed), totalEnergy(plain))).toBeLessThan(1.1);
  });
});
