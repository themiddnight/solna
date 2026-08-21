// DEV-288 Vocoder (External Carrier) — band engine + external "heard" carrier with an
// internal-supersaw fallback. Task 9 shipped a passthrough skeleton; this is the real graph.
//
// Self-contained: this file does NOT import from VocoderEffect.ts. The tiny pure helpers it
// needs (the odd-257 rectifier curve, log/mel bandFreqs) are re-implemented locally below —
// see VocoderEffect.ts's own copies for the DC-leak rationale, which applies identically here.
//
// Band engine: `inputNode` receives the MODULATOR (voice). Per band: modBP(bandpass) ->
// rect(full-wave WaveShaper) -> envLP(lowpass) produces the amplitude envelope, which drives
// `vca.gain` (audio-rate multiply). The vca's audio INPUT is a carrier band, carrierBP
// (bandpass), fed from a shared `carrierBus`. All band vcas sum into `makeupGain -> wetGain ->
// outputGain`.
//
// Carrier source: `carrierBus` is fed by `externalGain` (the collaborator/companion/track aux
// node connected via connectAuxInput(node, 'heard')) plus the optional noise layer. There is NO
// internal fallback carrier — with no external carrier the effect is SILENT (DEV-288 v1 revised:
// "no carrier = silent", replacing the original never-silent internal supersaw drone, which read
// as a stray root-note tone whenever nothing was linked). A carrier-level watcher (DEV-343 task 7:
// the envelope-follower worklet's ~20Hz metering message, not its audio-rate output — see below —
// on the external node, same gate pattern as VocoderEffect's silence watcher) drives a single
// `carrierPresenceGain` on the wet path: external present & non-silent -> 1, silent/absent -> 0.
// The gate sits on the whole wet output (bands + noise + sibilance) so nothing leaks when there's
// no live carrier.
//
// Carrier-presence watcher (DEV-343 task 7): previously an rAF loop read `externalNode`'s RMS
// via an AnalyserNode and drove `carrierPresenceGain` directly. It now reads the same RMS via
// the envelope-follower worklet's ~20Hz {type:"level"} metering message instead — NOT its
// audio-rate dB-reduction-curve output, which has the wrong polarity for a binary presence gate
// (a quiet key means *unity* on that curve, the opposite of "gate closed" — see DuckerEffect.ts's
// computeDuckGain). The real win is that the worklet keeps posting metering messages in a
// backgrounded tab, where rAF stops; the crossfade itself is still a `setTargetAtTime` ramp on
// `carrierPresenceGain`, driven by `carrierPresent()` exactly as before.
import { EFFECT_TYPE } from "../audioEffectTypes";
import type { AudioEffect, AuxRole, EffectParameter } from "../audioEffectTypes";
import { createStereoGainNode } from "./EffectsHelper";
import { VOCODER_FREQ_LOW, VOCODER_FREQ_HIGH } from "../../pitch/pitchConstants";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";
import {
  VOCODER_OUTPUT_GAIN_MIN_DB,
  VOCODER_OUTPUT_GAIN_MAX_DB,
  DEFAULT_VOCODER_OUTPUT_GAIN_DB,
} from "@/shared/audio/vocoderGain";
import { EnvelopeFollowerWorklet } from "./envelopeFollowerWorklet";

const GAIN_RAMP_TIME = 0.02;
/** Carrier crossfade is slower than param ramps — an audible fade, not a click, when the
 *  external source drops in/out. */
const CARRIER_CROSSFADE_TIME = 0.05;
/** Input RMS below this reads as "no external carrier" — same threshold VocoderEffect uses
 *  for its own modulator silence gate. */
const CARRIER_SILENCE_RMS = 0.008;

/**
 * Pure decision function for the carrier-presence gate: given the external carrier's current RMS
 * level and the silence threshold, returns the target linear gain for the wet-path presence gate.
 * External at/above the threshold is present (1); below it — including a broken/absent link — the
 * effect is silent (0). There is no internal fallback carrier. Extracted standalone so the
 * decision is unit-testable without a live Web Audio graph (mirrors DuckerEffect's computeDuckGain).
 */
export function carrierPresent(externalRms: number, silenceRms: number): number {
  return externalRms >= silenceRms ? 1 : 0;
}

