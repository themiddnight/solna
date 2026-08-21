import { describe, it, expect, beforeEach, vi } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// DEV-347 Task 1 — MixerEngine edge-patching vs full chain rebuild.
//
// The Tone mock mirrors `MixerEngine.test.ts` with ONE addition: the module
// `connect` mock FORWARDS to the source node's own `.connect`. MixerEngine's
// `connectNodes` helper always takes the Tone-bridge path under jsdom (no
// global `AudioNode` exists, so the native fast path never triggers), and
// without forwarding every `connectNodes`-driven edge would be invisible and
// all connect counts would read 0.
//
// Counting scheme: `vi.clearAllMocks()` runs AFTER `createUserChannel`, so the
// channel's birth wiring (merger → monoToStereoOutput, monoToStereoOutput →
// toneChannel) is excluded from the counters; each node's counters then measure
// exactly the wiring performed by the add/remove calls in the test. Effect
// nodes are created by the mocked EffectsFactory at add time, so their vi.fn
// counters start at zero on creation — "count from each node's creation" is
// the consistent scheme, and it is what makes `fx1.outputNode.connect === 2`
// and `fx3.outputNode.disconnect === 0` load-bearing (they are the brief's
// distinguishing assertions).
//
// NOTE (documented deviation from the brief's GREEN totals): the brief lists
// `fx2.outputNode.connect === 1`, but under this — the only counting scheme
// consistent with the brief's own RED contrast numbers and distinguishing
// assertions — the edge-patched path gives **2**: fx2 connects to
// `toneChannel` when it joins (add 2), then re-routes to `fx3.inputNode` when
// fx3 joins (add 3). A test asserting 1 would fail against ANY correct
// implementation. All other GREEN numbers hold verbatim.
// ═══════════════════════════════════════════════════════════════════════════
vi.mock("tone", () => {
  // Mimics the subset of Tone.js constructors used by MixerEngine — same shape
  // as MixerEngine.test.ts, plus connect forwarding (see header comment).
  class MockChannel {
    // ---- fields ----
    channel: { volume: { value: number }; pan: { value: number }; mute: boolean };
    pan: { value: number };
    mute: boolean;
    volume: { value: number };
    /** Captured from constructor opts so tests can assert MixerEngine's actual call site
     *  (DEV-305: Tone's Channel/Panner default to channelCount:1 — MixerEngine passes 2). */
    channelCount: number | undefined;
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    receive = vi.fn().mockReturnValue({ gain: { value: 1 } });
    send = vi.fn().mockReturnValue({ gain: { value: 1 } });

    // ---- constructor ----
    constructor(opts?: { volume?: number; pan?: number; channelCount?: number }) {
      this.channel = { volume: { value: opts?.volume ?? 0 }, pan: { value: opts?.pan ?? 0 }, mute: false };
      this.pan = { value: opts?.pan ?? 0 };
      this.mute = false;
      this.volume = { value: opts?.volume ?? 0 };
      this.channelCount = opts?.channelCount;
    }
  }

  class MockGain {
    // ---- fields ----
    gain: { value: number };
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    chain = vi.fn().mockReturnThis();
    fan = vi.fn().mockReturnThis();

    // ---- constructor ----
    constructor(val?: number) {
      this.gain = { value: val ?? 1 };
    }
  }

  class MockAnalyser {
    // ---- fields ----
    type = 'fft' as const;
    size = 1024;
    smooth = 0.8;
    getValue = vi.fn().mockReturnValue(new Float32Array(1024));
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    input = { connect: vi.fn(), disconnect: vi.fn() };
    output = { connect: vi.fn(), disconnect: vi.fn() };
  }

  const mockCtx: { rawContext: AudioContext | null } = { rawContext: null };

  return {
    Channel: MockChannel,
    Gain: MockGain,
    Analyser: MockAnalyser,
    // Forward to the source node's own `.connect` so connectNodes-driven edges
    // land on the source's vi.fn counters (see header comment).
    connect: vi.fn((source: unknown, destination: unknown) => {
      const src = source as { connect?: (dest: unknown) => unknown };
      src.connect?.(destination);
    }),
    // `disconnect` forwards the same way: the edge-patch helpers
    // (patchEffectIntoChainEnd / patchEffectOutOfChain) sever chain edges with
    // tone's `disconnect` bridge — the inverse of the `connect` bridge — so
    // those counters must land on the source's own `.disconnect` too.
    disconnect: vi.fn((source: unknown, destination?: unknown) => {
      const src = source as { disconnect?: (dest?: unknown) => unknown };
      src.disconnect?.(destination);
    }),
    getContext: vi.fn().mockReturnValue(mockCtx),
    setContext: vi.fn((ctx: AudioContext) => { mockCtx.rawContext = ctx; }),
    start: vi.fn().mockResolvedValue(undefined),
    get context() { return mockCtx; },
  };
});

