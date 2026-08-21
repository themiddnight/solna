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
import {
  getPadNotesForPage,
  mapSampleToGMNote,
} from "@/shared/utils/generalMidiPercussion";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";
import {
  getSafariLoadTimeout,
  handleSafariAudioError,
} from "@/shared/utils/webkitCompat";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";

export class DrumEngine extends BaseInstrumentEngine {
  private audioContext: EngineAudioContext | null = null;
  private provider: InstrumentProvider | null = null;
  private readonly instrumentParams: InstrumentParamsState = {
    volume: DEFAULT_INSTRUMENT_GAIN_DB,
  };

  // Note tracking
  private readonly activeNotes = new Map<string, InstrumentStopHandle>();
  private readonly sustainedNotes = new Set<string>();
  private readonly keyHeldNotes = new Set<string>();

  // Per-instrument GM note mapper for drum machines
  private readonly gmNoteToSampleMap: Map<string, string> = new Map();
  private readonly sampleToGMNoteMap: Map<string, string> = new Map();

  // Load cancellation tracking to prevent memory leaks from timed-out loads
  private readonly pendingLoads: Map<string, AbortController> = new Map();
  private readonly loadCancelled: Set<string> = new Set();

  constructor(config: InstrumentEngineConfig) {
    super(config);
    this.instrumentParams.volume = getCalibratedTrimDb(config.instrumentName) ?? DEFAULT_INSTRUMENT_GAIN_DB;
  }

  // Public methods
  getAvailableSamples(): string[] {
    if (this.provider && this.isLoaded) {
      return this.provider.getAvailableSamples();
    }
    return [];
  }

  async waitForSamples(maxWaitTime: number = 5000): Promise<string[]> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      const samples = this.getAvailableSamples();
      if (samples.length > 0) return samples;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.warn(
      `Timeout waiting for drum machine samples after ${maxWaitTime}ms`,
    );
    return [];
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
          `Unknown drum instrument: ${this.config.instrumentName}`,
        );
      }
      this.provider = createInstrumentProvider(descriptor);

      const loadTimeout = getSafariLoadTimeout();
      const loadId = `${this.config.instrumentName}-${Date.now()}`;
      const abortController = new AbortController();

      // Track this load attempt for cancellation
      this.pendingLoads.set(loadId, abortController);

      const loadPromise = new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          // Mark load as cancelled to prevent applying results if promise resolves later
          this.loadCancelled.add(loadId);
          this.pendingLoads.delete(loadId);
          abortController.abort();
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
            // Only proceed if load was not cancelled by timeout
            if (!this.loadCancelled.has(loadId)) {
              this.pendingLoads.delete(loadId);
              resolve();
            }
          })
          .catch((error: unknown) => {
            clearTimeout(timeoutId);
            this.loadCancelled.delete(loadId);
            this.pendingLoads.delete(loadId);
            const enhancedError = handleSafariAudioError(
              error,
              this.config.instrumentName,
            );
            reject(enhancedError);
          });
      });

      await loadPromise;
      this.isLoaded = true;

      try {
        const samples = await this.waitForSamples(3000);
        if (samples.length > 0) {
          this.initializeGMNoteMapper(samples);
        }
      } catch (error) {
        console.error(`🥁 Failed to initialize GM note mapper logs:`, error);
      }
    } finally {
      this.isLoading = false;
    }
  }

  playNote({ note, velocity = 0.7, time }: NoteEvent): void {
    if (!this.provider || !this.isLoaded) return;

    let actualNote = String(note);
    const mappedSample = this.resolveDrumSample(String(note));
    if (mappedSample) {
      actualNote = mappedSample;
    }

    // Stop existing note
    this.stopNote({ note: actualNote });

    const scaledVelocity = Math.round(
      Math.max(1, Math.min(127, velocity * 127)),
    );

    try {
      const playedNote = this.provider.play({
        note: actualNote,
        velocity: scaledVelocity,
        time: time ?? this.audioContext!.currentTime + 0.001,
      });

      if (playedNote) {
        this.activeNotes.set(actualNote, playedNote);
        this.keyHeldNotes.add(actualNote);

        // Auto cleanup for drums - smplr DrumMachine handles its own decay usually,
        // but we clear our refs.
        setTimeout(() => {
          if (this.activeNotes.get(actualNote) === playedNote) {
            this.activeNotes.delete(actualNote);
            this.keyHeldNotes.delete(actualNote);
          }
        }, 5000);
      }
    } catch (error) {
      console.warn(`[DrumEngine] Failed to play note ${actualNote}:`, error);
    }
  }

  stopNote({ note }: NoteStopEvent): void {
    if (!this.provider || !this.isLoaded) return;
    const noteStr = String(note);

    const actualNote = this.resolveDrumSample(noteStr) || noteStr;

    const activeNote = this.activeNotes.get(actualNote);
    if (activeNote) {
      this.keyHeldNotes.delete(actualNote);
      if (typeof activeNote === "function") {
        activeNote();
      } else {
        try {
          activeNote.stop();
        } catch {
          // Ignore errors during stop
        }
      }
      this.activeNotes.delete(actualNote);
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
      console.warn(`[DrumEngine] Failed to stop all notes:`, error);
    }
  }

  setVolume(volume: number): void {
    this.instrumentParams.volume = volume;
    if (this.preGainNode) {
      this.preGainNode.gain.value = dbToGain(toDecibels(volume));
    }
  }

  setSustain(_sustain: boolean): void {
    // Drums usually don't have sustain pedal logic in this engine
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
    this.provider?.dispose();
    this.provider = null;
    this.audioContext = null;
    this.gmNoteToSampleMap.clear();
    this.sampleToGMNoteMap.clear();

    // Cancel all pending loads to prevent memory leaks
    this.pendingLoads.forEach((controller) => {
      controller.abort();
    });
    this.pendingLoads.clear();
    this.loadCancelled.clear();
  }

  // Private methods (placed after all public methods per member-ordering)
  private initializeGMNoteMapper(availableSamples: string[]): void {
    this.gmNoteToSampleMap.clear();
    this.sampleToGMNoteMap.clear();

    if (availableSamples.length === 0) return;

    const gmNotes = getPadNotesForPage(0);
    const usedGMNotes = new Set<string>();

    availableSamples.forEach((sample) => {
      const gmNote = mapSampleToGMNote(sample);
      if (gmNote && !usedGMNotes.has(gmNote)) {
        this.gmNoteToSampleMap.set(gmNote, sample);
        this.sampleToGMNoteMap.set(sample, gmNote);
        usedGMNotes.add(gmNote);
      }
    });

    let noteIndex = 0;
    availableSamples.forEach((sample) => {
      if (this.sampleToGMNoteMap.has(sample)) return;

      while (noteIndex < gmNotes.length) {
        const gmNote = gmNotes[noteIndex];
        if (!gmNote || !usedGMNotes.has(gmNote)) {
          break;
        }
        noteIndex++;
      }

      const fallbackNote = gmNotes[noteIndex] ?? null;
      if (fallbackNote) {
        this.gmNoteToSampleMap.set(fallbackNote, sample);
        this.sampleToGMNoteMap.set(sample, fallbackNote);
        usedGMNotes.add(fallbackNote);
        noteIndex++;
      }
    });
  }

  private resolveDrumSample(note: string): string | null {
    return this.gmNoteToSampleMap.get(note) ?? null;
  }
}
