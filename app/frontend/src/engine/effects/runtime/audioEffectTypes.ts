import type { Channel, Gain, Analyser } from "tone";
import type { EffectType } from "@/engine/effects/model";
import type { Decibels } from "@/shared/audio/gainUnits";

// Effect Types
export type { EffectType };
export { EFFECT_TYPE } from "@/engine/effects/model";

// Effect Parameter Interface
export interface EffectParameter {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  curve?: "linear" | "exponential" | "logarithmic";
}

export type AuxRole = "control" | "heard";

// Base Effect Interface
export interface AudioEffect {
  id: string;
  type: EffectType;
  name: string;
  enabled: boolean;
  parameters: Map<string, EffectParameter>;
  inputNode: GainNode | AudioNode;
  outputNode: GainNode | AudioNode;
  wetGainNode?: GainNode | null;
  dryGainNode?: GainNode | null;
  bypass: boolean;
  /** Compressor-only: current gain reduction in dB (≤ 0). */
  getReduction?: () => number;
  /** Compressor-only: current input RMS level in dB (may be -Infinity). */
  getInputLevelDb?: () => number;
  /** Aux/external input edge (DEV-287). Only aux-consuming effects implement these. */
  connectAuxInput?: (node: AudioNode, role: AuxRole) => void;
  disconnectAuxInput?: () => void;
  /** Ducker key-level meter, dB (may be -Infinity). Mirrors getInputLevelDb. */
  getKeyLevelDb?: () => number;

  process(inputNode: AudioNode): AudioNode;
  setParameter(name: string, value: number): void;
  getParameter(name: string): number | undefined;
  enable(): void;
  disable(): void;
  cleanup(): void;
}

// User Channel Interface
export interface UserChannel {
  userId: string;
  username: string;
  inputGain: GainNode;
  monoToStereoOutput?: GainNode;
  monitorTap: GainNode;
  /** Live volume ([Decibels]) + pan (-1..1, equal-power) stage — see MixerEngine.applyChannelGains. */
  toneChannel?: Channel;
  stereoEffectOutput?: Gain;
  /**
   * Master send on the master branch only (`stereoEffectOutput → masterSendGain → masterBus`).
   * `monitorTap` taps `stereoEffectOutput` in parallel, so muting this (gain→0) silences the
   * channel in the main mix while an aux consumer (e.g. a Vocoder-ext carrier) still receives it
   * via the tap. Toggled by `setChannelMasterMuted`.
   */
  masterSendGain?: GainNode;
  targetVolume: Decibels;
  targetPan: number;
  effectChain: AudioEffect[];
  sends: Map<string, GainNode>;
  analyser?: Analyser;
  /**
   * Native (non-Tone) `AnalyserNode` tapped in parallel with `analyser`, at the same point
   * (`stereoEffectOutput`) — feeds `useMeterLevel`/avatar-glow consumers that need a raw Web
   * Audio `AnalyserNode` rather than Tone's wrapper (DEV-297/298: Tone's `Analyser` keeps its
   * native node(s) in a private field with no public getter). Purely additive: does not replace
   * or affect `analyser`/`getUserOutputLevel`.
   */
  nativeAnalyser?: AnalyserNode;
  /** Per-peer voice gain node (remote WebRTC voice, bypasses the volume/pan stage). */
  voiceGain?: GainNode;
  /** Stored voice fader position, dB, same -60..+12 range as targetVolume but a separate control. */
  voiceVolumeDb: Decibels;
}

// Aux Bus Interface
export interface AuxBus {
  id: string;
  name: string;
  inputGain: GainNode;
  effectChain: AudioEffect[];
  outputGain: GainNode;
}

// Master Section Interface
export interface MasterSection {
  inputGain: GainNode;
  effectChain: AudioEffect[];
  outputGain: GainNode;
  analyser: AnalyserNode;
}
