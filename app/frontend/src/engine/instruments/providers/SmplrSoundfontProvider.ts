import { Soundfont, type SoundfontOptions } from "smplr";

import { smplrSchedulerOptions, smplrStopTarget } from "./smplrOptions";
import type {
  InstrumentProvider,
  InstrumentProviderLoadContext,
  InstrumentProviderPlayOptions,
  InstrumentStopHandle,
} from "./types";

type SmplrSoundfontConfig = {
  instrument: string;
};

type SmplrSoundfont = Soundfont & {
  hasLoops?: boolean;
};

const DEFAULT_SOUNDFONT_KIT = "MusyngKite";
const SOUNDFONT_BASE_URL = `https://gleitz.github.io/midi-js-soundfonts/${DEFAULT_SOUNDFONT_KIT}`;

const isWebKitWithoutChromium = (): boolean => {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent;
  return /AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)/i.test(userAgent);
};

const shouldUseMp3Soundfont = (audioContext: BaseAudioContext): boolean =>
  isWebKitWithoutChromium() || audioContext.sampleRate === 44100;

const getMp3SoundfontUrl = (instrument: string): string =>
  `${SOUNDFONT_BASE_URL}/${encodeURIComponent(instrument)}-mp3.js`;

export class SmplrSoundfontProvider implements InstrumentProvider {
  private instrument: SmplrSoundfont | null = null;

  constructor(private readonly config: SmplrSoundfontConfig) {}

  async load(context: InstrumentProviderLoadContext): Promise<void> {
    const { audioContext, destination } = context;
    const options: SoundfontOptions = {
      loadLoopData: false,
      volume: 127,
      ...(destination ? { destination } : {}),
      ...smplrSchedulerOptions(context),
      ...(shouldUseMp3Soundfont(audioContext)
        ? { instrumentUrl: getMp3SoundfontUrl(this.config.instrument) }
        : { instrument: this.config.instrument }),
    };

    this.instrument = new Soundfont(audioContext, options) as SmplrSoundfont;

    await this.instrument.load;

    if (this.instrument.hasLoops === false) {
      console.warn(
        `[SmplrSoundfontProvider] Instrument ${this.config.instrument} loaded without smplr loop data; long held notes may still decay.`,
      );
    }
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
    return [];
  }

  dispose(): void {
    this.stopAll();
    this.instrument?.disconnect();
    this.instrument = null;
  }
}
