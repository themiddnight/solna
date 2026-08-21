import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AudioOutput } from "../index";
import { useAudioDeviceStore } from "@/features/audio/stores/audioDeviceStore";
import type { AudioDevice } from "@/features/audio/hooks/useAudioDevices";
import type { OutputSinkListener } from "@/engine/audio/outputRouter";

// Resolves with the requested id by default (i.e. "applied successfully"), matching
// the real router's contract of resolving to whatever was actually applied.
const setOutput = vi.fn<(deviceId: string | null) => Promise<string | null>>(
  (id) => Promise.resolve(id),
);
const isSupported = vi.fn<() => boolean>(() => true);
const listOutputs = vi.fn(() =>
  Promise.resolve([
    { deviceId: "spk-1", label: "MacBook Pro Speakers" },
    { deviceId: "spk-2", label: "AirPods Pro" },
  ]),
);

// Subscribers registered by the component. Tests drive them directly to simulate the
// router applying a sink on its own initiative (the D3 fallback) — the real router
// does this from inside `applyToContext`, long after the component's push resolved.
const sinkListeners = new Set<OutputSinkListener>();

// A stable singleton object, matching the real module's `router ??= ...` caching —
// the real `getOutputRouter()` always returns the same instance so the chosen sink
// survives context rebuilds. A factory that minted a fresh object per call would
// silently diverge from that guarantee without any test catching it.
// (Singleton identity of the real module is covered in engine/audio/outputRouter.)
const routerMock = {
  isSupported: () => isSupported(),
  listOutputs: () => listOutputs(),
  setOutput: (id: string | null) => setOutput(id),
  applyToContext: () => Promise.resolve(),
  subscribe: (listener: OutputSinkListener) => {
    sinkListeners.add(listener);
    return () => {
      sinkListeners.delete(listener);
    };
  },
};

vi.mock("@/engine/audio/outputRouter", () => ({
  getOutputRouter: () => routerMock,
}));

const permission = { granted: true };
// Stable reference across renders/calls — the real hook returns React state, which
// keeps the same array identity until `enumerateDevices` actually re-runs. A fresh
// `[]` literal per call would change identity on every render and, since Fix 3 keys
// the list-loading effect off this value, would re-trigger it forever. Tests that
// simulate a plug/unplug reassign `deviceState.devices` to get a new identity, which
// is exactly what the real hook does on the browser's `devicechange` event.
const deviceState: { devices: AudioDevice[] } = { devices: [] };
vi.mock("@/features/audio/hooks/useAudioDevices", () => ({
  useAudioDevices: () => ({
    devices: deviceState.devices,
    inputDevices: deviceState.devices,
    outputDevices: deviceState.devices,
    isPermissionGranted: permission.granted,
    refreshDevices: vi.fn(),
    requestAccess: vi.fn(() => Promise.resolve(true)),
  }),
}));

