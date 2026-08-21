import type { InstrumentCategory } from "./constants";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";

/**
 * Every context an instrument engine can be built on. Normally the shared live
 * `AudioContext`; an `OfflineAudioContext` when an engine is being driven by a non-realtime
 * render (the DEV-311 calibration harness). Structurally identical to Tone's `AnyAudioContext`,
 * so it can be handed straight to `Tone.setContext`, but declared here so the engine base class
 * does not depend on Tone.
 */
export type EngineAudioContext = AudioContext | OfflineAudioContext;

export interface SynthState {
  /**
   * Pre-gain, in relative dB (0 = unity/untouched), NOT linear 0-1 (pre-DEV-300 semantics).
   * Range: -24…+24 dB. Converted to linear gain only at the point of writing to the engine's
   * AudioParam (SynthEngine.ts), via `dbToGain`/`toDecibels` from `@/shared/audio/gainUnits`.
   * Stays a plain `number` at this wire-synced type — not branded `Decibels` — since this type
   * is shared with the untyped-bag `synthParams` wire sync and JSON project serialization.
   */
  volume: number;
  ampAttack: number;
  ampDecay: number;
  ampSustain: number;
  ampRelease: number;
  oscillatorType: string;
  portamento: number;
  filterFrequency: number;
  filterResonance: number;
  filterAttack: number;
  filterDecay: number;
  filterSustain: number;
  filterRelease: number;
  lfoTarget: string;
  lfoWaveform: string;
  lfoAmount: number;
  lfoFrequency: number;
  lfoSync: boolean;
  lfoSyncSubdivision: string;
  modulationIndex: number;
  harmonicity: number;
  modAttack: number;
  modDecay: number;
  modSustain: number;
  modRelease: number;
  arpEnabled: boolean;
  arpMode: string;
  arpSubdivision: string;
  arpOctaveRange: number;
  arpGate: number;
  arpLatch: boolean;
}

export interface InstrumentParamsState {
  /**
   * Pre-gain, in relative dB (0 = unity/untouched). Range: -24…+24 dB. Converted to linear
   * gain only at the point of writing to the engine's GainNode, via `dbToGain`/`toDecibels`
   * from `@/shared/audio/gainUnits`. Field name and semantics converge with `SynthState.volume`
   * (TR-26) — same meaning, same range, different instrument family.
   */
  volume: number;
}

export interface InstrumentEngineConfig {
  userId: string;
  username: string;
  instrumentName: string;
  category: InstrumentCategory;
  isLocalUser?: boolean;
  onSynthParamsChange?: (params: Partial<SynthState>) => void;
  onInstrumentFallback?: (
    originalInstrument: string,
    fallbackInstrument: string,
    category: InstrumentCategory,
  ) => void;
}

export interface InstrumentEngine {
  load(context?: EngineAudioContext): Promise<void>;
  playNote(event: NoteEvent): void;
  stopNote(event: NoteStopEvent): void;
  stopAllNotes(): void;
  setVolume(volume: number): void;
  setSustain(sustain: boolean): void;
  /** Optional portamento glide time in seconds. Implemented by synth engines only;
   *  soundfont/drum engines omit it (callers must feature-detect). */
  setPortamento?(seconds: number): void;
  destroy(): void;
  getInstrumentName(): string;
  getAllActiveNotes(): string[];
  
  getCategory(): InstrumentCategory;
  isInstrumentLoaded(): boolean;
  isInstrumentLoading(): boolean;
  updateInstrument(instrumentName: string, category: InstrumentCategory): Promise<void>;
  updateBPM(bpm: number): void;
  scheduleParameterChange(
    paramName: string,
    value: number,
    time: number,
    transitionTime?: number,
  ): void;
  getAudioNode(): AudioNode | null;
  waitForSamples(timeout?: number): Promise<string[]>;
  getAvailableSamples(): string[];
  getSynthState(): SynthState | null;
  updateSynthParams(params: Partial<SynthState>): Promise<void>;
  getInstrumentParams(): InstrumentParamsState | null;
  updateInstrumentParams(params: Partial<InstrumentParamsState>): Promise<void>;
  getUserId(): string;
  getUsername(): string;
}
