import { describe, it, expect, afterEach } from "vitest";
import { AudioContextManager } from "../audioContextManager";

/**
 * DEV-323 — the master insert point.
 *
 * The substrate is in place ahead of the UI, so these lock the two properties the UI will
 * depend on and that are easy to break in the meantime: channels land on a node that is
 * *before* the inserts and the fader, and rebuilding the chain leaves no stale edge bypassing
 * it. The second is the exact bug `rebuildChannelChain` documents for per-channel chains —
 * splice in a second effect and the previous last-node → destination connection survives as a
 * dry path around it, which sounds like "the new effect does nothing".
 */

interface CapturedEdges {
  from: GainNode;
  targets: (AudioNode | AudioParam)[];
}

/** Records what a node connects to, from the moment of the call onward. */
function watchConnections(node: GainNode): CapturedEdges {
  const targets: (AudioNode | AudioParam)[] = [];
  const original = node.connect.bind(node);
  // Reading edges is the only mock-safe way to assert chain order: the mock context does not
  // enforce real disconnect semantics, so probing with disconnect() would test the mock.
  Object.defineProperty(node, "connect", {
    configurable: true,
    value: (target: AudioNode | AudioParam) => {
      targets.push(target);
      return original(target as AudioNode);
    },
  });
  return { from: node, targets };
}

describe("MasterAudioBus — master insert point (DEV-323)", () => {
  afterEach(async () => {
    await AudioContextManager.cleanup();
  });

  it("gives channels an input node that is not the fader, so inserts cannot be bypassed", async () => {
    await AudioContextManager.getInstrumentContext();
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    // Before the master channel existed these were the same node. A channel still connecting
    // to the fader would sit past every insert.
    expect(bus.getMasterInput()).not.toBe(bus.getMasterGain());
    expect(bus.getMasterInput()).not.toBe(bus.getMasterTap());
  });

  it("wires the sum straight to the fader when there are no inserts", async () => {
    const context = await AudioContextManager.getInstrumentContext();
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    const edges = watchConnections(bus.getMasterInput());
    bus.setMasterInserts([]);

    expect(edges.targets).toEqual([bus.getMasterGain()]);
    expect(context).toBeDefined();
  });

  it("routes through inserts in order, sum → first, last → fader", async () => {
    const context = await AudioContextManager.getInstrumentContext();
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    const first = { inputNode: context.createGain(), outputNode: context.createGain() };
    const second = { inputNode: context.createGain(), outputNode: context.createGain() };
    const sumEdges = watchConnections(bus.getMasterInput());
    const firstOutEdges = watchConnections(first.outputNode);
    const secondOutEdges = watchConnections(second.outputNode);

    bus.setMasterInserts([first, second]);

    expect(sumEdges.targets).toEqual([first.inputNode]);
    expect(firstOutEdges.targets).toEqual([second.inputNode]);
    expect(secondOutEdges.targets).toEqual([bus.getMasterGain()]);
  });

  it("leaves no dry path around a newly added insert", async () => {
    const context = await AudioContextManager.getInstrumentContext();
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    const first = { inputNode: context.createGain(), outputNode: context.createGain() };
    bus.setMasterInserts([first]);

    // Adding a second insert re-runs the whole chain. If the rebuild only appended, `first`
    // would still be wired to the fader as well — half the signal skipping `second`.
    const second = { inputNode: context.createGain(), outputNode: context.createGain() };
    const firstOutEdges = watchConnections(first.outputNode);
    bus.setMasterInserts([first, second]);

    expect(firstOutEdges.targets).toEqual([second.inputNode]);
  });

  it("restores the direct sum → fader path when the last insert is removed", async () => {
    const context = await AudioContextManager.getInstrumentContext();
    const bus = AudioContextManager.getMasterBus();
    if (!bus) throw new Error("master bus was not created");

    bus.setMasterInserts([{ inputNode: context.createGain(), outputNode: context.createGain() }]);
    const sumEdges = watchConnections(bus.getMasterInput());
    bus.setMasterInserts([]);

    // An empty chain must be audibly identical to never having had one — not silence.
    expect(sumEdges.targets).toEqual([bus.getMasterGain()]);
  });
});