/**
 * Full-wave rectifier curve for the envelope follower, length 257 (ODD) — local copy of
 * VocoderEffect.ts's makeVocoderRectifierCurve. An odd length puts the midpoint sample
 * (index 128) exactly on input=0, so silence maps to EXACT zero and no VCA leaks carrier
 * during silence. See VocoderEffect.ts's header comment for the full DC-leak history.
 */
function makeRectifierCurve(): Float32Array {
  const curve = new Float32Array(257);
  for (let i = 0; i < 257; i++) curve[i] = Math.abs(i / 128 - 1);
  return curve;
}

/** Band center frequencies from LOW..HIGH inclusive: log-spaced, or mel-spaced (denser in the
 *  speech-formant range). Local copy of VocoderEffect.ts's bandFreqs. */
function bandFreqs(count: number, mel: boolean): number[] {
  const out: number[] = [];
  if (count < 2) {
    out.push(VOCODER_FREQ_LOW);
    return out;
  }
  if (mel) {
    const toMel = (f: number): number => 2595 * Math.log10(1 + f / 700);
    const fromMel = (m: number): number => 700 * (10 ** (m / 2595) - 1);
    const m0 = toMel(VOCODER_FREQ_LOW);
    const m1 = toMel(VOCODER_FREQ_HIGH);
    for (let i = 0; i < count; i++) out.push(fromMel(m0 + ((m1 - m0) * i) / (count - 1)));
  } else {
    const ratio = VOCODER_FREQ_HIGH / VOCODER_FREQ_LOW;
    for (let i = 0; i < count; i++) out.push(VOCODER_FREQ_LOW * ratio ** (i / (count - 1)));
  }
  return out;
}

/** Per-band makeup gain rising with frequency (dB/oct ref 500 Hz) so high (consonant) bands
 *  aren't starved by a carrier's natural 1/n-ish rolloff — same tilt formula VocoderEffect uses. */
function tiltGain(freq: number, tiltDbOct: number): number {
  return dbToGain(toDecibels(tiltDbOct * Math.log2(freq / 500)));
}

interface Band {
  freq: number;
  modBP: BiquadFilterNode;
  rect: WaveShaperNode;
  envLP: BiquadFilterNode;
  carrierBP: BiquadFilterNode;
  vca: GainNode;
  makeup: GainNode;
}

/** Extra test-only accessor beyond the AudioEffect contract, so unit tests can assert the
 *  carrier crossfade state without depending on the mocked AudioParam actually mutating
 *  `.value` on setTargetAtTime (jsdom's mock doesn't). Declared as its own interface (rather
 *  than widening AudioEffect itself) so production call sites — which only see AudioEffect —
 *  are unaffected. */
interface VocoderExtTestAccessor {
  getCarrierPresenceForTest?: () => number;
  /** Init-time makeup gain value (DEV-309) — direct property read, unaffected by the jsdom
   *  AudioParam mock's setTargetAtTime stub. */
  getMakeupGainValueForTest?: () => number;
}

/**
 * Channel vocoder whose carrier is an external aux "heard" input (a collaborator's, companion's,
 * or Arrange track's synth) instead of an internally-generated pitch-tracked drone. With no
 * external carrier linked (or when it goes silent) the effect is SILENT — a single
 * `carrierPresenceGain` on the wet path is held at 0 until a live carrier is present. No internal
 * fallback carrier (DEV-288 v1 revised).
 */