// EffectsFactory.initialize() calls Tone's `start()`; in jsdom `start()` could
// hang. The chain-rebuild tests additionally need `createEffect` to fabricate
// fake effects (real DSP is covered by e2e / manual testing).
vi.mock("../EffectsFactory", () => ({
  EffectsFactory: {
    initialize: vi.fn().mockResolvedValue(undefined),
    createEffect: vi.fn(),
    releaseEffect: vi.fn(),
  },
}));

import { MixerEngine } from "../MixerEngine";
import { EffectsFactory } from "../EffectsFactory";
import {
  EFFECT_TYPE,
  type AudioEffect,
  type EffectType,
  type UserChannel,
} from "../audioEffectTypes";

let effectCounter = 0;

/** Fake AudioEffect backed by real (mocked) context GainNodes — satisfies
 *  `GainNode | AudioNode` with no casts (TR-27). */
function makeFakeEffect(context: AudioContext, effectType: EffectType): AudioEffect {
  const n = ++effectCounter;
  return {
    id: `fx-${n}`,
    type: effectType,
    name: `Fake effect ${n}`,
    enabled: true,
    parameters: new Map(),
    inputNode: context.createGain(),
    outputNode: context.createGain(),
    bypass: false,
    process: (input) => input,
    setParameter: () => undefined,
    getParameter: () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    cleanup: () => undefined,
  };
}

/**
 * Fake AudioEffect whose cleanup TEARS ITS GRAPH DOWN: the getter-backed
 * `outputNode` is nullated once `cleanup()` runs (DEV-347 M2 — the remove
 * path must rewire around an effect whose cleanup may dispose its nodes).
 * The getter widens the declared `GainNode | AudioNode` property with null,
 * so the object carries the repo's accepted structural-fake cast
 * (`as unknown as AudioEffect`, mirroring meterScheduler.test.ts).
 */
function makeDisposedEffect(context: AudioContext, effectType: EffectType): AudioEffect {
  const n = ++effectCounter;
  let outputNode: GainNode | AudioNode | null = context.createGain();
  return {
    id: `fx-${n}`,
    type: effectType,
    name: `Fake effect ${n}`,
    enabled: true,
    parameters: new Map(),
    inputNode: context.createGain(),
    get outputNode() {
      return outputNode;
    },
    bypass: false,
    // Annotated explicitly: the `as unknown as AudioEffect` cast drops the
    // contextual type, leaving `input` implicit-any and tripping
    // no-unsafe-return (TR-27) — the real signature is
    // `process(inputNode: AudioNode): AudioNode`.
    process: (input: AudioNode) => input,
    setParameter: () => undefined,
    getParameter: () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    cleanup: () => {
      outputNode = null;
    },
  } as unknown as AudioEffect;
}

function requireEffect(effect: AudioEffect | null): AudioEffect {
  if (effect == null) throw new Error("expected addEffectToChannel to create an effect");
  return effect;
}

