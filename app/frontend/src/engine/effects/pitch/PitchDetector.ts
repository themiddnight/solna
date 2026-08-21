import { AMDF } from "pitchfinder";
import { getWebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";
import { decimateByThree, computeRms } from "./decimation";
import {
  PITCH_DETECT_FFT_SIZE,
  PITCH_MIN_FREQ_HZ,
  PITCH_MAX_FREQ_HZ,
  PITCH_DECIMATION_FACTOR,
  PITCH_DECIMATED_WINDOW,
  PITCH_SOURCE_WINDOW,
  PITCH_DETECT_RATE_HZ,
  PITCH_SILENCE_RMS,
} from "./pitchConstants";

type PitchCallback = (freq: number | null) => void;

/** Message shapes posted by public/worklets/pitch-tap-processor.js. */
type PitchWorkletMessage = { type: "silent" } | { type: "frame"; samples: Float32Array };

const WORKLET_URL = "/worklets/pitch-tap-processor.js";
const WORKLET_NAME = "pitch-tap-processor";

/** One addModule() per AudioContext — a second/third detector sharing a context must not re-add it. */
const registrations = new WeakMap<AudioContext, Promise<void>>();

/**
 * Main-thread pitch detector (DEV-343). The pitch-tap AudioWorklet (audio thread)
 * paces detection at a fixed PITCH_DETECT_RATE_HZ and gates on RMS so a silent input
 * costs nothing; this class decimates the posted frame 3x (16 kHz) and runs
 * pitchfinder AMDF (bounded to the vocal range) on it. AMDF deliberately stays off
 * the audio thread — see pitch-tap-processor.js's header for why.
 *
 * AMDF (not YIN): YIN needs ~40x the fundamental period in the analysis window to
 * lock on, so it can't detect below ~200 Hz at this buffer size and returns ~20 kHz
 * garbage for normal voices. AMDF bounded to PITCH_MIN/MAX_FREQ_HZ tracks the real
 * vocal fundamental (verified in the voice-dsp POC).
 *
 * Precondition: call and await `PitchDetector.register(context)` before constructing
 * an instance against that context. The constructor builds the AudioWorkletNode
 * synchronously — `.input` must be connectable immediately, matching the pre-worklet
 * API — and a real AudioContext throws synchronously from `new AudioWorkletNode(...)`
 * if the processor module hasn't finished loading yet. Sequencing that is the
 * caller's job; register()'s per-context promise is independent of any instance's
 * lifecycle, so calling stop()/dispose() on one detector has no effect on a pending
 * (or rejected) register() call for that context, and vice versa.
 */
export class PitchDetector {
  private readonly onPitch: PitchCallback;
  private readonly detect: (input: Float32Array) => number | null;
  private readonly decimated = new Float32Array(PITCH_DECIMATED_WINDOW);
  private readonly inputNode: AudioNode;
  private readonly node: AudioWorkletNode | null;
  private readonly analyser: AnalyserNode | null;
  private readonly sourceBuffer: Float32Array | null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(context: AudioContext, onPitch: PitchCallback) {
    this.onPitch = onPitch;
    this.detect = AMDF({
      sampleRate: context.sampleRate / PITCH_DECIMATION_FACTOR,
      minFrequency: PITCH_MIN_FREQ_HZ,
      maxFrequency: PITCH_MAX_FREQ_HZ,
    });

    if (getWebRTCCapabilities().supportsAudioWorklet) {
      // numberOfOutputs: 0 — this tap is pure analysis (pitch-tap-processor.js's process()
      // never touches `outputs`); with the default numberOfOutputs===1 and nothing ever
      // connecting that output onward, the render graph would never pull this node, so
      // process() (and therefore every posted pitch message) would never run — the exact
      // "no live output connection" failure this codebase already worked around for the
      // envelope-follower worklet via a dummy followerSink (see VocoderEffect.ts /
      // VocoderExtEffect.ts), and the exact convention useShadowCapture.ts already uses for
      // its own output-less analysis worklet. channelCount/channelCountMode pin the input to
      // mono explicitly: callers (AutotuneEffect.ts, VocoderEffect.ts) connect a stereo
      // createStereoGainNode into `.input`, and without pinning, `inputs[0]` would arrive as
      // 2 channels while pitch-tap-processor.js only reads `inputs[0][0]` (left channel
      // only) — an unintended left-only read instead of the proper mono downmix the
      // replaced AnalyserNode did automatically.
      const node = new AudioWorkletNode(context, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
      });
      node.port.onmessage = (event: MessageEvent<PitchWorkletMessage>): void => {
        this.handleWorkletMessage(event.data);
      };
      node.port.postMessage({ command: "setGate", value: PITCH_SILENCE_RMS });
      this.node = node;
      this.analyser = null;
      this.sourceBuffer = null;
      this.inputNode = node;
    } else {
      // No currently supported browser takes this path — getWebRTCCapabilities()
      // feature-detects `"audioWorklet" in AudioContext.prototype`, which every
      // browser we support has. This exists only so an unexpected environment
      // without AudioWorklet still gets pitch detection at a fixed rate, instead of
      // silently falling back to requestAnimationFrame (which is exactly the
      // display-tied pacing this task removes). It is deliberately degraded in a
      // background tab: setInterval is throttled there by every browser, same as
      // rAF would be — that's an accepted, documented limitation of this path, not
      // something this class works around.
      const analyser = context.createAnalyser();
      analyser.fftSize = PITCH_DETECT_FFT_SIZE;
      this.analyser = analyser;
      this.sourceBuffer = new Float32Array(analyser.fftSize);
      this.node = null;
      this.inputNode = analyser;
    }
  }

  /** Connect the signal to be analysed into this node. */
  get input(): AudioNode {
    return this.inputNode;
  }

  /**
   * Loads the pitch-tap worklet module onto `context`, once. Safe to call repeatedly
   * for the same context — later calls return the same in-flight/settled promise
   * instead of re-adding the module. A rejection is not swallowed here; it propagates
   * to whoever awaits this call, and stays cached (retrying a broken module load is
   * the caller's decision, not this method's).
   *
   * No-ops (resolves immediately, never touches `context.audioWorklet`) when
   * `getWebRTCCapabilities().supportsAudioWorklet` is false. On such a context,
   * `context.audioWorklet` is itself `undefined`, so `context.audioWorklet.addModule(...)`
   * would throw synchronously — every caller currently `.catch()`s this rejection (some
   * silently), which would otherwise leave the detector permanently unconstructed instead
   * of taking the constructor's own capability-gated `setInterval` fallback branch. Guarding
   * here lets `register()` succeed trivially so callers proceed to `new PitchDetector(...)`,
   * whose constructor checks the same capability flag independently and takes the fallback.
   */
  static async register(context: AudioContext): Promise<void> {
    if (!getWebRTCCapabilities().supportsAudioWorklet) return;
    let pending = registrations.get(context);
    if (!pending) {
      pending = context.audioWorklet.addModule(WORKLET_URL);
      registrations.set(context, pending);
    }
    return pending;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.analyser) {
      this.intervalId = setInterval(() => this.pollFallback(), 1000 / PITCH_DETECT_RATE_HZ);
    }
  }

  stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  dispose(): void {
    this.stop();
    if (this.node) {
      this.node.port.onmessage = null;
      try {
        this.node.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  /** Worklet path: gated on `running` so a message that arrives after stop() is dropped. */
  private handleWorkletMessage(data: PitchWorkletMessage): void {
    if (!this.running) return;
    if (data.type === "silent") {
      this.onPitch(null);
      return;
    }
    decimateByThree(data.samples, this.decimated);
    this.onPitch(this.detect(this.decimated));
  }

  /** Fallback path: same silence gate + decimation as the worklet, on a fixed-rate interval. */
  private pollFallback(): void {
    if (!this.running || !this.analyser || !this.sourceBuffer) return;
    this.analyser.getFloatTimeDomainData(this.sourceBuffer);
    // getFloatTimeDomainData orders oldest-to-newest; take the most recent
    // PITCH_SOURCE_WINDOW samples to match what the worklet posts.
    const recent = this.sourceBuffer.subarray(this.sourceBuffer.length - PITCH_SOURCE_WINDOW);
    if (computeRms(recent) < PITCH_SILENCE_RMS) {
      this.onPitch(null);
      return;
    }
    decimateByThree(recent, this.decimated);
    this.onPitch(this.detect(this.decimated));
  }
}
