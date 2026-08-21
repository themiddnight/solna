// DEV-232/DEV-287/DEV-343 Ducker — envelope-follower DSP + key/GR monitors + aux control
// edge. This is the real graph: the main signal runs input -> duckGain -> wet/dry mix ->
// output, while a separate "key" signal (connected via connectAuxInput, role 'control')
// is analyzed-only — it is never routed to the output — and feeds the envelope-follower
// AudioWorklet (DEV-343 task 6/7), which pulls duckGain down when the key is louder than
// `threshold`, up to `amount` dB of reduction, with attack/release/hold shaping the
// follower's response. This replaced an rAF + setTargetAtTime implementation: rAF's
// ~16ms granularity cannot represent a 5-20ms attack, and it stops running in a
// backgrounded tab, where the worklet keeps going.
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, AuxRole, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode, applyWetDry } from "./EffectsHelper";
import { dbToGain, gainToDb, toDecibels, toLinearGain } from "@/shared/audio/gainUnits";
import { EnvelopeFollowerWorklet } from "./envelopeFollowerWorklet";

/**
 * Pure decision function for the envelope follower: given the current key level
 * (dB), threshold (dB) and max reduction amount (dB), returns the *target* linear
 * gain for duckGain (1 = no reduction / unity). Extracted standalone because the
 * rAF loop + live Web Audio graph are awkward to unit-test — this is the actual
 * per-frame decision, independent of smoothing/timing.
 */
export function computeDuckGain(keyDb: number, thresholdDb: number, amountDb: number): number {
  if (keyDb === -Infinity) return 1;
  const over = keyDb - thresholdDb;
  if (over <= 0) return 1;
  const reductionDb = Math.min(amountDb, over);
  // reductionDb is a RELATIVE attenuation amount -> Decibels.
  return dbToGain(toDecibels(-reductionDb));
}

