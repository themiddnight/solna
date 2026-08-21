import { describe, it, expect, afterEach, vi } from "vitest";
import { AudioContextManager } from "../audioContextManager";

/**
 * DEV-322 — the master bus carries level, not corrections.
 *
 * The policy these lock is "murva measures, it never auto-fixes" (TR-40): nothing on the
 * master bus may alter the signal on its own. The obvious regression is someone re-adding the
 * DEV-302 limiter, so the first test watches the node factory rather than the config — a
 * config assertion would pass against a bus that silently built one anyway.
 *
 * The second half locks the reserved post-tap stage. `masterOut` is what capture hooks tap;
 * `outputGain` sits after it, so anything inserted there is heard but never printed into a
 * recording or export. Nothing uses it yet — that is the point, and a chain that quietly
 * loses it would make a future monitor-level control move the capture contract again.
 */

type ConnectTarget = AudioNode | AudioParam;

/** AudioParam is the other connect() overload and has no connect method of its own. */
const isAudioNode = (target: ConnectTarget): target is AudioNode => "connect" in target;

interface CapturedGraph {
  gains: GainNode[];
  compressors: DynamicsCompressorNode[];
  /** Downstream connect() targets per source node, recorded as the bus wires itself. */
  connectTargets: Map<AudioNode, ConnectTarget[]>;
}

/** Builds the master bus with the node factories spied, and returns the captured nodes. */
async function buildBus(): Promise<CapturedGraph> {
  const gains: GainNode[] = [];
  const compressors: DynamicsCompressorNode[] = [];
  const connectTargets = new Map<AudioNode, ConnectTarget[]>();

  // Wrap rather than replace, so the bus still gets real (mock-backed) nodes.
  const originalCreateGain = AudioContext.prototype.createGain;
  const originalCreateCompressor = AudioContext.prototype.createDynamicsCompressor;

  vi.spyOn(AudioContext.prototype, "createGain").mockImplementation(function (
    this: AudioContext,
  ): GainNode {
    const node = originalCreateGain.call(this);
    gains.push(node);
    // Spy before the bus wires anything, so the constructor's own connects are recorded.
    // Reading edges is the only mock-safe way to assert chain ORDER: the mock context does
    // not enforce real disconnect semantics, so probing with disconnect() would assert the
    // mock's behavior rather than the graph's shape.
    vi.spyOn(node, "connect").mockImplementation((target) => {
      connectTargets.set(node, [...(connectTargets.get(node) ?? []), target]);
      return target;
    });
    return node;
  });
  vi.spyOn(AudioContext.prototype, "createDynamicsCompressor").mockImplementation(function (
    this: AudioContext,
  ): DynamicsCompressorNode {
    const node = originalCreateCompressor.call(this);
    compressors.push(node);
    return node;
  });

  await AudioContextManager.getInstrumentContext();

  return { gains, compressors, connectTargets };
}

describe("MasterAudioBus — no corrective processing on the master bus (DEV-322)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await AudioContextManager.cleanup();
  });

  it("builds no DynamicsCompressorNode — no limiter, no auto-gain", async () => {
    const { compressors } = await buildBus();

    expect(compressors).toHaveLength(0);
  });

  it("exposes no limiter control surface", async () => {
    await buildBus();
    const bus = AudioContextManager.getMasterBus();

    expect(bus).not.toBeNull();
    expect(bus).not.toHaveProperty("setLimiterEnabled");
    expect(bus).not.toHaveProperty("getLimiterReductionDb");
  });
});

describe("MasterAudioBus — reserved post-tap output stage (DEV-322)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await AudioContextManager.cleanup();
  });

  it("keeps the capture tap upstream of the output stage, so the tap is not the speaker path", async () => {
    const { connectTargets } = await buildBus();
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    const context = await AudioContextManager.getInstrumentContext();
    const tap = bus.getMasterTap();

    // The tap feeds exactly one downstream node, and it is NOT the destination — a tap wired
    // straight to the speakers is the coupling `outputGain` exists to prevent.
    const fromTap = connectTargets.get(tap) ?? [];
    expect(fromTap).toHaveLength(1);
    const outputStage = fromTap[0];
    if (!outputStage || !isAudioNode(outputStage)) {
      throw new Error("the master tap is not wired to a downstream node");
    }
    expect(outputStage).not.toBe(context.destination);

    // …and that stage is what actually reaches the speakers.
    expect(connectTargets.get(outputStage) ?? []).toContain(context.destination);
  });

  it("divert/restore swaps the speaker path without disturbing the tap node itself", async () => {
    await buildBus();
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    const context = await AudioContextManager.getInstrumentContext();
    // A plain gain node stands in for the mixdown's MediaStreamDestination — the bus only
    // ever treats it as an AudioNode, and the mock context has no stream destination.
    const capture = context.createGain();
    const tap = bus.getMasterTap();

    bus.divertOutputToCapture(capture);
    bus.restoreOutputToSpeakers(capture);

    // Same node before and after — capture hooks hold this reference across a mixdown.
    expect(bus.getMasterTap()).toBe(tap);
    // Restoring twice is safe: the second call has nothing to detach.
    expect(() => {
      bus.restoreOutputToSpeakers(capture);
    }).not.toThrow();
  });
});
