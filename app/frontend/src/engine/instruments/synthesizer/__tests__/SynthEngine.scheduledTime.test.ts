import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { now } from "tone";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import { SynthEngine } from "../SynthEngine";
import type * as AudioModule from "@/engine/audio";
import type * as EffectsArchModule from "@/engine/effects/runtime/effectsArchitecture";

vi.mock("@/engine/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof AudioModule>();
  return {
    ...actual,
    AudioContextManager: {
      ...actual.AudioContextManager,
      getInstrumentContext: vi.fn(),
    },
  };
});

vi.mock("@/engine/effects/runtime/effectsArchitecture", async (importOriginal) => {
  const actual = await importOriginal<typeof EffectsArchModule>();
  return {
    ...actual,
    getOrCreateGlobalMixer: vi.fn(),
  };
});

vi.mock("tone", async () => (await import("./toneTestMock")).createToneTestMock());

/**
 * Distinctive sentinel returned by the mocked `Tone.now()`. Any assertion that sees this value
 * proves the engine fell back to "play immediately"; any assertion that sees a SCHEDULED_* value
 * proves it honored the caller's explicit `time`.
 */
const NOW_SENTINEL = 7.5;
const SCHEDULED_ATTACK_TIME = 2.25;
const SCHEDULED_RELEASE_TIME = 3.75;

interface MockSynthRef {
  triggerAttack: ReturnType<typeof vi.fn>;
  triggerRelease: ReturnType<typeof vi.fn>;
}
interface MockFilterEnvelopeRef {
  triggerAttack: ReturnType<typeof vi.fn>;
  triggerRelease: ReturnType<typeof vi.fn>;
}
interface SynthEngineInternals {
  synthRef: MockSynthRef;
  filterEnvelopeRef: MockFilterEnvelopeRef | null;
}

/** Reaches into the engine's private chain refs — the mocked Tone nodes are the only place the
 * scheduled time is observable, and SynthEngine deliberately exposes no getter for them. */
function internals(engine: SynthEngine): SynthEngineInternals {
  return engine as unknown as SynthEngineInternals;
}

function makeEngine(instrumentName: string): SynthEngine {
  return new SynthEngine({
    userId: "u1",
    username: "Test User",
    instrumentName,
    category: InstrumentCategory.Synthesizer,
    isLocalUser: true,
  });
}

