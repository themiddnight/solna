import { FatOscillator } from "tone";

export type CarrierWave = "sawtooth" | "square";

/** Owner-locked carrier defaults, ear-tuned in the POC session (2026-07-11). */
const DEFAULT_WAVE: CarrierWave = "sawtooth";
const DEFAULT_UNISON = 3;
const DEFAULT_SPREAD_CENTS = 16;
const DEFAULT_OCTAVE_MIX = 0.5;

const FREQ_RAMP_TIME = 0.01;
const GAIN_RAMP_TIME = 0.02;

/**
 * SUPERSAW carrier for the channel vocoder: one detuned-unison `Tone.FatOscillator`
 * per carrier note (main bus) plus a matching octave-up layer (octave bus), summed
 * into `output`. Dense unison detune smears each harmonic sideways so every filterbank
 * band always has carrier energy — a single thin oscillator leaves gaps between
 * harmonics that read as hollow/unintelligible vowels.
 */
export class VocoderCarrier {
  readonly output: GainNode;
  private readonly context: AudioContext;
  private readonly carrierBus: GainNode;
  private readonly octBus: GainNode;
  private fats: FatOscillator[] = [];
  private fatsOct: FatOscillator[] = [];
  private wave: CarrierWave = DEFAULT_WAVE;
  private unison = DEFAULT_UNISON;
  private spreadCents = DEFAULT_SPREAD_CENTS;

  constructor(context: AudioContext) {
    this.context = context;
    this.output = context.createGain();
    this.output.gain.value = 1;

    this.carrierBus = context.createGain();
    this.octBus = context.createGain();
    this.octBus.gain.value = DEFAULT_OCTAVE_MIX;
    this.carrierBus.connect(this.output);
    this.octBus.connect(this.carrierBus);
  }

  setWave(wave: CarrierWave): void {
    this.wave = wave;
    for (const fat of [...this.fats, ...this.fatsOct]) {
      fat.type = wave;
    }
  }

  setUnison(count: number): void {
    this.unison = count;
    for (const fat of [...this.fats, ...this.fatsOct]) {
      fat.count = count;
    }
  }

  setSpread(cents: number): void {
    this.spreadCents = cents;
    for (const fat of [...this.fats, ...this.fatsOct]) {
      fat.spread = cents;
    }
  }

  setOctaveMix(mix: number): void {
    this.octBus.gain.setTargetAtTime(mix, this.context.currentTime, GAIN_RAMP_TIME);
  }

  /** Replace the carrier voices (main + octave-up) with the given frequencies (Hz). */
  setFrequencies(freqs: number[]): void {
    const now = this.context.currentTime;

    while (this.fats.length < freqs.length) {
      const freq = freqs[this.fats.length];
      if (freq === undefined) break;
      this.fats.push(this.makeFat(freq, this.carrierBus));
      this.fatsOct.push(this.makeFat(freq * 2, this.octBus));
    }
    while (this.fats.length > freqs.length) {
      this.fats.pop()?.dispose();
      this.fatsOct.pop()?.dispose();
    }

    freqs.forEach((freq, i) => {
      const fat = this.fats[i];
      const fatOct = this.fatsOct[i];
      if (fat === undefined || fatOct === undefined) return;
      fat.frequency.setTargetAtTime(freq, now, FREQ_RAMP_TIME);
      fatOct.frequency.setTargetAtTime(freq * 2, now, FREQ_RAMP_TIME);
    });

    // constant-POWER (1/√n) not 1/n: adding harmony voices sounds fuller/louder instead
    // of normalising back to the single-voice level, while still taming clipping.
    this.carrierBus.gain.setTargetAtTime(1 / Math.sqrt(Math.max(1, freqs.length)), now, GAIN_RAMP_TIME);
  }

  dispose(): void {
    for (const fat of [...this.fats, ...this.fatsOct]) {
      fat.dispose();
    }
    this.fats = [];
    this.fatsOct = [];
    try {
      this.carrierBus.disconnect();
      this.octBus.disconnect();
      this.output.disconnect();
    } catch {
      /* ignore */
    }
  }

  private makeFat(freq: number, dest: GainNode): FatOscillator {
    const fat = new FatOscillator(freq, this.wave, this.spreadCents);
    fat.count = this.unison;
    fat.connect(dest);
    fat.start();
    return fat;
  }
}