describe("AudioOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupported.mockReturnValue(true);
    permission.granted = true;
    deviceState.devices = [];
    sinkListeners.clear();
    useAudioDeviceStore.setState({ outputDeviceId: null });
  });

  it("renders nothing when the platform cannot route output (D1)", () => {
    isSupported.mockReturnValue(false);
    const { container } = render(<AudioOutput />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the trigger when supported", async () => {
    render(<AudioOutput />);
    expect(screen.getByTestId("audio-output-trigger")).toBeInTheDocument();
    // Fix 1 loads the list on mount (not gated on the popover being open) — let that
    // settle so the update isn't left dangling past the end of the test.
    await waitFor(() => {
      expect(listOutputs).toHaveBeenCalled();
    });
  });

  it("lists devices directly in the popover — one click, no nested select", async () => {
    const user = userEvent.setup();
    render(<AudioOutput />);

    await user.click(screen.getByTestId("audio-output-trigger"));

    expect(await screen.findByText("AirPods Pro")).toBeInTheDocument();
    expect(screen.getByText("MacBook Pro Speakers")).toBeInTheDocument();
  });

  it("selecting a device stores it and tells the router", async () => {
    const user = userEvent.setup();
    render(<AudioOutput />);

    await user.click(screen.getByTestId("audio-output-trigger"));
    await user.click(await screen.findByText("AirPods Pro"));

    await waitFor(() => {
      expect(setOutput).toHaveBeenCalledWith("spk-2");
    });
    expect(useAudioDeviceStore.getState().outputDeviceId).toBe("spk-2");
  });

  it("pushes the persisted device into the router on mount", async () => {
    useAudioDeviceStore.setState({ outputDeviceId: "spk-2" });

    render(<AudioOutput />);

    await waitFor(() => {
      expect(setOutput).toHaveBeenCalledWith("spk-2");
    });
  });

  it("asks for permission instead of listing unnamed devices (D2)", async () => {
    permission.granted = false;
    const user = userEvent.setup();
    render(<AudioOutput />);

    await user.click(screen.getByTestId("audio-output-trigger"));

    expect(await screen.findByTestId("audio-output-request-access")).toBeInTheDocument();
    expect(screen.queryByText("AirPods Pro")).not.toBeInTheDocument();
  });

  // Fix 1 regression guard: the list used to only load once the popover opened
  // (effect gated on `isOpen`), so the trigger showed the generic speaker icon and
  // generic tooltip on first render even with a persisted headphone selection.
  // Spec §3.4 requires the cell icon to reflect current state at all times.
  it("reflects the persisted selection in the trigger tooltip without opening the popover", async () => {
    useAudioDeviceStore.setState({ outputDeviceId: "spk-2" });

    render(<AudioOutput />);

    await waitFor(() => {
      expect(screen.getByTestId("audio-output-trigger")).toHaveAttribute(
        "title",
        "AirPods Pro",
      );
    });
    // Never opened — confirms the list loaded on its own, not because of a click.
    expect(screen.queryByTestId("audio-output-list")).not.toBeInTheDocument();
  });

  it("selecting a device pushes it to the router exactly once (single-writer contract)", async () => {
    const user = userEvent.setup();
    render(<AudioOutput />);

    await user.click(screen.getByTestId("audio-output-trigger"));
    await user.click(await screen.findByText("AirPods Pro"));

    await waitFor(() => {
      expect(setOutput).toHaveBeenCalledWith("spk-2");
    });
    // The mount push of the current value (system default) then exactly one push for
    // the selection — the click handler writes to the store only, it never calls the
    // router itself.
    expect(setOutput.mock.calls).toEqual([[null], ["spk-2"]]);
  });

  // C1 regression guard. The router applies the remembered sink for the first time
  // inside `applyToContext`, which runs on the first user gesture — long after the
  // component's mount push has already resolved with the id it was handed. A dead
  // device is therefore only discovered later, and can only be reported through the
  // subscription. Correcting from `setOutput`'s resolved value never fired, so the
  // dead id was re-pushed and re-fell-back on every single reload.
  it("clears a dead persisted device when the router reports the D3 fallback (C1)", async () => {
    useAudioDeviceStore.setState({ outputDeviceId: "ghost-device" });

    render(<AudioOutput />);

    await waitFor(() => {
      expect(setOutput).toHaveBeenCalledWith("ghost-device");
    });
    // Resolved with the requested id: nothing was applied yet, so nothing contradicts
    // it — this is exactly why the return value cannot carry the correction.
    expect(useAudioDeviceStore.getState().outputDeviceId).toBe("ghost-device");

    // The AudioContext appears, the id is replayed, and only now does it turn out the
    // device is gone.
    act(() => {
      sinkListeners.forEach((listener) => {
        listener(null);
      });
    });

    expect(useAudioDeviceStore.getState().outputDeviceId).toBeNull();
  });

  it("unsubscribes from the router on unmount", () => {
    const { unmount } = render(<AudioOutput />);
    expect(sinkListeners.size).toBe(1);

    unmount();

    expect(sinkListeners.size).toBe(0);
  });

  // W1: Chromium silently reverts the sink to the system default when the active
  // device disappears. Without re-applying on device changes, re-plugging left the
  // popover showing the device as selected while audio stayed on the default.
  it("re-applies the selection when the device set changes (hot-plug)", async () => {
    useAudioDeviceStore.setState({ outputDeviceId: "spk-2" });
    const { rerender } = render(<AudioOutput />);

    await waitFor(() => {
      expect(setOutput).toHaveBeenCalledWith("spk-2");
    });
    setOutput.mockClear();

    // `devicechange` fired: the hook re-enumerated and handed back a new array.
    // The real hook re-renders on its own (it holds the device list in React state);
    // the mock cannot, and the component is `memo`, so a prop change is what makes it
    // re-read. What is under test is the effect's reaction to the new device set.
    deviceState.devices = [];
    rerender(<AudioOutput side="top" />);

    await waitFor(() => {
      expect(setOutput).toHaveBeenCalledWith("spk-2");
    });
  });

  // W6: `null` is the model's system default, and D3 falls back to it on its own —
  // but without an explicit entry the user could never deliberately return to it.
  it("offers an explicit system default entry that clears the stored device", async () => {
    useAudioDeviceStore.setState({ outputDeviceId: "spk-2" });
    const user = userEvent.setup();
    render(<AudioOutput />);

    await user.click(screen.getByTestId("audio-output-trigger"));
    await user.click(await screen.findByTestId("audio-output-system-default"));

    expect(useAudioDeviceStore.getState().outputDeviceId).toBeNull();
    await waitFor(() => {
      expect(setOutput).toHaveBeenCalledWith(null);
    });
  });
});
