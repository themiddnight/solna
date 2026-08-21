import SignalsmithStretch from "signalsmith-stretch";
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode } from "./EffectsHelper";
import { PitchDetector } from "../../pitch/PitchDetector";
import { diatonicDegreeFreq } from "../../pitch/pitchMath";
import { DEFAULT_SCALE_MASK } from "../../pitch/pitchConstants";

/** Index (0-3) -> diatonic scale degree: root, 3rd, 5th, octave. */
const INTERVAL_DEGREES = [1, 3, 5, 8];

/**
 * Autotune insert built on the Signalsmith Stretch phase-vocoder AudioWorklet. A
 * main-thread PitchDetector computes the target pitch (snapped to the injected
 * diatonic degree/scale) and drives the worklet's semitone offset through a
 * retune-speed smoothing loop, throttled to ~30ms schedule() calls so the time-map
 * updates stay smooth without flooding the worklet's message port.
 *
 * Unlike Tone.PitchShift (granular delay-line + LFO crossfade), Signalsmith Stretch
 * is a true phase vocoder with a built-in formant-compensation toggle, so the
 * shifted voice can keep its natural timbre instead of chipmunk/monster artifacts.
 */
export function createAutotuneEffect(context: AudioContext, id?: string): AudioEffect & { getLatency: () => number } {
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);
  wetGain.gain.value = 1; // autotune is fully wet by default
  dryGain.gain.value = 0;
  inputGain.connect(dryGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);
  inputGain.connect(wetGain); // temporary passthrough until the worklet is spliced in

  // Mutable engine state lives on a single object (rather than loose `let`s) so the
  // disposal flag stays a plain boolean property read consistently from both the
  // synchronous rAF loop and the async worklet-splice closure below.
  const state = {
    scaleMask: DEFAULT_SCALE_MASK,
    retuneSpeed: 0,
    targetSemitones: 0,
    currentSemitones: 0,
    isFormantOn: true, // start with formant preservation (natural)
    intervalDegree: 1, // 1=root, 3=3rd, 5=5th, 8=octave — snap to that diatonic degree
    blockMs: 50, // latency ≈ blockMs; 50ms = balanced (Signalsmith default is 120)
    latencyMs: 0,
    node: null as Awaited<ReturnType<typeof SignalsmithStretch>> | null,
    detector: null as PitchDetector | null,
    isDisposed: false,
    // Mirrors the AudioEffect's `enabled` field (which starts true) so the deferred detector
    // construction below can re-derive "should detection be running" at resolution time
    // instead of trusting a value snapshotted when the async IIFE was created — a disable()
    // that runs while registration is still pending must not be silently undone once the
    // detector is finally constructed.
    isEnabled: true,
  };

  const refreshLatency = (): void => {
    state.node
      ?.latency()
      .then((v) => {
        state.latencyMs = v;
      })
      .catch(() => undefined);
  };

  // Detector construction is deferred behind PitchDetector.register(context) (async, memoised
  // per context — see PitchDetector's class JSDoc): a real AudioContext throws synchronously
  // from `new AudioWorkletNode(...)` if the worklet module hasn't finished loading. isDisposed
  // is checked immediately after the await so a cleanup() that ran while registration was in
  // flight is respected — the detector is never constructed/connected/started once torn down
  // (the same acquired-across-teardown class as the mic leaks in FAILURE_PATTERNS.md).
  void (async () => {
    await PitchDetector.register(context);
    if (state.isDisposed) return;
    const detector = new PitchDetector(context, (freq) => {
      if (freq !== null && freq > 0) {
        // snap to the selected diatonic degree above the sung note (Root = plain autotune)
        state.targetSemitones = 12 * Math.log2(diatonicDegreeFreq(freq, state.scaleMask, state.intervalDegree) / freq);
      }
    });
    state.detector = detector;
    inputGain.connect(detector.input);
    // Re-derive enabled-ness now, not at construction time — disable() may have run while
    // registration was in flight (detector?.stop() was a no-op then, since state.detector was
    // still null). Only start if the effect is still enabled at this moment.
    if (state.isEnabled) detector.start();
  })().catch((error: unknown) => {
    // A swallowed rejection here (register() rejecting — addModule() failing to fetch the
    // module) would leave autotune's pitch tracking permanently and undiagnosably dead: no
    // detector is ever constructed, so targetSemitones never updates and the effect silently
    // becomes a fixed-pitch passthrough. Logged to match this codebase's established
    // `console.error("[Module] message:", error)` convention (see DuckerEffect.ts /
    // VocoderExtEffect.ts's identical registration-failure logging).
    console.error("[AutotuneEffect] Failed to load the pitch-tap worklet — pitch tracking stays disabled:", error);
  });

  const SEMI_EPS = 0.02;
  const SCHEDULE_MIN_MS = 30; // throttle time-map updates (message rate), still smooth
  let lastScheduleAt = 0;
  let hasScheduledFormantOn = state.isFormantOn;
  let raf: number | null = null;
  const smooth = (): void => {
    if (state.isDisposed) return;
    const alpha = 1 - state.retuneSpeed * 0.9;
    state.currentSemitones += (state.targetSemitones - state.currentSemitones) * alpha;
    if (Math.abs(state.targetSemitones - state.currentSemitones) < SEMI_EPS) {
      state.currentSemitones = state.targetSemitones;
    }
    const now = performance.now();
    const didFormantChange = state.isFormantOn !== hasScheduledFormantOn;
    if (state.node && (didFormantChange || now - lastScheduleAt >= SCHEDULE_MIN_MS)) {
      void state.node.schedule({
        semitones: state.currentSemitones,
        formantCompensation: state.isFormantOn,
        formantBaseHz: 0, // 0 = auto pitch-track for formant analysis
        output: context.currentTime,
      });
      lastScheduleAt = now;
      hasScheduledFormantOn = state.isFormantOn;
    }
    raf = requestAnimationFrame(smooth);
  };
  raf = requestAnimationFrame(smooth);

  void (async () => {
    const n = await SignalsmithStretch(context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    if (state.isDisposed) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
      return;
    }
    state.node = n;
    try {
      inputGain.disconnect(wetGain);
    } catch {
      /* ignore */
    }
    inputGain.connect(n);
    n.connect(wetGain);
    if (state.blockMs > 0) void n.configure({ blockMs: state.blockMs });
    void n.start(); // begin processing live input
    void n.schedule({ semitones: 0, formantCompensation: state.isFormantOn, formantBaseHz: 0, output: context.currentTime });
    refreshLatency();
  })().catch(() => undefined);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("interval", { name: "Interval", value: 0, min: 0, max: 3, step: 1 });
  parameters.set("retuneSpeed", { name: "Retune Speed", value: 0, min: 0, max: 1, step: 0.01 });
  parameters.set("blockMs", { name: "Latency", value: state.blockMs, min: 10, max: 160, step: 5, unit: "ms" });
  parameters.set("formant", { name: "Formant", value: 1, min: 0, max: 1, step: 1 });
  parameters.set("wetLevel", { name: "Wet Level", value: 1, min: 0, max: 1, unit: "%" });
  parameters.set("keyRoot", { name: "Key Root", value: 0, min: 0, max: 11, step: 1 });
  parameters.set("scaleMask", { name: "Scale Mask", value: state.scaleMask, min: 0, max: 4095, step: 1 });

  return {
    id: id ?? `autotune_${Date.now()}`,
    type: EFFECT_TYPE.AUTOTUNE,
    name: "Autotune",
    enabled: true,
    parameters,
    inputNode: inputGain,
    outputNode: outputGain,
    wetGainNode: wetGain,
    dryGainNode: dryGain,
    bypass: false,

    process(input: AudioNode): AudioNode {
      input.connect(this.inputNode);
      return this.outputNode;
    },

    setParameter(name: string, value: number): void {
      const param = this.parameters.get(name);
      if (!param) return;
      const v = Math.max(param.min, Math.min(param.max, value));
      param.value = v;
      switch (name) {
        case "interval":
          state.intervalDegree = INTERVAL_DEGREES[Math.round(v)] ?? 1;
          break;
        case "retuneSpeed":
          state.retuneSpeed = v;
          break;
        case "formant":
          state.isFormantOn = v >= 0.5;
          break;
        case "blockMs":
          state.blockMs = Math.round(v);
          void state.node?.configure({ blockMs: state.blockMs });
          refreshLatency();
          break;
        case "keyRoot":
          // injected for symmetry; diatonicDegreeFreq walks the absolute scaleMask
          break;
        case "scaleMask":
          state.scaleMask = Math.round(v);
          break;
        case "wetLevel":
          wetGain.gain.setValueAtTime(v, context.currentTime);
          dryGain.gain.setValueAtTime(1 - v, context.currentTime);
          break;
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    getLatency(): number {
      return state.latencyMs;
    },

    enable(): void {
      this.enabled = true;
      state.isEnabled = true;
      const wet = this.parameters.get("wetLevel")?.value ?? 1;
      wetGain.gain.setValueAtTime(wet, context.currentTime);
      dryGain.gain.setValueAtTime(1 - wet, context.currentTime);
      // Resume the AMDF detection + smoothing loop that disable() paused. Skip if disposed,
      // and only re-arm the rAF when it isn't already running (guard against double-arming).
      if (!state.isDisposed) {
        state.detector?.start();
        if (raf === null) raf = requestAnimationFrame(smooth);
      }
    },

    disable(): void {
      this.enabled = false;
      state.isEnabled = false;
      wetGain.gain.setValueAtTime(0, context.currentTime);
      dryGain.gain.setValueAtTime(1, context.currentTime);
      // Stop pitch detection + the smoothing rAF so a bypassed autotune does no per-frame
      // AMDF/schedule() work until it is re-enabled (or cleaned up). state.detector may still
      // be null while registration is pending — state.isEnabled = false above ensures the
      // pending construction (see the async block above) won't start it once it resolves.
      state.detector?.stop();
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },

    cleanup(): void {
      state.isDisposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      try {
        state.detector?.dispose();
        state.node?.disconnect();
        inputGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        outputGain.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
