import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EnvelopeFollowerWorklet } from "../envelopeFollowerWorklet";

/**
 * Direct unit tests for the shared worklet wrapper, added in the Task 7 fix round after a
 * review found two real audio bugs that jsdom's mocked AudioWorkletNode/AudioParam could
 * never catch by exercising the three effect files alone:
 *   - CRITICAL 2: the AudioWorkletNode was constructed with no explicit channel options,
 *     so its output channel count silently followed a stereo key input (halving the
 *     envelope through an AudioParam's additive down-mix). Covered below by asserting the
 *     exact options passed to `new AudioWorkletNode(...)`.
 *   - IMPORTANT 1: getReduction()/getKeyLevelDb() (via getEnvelopeGain()/getKeyLevelDb())
 *     froze at their last value forever once a key disconnected, since the worklet's old
 *     `!key` branch stopped posting metering messages entirely. Covered below by
 *     `resetLevel()`.
 * These are regression tests for the wrapper class itself — a more precise target than
 * asserting through DuckerEffect/VocoderExtEffect, since the bugs live in this file.
 */

interface FakeWorkletPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

class FakeAudioWorkletNode {
  readonly port: FakeWorkletPort = { onmessage: null, postMessage: vi.fn() };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  readonly options: AudioWorkletNodeOptions | undefined;
  constructor(_context: unknown, _name: unknown, options?: AudioWorkletNodeOptions) {
    this.options = options;
    recordCreatedNode(this);
  }
}
let capturedNode: FakeAudioWorkletNode | undefined;

/** Kept as a plain function (not a `this`-alias) to satisfy @typescript-eslint/no-this-alias. */
function recordCreatedNode(node: FakeAudioWorkletNode): void {
  capturedNode = node;
}

beforeEach(() => {
  capturedNode = undefined;
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
});
afterEach(() => vi.unstubAllGlobals());

describe("EnvelopeFollowerWorklet construction (CRITICAL 2 regression)", () => {
  it("pins the AudioWorkletNode to explicit mono in/out, not the input's (possibly stereo) channel count", () => {
    const ctx = new AudioContext();
    new EnvelopeFollowerWorklet(ctx);

    const node = capturedNode;
    if (!node) throw new Error("expected an AudioWorkletNode to be constructed");
    // Without this, connecting a stereo (createStereoGainNode, channelCount 2) key node
    // would silently widen the worklet's OUTPUT to 2 channels too (numberOfOutputs===1
    // with no explicit outputChannelCount follows the input's computed channel count) —
    // but process() only ever writes outputs[0][0], leaving channel 1 at zero, and a
    // 2-channel signal feeding an AudioParam down-mixes to 0.5*(L+R): the param would
    // receive HALF the intended envelope, silently, only once a key connects.
    expect(node.options).toMatchObject({
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
    });
  });
});

describe("EnvelopeFollowerWorklet level readout defaults and updates", () => {
  it("defaults to unity gain / -Infinity key level before any metering message", () => {
    const ctx = new AudioContext();
    const follower = new EnvelopeFollowerWorklet(ctx);
    expect(follower.getEnvelopeGain()).toBe(1);
    expect(follower.getKeyLevelDb()).toBe(-Infinity);
  });

  it("updates getKeyLevelDb()/getEnvelopeGain() from a {type:'level'} message and invokes the push callback", () => {
    const ctx = new AudioContext();
    const onLevel = vi.fn();
    const follower = new EnvelopeFollowerWorklet(ctx, onLevel);
    const node = capturedNode;
    if (!node) throw new Error("expected an AudioWorkletNode to be constructed");

    node.port.onmessage?.({ data: { type: "level", keyDb: -6, reduction: 0.5 } });

    expect(follower.getKeyLevelDb()).toBe(-6);
    expect(follower.getEnvelopeGain()).toBe(0.5);
    expect(onLevel).toHaveBeenCalledWith(-6, 0.5);
  });
});

describe("EnvelopeFollowerWorklet.resetLevel() (IMPORTANT 1 regression)", () => {
  it("immediately restores the unity/-Infinity default after a real message had updated it", () => {
    const ctx = new AudioContext();
    const follower = new EnvelopeFollowerWorklet(ctx);
    const node = capturedNode;
    if (!node) throw new Error("expected an AudioWorkletNode to be constructed");

    node.port.onmessage?.({ data: { type: "level", keyDb: -12, reduction: 0.25 } });
    expect(follower.getKeyLevelDb()).toBe(-12); // sanity: the message really did land

    follower.resetLevel();

    expect(follower.getKeyLevelDb()).toBe(-Infinity);
    expect(follower.getEnvelopeGain()).toBe(1);
  });
});

describe("EnvelopeFollowerWorklet.register", () => {
  it("adds the worklet module once per context, memoised across calls", async () => {
    const ctx = new AudioContext();
    await EnvelopeFollowerWorklet.register(ctx);
    await EnvelopeFollowerWorklet.register(ctx);
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  });
});

describe("EnvelopeFollowerWorklet.dispose", () => {
  it("clears the message handler and disconnects the node", () => {
    const ctx = new AudioContext();
    const follower = new EnvelopeFollowerWorklet(ctx);
    const node = capturedNode;
    if (!node) throw new Error("expected an AudioWorkletNode to be constructed");

    follower.dispose();

    expect(node.disconnect).toHaveBeenCalled();
    expect(node.port.onmessage).toBeNull();
  });
});
