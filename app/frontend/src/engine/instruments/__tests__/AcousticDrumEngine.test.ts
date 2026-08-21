/* eslint-disable */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MixerEngine } from "@/engine/effects/runtime/MixerEngine";
import { createEngine } from "../shared/engineFactory";
import { InstrumentCategory } from "../shared/constants";
import { mapGmNoteToAcousticDrumPiece } from "../acoustic-drumset/acousticDrumMapping";
import { DEFAULT_ACOUSTIC_DRUMSET_ID } from "../acoustic-drumset/constants";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";

const mockVersilianStart = vi.fn();
const mockVersilianStop = vi.fn();
const mockVersilianDisconnect = vi.fn();
let mockStopFns: ReturnType<typeof vi.fn>[] = [];
let mockVersilianOptions: any[] = [];

vi.mock("smplr", () => {
  class MockVersilian {
    private readonly instrument: string;
    load = Promise.resolve(this);
    start = vi.fn((event: any) => {
      mockVersilianStart({ ...event, instrument: this.instrument });
      const stopFn = vi.fn();
      mockStopFns.push(stopFn);
      return stopFn;
    });
    stop = mockVersilianStop;
    disconnect = mockVersilianDisconnect;

    constructor(_context: AudioContext, options: any) {
      this.instrument = options.instrument;
      mockVersilianOptions.push(options);
    }
  }

  return {
    Versilian: MockVersilian,
  };
});

vi.mock("@/engine/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/audio")>();
  return {
    ...actual,
    AudioContextManager: {
      ...actual.AudioContextManager,
      getInstrumentContext: vi.fn(),
    },
  };
});

vi.mock("@/engine/effects/runtime/effectsArchitecture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/effects/runtime/effectsArchitecture")>();
  return {
    ...actual,
    getOrCreateGlobalMixer: vi.fn(),
  };
});

vi.mock("../../../shared/utils/webkitCompat", () => ({
  isSafari: vi.fn().mockReturnValue(false),
  getSafariLoadTimeout: vi.fn().mockReturnValue(30000),
  handleSafariAudioError: vi.fn((error: any) => error),
  findNextCompatibleInstrument: vi.fn(),
}));

