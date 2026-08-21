import { describe, it, expect, beforeAll } from "vitest";
import { vi } from "vitest";

// jsdom's AudioContext mock can't back Tone's native nodes; mock the three Tone
// classes with light fakes exposing the shape each wrapper touches. Real DSP is
// browser-verified (matches CompressorEffect.test.ts / VocoderEffect.test.ts).
vi.mock("tone", () => {
  class FakeParam {
    value: number;
    setValueAtTime = vi.fn();
    constructor(value: number) { this.value = value; }
  }
  class FakeNode {
    input = { connect: vi.fn(), disconnect: vi.fn() };
    output = { connect: vi.fn(), disconnect: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
    dispose = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    wet = new FakeParam(1);
    frequency = new FakeParam(1);
    depth = new FakeParam(1);
    spread = 40;
  }
  return { Vibrato: FakeNode, Tremolo: FakeNode, AutoPanner: FakeNode };
});

import { createVibratoEffect } from "../VibratoEffect";
import { createTremoloEffect } from "../TremoloEffect";
import { createAutoPannerEffect } from "../AutoPannerEffect";

describe("Tier A effects initialize full-wet (no dry leak)", () => {
  let ctx: AudioContext;
  beforeAll(() => { ctx = new AudioContext(); });

  it.each([
    ["vibrato", createVibratoEffect],
    ["tremolo", createTremoloEffect],
    ["autopanner", createAutoPannerEffect],
  ] as const)("%s: wetGain=1, dryGain=0 on construction", (_name, create) => {
    const fx = create(ctx, "t");
    expect(fx.wetGainNode?.gain.value).toBe(1);
    expect(fx.dryGainNode?.gain.value).toBe(0);
    fx.cleanup();
  });
});
