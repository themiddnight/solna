/**
 * Thin wrapper around the envelope-follower AudioWorkletProcessor (DEV-343), mirroring
 * `PitchDetector.ts`'s registration/construction shape
 * (`../../pitch/PitchDetector.ts`) so `DuckerEffect.ts`, `VocoderExtEffect.ts`, and
 * `VocoderEffect.ts` share one loading/wiring pattern instead of each re-implementing
 * `addModule`/AudioWorkletNode construction.
 *
 * Usage: `await EnvelopeFollowerWorklet.register(context)` once per context (memoised —
 * safe to call from multiple effects sharing a context, mirrors `PitchDetector.register`
 * exactly), THEN `new EnvelopeFollowerWorklet(context, onLevel?)` per effect instance. A
 * real AudioContext throws synchronously from `new AudioWorkletNode(...)` if the module
 * hasn't finished loading, so callers must sequence the two — see DuckerEffect.ts /
 * VocoderExtEffect.ts / VocoderEffect.ts's async-splice blocks, which follow
 * AutotuneEffect.ts's established precedent (await register(), bail out if `cleanup()`
 * ran while registration was still pending).
 */

const WORKLET_URL = "/worklets/envelope-follower-processor.js";
const WORKLET_NAME = "envelope-follower-processor";

/** One addModule() per AudioContext — a second/third follower sharing a context must not
 *  re-add it. Mirrors PitchDetector.ts's `registrations` WeakMap exactly. */
const registrations = new WeakMap<AudioContext, Promise<void>>();

/**
 * Wire shape for the worklet's `{command:"setParams", value:{...}}` message (see
 * envelope-follower-processor.js's header comment). Field names match the worklet's own
 * instance fields verbatim, including `amount` — which is really an `amountDb` (the same
 * argument DuckerEffect.ts's `computeDuckGain` takes as `amountDb`), inherited from the
 * original plan's protocol naming (see DEV-343 task 6's flagged minor finding). Named
 * `amount` here too, not renamed, so this type documents the ACTUAL wire protocol
 * byte-for-byte rather than an aspirational one.
 */
export interface EnvelopeFollowerParams {
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
  holdMs: number;
  amount: number;
}

interface LevelMessage {
  type: "level";
  keyDb: number;
  reduction: number;
}

/** Envelope/level readout before the first metering message arrives (or with no key
 *  signal ever connected) — unity gain, silent key. Matches the worklet's own initial
 *  state (`this.envelope = 1`) and its "no key -> unity" contract. Re-created (not
 *  mutated) whenever a real message arrives — see the constructor below — so this shared
 *  constant is never mutated in place. */
const UNCONNECTED_LEVEL: { keyDb: number; reduction: number } = { keyDb: -Infinity, reduction: 1 };

/**
 * Main-thread handle for one envelope-follower worklet instance. Two consumption
 * patterns are supported, matching the two real call sites:
 *   - Pull: `getKeyLevelDb()`/`getEnvelopeGain()` read the last metering message on
 *     demand (DuckerEffect.ts's `getReduction()`/`getKeyLevelDb()` — a UI polls those).
 *   - Push: the optional `onLevel` constructor callback fires on every metering message,
 *     for effects that need to react immediately (VocoderExtEffect.ts/VocoderEffect.ts's
 *     presence/silence gates) — mirrors PitchDetector's `(context, onPitch)` shape.
 */
export class EnvelopeFollowerWorklet {
  private readonly node: AudioWorkletNode;
  private lastLevel = UNCONNECTED_LEVEL;

