import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import { SynthEngine } from "../SynthEngine";
import { VOICE_SUM_GAIN_RELEASE_RAMP_TIME } from "../utils/voiceSumSaturation";
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

// Shared with SynthEngine.scheduledTime.test.ts — see toneTestMock.ts for why the SynthEngine
// suites use their own mock rather than InstrumentEngine.synthesizer.test.ts's.
vi.mock("tone", async () => (await import("./toneTestMock")).createToneTestMock());

function makeEngine(instrumentName: string): SynthEngine {
  return new SynthEngine({
    userId: "u1",
    username: "Test User",
    instrumentName,
    category: InstrumentCategory.Synthesizer,
    isLocalUser: true,
  });
}

describe("SynthEngine — activeNotes voice-count tracking (DEV-299 prerequisite)", () => {
  let mockAudioContext: AudioContext;

  beforeEach(async () => {
    mockAudioContext = new AudioContext();
    const { AudioContextManager } = await import("@/engine/audio");
    const { getOrCreateGlobalMixer } = await import("@/engine/effects/runtime/effectsArchitecture");
    vi.mocked(AudioContextManager.getInstrumentContext).mockResolvedValue(mockAudioContext);
    vi.mocked(getOrCreateGlobalMixer).mockResolvedValue({
      getChannel: vi.fn().mockReturnValue(null),
      createUserChannel: vi.fn().mockReturnValue({ inputGain: mockAudioContext.createGain() }),
      routeInstrumentToChannel: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getOrCreateGlobalMixer>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getActiveVoiceCount reflects held PolySynth notes", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);

    engine.playNote({ note: "C4", velocity: 0.8 });
    engine.playNote({ note: "E4", velocity: 0.8 });
    engine.playNote({ note: "G4", velocity: 0.8 });
    expect(engine.getActiveVoiceCount()).toBe(3);

    engine.stopNote({ note: "E4" });
    expect(engine.getActiveVoiceCount()).toBe(2);
  });

  it("evicts activeNotes entries when the sustain pedal releases held PolySynth notes (bug fix)", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);

    engine.setSustain(true);
    engine.playNote({ note: "C4", velocity: 0.8 });
    engine.playNote({ note: "E4", velocity: 0.8 });
    engine.playNote({ note: "G4", velocity: 0.8 });
    // Keys physically released while the pedal is held: notes move to "sustained", NOT evicted
    // from activeNotes yet (matches keyboard behavior — the notes are still sounding).
    engine.stopNote({ note: "C4" });
    engine.stopNote({ note: "E4" });
    engine.stopNote({ note: "G4" });
    expect(engine.getActiveVoiceCount()).toBe(3); // still sounding, sustained

    engine.setSustain(false); // pedal lifted — all 3 should now fully release AND evict
    expect(engine.getActiveVoiceCount()).toBe(0);
  });
});

