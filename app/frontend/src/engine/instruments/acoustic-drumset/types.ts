export type AcousticDrumPiece =
  | "kick"
  | "snare"
  | "clap"
  | "hihatClosed"
  | "hihatOpen"
  | "tomLow"
  | "tomMid"
  | "tomHigh"
  | "crash"
  | "ride"
  | "tambourine"
  | "cowbell";

export type DrumHit = {
  gmNote: number;
  piece: AcousticDrumPiece;
  velocity: number;
  time?: number | undefined;
};

export interface DrumKitProvider {
  load(): Promise<void>;
  play(hit: DrumHit): void | ((time?: number) => void);
  stop?(hit: DrumHit): void;
  stopAll(): void;
  disconnect?(): void;
}
