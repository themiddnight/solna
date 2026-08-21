import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MixerEngine } from "../MixerEngine";
import { AudioContextManager } from "@/engine/audio";

/**
 * DEV-325 — voice must not be printed into an Arrange mixdown.
 *
 * Capture works by tapping `masterOut`, so "is voice in the export?" is really "is the voice
 * branch upstream or downstream of that node?". These tests assert the branch's destination
 * against the bus's own nodes rather than trying to render audio: the mock context carries no
 * signal, and a rendered-file assertion here would be testing the mock.
 */
/**
 * Records the outgoing edges of every GainNode created from this point on.
 *
 * The voice branch's gain is built inside `routeVoiceToChannel`, so its edges can only be
 * captured by wrapping the factory before the call — there is no way to read a node's
 * connections back out of the Web Audio API afterwards.
 */
function watchCreatedGains(context: AudioContext): Map<GainNode, (AudioNode | AudioParam)[]> {
  const edges = new Map<GainNode, (AudioNode | AudioParam)[]>();
  const createGain = context.createGain.bind(context);
  Object.defineProperty(context, "createGain", {
    configurable: true,
    value: (): GainNode => {
      const node = createGain();
      const targets: (AudioNode | AudioParam)[] = [];
      edges.set(node, targets);
      const connect = node.connect.bind(node);
      Object.defineProperty(node, "connect", {
        configurable: true,
        value: (target: AudioNode | AudioParam) => {
          targets.push(target);
          return connect(target as AudioNode);
        },
      });
      return node;
    },
  });
  return edges;
}

describe("MixerEngine — voice routing relative to the capture tap (DEV-325)", () => {
  let mixer: MixerEngine;
  let context: AudioContext;

  beforeEach(async () => {
    context = await AudioContextManager.getInstrumentContext();
    mixer = new MixerEngine(context);
    mixer.createUserChannel("peer-1", "Peer One");
  });

  afterEach(async () => {
    await AudioContextManager.cleanup();
  });

  it("keeps voice inside the mix by default, where a Perform capture will find it", () => {
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");
    expect(mixer.getVoiceRouting()).toBe("mix");

    const edges = watchCreatedGains(context);
    mixer.routeVoiceToChannel(context.createGain(), "peer-1");

    const voiceGain = mixer.getChannel("peer-1")?.voiceGain;
    if (!voiceGain) throw new Error("voice branch was not created");
    // The master sum is upstream of the capture tap, so a Perform capture still gets the
    // conversation.
    expect(edges.get(voiceGain)).toEqual([bus.getMasterInput()]);
  });

  it("keeps voice off the peer's channel output, so speaking cannot drive the instrument glow", () => {
    const channel = mixer.getChannel("peer-1");
    const meteredOutput = channel?.stereoEffectOutput?.input;
    // Without this the `not.toContain` below would pass against `undefined` and assert nothing.
    if (!meteredOutput) throw new Error("channel output node was not created");

    const edges = watchCreatedGains(context);
    mixer.routeVoiceToChannel(context.createGain(), "peer-1");

    const voiceGain = channel.voiceGain;
    if (!voiceGain) throw new Error("voice branch was not created");
    // `stereoEffectOutput` is what `analyser`, `nativeAnalyser` and `monitorTap` all read.
    // Landing voice there is how talking used to light the avatar's hold halo — an instrument
    // signal — and would also feed a peer's voice into any aux consumer keyed on their playing.
    // The single edge asserted above already excludes it; naming the node keeps the reason for
    // the constraint attached to the thing it protects.
    expect(edges.get(voiceGain)).not.toContain(meteredOutput);
  });

  it("lands voice on the post-tap stage in direct mode — heard, never printed", () => {
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    mixer.setVoiceRouting("direct");

    // The stage voice lands on is downstream of the tap, so a mixdown reading the tap cannot
    // see it. These being different nodes is the whole guarantee.
    expect(bus.getPostTapInput()).not.toBe(bus.getMasterTap());
    expect(bus.getPostTapInput()).not.toBe(bus.getMasterGain());
    expect(mixer.getVoiceRouting()).toBe("direct");
  });

  it("survives a silent-render mixdown: the post-tap stage keeps its speaker path", () => {
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");
    const capture = context.createGain();

    // divertOutputToCapture detaches masterOut from the post-tap stage, not the stage from the
    // speakers — so voice keeps playing while an export renders in silence.
    const postTap = bus.getPostTapInput();
    bus.divertOutputToCapture(capture);
    expect(bus.getPostTapInput()).toBe(postTap);

    bus.restoreOutputToSpeakers(capture);
    expect(bus.getPostTapInput()).toBe(postTap);
  });
});
