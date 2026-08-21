import { beforeEach, describe, expect, it, vi } from "vitest";

import { PercussionEngine } from "@/engine/instruments/percussion/PercussionEngine";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import { DEFAULT_PERCUSSION_SET_ID } from "@/engine/instruments/percussion/constants";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";
import type * as EngineAudioModule from "@/engine/audio";
import type * as EffectsArchitectureModule from "@/engine/effects/runtime/effectsArchitecture";
import type * as WebkitCompatModule from "@/shared/utils/webkitCompat";

// PercussionEngine had no dedicated engine-behavior test file before DEV-301 (only
// percussionSets.test.ts, which covers the set-config catalog, not the engine class) — this
// file is new, mirroring the sibling AcousticDrumEngine.test.ts's location/naming/mocking
// conventions so all 4 non-synth engines get equivalent pre-gain coverage.
//
// The mocks below are declared as bare `vi.fn()` (not re-imported and re-typed via
// `vi.mocked()`) so `.mockResolvedValue()` isn't type-checked against the real
// `MixerEngine`/`AudioContext` signatures — matching the pattern in
// `shared/__tests__/BaseInstrumentEngine.test.ts`, which avoids the `as unknown as T`
// casts TR-27 forbids.
vi.mock("smplr", () => {
  class MockVersilian {
    load = Promise.resolve(this);
    start = vi.fn(() => vi.fn());
    stop = vi.fn();
    disconnect = vi.fn();

    constructor(_context: AudioContext, _options: { instrument: string }) {}
  }

  return {
    Versilian: MockVersilian,
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

describe("PercussionEngine pre-gain (DEV-301)", () => {
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
    new PercussionEngine({
      userId: "u",
      username: "n",
      instrumentName: DEFAULT_PERCUSSION_SET_ID,
      category: InstrumentCategory.Percussions,
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
