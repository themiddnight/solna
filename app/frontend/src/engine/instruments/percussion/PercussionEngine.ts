import {
  createInstrumentProvider,
  isSampleInstrumentDescriptor,
} from "../providers";
import type { InstrumentProvider } from "../providers";
import { getInstrumentDescriptor } from "../shared/instrumentCatalog";
import { BaseInstrumentEngine } from "../shared/BaseInstrumentEngine";
import { DEFAULT_INSTRUMENT_GAIN_DB } from "../shared/constants";
import { getCalibratedTrimDb } from "../shared/calibration/getCalibratedTrimDb";
import type { EngineAudioContext, InstrumentEngineConfig, InstrumentParamsState } from "../shared/types";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";
import { noteNameToMidiPitch } from "@/shared/utils/generalMidiPercussion";
import {
  getSafariLoadTimeout,
  handleSafariAudioError,
} from "@/shared/utils/webkitCompat";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";

export class PercussionEngine extends BaseInstrumentEngine {
  private audioContext: EngineAudioContext | null = null;
  private provider: InstrumentProvider | null = null;
  private readonly instrumentParams: InstrumentParamsState = {
    volume: DEFAULT_INSTRUMENT_GAIN_DB,
  };

  constructor(config: InstrumentEngineConfig) {
    super(config);
    this.instrumentParams.volume = getCalibratedTrimDb(config.instrumentName) ?? DEFAULT_INSTRUMENT_GAIN_DB;
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.isLoaded = false;
    try {
      this.audioContext = await this.getInstrumentAudioContext();
      const destination = await this.connectPreGainToMixer();
      // Re-apply any volume set via setVolume()/updateInstrumentParams() before load()
      // completed — connectPreGainToMixer() may have just created the pre-gain node at
      // its unity-gain default, which would otherwise silently drop a pre-load call.
      this.setVolume(this.instrumentParams.volume);
      const descriptor = getInstrumentDescriptor(this.config.instrumentName);
      if (!descriptor || !isSampleInstrumentDescriptor(descriptor)) {
        throw new Error(`Unknown percussion instrument: ${this.config.instrumentName}`);
      }
      this.provider = createInstrumentProvider(descriptor);
      const timeout = getSafariLoadTimeout();
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(() => reject(new Error(`Instrument loading timed out after ${timeout}ms`)), timeout);
        this.provider!.load({ audioContext: this.audioContext!, destination })
          .then(() => { clearTimeout(id); resolve(); })
          .catch((e: unknown) => { clearTimeout(id); reject(handleSafariAudioError(e, this.config.instrumentName)); });
      });
      this.isLoaded = true;
    } finally {
      this.isLoading = false;
    }
  }

  playNote({ note, velocity = 0.7, time }: NoteEvent): void {
    if (!this.provider || !this.isLoaded) return;
    const gmNote = typeof note === "number" ? note : noteNameToMidiPitch(String(note));
    this.provider.play({
      note: gmNote,
      velocity: Math.round(Math.max(1, Math.min(127, velocity * 127))),
      time,
    });
  }

  stopNote({ note }: NoteStopEvent): void {
    this.provider?.stop(note);
  }

  stopAllNotes(): void {
    this.provider?.stopAll();
  }

  setVolume(volume: number): void {
    this.instrumentParams.volume = volume;
    if (this.preGainNode) {
      this.preGainNode.gain.value = dbToGain(toDecibels(volume));
    }
  }

  setSustain(_s: boolean): void {}

  getAudioNode(): AudioNode | null {
    return this.preGainNode;
  }

  getInstrumentParams(): InstrumentParamsState | null {
    return { ...this.instrumentParams };
  }

  async updateInstrumentParams(
    params: Partial<InstrumentParamsState>,
  ): Promise<void> {
    if (params.volume !== undefined) {
      this.setVolume(params.volume);
    }
  }

  getAvailableSamples(): string[] {
    return this.provider?.getAvailableSamples() ?? [];
  }

  destroy(): void {
    this.stopAllNotes();
    this.provider?.dispose();
    this.provider = null;
    this.audioContext = null;
  }
}
