import { noteNameToMidiPitch } from "@/shared/utils/generalMidiPercussion";
import {
  getPercussionSetInstruments,
  type PercussionSetConfig,
} from "../percussion/percussionSets";
import { VersilianRegionPlayer } from "../shared/VersilianRegionPlayer";
import type {
  InstrumentProvider,
  InstrumentProviderLoadContext,
  InstrumentProviderPlayOptions,
  InstrumentStopHandle,
} from "./types";

export class VersilianPercussionProvider implements InstrumentProvider {
  private core: VersilianRegionPlayer | null = null;

  constructor(private readonly set: PercussionSetConfig) {}

  async load({
    audioContext,
    destination,
    schedulerLookaheadMs,
  }: InstrumentProviderLoadContext): Promise<void> {
    this.core = new VersilianRegionPlayer(
      audioContext,
      getPercussionSetInstruments(this.set),
      destination,
      schedulerLookaheadMs,
    );
    await this.core.load();
  }

  play({ note, velocity = 100, time }: InstrumentProviderPlayOptions): InstrumentStopHandle {
    const gmNote = typeof note === "number" ? note : noteNameToMidiPitch(String(note));
    const region = this.set.gmNoteToRegion[gmNote];
    if (!region) return undefined;
    return this.core?.play(region, velocity, time);
  }

  stop(note?: string | number, time?: number): void {
    if (note === undefined) {
      this.stopAll();
      return;
    }
    const gmNote = typeof note === "number" ? note : noteNameToMidiPitch(String(note));
    const region = this.set.gmNoteToRegion[gmNote];
    if (region) this.core?.stop(region, time);
  }

  stopAll(): void {
    this.core?.stopAll();
  }

  // Direct-GM-note player: return [] so the engine skips sample-name remap.
  getAvailableSamples(): string[] {
    return [];
  }

  dispose(): void {
    this.stopAll();
    this.core?.disconnect();
    this.core = null;
  }
}