describe("SynthEngine — voice-sum output stage wiring (DEV-299)", () => {
  let mockAudioContext: AudioContext;

  beforeEach(async () => {
    mockAudioContext = new AudioContext();
    const { AudioContextManager } = await import("@/engine/audio");
    const { getOrCreateGlobalMixer } = await import("@/engine/effects/runtime/effectsArchitecture");
    vi.mocked(AudioContextManager.getInstrumentContext).mockResolvedValue(mockAudioContext);
    vi.mocked(getOrCreateGlobalMixer).mockResolvedValue({
      getChannel: vi.fn().mockReturnValue(null),
      createUserChannel: vi.fn().mockReturnValue({ inputGain: mockAudioContext.createGain() }),
      routeInstrumentToChannel: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getOrCreateGlobalMixer>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getAudioNode() returns the saturator (the new terminal node), not the volume Gain", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);
    const node = engine.getAudioNode();
    expect(node).not.toBeNull();
    // The saturator mock carries `oversample`, which the plain volume Gain mock never had —
    // the cheapest reliable signal, from this test's own mocks, that the terminal node changed.
    expect((node as unknown as { oversample?: string }).oversample).toBe("none");
  });

  it("ramps the voice-sum gain toward 1/√N as chord notes are added", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);

    engine.playNote({ note: "C4", velocity: 0.8 });
    engine.playNote({ note: "E4", velocity: 0.8 });
    engine.playNote({ note: "G4", velocity: 0.8 });
    engine.playNote({ note: "B4", velocity: 0.8 });

    const stage = (engine as unknown as { outputStage: { voiceSumGain: { gain: { rampTo: ReturnType<typeof vi.fn> } } } }).outputStage;
    const lastCall = stage.voiceSumGain.gain.rampTo.mock.calls.at(-1);
    expect(lastCall?.[0]).toBeCloseTo(1 / Math.sqrt(4), 5);
  });

  it("ramps DOWN with the fast ramp time as voices are added (target < current gain)", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);

    engine.playNote({ note: "C4", velocity: 0.8 });
    engine.playNote({ note: "E4", velocity: 0.8 });

    const stage = (
      engine as unknown as {
        outputStage: { voiceSumGain: { gain: { rampTo: ReturnType<typeof vi.fn> } } };
      }
    ).outputStage;
    // Every call here is a DECREASE (1 -> 1/√1, then 1/√1 -> 1/√2), so every call must use the
    // existing fast 20ms attack ramp — never the slow release-tail ramp (DEV-299 final-review
    // Finding 1).
    for (const call of stage.voiceSumGain.gain.rampTo.mock.calls) {
      expect(call[1]).toBeCloseTo(0.02, 5);
    }
  });

  it("ramps UP with the slow release-tail ramp time as voices release (target > current gain)", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);

    engine.playNote({ note: "C4", velocity: 0.8 });
    engine.playNote({ note: "E4", velocity: 0.8 });
    engine.playNote({ note: "G4", velocity: 0.8 });
    engine.playNote({ note: "B4", velocity: 0.8 });

    const stage = (
      engine as unknown as {
        outputStage: { voiceSumGain: { gain: { rampTo: ReturnType<typeof vi.fn> } } };
      }
    ).outputStage;
    stage.voiceSumGain.gain.rampTo.mockClear();

    // 4 held -> 3 held: target 1/√3 (≈0.577) > current 1/√4 (0.5) — a RISE. Must use the slow
    // release-tail ramp so the gain doesn't race back to unity while the released voice's
    // envelope is still audibly decaying (DEV-299 final-review Finding 1 — the "bloom" bug).
    engine.stopNote({ note: "B4" });
    const call = stage.voiceSumGain.gain.rampTo.mock.calls.at(-1);
    expect(call?.[0]).toBeCloseTo(1 / Math.sqrt(3), 5);
    expect(call?.[1]).toBeCloseTo(VOICE_SUM_GAIN_RELEASE_RAMP_TIME, 5);
  });

  it("stopNote actually invokes updateVoiceSumGain() for a mono synth — non-vacuously confirms target is always exactly 1", async () => {
    const engine = makeEngine("analog_mono");
    await engine.load(mockAudioContext);

    engine.playNote({ note: "C4", velocity: 0.8 });
    // This mock's Synth/FMSynth/NoiseSynth all share `mockSynthShape`, which has no `setNote` —
    // unlike a REAL Tone.Synth/FMSynth (used for a pitched "analog_mono" voice), which DOES
    // expose `setNote` and takes it in playMonoSynthNote's legato branch, correctly deleting the
    // previous note's activeNotes entry. So in production this multi-entry staleness for a
    // pitched mono voice essentially can't happen — it's realistically a NoiseSynth-only case (no
    // pitch/legato concept at all). Here the "stale" second entry is purely a side effect of this
    // file's simplified mock; it stands in to prove the mono path's gain target doesn't depend on
    // activeNotes.size, whatever that count happens to be.
    engine.playNote({ note: "E4", velocity: 0.8 }); // stale entry: mock has no setNote to evict "C4"

    const stage = (
      engine as unknown as {
        outputStage: { voiceSumGain: { gain: { rampTo: ReturnType<typeof vi.fn> } } };
      }
    ).outputStage;
    stage.voiceSumGain.gain.rampTo.mockClear();

    // The original version of this test asserted over rampTo's call list right after those two
    // playNote calls — but playMonoSynthNote never calls updateVoiceSumGain() at all, so that
    // assertion ran over zero calls and trivially passed (DEV-299 final-review Finding 4).
    // stopNote() DOES call updateVoiceSumGain() unconditionally at the end of the method — use it
    // to get a real, non-vacuous assertion.
    engine.stopNote({ note: "C4" });

    const calls = stage.voiceSumGain.gain.rampTo.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // Every call this mono synth ever makes must target unity gain — the mono path must never
    // read the (possibly stale) activeNotes.size.
    for (const call of calls) {
      expect(call[0]).toBeCloseTo(1, 10);
    }
  });

  it("rebuild-on-oscillator-type-change (isNeedsRebuild path) still produces a working outputStage", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);
    // "noise" flips isNoiseOscillator(), triggering the rebuild path in updateSynthParams.
    await engine.updateSynthParams({ oscillatorType: "noise" });
    expect(engine.getAudioNode()).not.toBeNull();
  });

  it("resyncs the fresh outputStage's voice-sum gain to the real activeNotes.size after a mid-performance rebuild (Finding 5)", async () => {
    const engine = makeEngine("analog_poly");
    await engine.load(mockAudioContext);

    engine.setSustain(true);
    engine.playNote({ note: "C4", velocity: 0.8 });
    engine.playNote({ note: "E4", velocity: 0.8 });
    engine.playNote({ note: "G4", velocity: 0.8 });
    expect(engine.getActiveVoiceCount()).toBe(3);

    // "noise" flips isNoiseOscillator(), triggering updateSynthParams's rebuild path:
    // stopAllNotes() -> for each held note, since sustain is on, the note moves to
    // sustainedNotes WITHOUT being evicted from activeNotes (keyHeldNotes.has() gate) ->
    // disposeSynthChain() -> load() constructs a brand-new SynthOutputSaturationStage.
    await engine.updateSynthParams({ oscillatorType: "noise" });
    expect(engine.getActiveVoiceCount()).toBe(3); // still tracked as active across the rebuild

    const stage = (
      engine as unknown as {
        outputStage: { voiceSumGain: { gain: { rampTo: ReturnType<typeof vi.fn> } } };
      }
    ).outputStage;
    // Before the Finding 5 fix, load() never called updateVoiceSumGain(), so the fresh stage
    // silently defaulted to unity gain regardless of the 3 voices still tracked as active — the
    // next note-on would then compute 1/√(N+1) relative to a starting gain of 1.0 instead of the
    // correct pre-rebuild 1/√3, producing a one-off loudness jump. Confirm load() resyncs it.
    const lastCall = stage.voiceSumGain.gain.rampTo.mock.calls.at(-1);
    expect(lastCall?.[0]).toBeCloseTo(1 / Math.sqrt(3), 5);
  });
});
