import { describe, it, expect } from "vitest";
import {
  freqToMidi,
  midiToFreq,
  quantizeFreqToScale,
  droneCarrierFreq,
  followCarrierFreq,
  diatonicDegreeFreq,
} from "../pitchMath";

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11].reduce((m, pc) => m | (1 << pc), 0); // 0xAB5

describe("freq/midi round-trip", () => {
  it("A4 = 440Hz = midi 69", () => {
    expect(freqToMidi(440)).toBeCloseTo(69, 5);
    expect(midiToFreq(69)).toBeCloseTo(440, 5);
  });
});

describe("quantizeFreqToScale", () => {
  it("snaps a slightly-sharp C to exact C in C major", () => {
    const sharpC5 = midiToFreq(72) * 1.02; // ~C5 + ~34 cents
    expect(quantizeFreqToScale(sharpC5, C_MAJOR)).toBeCloseTo(midiToFreq(72), 3);
  });

  it("snaps an out-of-scale note (C#) to nearest scale tone", () => {
    const cSharp5 = midiToFreq(73); // C# not in C major
    const snapped = quantizeFreqToScale(cSharp5, C_MAJOR);
    // nearest allowed: C(72) or D(74), both 1 semitone — impl prefers lower
    expect(snapped).toBeCloseTo(midiToFreq(72), 3);
  });

  it("returns the input unchanged for an empty mask", () => {
    expect(quantizeFreqToScale(440, 0)).toBe(440);
  });
});

describe("carrier frequency strategies", () => {
  it("drone plays the tonic (C at baseMidi 48)", () => {
    expect(droneCarrierFreq(0, 48)).toBeCloseTo(midiToFreq(48), 5);
  });

  it("follow quantizes the detected pitch into the scale", () => {
    expect(followCarrierFreq(midiToFreq(73), C_MAJOR)).toBeCloseTo(midiToFreq(72), 3);
  });
});

describe("diatonicDegreeFreq", () => {
  const CMAJ = 0b101010110101; // C D E F G A B

  it("unison returns the snapped base", () => {
    expect(diatonicDegreeFreq(midiToFreq(60), CMAJ, 1)).toBeCloseTo(midiToFreq(60), 1); // C4
  });

  it("diatonic 3rd above C is E (major 3rd, +4)", () => {
    expect(diatonicDegreeFreq(midiToFreq(60), CMAJ, 3)).toBeCloseTo(midiToFreq(64), 1); // E4
  });

  it("diatonic 3rd above D is F (minor 3rd, +3) — scale-aware", () => {
    expect(diatonicDegreeFreq(midiToFreq(62), CMAJ, 3)).toBeCloseTo(midiToFreq(65), 1); // F4
  });

  it("diatonic 5th above C is G (+7)", () => {
    expect(diatonicDegreeFreq(midiToFreq(60), CMAJ, 5)).toBeCloseTo(midiToFreq(67), 1); // G4
  });

  it("octave is +12 semitones regardless of scale", () => {
    expect(diatonicDegreeFreq(midiToFreq(60), CMAJ, 8)).toBeCloseTo(midiToFreq(72), 1);
  });
});
