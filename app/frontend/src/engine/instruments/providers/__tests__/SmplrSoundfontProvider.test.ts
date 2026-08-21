 
import { afterEach, describe, expect, it, vi } from "vitest";

import { SmplrSoundfontProvider } from "../SmplrSoundfontProvider";

const soundfontConstructors = vi.hoisted(() => [] as Array<{ options: Record<string, unknown> }>);

vi.mock("smplr", () => {
  class MockSoundfont {
    hasLoops = true;
    load = Promise.resolve();
    start = vi.fn();
    stop = vi.fn();
    disconnect = vi.fn();

    constructor(_context: AudioContext, options: Record<string, unknown>) {
      soundfontConstructors.push({ options });
    }
  }

  return {
    Soundfont: MockSoundfont,
  };
});

const setUserAgent = (userAgent: string): void => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
};

const makeAudioContext = (sampleRate?: number): AudioContext => ({ sampleRate }) as AudioContext;

describe("SmplrSoundfontProvider", () => {
  afterEach(() => {
    soundfontConstructors.length = 0;
    vi.restoreAllMocks();
  });

  it("uses smplr instrument lookup by default", async () => {
    setUserAgent("Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36");

    const provider = new SmplrSoundfontProvider({ instrument: "acoustic_grand_piano" });

    await provider.load({ audioContext: makeAudioContext() });

    expect(soundfontConstructors[0]?.options).toMatchObject({
      instrument: "acoustic_grand_piano",
      loadLoopData: false,
      volume: 127,
    });
    expect(soundfontConstructors[0]?.options.instrumentUrl).toBeUndefined();
  });

  it("forces mp3 soundfont URLs for WebKit without Chromium", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    );

    const provider = new SmplrSoundfontProvider({ instrument: "acoustic_grand_piano" });

    await provider.load({ audioContext: makeAudioContext() });

    expect(soundfontConstructors[0]?.options).toMatchObject({
      instrumentUrl:
        "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3.js",
      loadLoopData: false,
      volume: 127,
    });
    expect(soundfontConstructors[0]?.options.instrument).toBeUndefined();
  });

  it("forces mp3 soundfont URLs for 44100 Hz audio contexts", async () => {
    setUserAgent("Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36");

    const provider = new SmplrSoundfontProvider({ instrument: "acoustic_grand_piano" });

    await provider.load({ audioContext: makeAudioContext(44100) });

    expect(soundfontConstructors[0]?.options.instrumentUrl).toBe(
      "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3.js",
    );
    expect(soundfontConstructors[0]?.options.instrument).toBeUndefined();
  });
});