  constructor(context: AudioContext, onLevel?: (keyDb: number, reductionGain: number) => void) {
    // CRITICAL: numberOfInputs/numberOfOutputs default to 1 each, but with no explicit
    // `outputChannelCount`, the output channel count FOLLOWS the input's computed channel
    // count once something is connected. Aux key nodes in this codebase are
    // createStereoGainNode (channelCount 2), so an unpinned node would silently become
    // 2-channel output the instant a key connects — while envelope-follower-processor.js's
    // process() only ever writes outputs[0][0] (channel 0), leaving channel 1 at zero. A
    // 2-channel signal feeding an AudioParam down-mixes to 0.5*(L+R), so the param would
    // receive HALF the intended envelope, and the resting gain would shift by 6dB every
    // time a key node connects/disconnects (channel count flipping 1<->2). Pinning both
    // sides to explicit mono avoids all of that, and is also correct on its own merits:
    // the worklet's RMS measurement only ever reads channel 0, so a stereo key should be
    // pinned to mono up front rather than silently read from the left channel only.
    const node = new AudioWorkletNode(context, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
    });
    // The worklet posts exactly one message shape ({type:"level",...}) — see
    // envelope-follower-processor.js — so there is no discriminant to branch on here.
    node.port.onmessage = (event: MessageEvent<LevelMessage>): void => {
      const { keyDb, reduction } = event.data;
      this.lastLevel = { keyDb, reduction };
      onLevel?.(keyDb, reduction);
    };
    this.node = node;
  }

  /** Connect the key/aux signal to be analysed into this node. */
  get input(): AudioNode {
    return this.node;
  }

  /**
   * Audio-rate gain-envelope output (0..1, unity=1 when transparent). Connect straight to
   * a GainNode's `.gain` AudioParam for a dB-reduction-curve consumer (DuckerEffect.ts) —
   * an established idiom in this codebase (see VocoderEffect.ts's own
   * `envLP.connect(vca.gain) // audio-rate multiply`).
   *
   * A consumer that only needs the metering message — a binary presence/silence gate,
   * where this curve's polarity is backwards from what's needed (a quiet key means
   * *unity* no-reduction on this curve, the opposite of "gate closed"; see
   * VocoderExtEffect.ts/VocoderEffect.ts's header comments) — must still connect this
   * output to something reachable from the render graph: an AudioWorkletNode with no
   * live output connection is never pulled, so `process()` (and therefore the metering
   * message this class relies on) never runs.
   */
  get output(): AudioWorkletNode {
    return this.node;
  }

  /** Loads the envelope-follower worklet module onto `context`, once. Safe to call
   *  repeatedly for the same context — later calls return the same in-flight/settled
   *  promise instead of re-adding the module. A rejection is not swallowed; it
   *  propagates to whoever awaits this call and stays cached, mirroring
   *  PitchDetector.register()'s contract exactly. */
  static async register(context: AudioContext): Promise<void> {
    let pending = registrations.get(context);
    if (!pending) {
      pending = context.audioWorklet.addModule(WORKLET_URL);
      registrations.set(context, pending);
    }
    return pending;
  }

  setParams(params: Partial<EnvelopeFollowerParams>): void {
    this.node.port.postMessage({ command: "setParams", value: params });
  }

  /** Last `keyDb` from the worklet's ~20Hz metering message (ABSOLUTE dBFS), or
   *  -Infinity before the first message / with nothing connected. */
  getKeyLevelDb(): number {
    return this.lastLevel.keyDb;
  }

  /** Last `reduction` (linear gain envelope, 0..1, unity=1) from the worklet's metering
   *  message, or 1 (unity) before the first message. */
  getEnvelopeGain(): number {
    return this.lastLevel.reduction;
  }

  /** Immediately resets the cached last-level readout back to its unconnected default
   *  (unity gain, -Infinity key level), for a pull-mode consumer (DuckerEffect.ts) to call
   *  right after disconnecting its key input. Without this, `getReduction()`/
   *  `getKeyLevelDb()` would report a stale reading (e.g. "-12dB reduction") for up to one
   *  ~20Hz metering tick (~50ms) after the key that produced it is gone — the worklet does
   *  keep posting messages after a key disconnects (its `!key` branch releases toward
   *  unity rather than snapping, see envelope-follower-processor.js), but that next message
   *  isn't instantaneous, and a caller that wants the readout to reflect "no key" the
   *  moment it disconnects shouldn't have to wait for it. */
  resetLevel(): void {
    this.lastLevel = UNCONNECTED_LEVEL;
  }

  dispose(): void {
    this.node.port.onmessage = null;
    try {
      this.node.disconnect();
    } catch {
      /* ignore */
    }
  }
}
