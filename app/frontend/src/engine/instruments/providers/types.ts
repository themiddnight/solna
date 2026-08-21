import type { ControlType } from "@/shared/types";

import type { InstrumentCategory } from "../shared/constants";

export type InstrumentProviderKey =
  | "smplr-soundfont"
  | "smplr-drum-machine"
  | "smplr-drum-abuse"
  | "versilian-acoustic-drumset"
  | "versilian-percussion"
  // Reserved scaffold for a future SF2/SoundFont-backed acoustic kit (DEV-282
  // enabler; no kit uses it yet). See Sf2AcousticDrumsetProvider + acousticDrumKits.
  | "sf2-acoustic-drumset"
  | "tone-synth";

export type SampleInstrumentProviderKey = Exclude<
  InstrumentProviderKey,
  "tone-synth"
>;

export interface InstrumentProviderCapabilities {
  supportsSustain?: boolean;
  supportsSamples?: boolean;
  supportsSynthParams?: boolean;
  isPercussion?: boolean;
}

export interface InstrumentDescriptor {
  id: string;
  label: string;
  category: InstrumentCategory;
  controlType: ControlType;
  providerKey: InstrumentProviderKey;
  providerConfig: Record<string, unknown>;
  capabilities: InstrumentProviderCapabilities;
}

export type SampleInstrumentDescriptor = InstrumentDescriptor & {
  providerKey: SampleInstrumentProviderKey;
};

export interface InstrumentProviderLoadContext {
  /**
   * `BaseAudioContext` rather than `AudioContext` so an `OfflineAudioContext` can drive a
   * provider for non-realtime rendering (the DEV-311 calibration harness). Every provider
   * implementation only ever needs `BaseAudioContext` members; smplr's own instrument factories
   * accept `BaseAudioContext` too.
   */
  audioContext: BaseAudioContext;
  destination?: AudioNode | null;
  /**
   * Overrides the smplr scheduler's lookahead window (default 200ms). Events further in the
   * future than the window are queued and dispatched by a real wall-clock `setInterval`, which
   * never gets a chance to run inside an `OfflineAudioContext` render — so an offline caller
   * must widen this past the render's full duration to have every note dispatched (and
   * scheduled at its own audio-timeline `time`) synchronously. Ignored by providers that don't
   * use smplr's scheduler.
   */
  schedulerLookaheadMs?: number;
}

export interface InstrumentProviderPlayOptions {
  note: string | number;
  velocity?: number;
  time?: number | undefined;
  duration?: number | undefined;
}

export type InstrumentStopHandle = void | (() => void) | ((time?: number) => void) | {
  stop: (time?: number) => void;
};

export interface InstrumentProvider {
  load(context: InstrumentProviderLoadContext): Promise<void>;
  play(options: InstrumentProviderPlayOptions): InstrumentStopHandle;
  stop(note?: string | number, time?: number): void;
  stopAll(): void;
  getAvailableSamples(): string[];
  dispose(): void;
}
