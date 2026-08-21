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
import {
  getRepresentativeGmNoteForPiece,
  mapGmNoteToAcousticDrumPiece,
} from "./acousticDrumMapping";
import type { AcousticDrumPiece, DrumHit } from "./types";
import { noteNameToMidiPitch } from "@/shared/utils/generalMidiPercussion";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";
import {
  getSafariLoadTimeout,
  handleSafariAudioError,
} from "@/shared/utils/webkitCompat";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";

export class AcousticDrumEngine extends BaseInstrumentEngine {
  private audioContext: EngineAudioContext | null = null;
  private provider: InstrumentProvider | null = null;
  private readonly activeStops = new Map<AcousticDrumPiece, (time?: number) => void>();
  private readonly instrumentParams: InstrumentParamsState = {
    volume: DEFAULT_INSTRUMENT_GAIN_DB,
  };

  constructor(config: InstrumentEngineConfig) {
    super(config);
    this.instrumentParams.volume = getCalibratedTrimDb(config.instrumentName) ?? DEFAULT_INSTRUMENT_GAIN_DB;
  }

  async load(_context?: EngineAudioContext): Promise<void> {
    this.isLoading = true;
    this.isLoaded = false;

    try {
      this.audioContext = await this.getInstrumentAudioContext();
      const destinationNode = await this.connectPreGainToMixer();
      // Re-apply any volume set via setVolume()/updateInstrumentParams() before load()
      // completed — connectPreGainToMixer() may have just created the pre-gain node at
      // its unity-gain default, which would otherwise silently drop a pre-load call.
      this.setVolume(this.instrumentParams.volume);

      const descriptor = getInstrumentDescriptor(this.config.instrumentName);
      if (!descriptor || !isSampleInstrumentDescriptor(descriptor)) {
        throw new Error(
          `Unknown acoustic drum instrument: ${this.config.instrumentName}`,
        );
      }
      this.provider = createInstrumentProvider(descriptor);

      const loadTimeout = getSafariLoadTimeout();
      const loadPromise = new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(
            new Error(`Instrument loading timed out after ${loadTimeout}ms`),
          );
        }, loadTimeout);

        this.provider!.load({
          audioContext: this.audioContext!,
          destination: destinationNode,
        })
          .then(() => {
            clearTimeout(timeoutId);
            resolve();
          })
          .catch((error: unknown) => {
            clearTimeout(timeoutId);
            reject(handleSafariAudioError(error, this.config.instrumentName));
          });
      });

      await loadPromise;
      this.isLoaded = true;
    } finally {
      this.isLoading = false;
    }
  }

  playNote({ note, velocity = 0.7, time }: NoteEvent): void {
    if (!this.provider || !this.isLoaded) {
      return;
    }

    const piece = mapGmNoteToAcousticDrumPiece(note);
    if (piece == null) {
      console.warn(`[AcousticDrumEngine] Unsupported GM drum note: ${note}`);
      return;
    }

    if (piece === "hihatClosed") {
      this.stopPiece("hihatOpen");
    }

    const gmNote =
      typeof note === "number" ? note : noteNameToMidiPitch(String(note));
    const hit: DrumHit = {
      gmNote,
      piece,
      velocity: Math.round(Math.max(1, Math.min(127, velocity * 127))),
      time,
    };

    try {
      const stopFn = this.provider.play({
        note: hit.gmNote,
        velocity: hit.velocity,
        time: hit.time,
      });
      if (typeof stopFn === "function") {
        this.activeStops.set(piece, stopFn);
        setTimeout(() => {
          if (this.activeStops.get(piece) === stopFn) {
            this.activeStops.delete(piece);
          }
        }, 5000);
      }
    } catch (error) {
      console.warn(`[AcousticDrumEngine] Failed to play ${piece}:`, error);
    }
  }

  stopNote({ note }: NoteStopEvent): void {
    const piece = mapGmNoteToAcousticDrumPiece(note);
    if (piece != null) {
      this.stopPiece(piece);
    }
  }

  stopAllNotes(): void {
    this.provider?.stopAll();
    this.activeStops.clear();
  }

  setVolume(volume: number): void {
    this.instrumentParams.volume = volume;
    if (this.preGainNode) {
      this.preGainNode.gain.value = dbToGain(toDecibels(volume));
    }
  }

  setSustain(_sustain: boolean): void {
    // Drum hits are fire-and-forget; hi-hat choking is handled in playNote.
  }

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
    return [
      "kick",
      "snare",
      "clap",
      "hihatClosed",
      "hihatOpen",
      "tomLow",
      "tomMid",
      "tomHigh",
      "crash",
      "ride",
      "tambourine",
      "cowbell",
    ];
  }

  destroy(): void {
    this.stopAllNotes();
    this.provider?.dispose();
    this.provider = null;
    this.audioContext = null;
  }

  private stopPiece(piece: AcousticDrumPiece): void {
    const stopFn = this.activeStops.get(piece);
    if (stopFn) {
      stopFn();
      this.activeStops.delete(piece);
      return;
    }

    this.provider?.stop(getRepresentativeGmNoteForPiece(piece));
  }
}
