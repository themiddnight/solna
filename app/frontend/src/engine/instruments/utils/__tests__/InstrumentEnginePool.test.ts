/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InstrumentEnginePool } from "../InstrumentEnginePool";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import type { InstrumentEngine } from "@/engine/instruments/shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResolveFn = () => void;

/** Creates a controllable engine mock whose `load` promise resolves on demand. */
function createMockEngine(instrumentName: string, userId = "user-1") {
  let resolveFn: ResolveFn | null = null;
  const loadPromise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  const engine = {
    instrumentName,
    isLoaded: false,
    userId,
    load: vi.fn(async () => {
      await loadPromise;
      engine.isLoaded = true;
    }),
    destroy: vi.fn(() => {
      engine.isLoaded = false;
    }),
    stopAllNotes: vi.fn(),
    isInstrumentLoaded: vi.fn(() => engine.isLoaded),
    getInstrumentName: vi.fn(() => instrumentName),
    getCategory: vi.fn(() => InstrumentCategory.Melodic),
    getUserId: vi.fn(() => userId),
    getSynthState: vi.fn(() => null),
    // Not a SynthEngine — prevents synth-state restoration branch
    constructor: { name: "MelodicEngine" },
  };

  return { engine, resolveLoad: () => resolveFn!() };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const engineRegistry = new Map<string, ReturnType<typeof createMockEngine>>();

vi.mock("@/engine/instruments/shared/engineFactory", () => ({
  createEngine: vi.fn((config) => {
    const key = `${config.userId}-${config.instrumentName}-${config.category}`;
    const entry = createMockEngine(config.instrumentName, config.userId);
    engineRegistry.set(key, entry);
    return entry.engine;
  }),
}));

vi.mock("@/engine/audio", () => ({
  AudioContextManager: {
    getInstrumentContext: vi.fn(async () => ({
      state: "running",
      resume: vi.fn(),
    })),
  },
}));

vi.mock("@/engine/instruments/synthesizer/SynthEngine", () => ({
  SynthEngine: class SynthEngine {},
}));

// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  userId: "user-1",
  username: "Alice",
  category: InstrumentCategory.Melodic,
  isLocalUser: false,
};

/** Convenience: seed the pool with a pre-loaded engine at `key`. */
async function seedEngine(
  pool: InstrumentEnginePool,
  key: string,
  instrumentName: string,
) {
  const config = { ...BASE_CONFIG, instrumentName };
  const loadCall = pool.getOrCreateEngine(key, config);
  const regKey = `${BASE_CONFIG.userId}-${instrumentName}-${InstrumentCategory.Melodic}`;
  engineRegistry.get(regKey)?.resolveLoad();
  await loadCall;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InstrumentEnginePool.updateEngineInstrument", () => {
  let pool: InstrumentEnginePool;

  beforeEach(() => {
    pool = new InstrumentEnginePool();
    engineRegistry.clear();
    vi.clearAllMocks();
  });

  it("installs the latest engine when rapid switches A→B→C all start before any load finishes", async () => {
    // Seed an initial instrument so the pool has a "local" entry.
    await seedEngine(pool, "local", "piano");

    // Kick off three rapid switches without awaiting each one.
    const switchA = pool.updateEngineInstrument("local", "guitar", InstrumentCategory.Melodic);
    const switchB = pool.updateEngineInstrument("local", "violin", InstrumentCategory.Melodic);
    const switchC = pool.updateEngineInstrument("local", "flute", InstrumentCategory.Melodic);

    // Resolve in order A→B→C (simulates network variance in load order).
    engineRegistry.get(`user-1-guitar-${InstrumentCategory.Melodic}`)?.resolveLoad();
    await Promise.resolve(); // flush microtask

    engineRegistry.get(`user-1-violin-${InstrumentCategory.Melodic}`)?.resolveLoad();
    await Promise.resolve();

    engineRegistry.get(`user-1-flute-${InstrumentCategory.Melodic}`)?.resolveLoad();
    await Promise.resolve();

    await Promise.all([switchA, switchB, switchC]);

    // Only the last switch (flute) should be installed.
    const installed = pool.getEngine("local");
    expect(installed?.getInstrumentName()).toBe("flute");
    expect(installed?.isInstrumentLoaded()).toBe(true);

    // Stale engines (guitar, violin) must have been destroyed.
    const guitarEntry = engineRegistry.get(`user-1-guitar-${InstrumentCategory.Melodic}`);
    const violinEntry = engineRegistry.get(`user-1-violin-${InstrumentCategory.Melodic}`);
    expect(guitarEntry?.engine.destroy).toHaveBeenCalled();
    expect(violinEntry?.engine.destroy).toHaveBeenCalled();
  });

  it("cancels an in-flight switch when switching back to the original instrument (A→B→A)", async () => {
    // Seed initial instrument A.
    await seedEngine(pool, "local", "piano");

    // Switch A → B (start loading B).
    const switchToB = pool.updateEngineInstrument("local", "guitar", InstrumentCategory.Melodic);

    // Before B finishes, switch back to A.  The pool will create a *new* piano engine
    // (the old one was destroyed by the B switch), so engineRegistry["piano"] is now piano-2.
    const switchBackToA = pool.updateEngineInstrument("local", "piano", InstrumentCategory.Melodic);

    // Resolve B (guitar) first — it is stale (version 1) and must be discarded.
    engineRegistry.get(`user-1-guitar-${InstrumentCategory.Melodic}`)?.resolveLoad();
    await Promise.resolve();

    // Resolve the new piano engine (piano-2, version 2) — it should be installed.
    engineRegistry.get(`user-1-piano-${InstrumentCategory.Melodic}`)?.resolveLoad();
    await Promise.resolve();

    await Promise.all([switchToB, switchBackToA]);

    // B (guitar) must be discarded; A (piano) must be the active engine.
    const installed = pool.getEngine("local");
    expect(installed?.getInstrumentName()).toBe("piano");
    expect(installed?.isInstrumentLoaded()).toBe(true);

    const guitarEntry = engineRegistry.get(`user-1-guitar-${InstrumentCategory.Melodic}`);
    expect(guitarEntry?.engine.destroy).toHaveBeenCalled();
  });

  it("rolls back the config and leaves the existing engine when load throws", async () => {
    // Seed initial instrument.
    await seedEngine(pool, "local", "piano");

    // Track the initial engine so we can verify it stays installed.
    const original = pool.getEngine("local")!;

    // Make the next createEngine call return an engine whose load rejects.
    const { createEngine } = await import(
      "@/engine/instruments/shared/engineFactory"
    );
    const failingEngine = {
      load: vi.fn(async () => {
        throw new Error("Network error");
      }),
      destroy: vi.fn(),
      stopAllNotes: vi.fn(),
      isInstrumentLoaded: vi.fn(() => false),
      getInstrumentName: vi.fn(() => "guitar"),
      getCategory: vi.fn(() => InstrumentCategory.Melodic),
      getUserId: vi.fn(() => "user-1"),
      getSynthState: vi.fn(() => null),
    };
    // @ts-expect-error — intentional partial mock: vi.fn() stubs don't satisfy the full InstrumentEngine interface
    vi.mocked(createEngine).mockReturnValueOnce(failingEngine);

    await expect(
      pool.updateEngineInstrument("local", "guitar", InstrumentCategory.Melodic),
    ).rejects.toThrow("Network error");

    // Failed engine must be destroyed.
    expect(failingEngine.destroy).toHaveBeenCalled();

    // The pool still has the original engine at "local" — not the failed one.
    expect(pool.getEngine("local")).toBe(original);
  });
});
