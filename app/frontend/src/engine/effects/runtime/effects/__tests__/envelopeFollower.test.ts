import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { stepEnvelope, createEnvelopeState } from "../envelopeFollower";
import { computeDuckGain } from "../DuckerEffect";

const SAMPLE_RATE = 48000;
// amount is 40 dB (DuckerEffect's own real UI max — see its "amount" EffectParameter,
// min:0/max:40), NOT the plan brief's literal `amount: 1`. computeDuckGain's third
// argument is a real dB reduction depth (see DuckerEffect.ts and
// envelope-follower-processor.js — both agree, pinned by the agreement test below), so
// amount=1 caps the maximum possible reduction at ~1dB (target gain ~0.891) and the
// envelope could NEVER cross the <0.4 assertion in the first test below, regardless of
// how fast the attack is. 40dB (here clamped by the 30dB keyDb-thresholdDb overshoot to
// a target of ~0.0316) preserves the test's actual intent — verifying sub-frame
// convergence — without reinterpreting the curve.
const PARAMS = { thresholdDb: -30, attackMs: 5, releaseMs: 200, holdMs: 0, amount: 40 };

describe("envelope follower attack resolution", () => {
  it("reaches its target within a 5 ms attack — shorter than one animation frame", () => {
    const state = createEnvelopeState();
    const loudDb = 0; // well over the -30 dB threshold
    const samplesIn5ms = (5 / 1000) * SAMPLE_RATE;
    let gain = 1;
    for (let i = 0; i < samplesIn5ms; i++) {
      gain = stepEnvelope(state, loudDb, PARAMS, SAMPLE_RATE);
    }
    // One time-constant reaches ~63%; after a full attack window it must be most of
    // the way down. rAF could not have produced ANY intermediate value here — 5 ms is
    // less than a third of a 16.7 ms frame.
    expect(gain).toBeLessThan(0.4);
  });

  it("does not duck at all while the key stays below threshold", () => {
    const state = createEnvelopeState();
    let gain = 1;
    for (let i = 0; i < 1000; i++) gain = stepEnvelope(state, -60, PARAMS, SAMPLE_RATE);
    expect(gain).toBeCloseTo(1, 5);
  });

  it("releases back to unity after the key stops", () => {
    const state = createEnvelopeState();
    for (let i = 0; i < 480; i++) stepEnvelope(state, 0, PARAMS, SAMPLE_RATE);
    let gain = 1;
    for (let i = 0; i < SAMPLE_RATE; i++) gain = stepEnvelope(state, -60, PARAMS, SAMPLE_RATE);
    expect(gain).toBeGreaterThan(0.95);
  });
});

/**
 * Reads the REAL envelope-follower-processor.js source off disk and extracts its
 * `computeDuckGain` function body so the agreement test below runs the worklet's ACTUAL
 * current file content, not a transcription of it. A fix-round finding on this task
 * caught that an earlier version of this test compared a hand-typed THIRD copy (living
 * only in this test file) against DuckerEffect.ts's export — that mechanism could not
 * detect the exact drift it existed to catch (editing the worklet .js file alone left the
 * test green, since the test never read that file). Extraction (not a whole-file `eval`)
 * because the worklet also references `AudioWorkletProcessor`/`sampleRate`/
 * `registerProcessor`, which don't exist in this Node test environment — only the
 * self-contained `computeDuckGain` function is isolated and evaluated.
 *
 * The extracted source becomes a real, callable function via `new Function(...)` — not
 * a copy living in this file, so nothing here can drift from the worklet independently of
 * the worklet itself changing.
 */
const WORKLET_SOURCE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../public/worklets/envelope-follower-processor.js",
);
const workletSource = readFileSync(WORKLET_SOURCE_PATH, "utf-8");

const computeDuckGainMatch = /function computeDuckGain\(([^)]*)\)\s*\{([\s\S]*?)\n\}/.exec(workletSource);
if (!computeDuckGainMatch) {
  throw new Error(
    `Could not find computeDuckGain(...) in ${WORKLET_SOURCE_PATH} — the extraction regex ` +
      "and the worklet's actual function signature/formatting have drifted apart.",
  );
}
const [, workletParamNames, workletBody] = computeDuckGainMatch;
// `new Function(...)` here is deliberate — this IS the point of the test (see the block
// comment above): evaluating the worklet's own extracted source, not a copy of it.
const workletComputeDuckGain = new Function(
  ...workletParamNames!.split(",").map((p) => p.trim()),
  workletBody!,
) as (keyDb: number, thresholdDb: number, amountDb: number) => number;

describe("worklet computeDuckGain agreement (DEV-343 task 7)", () => {
  const cases: Array<[keyDb: number, thresholdDb: number, amountDb: number]> = [
    [-40, -30, 12], // below threshold -> unity
    [-30, -30, 12], // exactly at threshold -> unity (over === 0 is not > 0)
    [-24, -30, 12], // 6dB over, under the amount headroom
    [0, -30, 12], // 30dB over, clamped to amount=12
    [-Infinity, -30, 12], // silent key -> unity
    [0, -60, 40], // large overshoot, large amount
    [-10, -20, 6], // small overshoot, small amount
    [20, -6, 24], // large positive keyDb
    [-30, -30, 0], // amount=0 -> always unity regardless of overshoot
  ];

  it.each(cases)("keyDb=%p thresholdDb=%p amountDb=%p", (keyDb, thresholdDb, amountDb) => {
    expect(workletComputeDuckGain(keyDb, thresholdDb, amountDb)).toBeCloseTo(
      computeDuckGain(keyDb, thresholdDb, amountDb),
      10,
    );
  });
});
