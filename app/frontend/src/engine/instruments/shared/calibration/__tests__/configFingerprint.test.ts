import { describe, it, expect } from "vitest";
import { hashInstrumentConfig } from "../configFingerprint";

describe("hashInstrumentConfig", () => {
  it("is deterministic for identical input", () => {
    const input = { instrumentId: "piano-01", loudnessRelevantConfig: { url: "a.sfz", attack: 0.01 } };
    expect(hashInstrumentConfig(input)).toBe(hashInstrumentConfig(input));
  });

  it("changes when the config changes (soundfont swap detection)", () => {
    const base = { instrumentId: "piano-01", loudnessRelevantConfig: { url: "a.sfz", attack: 0.01 } };
    const swapped = { instrumentId: "piano-01", loudnessRelevantConfig: { url: "b.sfz", attack: 0.01 } };
    expect(hashInstrumentConfig(base)).not.toBe(hashInstrumentConfig(swapped));
  });

  it("changes when an envelope value changes (envelope edit detection)", () => {
    const base = { instrumentId: "pad-02", loudnessRelevantConfig: { attack: 0.5, release: 1.2 } };
    const edited = { instrumentId: "pad-02", loudnessRelevantConfig: { attack: 0.5, release: 2.0 } };
    expect(hashInstrumentConfig(base)).not.toBe(hashInstrumentConfig(edited));
  });

  it("is stable regardless of object key order (JSON.stringify key order would break this otherwise)", () => {
    const a = { instrumentId: "x", loudnessRelevantConfig: { attack: 1, release: 2 } };
    const b = { instrumentId: "x", loudnessRelevantConfig: { release: 2, attack: 1 } };
    expect(hashInstrumentConfig(a)).toBe(hashInstrumentConfig(b));
  });

  it("handles undefined values in nested config (type contract safety)", () => {
    const input = { instrumentId: "test", loudnessRelevantConfig: { value: undefined } };
    const hash = hashInstrumentConfig(input);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});