describe("SynthEngine — honors NoteEvent.time when scheduling (DEV-311 offline render)", () => {
  let mockAudioContext: AudioContext;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockAudioContext = new AudioContext();
    const { AudioContextManager } = await import("@/engine/audio");
    const { getOrCreateGlobalMixer } = await import("@/engine/effects/runtime/effectsArchitecture");
    vi.mocked(AudioContextManager.getInstrumentContext).mockResolvedValue(mockAudioContext);
    vi.mocked(getOrCreateGlobalMixer).mockResolvedValue({
      getChannel: vi.fn().mockReturnValue(null),
      createUserChannel: vi.fn().mockReturnValue({ inputGain: mockAudioContext.createGain() }),
      routeInstrumentToChannel: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getOrCreateGlobalMixer>>);
    vi.mocked(now).mockReturnValue(NOW_SENTINEL);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("polyphonic voices", () => {
    it("passes an explicit playNote time straight through to triggerAttack", async () => {
      const engine = makeEngine("analog_poly");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8, time: SCHEDULED_ATTACK_TIME });

      expect(internals(engine).synthRef.triggerAttack).toHaveBeenCalledWith(
        "C4",
        SCHEDULED_ATTACK_TIME,
        0.8,
      );
    });

    it("falls back to now() when playNote omits time (existing live-room behavior)", async () => {
      const engine = makeEngine("analog_poly");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8 });

      expect(internals(engine).synthRef.triggerAttack).toHaveBeenCalledWith(
        "C4",
        NOW_SENTINEL,
        0.8,
      );
    });

    it("passes an explicit stopNote time straight through to triggerRelease", async () => {
      const engine = makeEngine("analog_poly");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8, time: SCHEDULED_ATTACK_TIME });
      engine.stopNote({ note: "C4", time: SCHEDULED_RELEASE_TIME });

      expect(internals(engine).synthRef.triggerRelease).toHaveBeenCalledWith(
        "C4",
        SCHEDULED_RELEASE_TIME,
      );
    });

    it("falls back to now() when stopNote omits time (existing live-room behavior)", async () => {
      const engine = makeEngine("analog_poly");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8 });
      engine.stopNote({ note: "C4" });

      expect(internals(engine).synthRef.triggerRelease).toHaveBeenCalledWith("C4", NOW_SENTINEL);
    });

    it("schedules an analog filter envelope on the audio timeline (not a wall-clock setTimeout) when time is given", async () => {
      // The wall-clock `setTimeout(…, 0)` used by the live path never fires inside an
      // OfflineAudioContext render, which completes faster than the timer — with an explicit
      // time the envelope must be scheduled directly instead.
      const engine = makeEngine("analog_poly");
      await engine.load(mockAudioContext);
      const filterEnvelope = internals(engine).filterEnvelopeRef;
      expect(filterEnvelope).not.toBeNull();

      engine.playNote({ note: "C4", velocity: 0.8, time: SCHEDULED_ATTACK_TIME });

      expect(filterEnvelope?.triggerAttack).toHaveBeenCalledWith(SCHEDULED_ATTACK_TIME, 0.8);
      expect(vi.getTimerCount()).toBe(0);
      // No paired release: a release at the same audio timestamp as the attack cancels it out,
      // leaving the filter shut for the whole render.
      expect(filterEnvelope?.triggerRelease).not.toHaveBeenCalled();
    });

    it("retriggers the analog filter envelope only once for a chord scheduled at one instant", async () => {
      // The live path coalesces a chord naturally (each note-on clears the previous pending
      // setTimeout, so one attack fires); the scheduled path must match, or three attacks land
      // on the same timestamp and fight each other.
      const engine = makeEngine("analog_poly");
      await engine.load(mockAudioContext);
      const filterEnvelope = internals(engine).filterEnvelopeRef;

      engine.playNote({ note: "C4", velocity: 1, time: SCHEDULED_ATTACK_TIME });
      engine.playNote({ note: "E4", velocity: 1, time: SCHEDULED_ATTACK_TIME });
      engine.playNote({ note: "G4", velocity: 1, time: SCHEDULED_ATTACK_TIME });

      expect(filterEnvelope?.triggerAttack).toHaveBeenCalledTimes(1);
      // …but a genuinely later note does retrigger it.
      engine.playNote({ note: "B4", velocity: 1, time: SCHEDULED_ATTACK_TIME + 1 });
      expect(filterEnvelope?.triggerAttack).toHaveBeenCalledTimes(2);
    });

    it("keeps the deferred setTimeout filter-envelope path when no time is given", async () => {
      const engine = makeEngine("analog_poly");
      await engine.load(mockAudioContext);
      const filterEnvelope = internals(engine).filterEnvelopeRef;

      engine.playNote({ note: "C4", velocity: 0.8 });

      expect(filterEnvelope?.triggerAttack).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(filterEnvelope?.triggerAttack).toHaveBeenCalledWith(NOW_SENTINEL, 0.8);
    });
  });

  describe("monophonic voices", () => {
    it("passes an explicit playNote time straight through to triggerAttack", async () => {
      const engine = makeEngine("analog_mono");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8, time: SCHEDULED_ATTACK_TIME });

      expect(internals(engine).synthRef.triggerAttack).toHaveBeenCalledWith(
        "C4",
        SCHEDULED_ATTACK_TIME,
        0.8,
      );
      expect(internals(engine).filterEnvelopeRef?.triggerAttack).toHaveBeenCalledWith(
        SCHEDULED_ATTACK_TIME,
      );
    });

    it("leaves the attack time undefined when playNote omits time (existing live-room behavior)", async () => {
      const engine = makeEngine("analog_mono");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8 });

      expect(internals(engine).synthRef.triggerAttack).toHaveBeenCalledWith("C4", undefined, 0.8);
      expect(internals(engine).filterEnvelopeRef?.triggerAttack).toHaveBeenCalledWith(undefined);
    });

    it("passes an explicit stopNote time straight through to triggerRelease", async () => {
      const engine = makeEngine("analog_mono");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8, time: SCHEDULED_ATTACK_TIME });
      engine.stopNote({ note: "C4", time: SCHEDULED_RELEASE_TIME });

      expect(internals(engine).synthRef.triggerRelease).toHaveBeenCalledWith(
        SCHEDULED_RELEASE_TIME,
      );
      expect(internals(engine).filterEnvelopeRef?.triggerRelease).toHaveBeenCalledWith(
        SCHEDULED_RELEASE_TIME,
      );
    });

    it("leaves the release time undefined when stopNote omits time (existing live-room behavior)", async () => {
      const engine = makeEngine("analog_mono");
      await engine.load(mockAudioContext);

      engine.playNote({ note: "C4", velocity: 0.8 });
      engine.stopNote({ note: "C4" });

      expect(internals(engine).synthRef.triggerRelease).toHaveBeenCalledWith(undefined);
    });
  });
});
