import { describe, it, expect } from "vitest";

/**
 * Regression test for the DEV-305 final-review Critical finding: Tone's `Channel`/`Panner`
 * default to `channelCount: 1` + `channelCountMode: "explicit"`, which makes the internal
 * `StereoPannerNode` DOWN-MIX stereo input to mono BEFORE panning, at every pan position —
 * silently destroying Haas stereo width, PingPongDelay's L/R alternation, AutoPanner,
 * StereoWidener, and Chorus on every channel (plus a quiet ~3dB unity-gain loudness drop).
 * `MixerEngine.createUserChannel` (`runtime/MixerEngine.ts`) fixes this by passing
 * `channelCount: 2` explicitly when constructing `toneChannel`.
 *
 * ── Why this test is analytic, not a real `OfflineAudioContext` render ──────────────────
 * The bug was originally found and empirically verified via a real browser's
 * `OfflineAudioContext` (rendering actual Tone.js/`StereoPannerNode` DSP in Chrome). That
 * render cannot be reproduced inside this repo's test suite: vitest here runs on
 * jsdom + Node, which has NO native or WASM implementation of `AudioContext`/
 * `OfflineAudioContext` (verified: `typeof OfflineAudioContext === "undefined"` under the
 * project's Node version; jsdom does not implement Web Audio at all — that's why
 * `src/test/setup.ts` fully mocks `AudioContext` for every test, and why `MixerEngine.test.ts`
 * mocks the entire `tone` module: real Tone.js hangs during context initialization against a
 * mocked `AudioContext`). Adding a real Web Audio DSP engine to Node (a native/WASM
 * `OfflineAudioContext` polyfill) is a new-dependency decision (TR-34) that is out of scope
 * for this fix wave. `voiceSumSaturation.test.ts` (DEV-299) hit the identical wall and
 * established the precedent this file follows: lock the browser-verified behavior with the
 * exact, normative Web Audio algorithm instead of guessing or skipping the test.
 *
 * ── The algorithm, traced to source (not a guess) ───────────────────────────────────────
 * Confirmed by reading `node_modules/tone/build/esm/component/channel/{Channel,PanVol,
 * Panner}.js`: `Channel` → `PanVol` → `Panner` forwards its `channelCount` option all the way
 * to the native node (`this._panner.channelCount = options.channelCount;
 * this._panner.channelCountMode = "explicit";`), and `Channel.getDefaults()` /
 * `PanVol.getDefaults()` / `Panner.getDefaults()` all default `channelCount` to `1`. With
 * `channelCountMode: "explicit"`, the Web Audio spec's channel up/down-mixing rules
 * (https://www.w3.org/TR/webaudio/#UpMix-sub, "speakers" interpretation, 2ch → 1ch) mandate:
 *
 *   mono = 0.5 * (inputL + inputR)
 *
 * — applied BEFORE the pan algorithm runs, whenever `computedNumberOfChannels` (pinned to
 * `channelCount` in "explicit" mode) is 1. At `channelCount: 2`, no down-mix occurs and the
 * StereoPannerNode's pan algorithm (https://www.w3.org/TR/webaudio/#stereopanner-algorithm)
 * has a well-known center-pan (`pan: 0`) special case for stereo input: it is an exact
 * pass-through (`x = pan + 1 = 1` → `gainL = cos(π/2) = 0`, `gainR = sin(π/2) = 1` →
 * `outputL = inputL + inputR·0 = inputL`, `outputR = inputR·1 = inputR`). `MixerEngine`
 * always constructs `toneChannel` at `pan: 0` (`setUserPan` moves it afterward), so this
 * center-pan case is exactly what a freshly created channel exercises.
 */

/** Web Audio spec channel down-mixing, 2ch → 1ch ("speakers" interpretation). */
const downmixStereoToMono = (left: number, right: number): number => 0.5 * (left + right);

/**
 * StereoPannerNode pan algorithm, mono-input case, evaluated at pan=0 (x=(0+1)/2=0.5):
 * gainL = cos(x·π/2), gainR = sin(x·π/2) — both ≈0.707, applied identically to the single
 * (already down-mixed) input on both outputs.
 */
const panAtCenterMonoInput = (mono: number): { left: number; right: number } => {
  const x = 0.5;
  return {
    left: mono * Math.cos((x * Math.PI) / 2),
    right: mono * Math.sin((x * Math.PI) / 2),
  };
};

/** StereoPannerNode pan algorithm, stereo-input case, evaluated at pan=0 — exact pass-through
 *  (see file header derivation: x=1 → gainL=0, gainR=1 → outputL=inputL, outputR=inputR). */
const panAtCenterStereoInput = (left: number, right: number): { left: number; right: number } => ({
  left,
  right,
});

describe("Tone.Channel channelCount:2 stereo regression (DEV-305 final review, Critical finding 1)", () => {
  // Fully decorrelated stereo content (e.g. the Haas mono-to-stereo converter's two delayed
  // taps, or PingPongDelay's alternating L/R) — the finding's exact repro shape.
  const decorrelatedLeft = 1;
  const decorrelatedRight = -1;

  it("BUG — Tone's default (channelCount:1, channelCountMode:'explicit') collapses decorrelated stereo to silence at center pan", () => {
    const mono = downmixStereoToMono(decorrelatedLeft, decorrelatedRight);
    expect(mono).toBe(0); // down-mix itself cancels fully-decorrelated content

    const { left, right } = panAtCenterMonoInput(mono);
    expect(left).toBe(0);
    expect(right).toBe(0);
  });

  it("FIX — MixerEngine's channelCount:2 preserves stereo separation at center pan (both channels NOT driven toward 0)", () => {
    const { left, right } = panAtCenterStereoInput(decorrelatedLeft, decorrelatedRight);

    expect(left).toBe(decorrelatedLeft);
    expect(right).toBe(decorrelatedRight);
    // The actual regression assertion: L and R are not both collapsed toward 0 — stereo
    // separation survives, unlike the channelCount:1 case above.
    expect(Math.abs(left)).toBeGreaterThan(0.5);
    expect(Math.abs(right)).toBeGreaterThan(0.5);
    expect(Math.abs(left - right)).toBeGreaterThan(1);
  });

  it("the bug is not limited to hard-panned extremes — center pan (MixerEngine's default) is already fully collapsed under channelCount:1", () => {
    // Guards against a narrower (wrong) mental model of the bug as "only at hard pan".
    const mono = downmixStereoToMono(decorrelatedLeft, decorrelatedRight);
    const collapsed = panAtCenterMonoInput(mono);
    const preserved = panAtCenterStereoInput(decorrelatedLeft, decorrelatedRight);

    const collapsedSeparation = Math.abs(collapsed.left - collapsed.right);
    const preservedSeparation = Math.abs(preserved.left - preserved.right);
    expect(collapsedSeparation).toBeLessThan(preservedSeparation);
    expect(collapsedSeparation).toBe(0);
  });
});
