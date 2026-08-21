import { DrumAbuse, DrumMachine } from "smplr";

import { createCaseFallbackStorage } from "./smplrCaseFallbackStorage";
import { smplrSchedulerOptions, smplrStopTarget } from "./smplrOptions";
import type {
  InstrumentProvider,
  InstrumentProviderLoadContext,
  InstrumentProviderPlayOptions,
  InstrumentStopHandle,
} from "./types";

type SmplrDrumInstrument = ReturnType<typeof DrumMachine> | ReturnType<typeof DrumAbuse>;

type SmplrDrumProviderConfig =
  | {
      kind: "machine";
      instrument: string;
    }
  | {
      kind: "drum-abuse";
      machine: string;
      set?: string;
    };

export class SmplrDrumProvider implements InstrumentProvider {
  private instrument: SmplrDrumInstrument | null = null;

  constructor(private readonly config: SmplrDrumProviderConfig) {}

  async load(context: InstrumentProviderLoadContext): Promise<void> {
    const { audioContext, destination } = context;
    const sharedOptions = {
      volume: 127,
      storage: createCaseFallbackStorage(),
      ...(destination ? { destination } : {}),
      ...smplrSchedulerOptions(context),
    };

    this.instrument =
      this.config.kind === "drum-abuse"
        ? DrumAbuse(audioContext, {
            ...sharedOptions,
            source: {
              kind: "machine",
              machine: this.config.machine,
              ...(this.config.set !== undefined ? { set: this.config.set } : {}),
            },
          })
        : DrumMachine(audioContext, {
            ...sharedOptions,
            instrument: this.config.instrument,
          });

    await this.instrument.load;
  }

  play({ note, velocity = 100, time }: InstrumentProviderPlayOptions): InstrumentStopHandle {
    return this.instrument?.start({
      note,
      velocity,
      ...(time !== undefined ? { time } : {}),
    });
  }

  stop(note?: string | number, time?: number): void {
    this.instrument?.stop(smplrStopTarget(note, time));
  }

  stopAll(): void {
    this.instrument?.stop();
  }

  getAvailableSamples(): string[] {
    if (!this.instrument?.getSampleNames) {
      return [];
    }

    try {
      const samples = this.instrument.getSampleNames();
      return Array.isArray(samples) ? samples : [];
    } catch (error) {
      console.warn(`Failed to get samples from drum provider: ${String(error)}`);
      return [];
    }
  }

  dispose(): void {
    this.stopAll();
    this.instrument?.disconnect();
    this.instrument = null;
  }
}
