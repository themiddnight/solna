/**
 * Fixes synth voice-sum stacking (DEV-299): PolySynth voices sum ~coherently (×N amplitude,
 * phase-aligned/harmonically dense), while sampled instruments sum ~incoherently (×√N, uncorrelated
 * phase). This module provides the reactive 1/√N compensation (matching the in-repo precedent at
 * VocoderCarrier.ts:94 exactly — dividing a ×N coherent sum by √N yields a √N-scaling result,
 * i.e. makes the synth behave like the sampler) plus a static soft-clip curve that shaves any
 * remaining headroom excess without hard-clipping. Both are applied on the synth's shared OUTPUT
 * BUS (after all voices have summed into the existing volume Gain), not per-voice.
 */

import { Gain, WaveShaper } from "tone";

/** Full 1/√N — the VocoderCarrier.ts:94 precedent applied as-is, not a partial blend. */
const VOICE_SUM_EXPONENT = 0.5;

/** Matches VocoderCarrier.ts's GAIN_RAMP_TIME — avoids zipper noise on rapid note on/off. */
const VOICE_SUM_GAIN_RAMP_TIME = 0.02;

/**
 * Ramp time when the voice-sum gain is RISING (voices releasing, N decreasing toward fewer
 * held notes). Deliberately much slower than VOICE_SUM_GAIN_RAMP_TIME's fast-attack 20ms: the
 * gain must not race back toward unity while the just-released voices are still audibly
 * decaying through their envelope's release tail, or the tail blooms up to +6-9dB right as the
 * chord fades (DEV-299 final-review finding). 300ms is a deliberately generic middle ground —
 * not tied to any specific instrument's actual envelope release time (which varies per preset
 * and isn't read by this stage), but long enough to meaningfully soften the bloom on typical
 * pad-style release times without perceptibly delaying the gain's return to unity on short,
 * percussive-release patches.
 */
export const VOICE_SUM_GAIN_RELEASE_RAMP_TIME = 0.3;

/**
 * tanh drive amount for the soft-clip curve. By-ear starting point (Task 5) — this constant is
 * the single tuning knob; f'(0) = 1 for ANY drive value (see softClipSample), so raising/lowering
 * it only changes how aggressively the top end compresses, never single-note transparency.
 */
export const SATURATION_DRIVE = 1.2;

const SATURATION_CURVE_SIZE = 2048;

/**
 * Reactive voice-sum compensation gain. Floors N at 1 (never divides by zero, never exceeds unity
 * gain) — mirrors VocoderCarrier.ts:94's `Math.max(1, freqs.length)` guard exactly.
 */
export function computeVoiceSumGain(activeVoiceCount: number, exponent: number = VOICE_SUM_EXPONENT): number {
  const n = Math.max(1, activeVoiceCount);
  return Math.pow(n, -exponent);
}

/**
 * Soft-clip curve: f(x) = tanh(drive·x) / drive.
 * f'(0) = 1 for any drive > 0 (L'Hopital: lim tanh(d·x)/(d·x) · 1 = 1 as x→0) — guarantees
 * unity gain and zero added coloration at low signal levels (AC 2: single note unchanged).
 * f(1) = tanh(drive)/drive < 1 for drive > 0 — the top end is progressively shaved as drive
 * increases (AC 1: tames the excess from coherent stacking), never a brick-wall hard clip.
 */
export function softClipSample(x: number, drive: number): number {
  if (drive <= 0) return x;
  return Math.tanh(drive * x) / drive;
}

/**
 * Samples softClipSample across [-1, 1] into a Float32Array suitable for Tone/WebAudio
 * WaveShaperNode.curve.
 */
export function buildSoftClipCurve(drive: number, size: number = SATURATION_CURVE_SIZE): Float32Array {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = softClipSample(x, drive);
  }
  return curve;
}

/**
 * Replicates WaveShaperNode's clamped table-lookup: input outside [-1, 1] is clamped to the
 * curve's endpoint value (no extrapolation), matching native WaveShaperNode semantics exactly.
 * Exported for direct use by Task 4's offline-render locking test — verifies the actual sampled
 * curve that ships to production, not just the underlying continuous function.
 */
export function lookupSoftClipCurve(curve: Float32Array, x: number): number {
  const clamped = Math.max(-1, Math.min(1, x));
  const index = Math.round(((clamped + 1) / 2) * (curve.length - 1));
  return curve[index] ?? clamped;
}

/**
 * Owns the two-node DEV-299 output-stage fix: a dynamic 1/√N gain (reactive to live polyphony)
 * feeding a static soft-clip WaveShaper. Inserted after the existing volume Gain, before
 * whatever the synth connects to next (mixer channel or destination).
 * Chain: ...volume Gain -> voiceSumGain -> saturator -> (destination).
 */
export class SynthOutputSaturationStage {
  readonly voiceSumGain: Gain;
  readonly saturator: WaveShaper;

  constructor(drive: number = SATURATION_DRIVE) {
    this.voiceSumGain = new Gain(1);
    // Tone.WaveShaper's constructor accepts a Float32Array mapping directly (confirmed against
    // tone/build/esm/signal/WaveShaper.js: `options.mapping instanceof Float32Array` branch) —
    // no Array.from conversion needed.
    this.saturator = new WaveShaper(buildSoftClipCurve(drive));
    // "none": no added latency in the note path (AC 3) — oversampling trades a small amount of
    // latency for less aliasing, not appropriate for an always-on stage in the live note path.
    this.saturator.oversample = "none";
    this.voiceSumGain.connect(this.saturator);
  }

  /**
   * Call whenever the live PolySynth active-voice count changes (note on/off, sustain release).
   * The ramp is deliberately asymmetric: fast-attack when the target is LOWER than the gain's
   * current value (more voices stacking, duck quickly so the new attack doesn't overload), slow
   * when the target is HIGHER (voices releasing, gain climbing back toward unity — this must lag
   * behind the actual acoustic decay of the released voices' release tail, not race ahead of it;
   * see VOICE_SUM_GAIN_RELEASE_RAMP_TIME).
   */
  updateVoiceCount(activeVoiceCount: number): void {
    const target = computeVoiceSumGain(activeVoiceCount);
    const isRising = target > this.voiceSumGain.gain.value;
    const rampTime = isRising ? VOICE_SUM_GAIN_RELEASE_RAMP_TIME : VOICE_SUM_GAIN_RAMP_TIME;
    this.voiceSumGain.gain.rampTo(target, rampTime);
  }

  dispose(): void {
    try {
      this.voiceSumGain.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.saturator.dispose();
    } catch {
      /* ignore */
    }
  }
}
