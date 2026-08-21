import {
  createInstrumentProvider,
  isSampleInstrumentDescriptor,
} from "../providers";
import type { InstrumentProvider, InstrumentStopHandle } from "../providers";
import { BaseInstrumentEngine } from "../shared/BaseInstrumentEngine";
import { getInstrumentDescriptor } from "../shared/instrumentCatalog";
import { DEFAULT_INSTRUMENT_GAIN_DB } from "../shared/constants";
import { getCalibratedTrimDb } from "../shared/calibration/getCalibratedTrimDb";
import type { EngineAudioContext, InstrumentEngineConfig, InstrumentParamsState } from "../shared/types";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";
import {
  getSafariLoadTimeout,
  handleSafariAudioError,
} from "@/shared/utils/webkitCompat";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";

export class MelodicEngine extends BaseInstrumentEngine {
  private audioContext: EngineAudioContext | null = null;
  private provider: InstrumentProvider | null = null;

  // Note tracking
  private readonly activeNotes = new Map<string, InstrumentStopHandle>();
  private readonly sustainedNotes = new Set<string>();
  private readonly keyHeldNotes = new Set<string>();
  private sustain = false;
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
          `Unknown melodic instrument: ${this.config.instrumentName}`,
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
            const enhancedError = handleSafariAudioError(
              error,
              this.config.instrumentName,
            );
            reject(enhancedError);
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
      console.warn(
        `[MelodicEngine] Skip playNote: instrument=${!!this.provider}, isLoaded=${this.isLoaded}`,
      );
      return;
    }
    const noteStr = String(note);
    // console.log(`[MelodicEngine] playNote: ${noteStr}, velocity: ${velocity}`);

    // Force stop previous instance of this note before re-triggering.
    // Cannot use this.stopNote() here because it has a sustain guard that
    // returns early without stopping sound, causing stacked voices when
    // the same note is repeated rapidly while sustain is held.
    const existingStopFn = this.activeNotes.get(noteStr);
    if (existingStopFn) {
      this.invokeStopHandle(existingStopFn);
      this.activeNotes.delete(noteStr);
      this.sustainedNotes.delete(noteStr);
      this.keyHeldNotes.delete(noteStr);
    }

    const scaledVelocity = Math.round(
      Math.max(1, Math.min(127, velocity * 127)),
    );

    try {
      const stopFn = this.provider.play({
        note: noteStr,
        velocity: scaledVelocity,
        time: time ?? this.audioContext!.currentTime + 0.001,
      });
      this.activeNotes.set(noteStr, stopFn);
      this.keyHeldNotes.add(noteStr);
    } catch (error) {
      console.warn(`[MelodicEngine] Failed to play note ${noteStr}:`, error);
    }
  }

  stopNote({ note }: NoteStopEvent): void {
    if (!this.provider || !this.isLoaded) return;
    const noteStr = String(note);

    this.keyHeldNotes.delete(noteStr);

    if (this.sustain) {
      if (this.activeNotes.has(noteStr)) {
        this.sustainedNotes.add(noteStr);
      }
      return;
    }

    try {
      const stopFn = this.activeNotes.get(noteStr);
      if (stopFn) {
        this.invokeStopHandle(stopFn);
      }
      this.activeNotes.delete(noteStr);
      this.sustainedNotes.delete(noteStr);
    } catch (error) {
      console.warn(`[MelodicEngine] Failed to stop note ${noteStr}:`, error);
    }
  }

  stopAllNotes(): void {
    if (!this.provider || !this.isLoaded) return;

    try {
      this.provider.stopAll();
      this.activeNotes.clear();
      this.sustainedNotes.clear();
      this.keyHeldNotes.clear();
    } catch (error) {
      console.warn(`[MelodicEngine] Failed to stop all notes:`, error);
    }
  }

  setVolume(volume: number): void {
    this.instrumentParams.volume = volume;
    if (this.preGainNode) {
      this.preGainNode.gain.value = dbToGain(toDecibels(volume));
    }
  }

  setSustain(sustain: boolean): void {
    if (!this.provider || !this.isLoaded) return;
    this.sustain = sustain;

    if (!sustain) {
      this.sustainedNotes.forEach((noteStr) => {
        if (!this.keyHeldNotes.has(noteStr)) {
          try {
            const stopFn = this.activeNotes.get(noteStr);
            if (stopFn) {
              this.invokeStopHandle(stopFn);
            }
            this.activeNotes.delete(noteStr);
          } catch {
            // Ignore errors during stop
          }
        }
      });
      this.sustainedNotes.clear();
    }
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

  destroy(): void {
    this.stopAllNotes();
    this.isLoaded = false;
    this.provider?.dispose();
    this.provider = null;
    this.audioContext = null;
  }

  private invokeStopHandle(stopHandle: InstrumentStopHandle): void {
    try {
      if (typeof stopHandle === "function") {
        stopHandle();
      } else if (stopHandle && "stop" in stopHandle) {
        stopHandle.stop();
      }
    } catch {
      // Ignore individual voice cleanup errors.
    }
  }
}
