import { noteNameToMidiPitch } from "@/shared/utils/generalMidiPercussion";

import { ACOUSTIC_DRUM_PIECES } from "../acoustic-drumset/acousticDrumKits";
import type { VersilianDrumKitConfig } from "../acoustic-drumset/acousticDrumKits";
import {
  getRepresentativeGmNoteForPiece,
  mapGmNoteToAcousticDrumPiece,
} from "../acoustic-drumset/acousticDrumMapping";
import { VersilianAcousticDrumProvider } from "../acoustic-drumset/VersilianAcousticDrumProvider";
import type { AcousticDrumPiece, DrumHit, DrumKitProvider } from "../acoustic-drumset/types";
import type {
  InstrumentProvider,
  InstrumentProviderLoadContext,
  InstrumentProviderPlayOptions,
  InstrumentStopHandle,
} from "./types";

export class VersilianAcousticDrumsetProvider implements InstrumentProvider {
  private provider: DrumKitProvider | null = null;

  constructor(private readonly kit: VersilianDrumKitConfig) {}

  async load({
    audioContext,
    destination,
    schedulerLookaheadMs,
  }: InstrumentProviderLoadContext): Promise<void> {
    this.provider = new VersilianAcousticDrumProvider(
      audioContext,
      this.kit,
      destination,
      schedulerLookaheadMs,
    );
    await this.provider.load();
  }

  play({ note, velocity = 100, time }: InstrumentProviderPlayOptions): InstrumentStopHandle {
    const hit = this.resolveHit(note, velocity, time);
    if (hit === null) {
      console.warn(`[VersilianAcousticDrumsetProvider] Unsupported GM drum note: ${note}`);
      return undefined;
    }

    return this.provider?.play(hit);
  }

  stop(note?: string | number, time?: number): void {
    if (note === undefined) {
      this.stopAll();
      return;
    }

    const hit = this.resolveHit(note, 127, time);
    if (hit !== null) {
      this.provider?.stop?.(hit);
    }
  }

  stopAll(): void {
    this.provider?.stopAll();
  }

  getAvailableSamples(): string[] {
    return [...ACOUSTIC_DRUM_PIECES];
  }

  dispose(): void {
    this.stopAll();
    this.provider?.disconnect?.();
    this.provider = null;
  }

  stopPiece(piece: AcousticDrumPiece): void {
    this.provider?.stop?.({
      gmNote: getRepresentativeGmNoteForPiece(piece),
      piece,
      velocity: 127,
    });
  }

  private resolveHit(
    note: string | number,
    velocity: number,
    time?: number,
  ): DrumHit | null {
    const piece = mapGmNoteToAcousticDrumPiece(note);
    if (piece === null) {
      return null;
    }

    return {
      gmNote: typeof note === "number" ? note : noteNameToMidiPitch(String(note)),
      piece,
      velocity,
      time,
    };
  }
}
