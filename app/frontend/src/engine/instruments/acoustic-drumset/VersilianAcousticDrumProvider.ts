import {
  VersilianRegionPlayer,
  type VersilianRegion,
} from "../shared/VersilianRegionPlayer";
import {
  getVersilianKitInstruments,
  type VersilianDrumKitConfig,
} from "./acousticDrumKits";
import type { DrumHit, DrumKitProvider } from "./types";

export class VersilianAcousticDrumProvider implements DrumKitProvider {
  private readonly core: VersilianRegionPlayer;

  constructor(
    context: BaseAudioContext,
    private readonly kit: VersilianDrumKitConfig,
    destination?: AudioNode | null,
    schedulerLookaheadMs?: number,
  ) {
    this.core = new VersilianRegionPlayer(
      context,
      getVersilianKitInstruments(kit),
      destination,
      schedulerLookaheadMs,
    );
  }

  load(): Promise<void> {
    return this.core.load();
  }

  play(hit: DrumHit): void | ((time?: number) => void) {
    return this.core.play(this.resolveRegion(hit), hit.velocity, hit.time);
  }

  stop(hit: DrumHit): void {
    this.core.stop(this.resolveRegion(hit), hit.time);
  }

  stopAll(): void {
    this.core.stopAll();
  }

  disconnect(): void {
    this.core.disconnect();
  }

  private resolveRegion(hit: DrumHit): VersilianRegion {
    return this.kit.gmNoteToRegion[hit.gmNote] ?? this.kit.pieceRegions[hit.piece];
  }
}