describe("MixerEngine chain wiring — edge-patched add/remove (DEV-347 Task 1)", () => {
  let ctx: AudioContext;
  let mixer: MixerEngine;
  let channel: UserChannel;
  let mS: GainNode;

  beforeEach(() => {
    ctx = new AudioContext();
    mixer = new MixerEngine(ctx);
    channel = mixer.createUserChannel("u1", "Alice");
    vi.mocked(EffectsFactory.createEffect).mockImplementation((effectType) =>
      makeFakeEffect(ctx, effectType),
    );
    // Exclude the channel's birth wiring from the counters — see header comment.
    vi.clearAllMocks();
    if (channel.monoToStereoOutput == null) {
      throw new Error("expected channel.monoToStereoOutput");
    }
    mS = channel.monoToStereoOutput;
  });

  it("sequential adds patch only the two edges around each new effect (3 effects)", () => {
    const fx1 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx2 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx3 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));

    // monoToStereoOutput is touched only when the first effect joins the empty
    // chain (disconnect from toneChannel, re-route through the effect).
    expect(mS.disconnect).toHaveBeenCalledTimes(1);
    expect(mS.connect).toHaveBeenCalledTimes(1);

    // fx1: disconnected once (when fx2 joins), connected twice (to toneChannel
    // at add1, re-routed to fx2.inputNode at add2).
    expect(fx1.outputNode.disconnect).toHaveBeenCalledTimes(1);
    expect(fx1.outputNode.connect).toHaveBeenCalledTimes(2);

    // fx2: disconnected once (when fx3 joins). Connected twice (to toneChannel
    // at add2 AND to fx3.inputNode at add3) — the brief's listed 1 is an
    // arithmetic slip; see header comment.
    expect(fx2.outputNode.disconnect).toHaveBeenCalledTimes(1);
    expect(fx2.outputNode.connect).toHaveBeenCalledTimes(2);

    // The newest effect is never disconnected by its own add.
    expect(fx3.outputNode.disconnect).toHaveBeenCalledTimes(0);
    expect(fx3.outputNode.connect).toHaveBeenCalledTimes(1);
  });

  it("removing the middle effect patches only the adjacent edges", () => {
    const fx1 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx2 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx3 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));

    mixer.removeEffectFromChannel("u1", fx2.id);

    // The effect after the removed one is untouched by the patch.
    expect(fx3.outputNode.disconnect).toHaveBeenCalledTimes(0);
    // The effect before the removed one re-routes directly to fx3's input.
    expect(fx1.outputNode.connect).toHaveBeenCalledWith(fx3.inputNode);
    // The removed effect's own output is disconnected (1 from add3's patch + 1 from removal).
    expect(fx2.outputNode.disconnect).toHaveBeenCalledTimes(2);
    // monoToStereoOutput is not re-touched by a middle removal.
    expect(mS.disconnect).toHaveBeenCalledTimes(1);
  });

  it("removing an effect whose cleanup nullates its outputNode still rewires prev → next (M2)", () => {
    // The middle effect is the disposed variant: cleanup nullates its
    // outputNode, so the edge patch must run while the node is alive
    // (patch-before-cleanup) or `removedEffect.outputNode.disconnect()` throws.
    vi.mocked(EffectsFactory.createEffect).mockImplementationOnce((effectType) =>
      makeFakeEffect(ctx, effectType),
    );
    vi.mocked(EffectsFactory.createEffect).mockImplementationOnce((effectType) =>
      makeDisposedEffect(ctx, effectType),
    );
    vi.mocked(EffectsFactory.createEffect).mockImplementationOnce((effectType) =>
      makeFakeEffect(ctx, effectType),
    );
    const fx1 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx2 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx3 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx2OutputBeforeCleanup = fx2.outputNode; // capture while alive

    expect(() => mixer.removeEffectFromChannel("u1", fx2.id)).not.toThrow();
    // The prev → next rewire still happened despite the disposed cleanup.
    expect(fx1.outputNode.connect).toHaveBeenCalledWith(fx3.inputNode);
    // The removed effect's own disconnect ran against the live node — the
    // patch executed before cleanup tore the graph down.
    expect(fx2OutputBeforeCleanup.disconnect).toHaveBeenCalledTimes(2);
  });

  it("removing the only effect returns the chain to the direct monoToStereo → toneChannel passthrough", () => {
    const fx1 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));

    mixer.removeEffectFromChannel("u1", fx1.id);

    // GREEN-behavior assertion: the chain is empty again, so monoToStereoOutput
    // is re-connected straight to the volume/pan stage.
    expect(mS.connect).toHaveBeenCalledWith(channel.toneChannel);
    expect(mS.disconnect).toHaveBeenCalledTimes(2); // one from add, one from remove
    // The removed effect's own output is disconnected.
    expect(fx1.outputNode.disconnect).toHaveBeenCalledTimes(1);
  });

  it("removing the FIRST effect falls back to monoToStereoOutput as the patch source (?? branch)", () => {
    const fx1 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx2 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));

    mixer.removeEffectFromChannel("u1", fx1.id);

    // No effect precedes fx1, so the patch source falls back to
    // monoToStereoOutput (patchEffectOutOfChain's `??` branch), which is
    // disconnected and re-routed straight to fx2's input.
    expect(mS.connect).toHaveBeenCalledWith(fx2.inputNode);
    expect(mS.disconnect).toHaveBeenCalledTimes(2); // one from add, one from remove
    // The removed effect's own output is disconnected (1 from add2's patch + 1 from removal).
    expect(fx1.outputNode.disconnect).toHaveBeenCalledTimes(2);
    // fx2 was never touched by this removal: it was not disconnected, and its
    // single connect remains its original join to toneChannel.
    expect(fx2.outputNode.disconnect).toHaveBeenCalledTimes(0);
    expect(fx2.outputNode.connect).toHaveBeenCalledTimes(1);
  });

  it("removing the LAST effect falls back to toneChannel as the patch target (?? branch)", () => {
    const fx1 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));
    const fx2 = requireEffect(mixer.addEffectToChannel("u1", EFFECT_TYPE.REVERB));

    mixer.removeEffectFromChannel("u1", fx2.id);

    // No effect follows fx2, so the patch target falls back to toneChannel
    // (patchEffectOutOfChain's `??` branch): fx1 re-routes straight to the
    // volume/pan stage.
    expect(fx1.outputNode.connect).toHaveBeenCalledWith(channel.toneChannel);
    // fx1's output is disconnected twice (once when fx2 joined, once by the patch).
    expect(fx1.outputNode.disconnect).toHaveBeenCalledTimes(2);
    // The removed effect's own output is disconnected by the patch.
    expect(fx2.outputNode.disconnect).toHaveBeenCalledTimes(1);
    // monoToStereoOutput is untouched by a tail removal.
    expect(mS.disconnect).toHaveBeenCalledTimes(1);
  });
});