describe("AcousticDrumEngine", () => {
  let mockAudioContext: AudioContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStopFns = [];
    mockVersilianOptions = [];
    mockAudioContext = new AudioContext();

    const { AudioContextManager } = await import("@/engine/audio");
    const { getOrCreateGlobalMixer } = await import("@/engine/effects/runtime/effectsArchitecture");

    vi.mocked(AudioContextManager.getInstrumentContext).mockResolvedValue(mockAudioContext);
    vi.mocked(getOrCreateGlobalMixer).mockResolvedValue({
      getChannel: vi.fn().mockReturnValue(null),
      createUserChannel: vi.fn().mockReturnValue({
        inputGain: mockAudioContext.createGain(),
      }),
    } as unknown as MixerEngine);
  });

  it("maps common GM drum notes to acoustic drum pieces", () => {
    expect(mapGmNoteToAcousticDrumPiece(36)).toBe("kick");
    expect(mapGmNoteToAcousticDrumPiece("D2")).toBe("snare");
    expect(mapGmNoteToAcousticDrumPiece("F#2")).toBe("hihatClosed");
    expect(mapGmNoteToAcousticDrumPiece("A#2")).toBe("hihatOpen");
    expect(mapGmNoteToAcousticDrumPiece(51)).toBe("ride");
  });

  it("routes acoustic drumset category through Versilian provider and chokes open hi-hat", async () => {
    const engine = createEngine({
      userId: "track-1",
      username: "Track 1",
      instrumentName: DEFAULT_ACOUSTIC_DRUMSET_ID,
      category: InstrumentCategory.AcousticDrumset,
      isLocalUser: true,
    });

    await engine.load();

    expect(mockVersilianOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instrument: "Idiophones/Struck Idiophones/Hi-Hat Cymbal",
        }),
        expect.objectContaining({
          instrument: "Membranophones/Struck Membranophones/Bass Drum 1",
        }),
      ]),
    );

    engine.playNote({ note: "A#2", velocity: 0.8 });
    const openHatStop = mockStopFns[0];
    expect(openHatStop).toBeDefined();

    engine.playNote({ note: "F#2", velocity: 0.8 });

    expect(openHatStop).toHaveBeenCalledOnce();
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({ note: 46 }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({ note: 42 }),
    );
  });

  it("uses playable hit regions from the Versilian SFZ files", async () => {
    const engine = createEngine({
      userId: "track-1",
      username: "Track 1",
      instrumentName: DEFAULT_ACOUSTIC_DRUMSET_ID,
      category: InstrumentCategory.AcousticDrumset,
      isLocalUser: true,
    });

    await engine.load();

    engine.playNote({ note: "D2", velocity: 0.8 }); // GM snare
    engine.playNote({ note: "A2", velocity: 0.8 }); // GM low tom
    engine.playNote({ note: "D3", velocity: 0.8 }); // GM high tom
    engine.playNote({ note: "C#3", velocity: 0.8 }); // GM crash
    engine.playNote({ note: "D#3", velocity: 0.8 }); // GM ride

    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({ note: 61 }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Membranophones/Struck Membranophones/Tom 2",
        note: 64,
      }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({ note: 64 }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({ note: 68 }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({ note: 66 }),
    );
  });

  it("assigns repeated GM drum labels to distinct Versilian instruments and articulations", async () => {
    const engine = createEngine({
      userId: "track-1",
      username: "Track 1",
      instrumentName: DEFAULT_ACOUSTIC_DRUMSET_ID,
      category: InstrumentCategory.AcousticDrumset,
      isLocalUser: true,
    });

    await engine.load();

    engine.playNote({ note: "B1", velocity: 0.8 }); // GM acoustic bass drum
    engine.playNote({ note: "C2", velocity: 0.8 }); // GM bass drum 1
    engine.playNote({ note: "C#2", velocity: 0.8 }); // GM side stick
    engine.playNote({ note: "D2", velocity: 0.8 }); // GM acoustic snare
    engine.playNote({ note: "E2", velocity: 0.8 }); // GM electric snare
    engine.playNote({ note: "G#2", velocity: 0.8 }); // GM pedal hi-hat
    engine.playNote({ note: "F3", velocity: 0.8 }); // GM ride bell

    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Membranophones/Struck Membranophones/Bass Drum 2",
        note: 62,
      }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Membranophones/Struck Membranophones/Bass Drum 1",
        note: 60,
      }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Membranophones/Struck Membranophones/Snare Drum, Modern 3",
        note: 62,
      }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Membranophones/Struck Membranophones/Snare Drum, Modern 1",
        note: 61,
      }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Membranophones/Struck Membranophones/Snare Drum, Modern 2",
        note: 61,
      }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Idiophones/Struck Idiophones/Hi-Hat Cymbal",
        note: 44,
      }),
    );
    expect(mockVersilianStart).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 2",
        note: 67,
      }),
    );
  });

  describe("pre-gain (DEV-301)", () => {
    it("setVolume writes to the pre-gain node's gain value after load", async () => {
      const engine = createEngine({
        userId: "track-1",
        username: "Track 1",
        instrumentName: DEFAULT_ACOUSTIC_DRUMSET_ID,
        category: InstrumentCategory.AcousticDrumset,
        isLocalUser: true,
      });

      await engine.load();
      engine.setVolume(-6);

      const node = engine.getAudioNode();
      expect(node).not.toBeNull();
      expect((node as GainNode).gain.value).toBeCloseTo(
        dbToGain(toDecibels(-6)),
        5,
      );
    });

    it("setVolume called before load() does not throw and is applied once loaded", async () => {
      const engine = createEngine({
        userId: "track-1",
        username: "Track 1",
        instrumentName: DEFAULT_ACOUSTIC_DRUMSET_ID,
        category: InstrumentCategory.AcousticDrumset,
        isLocalUser: true,
      });

      expect(() => engine.setVolume(-12)).not.toThrow();
      await engine.load();

      const node = engine.getAudioNode();
      expect(node).not.toBeNull();
      expect((node as GainNode).gain.value).toBeCloseTo(
        dbToGain(toDecibels(-12)),
        5,
      );
    });

    it("getInstrumentParams reflects the last setVolume/updateInstrumentParams value", async () => {
      const engine = createEngine({
        userId: "track-1",
        username: "Track 1",
        instrumentName: DEFAULT_ACOUSTIC_DRUMSET_ID,
        category: InstrumentCategory.AcousticDrumset,
        isLocalUser: true,
      });

      await engine.load();

      engine.setVolume(-3);
      expect(engine.getInstrumentParams()).toEqual({ volume: -3 });

      await engine.updateInstrumentParams({ volume: 6 });
      expect(engine.getInstrumentParams()).toEqual({ volume: 6 });
      expect((engine.getAudioNode() as GainNode).gain.value).toBeCloseTo(
        dbToGain(toDecibels(6)),
        5,
      );
    });
  });
});
