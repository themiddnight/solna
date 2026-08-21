import { describe, it, expect, vi } from "vitest";
import { NoteDispatch } from "../NoteDispatch";
import type { EngineResolver } from "../engineResolver";
import type { NoteTarget } from "../noteTarget";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import type { InstrumentEngine } from "@/engine/instruments/shared/types";

/**
 * Fully-typed InstrumentEngine stub — every method is a vi.fn() so the test
 * satisfies InstrumentEngine without any cast (TR-27). setPortamento is optional
 * and intentionally omitted.
 */
function createMockEngine(): InstrumentEngine {
  return {
    load: vi.fn(async () => {}),
    playNote: vi.fn(),
    stopNote: vi.fn(),
    stopAllNotes: vi.fn(),
    setVolume: vi.fn(),
    setSustain: vi.fn(),
    destroy: vi.fn(),
    getInstrumentName: vi.fn(() => "piano"),
    getAllActiveNotes: vi.fn(() => []),
    getCategory: vi.fn(() => InstrumentCategory.Melodic),
    isInstrumentLoaded: vi.fn(() => true),
    isInstrumentLoading: vi.fn(() => false),
    updateInstrument: vi.fn(async () => {}),
    updateBPM: vi.fn(),
    scheduleParameterChange: vi.fn(),
    getAudioNode: vi.fn(() => null),
    waitForSamples: vi.fn(async () => []),
    getAvailableSamples: vi.fn(() => []),
    getSynthState: vi.fn(() => null),
    updateSynthParams: vi.fn(async () => {}),
    getInstrumentParams: vi.fn(() => null),
    updateInstrumentParams: vi.fn(async () => {}),
    getUserId: vi.fn(() => "user-1"),
    getUsername: vi.fn(() => "tester"),
  };
}

const TRACK_TARGET: NoteTarget = { kind: "track", trackId: "track-1" };

describe("NoteDispatch", () => {
  it("forwards playNote to the resolved engine", () => {
    const engine = createMockEngine();
    const resolver: EngineResolver = { resolve: vi.fn(() => engine) };
    const dispatch = new NoteDispatch(resolver);

    dispatch.playNote(TRACK_TARGET, { note: "C4", velocity: 0.8 });

    expect(resolver.resolve).toHaveBeenCalledWith(TRACK_TARGET);
    expect(engine.playNote).toHaveBeenCalledWith({ note: "C4", velocity: 0.8 });
  });

  it("no-ops when the resolver returns null (no engine ready)", () => {
    const resolver: EngineResolver = { resolve: vi.fn(() => null) };
    const dispatch = new NoteDispatch(resolver);

    expect(() => dispatch.playNote(TRACK_TARGET, { note: "C4" })).not.toThrow();
    expect(() => dispatch.stopNote(TRACK_TARGET, { note: "C4" })).not.toThrow();
    expect(() => dispatch.stopAllNotes(TRACK_TARGET)).not.toThrow();
    expect(() => dispatch.setSustain(TRACK_TARGET, true)).not.toThrow();
  });

  it("forwards stopNote, stopAllNotes and setSustain to the engine", () => {
    const engine = createMockEngine();
    const dispatch = new NoteDispatch({ resolve: () => engine });

    dispatch.stopNote(TRACK_TARGET, { note: "C4", time: 1.5 });
    dispatch.stopAllNotes(TRACK_TARGET);
    dispatch.setSustain(TRACK_TARGET, true);

    expect(engine.stopNote).toHaveBeenCalledWith({ note: "C4", time: 1.5 });
    expect(engine.stopAllNotes).toHaveBeenCalledTimes(1);
    expect(engine.setSustain).toHaveBeenCalledWith(true);
  });

  it("re-resolves the target on every call (engine may swap between notes)", () => {
    const engineA = createMockEngine();
    const engineB = createMockEngine();
    const resolve = vi
      .fn<EngineResolver["resolve"]>()
      .mockReturnValueOnce(engineA)
      .mockReturnValueOnce(engineB);
    const dispatch = new NoteDispatch({ resolve });

    dispatch.playNote(TRACK_TARGET, { note: "C4" });
    dispatch.playNote(TRACK_TARGET, { note: "E4" });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(engineA.playNote).toHaveBeenCalledWith({ note: "C4" });
    expect(engineB.playNote).toHaveBeenCalledWith({ note: "E4" });
  });
});