export function createVocoderExtEffect(context: AudioContext, id?: string): AudioEffect & VocoderExtTestAccessor {
  const inputGain = createStereoGainNode(context);
  const wetGain = createStereoGainNode(context);
  const dryGain = createStereoGainNode(context);
  const outputGain = createStereoGainNode(context);
  // The whole wet path (bands + noise + sibilance) runs through carrierPresenceGain so it is fully
  // silent whenever there's no live external carrier. Starts at 0 — nothing linked yet.
  const carrierPresenceGain = createStereoGainNode(context);
  carrierPresenceGain.gain.value = 0;
  wetGain.gain.value = 1;
  dryGain.gain.value = 0;
  inputGain.connect(dryGain);
  dryGain.connect(outputGain);
  wetGain.connect(carrierPresenceGain);
  carrierPresenceGain.connect(outputGain);

  // Carrier bus: the external aux "heard" input (+ the optional noise layer) feed here, and every
  // band's carrierBP taps this single bus. No external carrier -> carrierBus carries only noise,
  // and carrierPresenceGain is 0 regardless, so the effect is silent.
  const carrierBus = createStereoGainNode(context);
  const externalGain = createStereoGainNode(context);
  externalGain.connect(carrierBus);
  // Stable summing point: 1 while a node is connected, 0 when none. Silence is enforced by
  // carrierPresenceGain on the wet path, not by starving the bus here.
  externalGain.gain.value = 1;

  // Broadband noise layer, mixed into the carrier bus ahead of the per-band bandpasses so each
  // band's own filter naturally colors it (constant-Q bandpasses pass proportionally more of a
  // flat spectrum at higher center frequencies) — gives "Noise HF" a breathy/consonant texture
  // without a second per-band carrier path.
  const noiseBuf = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const noiseGain = createStereoGainNode(context);
  noiseGain.gain.value = 0;
  noise.connect(noiseGain);
  noiseGain.connect(carrierBus);
  noise.start();

  // Sibilance passthrough: HP(dry voice) -> gain -> wet path (cheap "s" that survives vocoding).
  // Routed into wetGain (not straight to output) so it too is silenced by carrierPresenceGain when
  // there's no live carrier — otherwise the voice's "s" sounds would leak with no carrier picked.
  const sibHP = context.createBiquadFilter();
  sibHP.type = "highpass";
  sibHP.frequency.value = 5000;
  const sibGain = createStereoGainNode(context);
  sibGain.gain.value = 0.3;
  inputGain.connect(sibHP);
  sibHP.connect(sibGain);
  sibGain.connect(wetGain);

  const rectifierCurve = makeRectifierCurve();

  let bandCount = 16;
  let bandQ = 8;
  let isMelSpacing = false;
  let envHz = 50;
  let tiltDbOct = 4;
  let bands: Band[] = [];

  const makeupGain = createStereoGainNode(context);
  makeupGain.gain.value = dbToGain(toDecibels(DEFAULT_VOCODER_OUTPUT_GAIN_DB)); // was: = 8 (DEV-309)
  makeupGain.connect(wetGain);

  const teardownBands = (): void => {
    for (const b of bands) {
      try {
        inputGain.disconnect(b.modBP);
        carrierBus.disconnect(b.carrierBP);
      } catch {
        /* ignore */
      }
      for (const n of [b.modBP, b.rect, b.envLP, b.carrierBP, b.vca, b.makeup]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
    bands = [];
  };

  const buildBands = (): void => {
    teardownBands();
    for (const freq of bandFreqs(bandCount, isMelSpacing)) {
      // Modulator analysis: bandpass -> full-wave rectify -> lowpass = amplitude envelope.
      const modBP = context.createBiquadFilter();
      modBP.type = "bandpass";
      modBP.frequency.value = freq;
      modBP.Q.value = bandQ;
      const rect = context.createWaveShaper();
      rect.curve = rectifierCurve;
      const envLP = context.createBiquadFilter();
      envLP.type = "lowpass";
      envLP.frequency.value = envHz;
      inputGain.connect(modBP);
      modBP.connect(rect);
      rect.connect(envLP);

      // Carrier band, fed from the shared internal/external carrier bus.
      const carrierBP = context.createBiquadFilter();
      carrierBP.type = "bandpass";
      carrierBP.frequency.value = freq;
      carrierBP.Q.value = bandQ;
      carrierBus.connect(carrierBP);

      const vca = context.createGain();
      vca.gain.value = 0;
      carrierBP.connect(vca);
      envLP.connect(vca.gain); // audio-rate multiply

      const makeup = context.createGain();
      makeup.gain.value = tiltGain(freq, tiltDbOct);
      vca.connect(makeup);
      makeup.connect(makeupGain);

      bands.push({ freq, modBP, rect, envLP, carrierBP, vca, makeup });
    }
  };

  const applyTilt = (): void => {
    const now = context.currentTime;
    for (const b of bands) {
      b.makeup.gain.setTargetAtTime(tiltGain(b.freq, tiltDbOct), now, GAIN_RAMP_TIME);
    }
  };

  buildBands();

  // Carrier-presence watcher: only meaningfully reacts while an external aux node is
  // linked. Reads its RMS via the envelope-follower worklet's metering message, decides
  // presence via carrierPresent(), and ramps the wet-path carrierPresenceGain toward it.
  let currentPresence = 0;

  const applyPresence = (present: number): void => {
    carrierPresenceGain.gain.setTargetAtTime(present, context.currentTime, CARRIER_CROSSFADE_TIME);
    currentPresence = present;
  };

  // Follower construction is deferred behind EnvelopeFollowerWorklet.register(context)
  // (async, memoised per context) — see DuckerEffect.ts's equivalent block for the full
  // rationale (mirrors PitchDetector.register()'s precondition). isDisposed lets cleanup()
  // invalidate a still-pending registration so a worklet node is never constructed/
  // connected after teardown. `externalNode` lives here too (rather than a bare `let`) so
  // its type doesn't get narrowed to `null`/`never` inside the async closure below — see
  // DuckerEffect.ts's identical comment on its own `followerState.keyNode` for why.
  const followerState: { follower: EnvelopeFollowerWorklet | null; isDisposed: boolean; externalNode: AudioNode | null } = {
    follower: null,
    isDisposed: false,
    externalNode: null,
  };

  // Silent sink for the follower's audio-rate output: an AudioWorkletNode with no live
  // output connection is never pulled by the render graph, so process() (and therefore
  // the metering message this watcher relies on) would never run. This effect only needs
  // the metering message (see the header comment above for why the worklet's
  // dB-reduction-curve output itself is the wrong shape for a presence gate), so the
  // connection exists purely to keep the worklet alive; gain 0 means it never
  // contributes audibly.
  const followerSink = createStereoGainNode(context);
  followerSink.gain.value = 0;
  followerSink.connect(outputGain);

  void (async () => {
    await EnvelopeFollowerWorklet.register(context);
    if (followerState.isDisposed) return;
    const follower = new EnvelopeFollowerWorklet(context, (keyDb) => {
      // dbToGain(db) === 10**(db/20) is the exact inverse of the RMS -> dBFS conversion
      // the old rAF watcher did locally (20*log10(rms)) — reused here so this stays
      // numerically identical to the pre-DEV-343 computation.
      applyPresence(carrierPresent(dbToGain(toDecibels(keyDb)), CARRIER_SILENCE_RMS));
    });
    followerState.follower = follower;
    follower.output.connect(followerSink);
    if (followerState.externalNode) followerState.externalNode.connect(follower.input);
  })().catch((error: unknown) => {
    // Unlike Ducker (fails open — no ducking, signal still passes) or VocoderEffect (the
    // internal PitchDetector-driven carrier keeps running, just without silence gating), a
    // worklet-load failure here is catastrophic: carrierPresenceGain starts fail-closed
    // (gain 0) and is only ever opened via this callback, so a swallowed rejection would
    // leave the whole effect permanently and silently silent — a bad deploy/CSP/cache miss
    // with no error surfaced anywhere. Log it so it's diagnosable, matching this codebase's
    // established `console.error("[Module] message:", error)` convention for a non-fatal
    // audio-graph failure (see StereoWidenerEffect.ts).
    console.error("[VocoderExtEffect] Failed to load the envelope-follower worklet — carrier presence stays silent:", error);
  });

  const parameters = new Map<string, EffectParameter>();
  parameters.set("bandQ", { name: "Band Q", value: bandQ, min: 2, max: 12 });
  parameters.set("bandCount", { name: "Band count", value: bandCount, min: 12, max: 32 });
  parameters.set("melSpacing", { name: "Band spacing", value: 0, min: 0, max: 1 });
  parameters.set("noiseHighAmount", { name: "Noise HF", value: 0, min: 0, max: 1 });
  parameters.set("sibilancePassthrough", { name: "Sibilance", value: 0.3, min: 0, max: 1 });
  parameters.set("envHz", { name: "Envelope speed", value: envHz, min: 8, max: 120, unit: "Hz" });
  parameters.set("tiltDbOct", { name: "HF tilt", value: tiltDbOct, min: 0, max: 6, unit: "dB/oct" });
  parameters.set("outputGain", {
    name: "Output gain",
    value: DEFAULT_VOCODER_OUTPUT_GAIN_DB,
    min: VOCODER_OUTPUT_GAIN_MIN_DB,
    max: VOCODER_OUTPUT_GAIN_MAX_DB,
    unit: "dB", // was "×" (DEV-309)
  });
  parameters.set("wetLevel", { name: "Dry/Wet", value: 1, min: 0, max: 1, unit: "%" });

  const effect: AudioEffect & VocoderExtTestAccessor = {
    id: id || `vocoderext_${Date.now()}`,
    type: EFFECT_TYPE.VOCODEREXT,
    name: "Vocoder (External Carrier)",
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
      const now = context.currentTime;

      switch (name) {
        case "bandQ":
          bandQ = v;
          for (const b of bands) {
            b.modBP.Q.setTargetAtTime(v, now, GAIN_RAMP_TIME);
            b.carrierBP.Q.setTargetAtTime(v, now, GAIN_RAMP_TIME);
          }
          break;
        case "bandCount":
          bandCount = Math.round(v);
          buildBands();
          break;
        case "melSpacing":
          isMelSpacing = Math.round(v) >= 1;
          buildBands();
          break;
        case "noiseHighAmount":
          noiseGain.gain.setTargetAtTime(v, now, GAIN_RAMP_TIME);
          break;
        case "sibilancePassthrough":
          sibGain.gain.setTargetAtTime(v, now, GAIN_RAMP_TIME);
          break;
        case "envHz":
          envHz = v;
          for (const b of bands) b.envLP.frequency.setTargetAtTime(v, now, GAIN_RAMP_TIME);
          break;
        case "tiltDbOct":
          tiltDbOct = v;
          applyTilt();
          break;
        case "outputGain":
          makeupGain.gain.setTargetAtTime(dbToGain(toDecibels(v)), now, GAIN_RAMP_TIME);
          break;
        case "wetLevel":
          wetGain.gain.setValueAtTime(v, now);
          dryGain.gain.setValueAtTime(1 - v, now);
          break;
      }
    },

    getParameter(name: string): number | undefined {
      return this.parameters.get(name)?.value;
    },

    getMakeupGainValueForTest(): number {
      return makeupGain.gain.value;
    },

    enable(): void {
      this.enabled = true;
      const wet = this.parameters.get("wetLevel")?.value ?? 1;
      wetGain.gain.setValueAtTime(wet, context.currentTime);
      dryGain.gain.setValueAtTime(1 - wet, context.currentTime);
    },

    disable(): void {
      this.enabled = false;
      wetGain.gain.setValueAtTime(0, context.currentTime);
      dryGain.gain.setValueAtTime(1, context.currentTime);
    },

    connectAuxInput(node: AudioNode, role: AuxRole): void {
      // Vocoder-ext only consumes the 'heard' external-carrier edge. A 'control' aux edge
      // isn't meaningful here — ignore it defensively rather than throw, matching Ducker's
      // handling of the role it doesn't consume.
      if (role !== "heard") return;
      if (followerState.externalNode === node) return; // already linked (idempotent)
      if (followerState.externalNode) {
        try {
          followerState.externalNode.disconnect(externalGain);
          if (followerState.follower) followerState.externalNode.disconnect(followerState.follower.input);
        } catch {
          // already disconnected
        }
      }
      followerState.externalNode = node;
      node.connect(externalGain);
      // Follower may still be pending registration — the async block above connects
      // whatever `externalNode` holds the instant it's constructed, so nothing is lost.
      if (followerState.follower) node.connect(followerState.follower.input);
    },

    disconnectAuxInput(): void {
      if (followerState.externalNode) {
        try {
          followerState.externalNode.disconnect(externalGain);
          if (followerState.follower) followerState.externalNode.disconnect(followerState.follower.input);
        } catch {
          // already disconnected
        }
        followerState.externalNode = null;
      }
      // No carrier -> silent (no internal fallback).
      applyPresence(0);
    },

    getCarrierPresenceForTest(): number {
      return currentPresence;
    },

    cleanup(): void {
      followerState.isDisposed = true;
      followerState.follower?.dispose();
      try {
        if (followerState.externalNode) {
          followerState.externalNode.disconnect(externalGain);
          if (followerState.follower) followerState.externalNode.disconnect(followerState.follower.input);
        }
      } catch {
        // ignore
      }
      followerState.externalNode = null;
      try {
        teardownBands();
        noise.stop();
        noiseGain.disconnect();
        makeupGain.disconnect();
        carrierBus.disconnect();
        externalGain.disconnect();
        followerSink.disconnect();
        sibHP.disconnect();
        sibGain.disconnect();
        inputGain.disconnect();
        wetGain.disconnect();
        dryGain.disconnect();
        carrierPresenceGain.disconnect();
        outputGain.disconnect();
      } catch {
        // ignore
      }
    },
  };

  return effect;
}
