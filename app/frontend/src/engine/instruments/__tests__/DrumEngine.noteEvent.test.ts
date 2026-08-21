import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrumEngine } from "@/engine/instruments/drum/DrumEngine";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import type { InstrumentProviderPlayOptions } from "@/engine/instruments/providers/types";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";
import type * as EngineAudioModule from "@/engine/audio";
import type * as EffectsArchitectureModule from "@/engine/effects/runtime/effectsArchitecture";
import type * as WebkitCompatModule from "@/shared/utils/webkitCompat";

// Pre-gain tests (DEV-301) exercise the real load() path, which pulls in the smplr-backed
// drum machine provider and the mixer/audio-context plumbing. Mock all three so load()
// resolves instantly against fake nodes instead of fetching real drum-machine samples.
//
// The mocks below are declared as bare `vi.fn()` (not re-imported and re-typed via
// `vi.mocked()`) so `.mockResolvedValue()` isn't type-checked against the real
// `MixerEngine`/`AudioContext` signatures — matching the pattern in
// `shared/__tests__/BaseInstrumentEngine.test.ts`, which avoids the `as unknown as T`
// casts TR-27 forbids.
vi.mock("smplr", () => {
  // Non-empty so DrumEngine.load()'s waitForSamples() resolves on its first poll
  // instead of spinning for the full 3s timeout.
  const mockInstrument = {
    load: Promise.resolve(),
    start: vi.fn(() => vi.fn()),
    stop: vi.fn(),
    disconnect: vi.fn(),
    getSampleNames: vi.fn(() => ["kick"]),
  };
  return {
    DrumMachine: vi.fn(() => mockInstrument),
    DrumAbuse: vi.fn(() => mockInstrument),
    // SmplrDrumProvider passes createCaseFallbackStorage()'s default param (HttpStorage) through
    // to smplr — the mocked instrument above never actually calls storage.fetch, so this only
    // needs to be defined, not functional.
    HttpStorage: { fetch: vi.fn() },
  };
});

const getInstrumentContextMock = vi.fn();

vi.mock("@/engine/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof EngineAudioModule>();
  return {
    ...actual,
    AudioContextManager: {
      ...actual.AudioContextManager,
      getInstrumentContext: getInstrumentContextMock,
    },
  };
});

const getOrCreateGlobalMixerMock = vi.fn();

vi.mock("@/engine/effects/runtime/effectsArchitecture", async (importOriginal) => {
  const actual = await importOriginal<typeof EffectsArchitectureModule>();
  return {
    ...actual,
    getOrCreateGlobalMixer: getOrCreateGlobalMixerMock,
  };
});

vi.mock("@/shared/utils/webkitCompat", async (importOriginal) => {
  const actual = await importOriginal<typeof WebkitCompatModule>();
  return {
    ...actual,
    isSafari: vi.fn().mockReturnValue(false),
    getSafariLoadTimeout: vi.fn().mockReturnValue(30000),
    handleSafariAudioError: vi.fn((error: unknown) => error),
  };
});

describe("DrumEngine playNote NoteEvent", () => {
  it("accepts a NoteEvent and forwards to the provider", () => {
    const play = vi.fn((_options: InstrumentProviderPlayOptions) => () => {});
    const engine = new DrumEngine({
      userId: "u", username: "n", instrumentName: "drum-machine",
      category: InstrumentCategory.DrumBeat,
    });
    // @ts-expect-error test seam: inject a loaded provider
    engine.provider = { play };
    // @ts-expect-error test seam: mark the engine loaded
    engine.isLoaded = true;
    // @ts-expect-error test seam: inject audio context
    engine.audioContext = { currentTime: 0 };

    engine.playNote({ note: "C2", velocity: 0.5 });

    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]![0]).toMatchObject({ velocity: 64 }); // round(0.5*127)
  });
});

describe("DrumEngine pre-gain (DEV-301)", () => {
  let mockAudioContext: AudioContext;

  beforeEach(() => {
    mockAudioContext = new AudioContext();

    getInstrumentContextMock.mockReset().mockResolvedValue(mockAudioContext);
    getOrCreateGlobalMixerMock.mockReset().mockResolvedValue({
      getChannel: vi.fn().mockReturnValue(null),
      createUserChannel: vi.fn().mockReturnValue({
        inputGain: mockAudioContext.createGain(),
      }),
    });
  });

  const makeEngine = () =>
    new DrumEngine({
      userId: "u",
      username: "n",
      instrumentName: "TR-808",
      category: InstrumentCategory.DrumBeat,
    });

  it("setVolume writes to the pre-gain node's gain value after load", async () => {
    const engine = makeEngine();
    await engine.load();

    engine.setVolume(-6);

    const node = engine.getAudioNode();
    expect(node).not.toBeNull();
    expect((node as GainNode).gain.value).toBeCloseTo(dbToGain(toDecibels(-6)), 5);
  });

  it("setVolume called before load() does not throw and is applied once loaded", async () => {
    const engine = makeEngine();

    expect(() => engine.setVolume(-12)).not.toThrow();
    await engine.load();

    const node = engine.getAudioNode();
    expect(node).not.toBeNull();
    expect((node as GainNode).gain.value).toBeCloseTo(dbToGain(toDecibels(-12)), 5);
  });

  it("getInstrumentParams reflects the last setVolume/updateInstrumentParams value", async () => {
    const engine = makeEngine();
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