export function createDuckerEffect(context: AudioContext, id?: string): AudioEffect {
  const inputGain = createStereoGainNode(context);
  const duckGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);

  // Key (aux/control) signal is analyzed only — it never reaches wetGain/outputGain. It
  // feeds the envelope-follower worklet's "key" input; the worklet's audio-rate
  // gain-envelope output connects straight to duckGain.gain (an established idiom in
  // this codebase — see VocoderEffect.ts's `envLP.connect(vca.gain) // audio-rate
  // multiply`).
  //
  // duckGain deliberately stays at the createGain() default of 1 (unity) here, NOT
  // zeroed at construction — see the async registration block below for why (fail-open
  // during the worklet's load window, fail-closed only once the worklet is actually
  // wired in).

  // Tier B insert: full wet by default (matches duckerConfig Dry/Wet = 1).
  wetGain.gain.value = 1;
  dryGain.gain.value = 0;

  inputGain.connect(duckGain);
  duckGain.connect(wetGain);
  inputGain.connect(dryGain);
  wetGain.connect(outputGain);
  dryGain.connect(outputGain);

  const parameters = new Map<string, EffectParameter>();
  parameters.set("threshold", {
    name: "Threshold",
    value: -20, // was -30 — DEV-313, see ducker/config.ts for rationale
    min: -60,
    max: 0,
    unit: "dB",
  });
  parameters.set("amount", {
    name: "Amount",
    value: 12,
    min: 0,
    max: 40,
    unit: "dB",
  });
  parameters.set("attack", {
    name: "Attack",
    value: 0.01,
    min: 0.001,
    max: 0.5,
    unit: "s",
  });
  parameters.set("release", {
    name: "Release",
    value: 0.2,
    min: 0.02,
    max: 1.5,
    unit: "s",
  });
  parameters.set("hold", {
    name: "Hold",
    value: 0.02,
    min: 0,
    max: 0.5,
    unit: "s",
  });
  parameters.set("wetLevel", {
    name: "Dry/Wet",
    value: 1,
    min: 0,
    max: 1,
    unit: "%",
  });

  // Follower construction is deferred behind EnvelopeFollowerWorklet.register(context)
  // (async, memoised per context) — a real AudioContext throws synchronously from
  // `new AudioWorkletNode(...)` if the module hasn't finished loading (same precondition
  // as PitchDetector.register(), see that class's JSDoc, and the same pattern
  // AutotuneEffect.ts/VocoderEffect.ts already use for PitchDetector). isDisposed lets
  // cleanup() invalidate a still-pending registration so a worklet node is never
  // constructed/connected after teardown (the same acquired-across-teardown class as the
  // mic leaks in FAILURE_PATTERNS.md).
  // `keyNode` lives on this same object (rather than a bare `let`) so its type doesn't get
  // narrowed to `null`/`never` inside the async closure below — a `let` referenced for the
  // first time inside an async arrow function with no intervening synchronous assignment
  // gets narrowed to its initial value at that point, even though connectAuxInput() (defined
  // later, called asynchronously from outside) can and does reassign it before the closure
  // runs. Object property reads don't get this treatment. Mirrors AutotuneEffect.ts's/
  // VocoderEffect.ts's own `state` object convention, which exists for this exact reason.
  const followerState: { follower: EnvelopeFollowerWorklet | null; isDisposed: boolean; keyNode: AudioNode | null } = {
    follower: null,
    isDisposed: false,
    keyNode: null,
  };

  /** Pushes the current threshold/amount/attack/release/hold params to the worklet (a
   *  no-op while registration is still pending — the async block below calls this again,
   *  reading live parameter state, the instant the follower is constructed, so no
   *  setParameter() call made during that window is lost). Attack/release/hold are
   *  stored in seconds (matching the rest of this file's parameter unit) and converted
   *  to ms here, since that's the worklet's wire unit. */
  function pushFollowerParams(): void {
    const follower = followerState.follower;
    if (!follower) return;
    follower.setParams({
      thresholdDb: parameters.get("threshold")!.value,
      attackMs: parameters.get("attack")!.value * 1000,
      releaseMs: parameters.get("release")!.value * 1000,
      holdMs: parameters.get("hold")!.value * 1000,
      amount: parameters.get("amount")!.value,
    });
  }

  // Follower registration is async (a real audioWorklet.addModule(...) network fetch on
  // the first Ducker created against a given AudioContext — nothing pre-registers this
  // module anywhere). Until it resolves, duckGain stays at its createGain() default of 1
  // (unity, set above) so the ducker's wet path is TRANSPARENT during that window, not
  // silent — a `Ducker` should fail open (passthrough), never fail closed. Only once the
  // worklet is actually about to be wired in do we zero duckGain.gain.value, immediately
  // before connecting the worklet's output to it, in the same synchronous stretch of this
  // callback (no `await` between the two) — this is the exact shape VocoderEffect.ts's
  // `vca.gain.value = 0` + `envLP.connect(vca.gain)` already uses (adjacent, synchronous,
  // no async gap). Per the Web Audio spec, a connected AudioParam's computed value is
  // `intrinsic value + sum of connected audio-rate signals` — NOT a replacement — so
  // duckGain MUST be zeroed before the worklet's output is connected, or the computed
  // gain becomes `1 + envelope` (up to +6dB unconditional boost at rest, and never
  // actually ducking); zeroing it earlier (at construction) would leave the pre-load
  // window silent instead, which is the bug this ordering fixes.
  void (async () => {
    await EnvelopeFollowerWorklet.register(context);
    if (followerState.isDisposed) return;
    const follower = new EnvelopeFollowerWorklet(context);
    followerState.follower = follower;
    duckGain.gain.value = 0;
    follower.output.connect(duckGain.gain);
    pushFollowerParams();
    if (followerState.keyNode) followerState.keyNode.connect(follower.input);
  })().catch((error: unknown) => {
    // The common failure (register() rejecting — addModule() failing to fetch the
    // module) is caught before duckGain is ever zeroed, so it leaves duckGain at unity
    // (fail-open, passthrough) — not silent. Logged anyway, matching the same
    // established `console.error("[Module] message:", error)` convention already applied
    // to VocoderExtEffect.ts's registration failure: a swallowed rejection here is still
    // undiagnosable (no ducking, and no error anywhere explaining why), and the one
    // remaining edge case — `new EnvelopeFollowerWorklet(context)` or
    // `follower.output.connect(...)` themselves throwing AFTER duckGain has already been
    // zeroed above — would otherwise leave the effect silently fail-closed with nothing
    // in the console to explain it.
    console.error("[DuckerEffect] Failed to load the envelope-follower worklet — ducking may be unavailable:", error);
  });

  return {
    id: id || `ducker_${Date.now()}`,
    type: EFFECT_TYPE.DUCKER,
    name: "Ducker",
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
        case "threshold":
        case "amount":
        case "attack":
        case "release":
        case "hold":
          pushFollowerParams();
          break;
        case "wetLevel":
          applyWetDry(wetGain, dryGain, v, context);
          break;
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    enable(): void {
      this.enabled = true;
      const wetLevel = this.parameters.get("wetLevel")?.value ?? 1;
      applyWetDry(wetGain, dryGain, wetLevel, context);
    },

    disable(): void {
      this.enabled = false;
      applyWetDry(wetGain, dryGain, 0, context);
    },

    connectAuxInput(node: AudioNode, role: AuxRole): void {
      // Ducker only consumes the aux control-role key signal (the trigger it ducks against).
      // A 'heard' aux edge isn't meaningful here — ignore it defensively rather
      // than throw, since this is reached from generic aux-wiring call sites.
      if (role !== "control") return;
      if (followerState.keyNode === node) return; // already linked (idempotent)
      if (followerState.keyNode && followerState.follower) {
        try {
          followerState.keyNode.disconnect(followerState.follower.input);
        } catch {
          // already disconnected
        }
      }
      followerState.keyNode = node;
      // Follower may still be pending registration — the async block above connects
      // whatever `keyNode` holds the instant it's constructed, so nothing is lost.
      if (followerState.follower) node.connect(followerState.follower.input);
    },

    disconnectAuxInput(): void {
      if (followerState.keyNode && followerState.follower) {
        try {
          followerState.keyNode.disconnect(followerState.follower.input);
        } catch {
          // already disconnected
        }
      }
      followerState.keyNode = null;
      // No main-thread ramp needed: with no key input, the worklet's own release math
      // takes over and eases duckGain.gain back toward unity using the release time
      // constant (see envelope-follower-processor.js's `!key` branch) — the follower, not
      // this file, owns the envelope's timing now.
      //
      // The worklet's cached last-level readout is reset immediately (rather than waiting
      // up to one ~20Hz metering tick) so getReduction()/getKeyLevelDb() don't report a
      // stale reading — e.g. "-12dB reduction" — for up to 50ms after the key that produced
      // it is gone.
      followerState.follower?.resetLevel();
    },

    getReduction(): number {
      // A RELATIVE gain-reduction amount, mirrors CompressorEffect's getReduction ->
      // Decibels. Reads the worklet's last {type:"level"} metering message instead of
      // computing live; defaults to unity (0dB) before the follower exists / connects.
      const gain = followerState.follower?.getEnvelopeGain() ?? 1;
      return gain > 0 ? gainToDb(toLinearGain(gain)) : -Infinity;
    },

    getKeyLevelDb(): number {
      // ABSOLUTE dBFS key level, from the worklet's last metering message. Defaults to
      // -Infinity (silent) before the follower exists / connects.
      return followerState.follower?.getKeyLevelDb() ?? -Infinity;
    },

    cleanup(): void {
      followerState.isDisposed = true;
      followerState.follower?.dispose();
      try {
        if (followerState.keyNode && followerState.follower) {
          followerState.keyNode.disconnect(followerState.follower.input);
        }
      } catch {
        // ignore
      }
      followerState.keyNode = null;
      try {
        inputGain.disconnect();
        duckGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        outputGain.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
