import { Scheduler, Versilian } from "smplr";

export interface VersilianRegion {
  instrument: string;
  note: number;
}

export class VersilianRegionPlayer {
  private readonly players = new Map<string, Versilian>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly instruments: readonly string[],
    private readonly destination?: AudioNode | null,
    /** See `InstrumentProviderLoadContext.schedulerLookaheadMs` — widened by offline renders so
     * every scheduled hit is dispatched synchronously instead of waiting on a wall-clock timer. */
    private readonly schedulerLookaheadMs?: number,
  ) {}

  async load(): Promise<void> {
    await Promise.all(
      this.instruments.map(async (instrument) => {
        const player = new Versilian(this.context, {
          instrument,
          ...(this.destination ? { destination: this.destination } : {}),
          ...(this.schedulerLookaheadMs === undefined
            ? {}
            : { scheduler: Scheduler(this.context, { lookaheadMs: this.schedulerLookaheadMs }) }),
        });
        await player.load;
        this.players.set(instrument, player);
      }),
    );
  }

  play(
    region: VersilianRegion,
    velocity: number,
    time?: number,
  ): ((time?: number) => void) | void {
    const player = this.players.get(region.instrument);
    if (!player) return;
    return player.start({
      note: region.note,
      velocity,
      ...(time !== undefined ? { time } : {}),
    });
  }

  /**
   * `time` omitted means "stop now" — during an offline render that's `context.currentTime`,
   * which stays 0 until `startRendering()` runs, cutting every scheduled note to zero length
   * (DEV-311 finding). Mirrors `smplrStopTarget`'s note↔StopTarget mapping so a scheduled stop
   * time survives instead of silently collapsing to "now".
   */
  stop(region: VersilianRegion, time?: number): void {
    const player = this.players.get(region.instrument);
    if (!player) return;
    player.stop(time === undefined ? region.note : { stopId: region.note, time });
  }

  stopAll(): void {
    new Set(this.players.values()).forEach((p) => p.stop());
  }

  disconnect(): void {
    new Set(this.players.values()).forEach((p) => p.disconnect());
    this.players.clear();
  }
}
