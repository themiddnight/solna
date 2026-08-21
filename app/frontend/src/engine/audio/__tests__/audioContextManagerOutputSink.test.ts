import { describe, it, expect, beforeEach, vi } from "vitest";

const applyToContext = vi.fn<(context: AudioContext) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock("../outputRouter", () => ({
  getOutputRouter: () => ({
    isSupported: () => true,
    listOutputs: () => Promise.resolve([]),
    setOutput: (deviceId: string | null) => Promise.resolve(deviceId),
    applyToContext: (context: AudioContext) => applyToContext(context),
  }),
}));

describe("audioContextManager applies the output sink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("hands each newly created instrument context to the OutputRouter", async () => {
    const { AudioContextManager } = await import("../audioContextManager");

    const context = await AudioContextManager.getInstrumentContext();

    expect(applyToContext).toHaveBeenCalledWith(context);
  });
});
