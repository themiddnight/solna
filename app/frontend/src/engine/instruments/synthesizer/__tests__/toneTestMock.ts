import { vi } from "vitest";

/**
 * Tone.js test double for the `SynthEngine.*` unit tests.
 *
 * NOT shared with `InstrumentEngine.synthesizer.test.ts`'s mock — that one's `Gain` has no
 * `.gain.rampTo` and no `WaveShaper` at all, and its `createCtor` doesn't preserve the prototype
 * chain (so `instanceof PolySynth` is always false there). Both are load-bearing here, so the
 * SynthEngine suites own this corrected mock rather than touching the shared one and risking the
 * ~40 existing tests that depend on its exact current shape.
 *
 * Use from a test file via the async `vi.mock` factory form so hoisting still works:
 *
 * ```ts
 * vi.mock("tone", async () => (await import("./toneTestMock")).createToneTestMock());
 * ```
 *
 * Each `vi.mock` call gets its own invocation, so the `vi.fn()`s are never shared across files.
 */
export function createToneTestMock(): Record<string, unknown> {
  const mockAudioNode = {
    toDestination: vi.fn().mockReturnThis(),
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
  };

  // Unlike the shared mock's createCtor (which returns a bare object literal from `factory()`,
  // breaking `instanceof`), this one assigns onto `this` so the constructed instance keeps the
  // real prototype chain — `new PolySynth(...) instanceof PolySynth` must be `true` for
  // SynthEngine's branching (`this.synthRef instanceof PolySynth`) to behave as it does in prod.
  function createCtor<T extends object>(factory: () => T) {
    return function (this: T, ..._args: unknown[]) {
      Object.assign(this, factory());
      return this;
    } as unknown as new (...args: unknown[]) => T;
  }

  const mockSynthShape = () => ({
    ...mockAudioNode,
    triggerAttack: vi.fn(),
    triggerRelease: vi.fn(),
    set: vi.fn(),
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 },
    oscillator: { type: "sawtooth" },
  });

  return {
    Synth: createCtor(mockSynthShape),
    FMSynth: createCtor(mockSynthShape),
    NoiseSynth: createCtor(mockSynthShape),
    PolySynth: createCtor(() => ({ ...mockSynthShape(), maxPolyphony: 16 })),
    Filter: createCtor(() => ({ ...mockAudioNode, frequency: { value: 1000 }, Q: { value: 5 } })),
    FrequencyEnvelope: createCtor(() => ({
      ...mockAudioNode,
      attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3, baseFrequency: 1000, octaves: 4,
      triggerAttack: vi.fn(), triggerRelease: vi.fn(),
    })),
    Gain: createCtor(() => {
      // `gain.value` is mutated by `rampTo` (rather than staying static) so tests can assert on
      // ramp DIRECTION across a sequence of calls (DEV-299 final-review Finding 1: asymmetric
      // release-tail ramp) — a real Tone.js Signal's `.value` reflects the current scheduled
      // value, and SynthOutputSaturationStage.updateVoiceCount() reads it to pick ramp time.
      const gain: { value: number; rampTo: ReturnType<typeof vi.fn> } = {
        value: 1,
        rampTo: vi.fn(),
      };
      gain.rampTo.mockImplementation((target: number) => {
        gain.value = target;
      });
      return { ...mockAudioNode, gain };
    }),
    WaveShaper: createCtor(() => ({ ...mockAudioNode, oversample: "none", curve: null })),
    LFO: createCtor(() => ({
      ...mockAudioNode,
      frequency: { value: 5 }, min: 0, max: 1, type: "sine", state: "stopped",
      start: vi.fn(), stop: vi.fn(),
    })),
    Frequency: vi.fn((note: string) => ({ toMidi: vi.fn(() => 60), toNote: vi.fn(() => note) })),
    setContext: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn(() => ({ lookAhead: 0.1, state: "running", sampleRate: 44100, currentTime: 0 })),
    now: vi.fn(() => 0),
    getTransport: vi.fn(() => ({ bpm: { value: 120 }, start: vi.fn(), stop: vi.fn(), pause: vi.fn() })),
  };
}
