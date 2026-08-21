import { describe, it, expect, beforeEach, vi } from "vitest";
import { createChromiumOutputRouter } from "../chromiumOutputRouter";

type SinkCapableContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const makeContext = (withSink: boolean) => {
  const setSinkId = vi.fn<(sinkId: string) => Promise<void>>(() => Promise.resolve());
  const context = {} as SinkCapableContext;
  if (withSink) {
    context.setSinkId = setSinkId;
  }
  return { context, setSinkId };
};

const stubEnumerate = (devices: MediaDeviceInfo[]) => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: vi.fn(() => Promise.resolve(devices)) },
  });
};

const device = (deviceId: string, label: string, kind: MediaDeviceKind): MediaDeviceInfo =>
  ({ deviceId, label, kind, groupId: "g", toJSON: () => ({}) }) as MediaDeviceInfo;

describe("chromiumOutputRouter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isSupported", () => {
    it("returns true when AudioContext.prototype exposes setSinkId", () => {
      const router = createChromiumOutputRouter(() => true);
      expect(router.isSupported()).toBe(true);
    });

    it("returns false when setSinkId is absent", () => {
      const router = createChromiumOutputRouter(() => false);
      expect(router.isSupported()).toBe(false);
    });
  });

  describe("listOutputs", () => {
    it("returns only audiooutput devices", async () => {
      stubEnumerate([
        device("mic-1", "Built-in Mic", "audioinput"),
        device("spk-1", "Built-in Speakers", "audiooutput"),
        device("spk-2", "AirPods Pro", "audiooutput"),
      ]);
      const router = createChromiumOutputRouter(() => true);

      const outputs = await router.listOutputs();

      expect(outputs).toEqual([
        { deviceId: "spk-1", label: "Built-in Speakers" },
        { deviceId: "spk-2", label: "AirPods Pro" },
      ]);
    });

    it("returns an empty list when unsupported", async () => {
      stubEnumerate([device("spk-1", "Speakers", "audiooutput")]);
      const router = createChromiumOutputRouter(() => false);

      expect(await router.listOutputs()).toEqual([]);
    });
  });

  describe("setOutput + applyToContext", () => {
    it("applies the chosen device to an attached context", async () => {
      const { context, setSinkId } = makeContext(true);
      const router = createChromiumOutputRouter(() => true);

      await router.applyToContext(context);
      await router.setOutput("spk-2");

      expect(setSinkId).toHaveBeenCalledWith("spk-2");
    });

    it("applies the remembered device to a context created later", async () => {
      const router = createChromiumOutputRouter(() => true);
      await router.setOutput("spk-2");

      const { context, setSinkId } = makeContext(true);
      await router.applyToContext(context);

      expect(setSinkId).toHaveBeenCalledWith("spk-2");
    });

    it("passes an empty string for null (system default)", async () => {
      const { context, setSinkId } = makeContext(true);
      const router = createChromiumOutputRouter(() => true);
      await router.applyToContext(context);

      await router.setOutput(null);

      expect(setSinkId).toHaveBeenCalledWith("");
    });

    it("falls back to system default when the device is gone (D3)", async () => {
      const { context, setSinkId } = makeContext(true);
      setSinkId.mockRejectedValueOnce(new DOMException("Not found", "NotFoundError"));
      const router = createChromiumOutputRouter(() => true);
      await router.applyToContext(context);

      await router.setOutput("ghost-device");

      expect(setSinkId).toHaveBeenNthCalledWith(1, "ghost-device");
      expect(setSinkId).toHaveBeenNthCalledWith(2, "");
    });

    it("resolves with the requested device id when it applies cleanly", async () => {
      const { context } = makeContext(true);
      const router = createChromiumOutputRouter(() => true);
      await router.applyToContext(context);

      const applied = await router.setOutput("spk-2");

      expect(applied).toBe("spk-2");
    });

    it("reports the fallback sink, not the requested one, when the device is gone (D3)", async () => {
      const { context, setSinkId } = makeContext(true);
      setSinkId.mockRejectedValueOnce(new DOMException("Not found", "NotFoundError"));
      const router = createChromiumOutputRouter(() => true);
      await router.applyToContext(context);

      const applied = await router.setOutput("ghost-device");

      // The caller asked for "ghost-device" but the router silently fell back to the
      // system default — this is what lets the feature layer correct a persisted
      // selection instead of re-pushing a dead id forever.
      expect(applied).toBeNull();
      expect(applied).not.toBe("ghost-device");
    });

    // C1 regression guard. `setOutput` is called from the feature's mount effect,
    // which normally runs BEFORE any AudioContext exists (the context is created
    // lazily on the first user gesture because of the autoplay policy). Nothing is
    // applied at that moment, so the resolved value cannot report the fallback — the
    // real D3 rejection only happens later, inside `applyToContext`. Without a
    // notification the dead id survives every reload, which is exactly the loop the
    // D3 deviation claims to have closed.
    it("reports the fallback for a dead id pushed before any context exists (C1)", async () => {
      const router = createChromiumOutputRouter(() => true);
      const applied = vi.fn<(sinkId: string | null) => void>();
      router.subscribe(applied);

      // Mount-time push: no context yet, so nothing is applied and nothing is known.
      expect(await router.setOutput("ghost-device")).toBe("ghost-device");
      expect(applied).not.toHaveBeenCalled();

      // First user gesture: the context appears, the remembered id is replayed and
      // only now does the device turn out to be gone.
      const { context, setSinkId } = makeContext(true);
      setSinkId.mockRejectedValueOnce(new DOMException("Not found", "NotFoundError"));
      await router.applyToContext(context);

      expect(setSinkId).toHaveBeenNthCalledWith(1, "ghost-device");
      expect(setSinkId).toHaveBeenNthCalledWith(2, "");
      expect(applied).toHaveBeenCalledWith(null);
    });

    it("stops notifying after unsubscribe", async () => {
      const router = createChromiumOutputRouter(() => true);
      const applied = vi.fn<(sinkId: string | null) => void>();
      const unsubscribe = router.subscribe(applied);
      unsubscribe();

      const { context, setSinkId } = makeContext(true);
      setSinkId.mockRejectedValueOnce(new DOMException("Not found", "NotFoundError"));
      await router.applyToContext(context);
      await router.setOutput("ghost-device");

      expect(applied).not.toHaveBeenCalled();
    });

    it("keeps the user's choice when the attached context was closed (W3)", async () => {
      const { context, setSinkId } = makeContext(true);
      const router = createChromiumOutputRouter(() => true);
      const applied = vi.fn<(sinkId: string | null) => void>();
      router.subscribe(applied);
      await router.applyToContext(context);

      // The context is closed (Safari rebuild / teardown) and rejects everything.
      Object.defineProperty(context, "state", { value: "closed", configurable: true });
      setSinkId.mockRejectedValue(new DOMException("Closed", "InvalidStateError"));

      expect(await router.setOutput("spk-2")).toBe("spk-2");
      // A closed context says nothing about the device: the choice must survive and
      // must NOT be reported as a fallback to the system default.
      expect(applied).not.toHaveBeenCalled();

      const rebuilt = makeContext(true);
      await router.applyToContext(rebuilt.context);
      expect(rebuilt.setSinkId).toHaveBeenCalledWith("spk-2");
    });

    it("is a no-op when unsupported", async () => {
      const { context, setSinkId } = makeContext(false);
      const router = createChromiumOutputRouter(() => false);

      await router.applyToContext(context);
      await router.setOutput("spk-1");

      expect(setSinkId).not.toHaveBeenCalled();
    });
  });
});
