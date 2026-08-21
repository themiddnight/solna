import { DEFAULT_SYNTH_GAIN_DB } from "@jam-band/shared";
import { ControlType } from "@/shared/types";
import type { Instrument } from "@/shared/types";
import type { SynthState } from "../shared/types";

/**
 * Pre-gain default, in dB (DEV-300). The literal conversion of the old linear 0.5 default
 * (20*log10(0.5) ≈ -6.02dB), rounded to -6 per the epic's locked decision. This is NOT a
 * measured/calibrated value — that lands later in a follow-up issue.
 *
 * DEV-295: hoisted into `shared/src/constants/LegacyLoudnessDefaults.ts` so the backend's
 * legacy-loudness-reset (`ProjectImportService.ts`) can share the exact same default as this
 * module's FE consumers — re-exported here under the same name so every existing FE call site
 * is unchanged.
 */
export { DEFAULT_SYNTH_GAIN_DB };

export const defaultSynthState: SynthState = {
  volume: DEFAULT_SYNTH_GAIN_DB,
  ampAttack: 0.01,
  ampDecay: 0.1,
  ampSustain: 0.8,
  ampRelease: 0.3,
  oscillatorType: "sawtooth",
  portamento: 0,
  filterFrequency: 1000,
  filterResonance: 5,
  filterAttack: 0.01,
  filterDecay: 0.1,
  filterSustain: 0.5,
  filterRelease: 0.3,
  lfoTarget: "pitch",
  lfoWaveform: "sine",
  lfoAmount: 0,
  lfoFrequency: 5,
  lfoSync: false,
  lfoSyncSubdivision: "4n",
  modulationIndex: 10,
  harmonicity: 1,
  modAttack: 0.01,
  modDecay: 0.1,
  modSustain: 0.5,
  modRelease: 0.3,
  arpEnabled: false,
  arpMode: "up",
  arpSubdivision: "8n",
  arpOctaveRange: 1,
  arpGate: 0.5,
  arpLatch: false,
};

// Available synthesizer instruments using Tone.js
export const SYNTHESIZER_INSTRUMENTS: Instrument[] = [
  // Analog Synthesizers
  {
    value: "analog_mono",
    label: "Analog Mono Synth",
    defaultControlType: ControlType.Keyboard,
    type: "analog",
    polyphony: "mono",
    icon: "piano",
  },
  {
    value: "analog_poly",
    label: "Analog Poly Synth",
    defaultControlType: ControlType.Keyboard,
    type: "analog",
    polyphony: "poly",
    icon: "piano",
  },

  // FM Synthesizers
  {
    value: "fm_mono",
    label: "FM Mono Synth",
    defaultControlType: ControlType.Keyboard,
    type: "fm",
    polyphony: "mono",
    icon: "piano",
  },
  {
    value: "fm_poly",
    label: "FM Poly Synth",
    defaultControlType: ControlType.Keyboard,
    type: "fm",
    polyphony: "poly",
    icon: "piano",
  },
];
