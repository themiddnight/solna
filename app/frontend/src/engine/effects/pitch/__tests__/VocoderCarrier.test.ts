import { describe, it, expect, vi, beforeEach } from "vitest";
import { VocoderCarrier } from "../VocoderCarrier";

interface FakeFatOscillator {
  frequency: { setTargetAtTime: ReturnType<typeof vi.fn>; value: number };
  count: number;
  spread: number;
  type: string;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const { fakeInstances } = vi.hoisted(() => ({ fakeInstances: [] as FakeFatOscillator[] }));

vi.mock("tone", () => ({
  FatOscillator: class {
    frequency = { setTargetAtTime: vi.fn(), value: 0 };
    count = 1;
    spread = 0;
    type = "sawtooth";
    connect = vi.fn();
    start = vi.fn(() => this);
    stop = vi.fn();
    dispose = vi.fn();
    constructor(freq: number, type: string, spread: number) {
      this.type = type;
      this.spread = spread;
      fakeInstances.push(this);
    }
  },
}));

describe("VocoderCarrier", () => {
  beforeEach(() => {
    fakeInstances.length = 0;
  });

  it("constructs a main + octave FatOscillator per frequency and connects them", () => {
    const ctx = new AudioContext();
    const carrier = new VocoderCarrier(ctx);

    carrier.setFrequencies([220, 330]);

    // 2 main + 2 octave = 4 FatOscillators total
    expect(fakeInstances).toHaveLength(4);
    for (const instance of fakeInstances) {
      expect(instance.connect).toHaveBeenCalled();
      expect(instance.start).toHaveBeenCalled();
    }

    carrier.dispose();
  });

  it("disposes removed voices when the pool shrinks", () => {
    const ctx = new AudioContext();
    const carrier = new VocoderCarrier(ctx);

    carrier.setFrequencies([220, 330]);
    const instances = [...fakeInstances];

    carrier.setFrequencies([220]);

    const disposedCount = instances.filter((instance) => instance.dispose.mock.calls.length > 0).length;
    expect(disposedCount).toBe(2); // 1 main + 1 octave removed

    carrier.dispose();
  });

  it("setUnison sets count on all live oscillators", () => {
    const ctx = new AudioContext();
    const carrier = new VocoderCarrier(ctx);
    carrier.setFrequencies([220, 330]);

    carrier.setUnison(5);

    for (const instance of fakeInstances) {
      expect(instance.count).toBe(5);
    }

    carrier.dispose();
  });

  it("setSpread sets spread on all live oscillators", () => {
    const ctx = new AudioContext();
    const carrier = new VocoderCarrier(ctx);
    carrier.setFrequencies([220, 330]);

    carrier.setSpread(20);

    for (const instance of fakeInstances) {
      expect(instance.spread).toBe(20);
    }

    carrier.dispose();
  });

  it("setWave sets type on all live oscillators", () => {
    const ctx = new AudioContext();
    const carrier = new VocoderCarrier(ctx);
    carrier.setFrequencies([220, 330]);

    carrier.setWave("square");

    for (const instance of fakeInstances) {
      expect(instance.type).toBe("square");
    }

    carrier.dispose();
  });

  it("dispose disposes all live oscillators and does not throw", () => {
    const ctx = new AudioContext();
    const carrier = new VocoderCarrier(ctx);
    carrier.setFrequencies([220, 330]);

    const instances = [...fakeInstances];

    expect(() => carrier.dispose()).not.toThrow();

    for (const instance of instances) {
      expect(instance.dispose).toHaveBeenCalled();
    }
  });
});
