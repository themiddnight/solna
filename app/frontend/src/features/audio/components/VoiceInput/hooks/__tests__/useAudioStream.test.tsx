/* eslint-disable */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRetainedVoiceRuntimeForTests,
  useAudioStream,
} from "../useAudioStream";
import { applyVoiceInputGainDb } from "../../utils/voiceGain";

// The effects output node is a long-lived singleton inside AudioInputEffectsManager —
// the same GainNode instance survives a stream reinitialization. Model it as a stub that
// tracks its outgoing edges so tests can assert which connections a reinit tears down.
const effectsMocks = vi.hoisted(() => {
  const edges = new Set<unknown>();
  const outputNode = {
    edges,
    connect: vi.fn((node: unknown) => {
      edges.add(node);
    }),
    disconnect: vi.fn((node?: unknown) => {
      if (node === undefined) {
        edges.clear();
      } else {
        edges.delete(node);
      }
    }),
  };
  return { outputNode };
});

vi.mock("@/features/audio/services/AudioInputEffectsManager", () => ({
  audioInputEffectsManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    attachSource: vi.fn(),
    detachSource: vi.fn(),
    getOutputNode: vi.fn(() => effectsMocks.outputNode),
  },
}));

vi.mock("@/engine/effects/runtime/effectsArchitecture", () => ({
  getOrCreateGlobalMixer: vi.fn().mockResolvedValue({
    getChannelMonitorTap: vi.fn(() => null),
  }),
}));

const audioContextMocks = vi.hoisted(() => ({
  context: null as unknown as AudioContext,
}));

vi.mock("@/engine/audio", async (importOriginal) => {
  // Only AudioContextManager needs stubbing — acquireCleanInput/buildInputConstraints/
  // verifyCleanInput must stay real so the constraints tests below exercise the actual
  // shared builder, not a re-implemented fake of it.
  const actual = await importOriginal<typeof import("@/engine/audio")>();
  return {
    ...actual,
    AudioContextManager: {
      getInstrumentContext: vi.fn(() => Promise.resolve(audioContextMocks.context)),
    },
  };
});

const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);

const createAudioNode = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const createMockTrack = () => ({
  kind: "audio",
  enabled: false,
  readyState: "live",
  stop: vi.fn(function stop(this: { readyState: string }) {
    this.readyState = "ended";
  }),
  applyConstraints: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn(() => ({})), // latency field absent → inputDriverLatencySeconds = null
});

const createMockStream = (track = createMockTrack()) => ({
  getTracks: vi.fn(() => [track]),
  getAudioTracks: vi.fn(() => [track]),
  getVideoTracks: vi.fn(() => []),
  addTrack: vi.fn(),
});

// The retained-runtime grace window only applies while the router is still inside a
// room (responsive remount / room→room handoff), so every test below runs "in a room"
// unless it explicitly navigates away.
beforeEach(() => {
  window.history.pushState({}, "", "/perform/test-room");
});

describe("useAudioStream responsive runtime continuity", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    const processedStream = createMockStream();
    audioContextMocks.context = {
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn(() => createAudioNode()),
      createAnalyser: vi.fn(() => ({
        ...createAudioNode(),
        fftSize: 0,
        smoothingTimeConstant: 0,
      })),
      createGain: vi.fn(() => ({
        ...createAudioNode(),
        gain: { value: 1 },
      })),
      createMediaStreamDestination: vi.fn(() => ({
        stream: processedStream,
      })),
    } as unknown as AudioContext;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getSupportedConstraints: vi.fn(() => ({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })),
        getUserMedia: vi.fn().mockResolvedValue(createMockStream()),
      },
    });
  });

  afterEach(() => {
    __resetRetainedVoiceRuntimeForTests();
    if (originalMediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("retains the local stream across layout-only unmount/remount", async () => {
    const onStreamReady = vi.fn();
    const onStreamRemoved = vi.fn();

    const firstHook = renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady,
        onStreamRemoved,
      }),
    );

    await act(async () => {
      await firstHook.result.current.initializeAudioStream();
    });

    const retainedStream = onStreamReady.mock.calls[0]![0] as MediaStream;
    const retainedTrack = retainedStream.getAudioTracks()[0]!;

    firstHook.unmount();

    expect(onStreamRemoved).not.toHaveBeenCalled();
    expect(retainedTrack.stop).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    const secondOnStreamReady = vi.fn();
    const secondOnStreamRemoved = vi.fn();

    const secondHook = renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady: secondOnStreamReady,
        onStreamRemoved: secondOnStreamRemoved,
      }),
    );

    expect(secondOnStreamReady).toHaveBeenCalledWith(retainedStream);
    expect(onStreamRemoved).not.toHaveBeenCalled();
    expect(secondOnStreamRemoved).not.toHaveBeenCalled();
    expect(retainedTrack.stop).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(retainedTrack.stop).not.toHaveBeenCalled();

    secondHook.unmount();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(secondOnStreamRemoved).toHaveBeenCalledTimes(1);
    expect(retainedTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("only lets one remount claim a retained runtime", async () => {
    const onStreamReady = vi.fn();

    const firstHook = renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady,
      }),
    );

    await act(async () => {
      await firstHook.result.current.initializeAudioStream();
    });

    const retainedStream = onStreamReady.mock.calls[0]![0] as MediaStream;
    firstHook.unmount();

    const secondOnStreamReady = vi.fn();
    renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady: secondOnStreamReady,
      }),
    );

    const thirdOnStreamReady = vi.fn();
    renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady: thirdOnStreamReady,
      }),
    );

    expect(secondOnStreamReady).toHaveBeenCalledWith(retainedStream);
    expect(thirdOnStreamReady).not.toHaveBeenCalled();
  });

  // Regression: only the Leave button armed an immediate teardown. Every other exit
  // (browser Back, a redirect, being kicked) fell through to the responsive-reflow
  // grace window, so the mic — and the browser's recording indicator — stayed live for
  // 3s after the user had already left the room. Nothing can claim the runtime once the
  // router is off every room route, so the grace buys nothing there.
  it("releases the mic immediately when the router has left every room route", async () => {
    const onStreamReady = vi.fn();
    const onStreamRemoved = vi.fn();

    const hook = renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady,
        onStreamRemoved,
      }),
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream();
    });

    const stream = onStreamReady.mock.calls[0]![0] as MediaStream;
    const track = stream.getAudioTracks()[0]!;

    // Browser Back to the lobby: history is already updated when React unmounts the route.
    window.history.pushState({}, "", "/");
    hook.unmount();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(onStreamRemoved).toHaveBeenCalledTimes(1);
  });

  it("keeps retaining the stream when moving between rooms", async () => {
    const onStreamReady = vi.fn();

    const hook = renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady,
      }),
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream();
    });

    const stream = onStreamReady.mock.calls[0]![0] as MediaStream;
    const track = stream.getAudioTracks()[0]!;

    // Perform → Arrange switch: the next room's runtime claims this stream.
    window.history.pushState({}, "", "/arrange/other-room");
    hook.unmount();

    expect(track.stop).not.toHaveBeenCalled();

    const secondOnStreamReady = vi.fn();
    renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady: secondOnStreamReady,
      }),
    );

    expect(secondOnStreamReady).toHaveBeenCalledWith(stream);
  });

  // Regression: the handoff slot holds exactly one runtime, and both ends of it used to drop
  // the loser on the floor — `cleanup({defer})` overwrote an already-retained runtime after
  // cancelling its teardown timer, and `claimRuntime` overwrote the claiming instance's own
  // refs. Either way a live MediaStream was left referenced by nothing, unreachable by every
  // later teardown: the mic stayed on for the rest of the page session. Seen for real on the
  // ghost-room screen, where the room shell mounts and unmounts in quick succession.
  it("leaves no stream behind when overlapping runtimes hand off", async () => {
    const firstOnStreamReady = vi.fn();
    const secondOnStreamReady = vi.fn();

    const firstHook = renderHook(() =>
      useAudioStream({ gain: 1, cleanMode: false, autoGain: true, onStreamReady: firstOnStreamReady }),
    );
    await act(async () => {
      await firstHook.result.current.initializeAudioStream();
    });

    // A second provider overlaps the first (responsive layout swap, ghost-room remount) and
    // acquires its own stream before the first one goes away.
    const secondHook = renderHook(() =>
      useAudioStream({ gain: 1, cleanMode: false, autoGain: true, onStreamReady: secondOnStreamReady }),
    );
    await act(async () => {
      await secondHook.result.current.initializeAudioStream();
    });

    const firstStream = firstOnStreamReady.mock.calls[0]![0] as MediaStream;
    const secondStream = secondOnStreamReady.mock.calls[0]![0] as MediaStream;
    const firstTrack = firstStream.getAudioTracks()[0]!;
    const secondTrack = secondStream.getAudioTracks()[0]!;
    expect(firstStream).not.toBe(secondStream);

    firstHook.unmount();
    secondHook.unmount();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(firstTrack.readyState).toBe("ended");
    expect(secondTrack.readyState).toBe("ended");
  });

  // Regression: initializeAudioStream only stored the stream *after* awaiting getUserMedia,
  // so an unmount landing inside that await found nothing to stop — and the stream that
  // resolved afterwards was wired up by a dead instance and never released. React StrictMode
  // makes this the normal case on room entry (mount → unmount → mount), which is how a live
  // mic survived leaving the room.
  it("stops a stream that resolves after the hook was torn down", async () => {
    let resolveStream: (stream: MediaStream) => void = () => { };
    const pendingStream = createMockStream();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      }),
    );

    const hook = renderHook(() =>
      useAudioStream({ gain: 1, cleanMode: false, autoGain: true }),
    );

    const initPromise = hook.result.current.initializeAudioStream();

    hook.unmount();

    await act(async () => {
      resolveStream(pendingStream as unknown as MediaStream);
      await initPromise;
    });

    expect(pendingStream.getAudioTracks()[0]!.stop).toHaveBeenCalled();
  });

  it("tears down immediately for explicit disconnect", async () => {
    const onStreamReady = vi.fn();
    const onStreamRemoved = vi.fn();

    const hook = renderHook(() =>
      useAudioStream({
        gain: 1,
        cleanMode: false,
        autoGain: true,
        onStreamReady,
        onStreamRemoved,
      }),
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream();
    });

    const stream = onStreamReady.mock.calls[0]![0] as MediaStream;
    const track = stream.getAudioTracks()[0]!;

    act(() => {
      hook.result.current.cleanup();
    });

    expect(onStreamRemoved).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Input gain applied to the created GainNode (DEV-307 review finding 3)
//
// This is the exact "persisted value reaches the audio" seam this codebase keeps
// regressing on: the `gain` prop (dB, DEV-307) must be converted to a linear multiplier
// via applyVoiceInputGainDb and written to the freshly-created GainNode's gain.value at
// node-creation time (useAudioStream.ts ~line 436) — not left as the raw dB number.
// ---------------------------------------------------------------------------

describe("input gain applied to created GainNode (DEV-307 review finding 3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    const processedStream = createMockStream();
    audioContextMocks.context = {
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn(() => createAudioNode()),
      createAnalyser: vi.fn(() => ({
        ...createAudioNode(),
        fftSize: 0,
        smoothingTimeConstant: 0,
      })),
      createGain: vi.fn(() => ({
        ...createAudioNode(),
        gain: { value: 1 },
      })),
      createMediaStreamDestination: vi.fn(() => ({
        stream: processedStream,
      })),
    } as unknown as AudioContext;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getSupportedConstraints: vi.fn(() => ({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })),
        getUserMedia: vi.fn().mockResolvedValue(createMockStream()),
      },
    });
  });

  afterEach(() => {
    __resetRetainedVoiceRuntimeForTests();
    if (originalMediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("converts a non-default persisted dB gain to a linear multiplier on the created GainNode", async () => {
    const hook = renderHook(() =>
      useAudioStream({
        gain: 12, // dB — non-default, non-unity persisted value
        cleanMode: false,
        autoGain: true,
      }),
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream();
    });

    const createGainMock = audioContextMocks.context.createGain as ReturnType<typeof vi.fn>;
    expect(createGainMock).toHaveBeenCalledTimes(1);
    const createdGainNode = createGainMock.mock.results[0]!.value as GainNode;

    // +12dB → linear gain ≈ 3.98 via applyVoiceInputGainDb — must be the converted value,
    // not the raw dB number (which would silently blast the signal at 12x instead of ~4x).
    expect(createdGainNode.gain.value).toBeCloseTo(applyVoiceInputGainDb(12), 5);
    expect(createdGainNode.gain.value).not.toBe(12);

    // Explicit unmount (rather than relying on RTL's implicit end-of-test cleanup) so this
    // stream isn't handed to the next test via the layout-transition retained-runtime path.
    act(() => {
      hook.result.current.cleanup();
    });
    hook.unmount();
  });

  it("converts a negative persisted dB gain (attenuation) to a linear multiplier below 1", async () => {
    const hook = renderHook(() =>
      useAudioStream({
        gain: -20, // dB — attenuation
        cleanMode: false,
        autoGain: true,
      }),
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream();
    });

    const createGainMock = audioContextMocks.context.createGain as ReturnType<typeof vi.fn>;
    const createdGainNode = createGainMock.mock.results[0]!.value as GainNode;

    expect(createdGainNode.gain.value).toBeCloseTo(applyVoiceInputGainDb(-20), 5);
    expect(createdGainNode.gain.value).toBeLessThan(1);

    act(() => {
      hook.result.current.cleanup();
    });
    hook.unmount();
  });
});

// ---------------------------------------------------------------------------
// Input constraints requested via acquireCleanInput (via initializeAudioStream →
// getUserMedia call). The hook no longer builds these itself — it delegates to the
// shared engine/audio/cleanInput.ts builder, which every clean-input consumer shares.
// ---------------------------------------------------------------------------

describe("microphone constraints requested via acquireCleanInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    const processedStream = createMockStream();
    audioContextMocks.context = {
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn(() => createAudioNode()),
      createAnalyser: vi.fn(() => ({
        ...createAudioNode(),
        fftSize: 0,
        smoothingTimeConstant: 0,
      })),
      createGain: vi.fn(() => ({
        ...createAudioNode(),
        gain: { value: 1 },
      })),
      createMediaStreamDestination: vi.fn(() => ({
        stream: processedStream,
      })),
    } as unknown as AudioContext;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getSupportedConstraints: vi.fn(() => ({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })),
        getUserMedia: vi.fn().mockResolvedValue(createMockStream()),
      },
    });
  });

  afterEach(() => {
    __resetRetainedVoiceRuntimeForTests();
    if (originalMediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const getConstraintsAfterInit = async (
    hookProps: Parameters<typeof useAudioStream>[0],
  ): Promise<MediaTrackConstraints & Record<string, unknown>> => {
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;

    const hook = renderHook(() => useAudioStream(hookProps));

    await act(async () => {
      await hook.result.current.initializeAudioStream({ forceReinitialize: true });
    });

    // Use the last call — earlier calls may come from auto-connect on mount
    const calls = getUserMediaMock.mock.calls;
    return calls[calls.length - 1]![0].audio as MediaTrackConstraints & Record<string, unknown>;
  };

  // acquireCleanInput always asks with `exact` on its first attempt (both clean and normal
  // mode) so an accepted request proves the platform genuinely committed — it only falls
  // back to plain booleans on OverconstrainedError, which this always-resolving mock never
  // raises. So every processing-stage assertion below observes the `{ exact }` shape, not
  // a plain boolean, regardless of which mode is under test.
  it("sets echoCancellation=true and noiseSuppression=true when cleanMode=false", async () => {
    const constraints = await getConstraintsAfterInit({
      gain: 1,
      cleanMode: false,
      autoGain: false,
    });

    expect(constraints.echoCancellation).toEqual({ exact: true });
    expect(constraints.noiseSuppression).toEqual({ exact: true });
  });

  it("sets echoCancellation=false and noiseSuppression=false when cleanMode=true", async () => {
    const constraints = await getConstraintsAfterInit({
      gain: 1,
      cleanMode: true,
      autoGain: false,
    });

    expect(constraints.echoCancellation).toEqual({ exact: false });
    expect(constraints.noiseSuppression).toEqual({ exact: false });
  });

  it("sets autoGainControl=true when autoGain=true", async () => {
    const constraints = await getConstraintsAfterInit({
      gain: 1,
      cleanMode: false,
      autoGain: true,
    });

    expect(constraints.autoGainControl).toEqual({ exact: true });
  });

  it("sets autoGainControl=false when autoGain=false", async () => {
    const constraints = await getConstraintsAfterInit({
      gain: 1,
      cleanMode: false,
      autoGain: false,
    });

    expect(constraints.autoGainControl).toEqual({ exact: false });
  });

  it("requests every processing stage disabled when clean mode is on", async () => {
    const constraints = await getConstraintsAfterInit({
      gain: 1,
      cleanMode: true,
      autoGain: false,
    });

    expect(constraints.echoCancellation).toEqual({ exact: false });
    expect(constraints.noiseSuppression).toEqual({ exact: false });
    expect(constraints.autoGainControl).toEqual({ exact: false });
  });

  it("exposes the verification report so the UI can tell the truth", async () => {
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    // getSettings() reads back the disabled processing stages the (mocked) browser actually
    // applied — the shared createMockTrack default returns {} (empty settings), which
    // verifyCleanInput correctly reports as "unknown", not "clean".
    const compliantTrack = {
      ...createMockTrack(),
      getSettings: vi.fn(() => ({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      })),
    };
    getUserMediaMock.mockResolvedValue(createMockStream(compliantTrack));

    const hook = renderHook(() => useAudioStream({ gain: 1, cleanMode: true, autoGain: false }));

    await act(async () => {
      await hook.result.current.initializeAudioStream({ forceReinitialize: true });
    });

    expect(hook.result.current.cleanInputReport?.verdict).toBe("clean");
    expect(hook.result.current.cleanInputReport?.exactHonoured).toBe(true);
  });

  // Regression (Task 4 review carry-forward): the old stream is stopped synchronously, but
  // without this reset the previous report stayed exposed across the acquireCleanInput()
  // permission round-trip on a device switch — the badge would briefly claim "clean" for a
  // microphone that is already dead.
  it("clears the previous verification report during a device switch", async () => {
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    const compliantTrack = {
      ...createMockTrack(),
      getSettings: vi.fn(() => ({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      })),
    };
    getUserMediaMock.mockResolvedValueOnce(createMockStream(compliantTrack));

    const hook = renderHook(() =>
      useAudioStream({ gain: 1, cleanMode: true, autoGain: false }),
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream({ forceReinitialize: true });
    });

    expect(hook.result.current.cleanInputReport?.verdict).toBe("clean");

    let resolveSecondStream: (stream: ReturnType<typeof createMockStream>) => void = () => { };
    getUserMediaMock.mockReturnValueOnce(
      new Promise<ReturnType<typeof createMockStream>>((resolve) => {
        resolveSecondStream = resolve;
      }),
    );

    let reinitPromise!: Promise<void>;
    act(() => {
      reinitPromise = hook.result.current.initializeAudioStream({ forceReinitialize: true });
    });

    // Still awaiting the new getUserMedia() call — the old report must already be gone.
    expect(hook.result.current.cleanInputReport).toBeNull();

    await act(async () => {
      resolveSecondStream(createMockStream(compliantTrack));
      await reinitPromise;
    });

    expect(hook.result.current.cleanInputReport?.verdict).toBe("clean");
  });

  it("sets deviceId exact constraint when deviceId is provided", async () => {
    const constraints = await getConstraintsAfterInit({
      gain: 1,
      cleanMode: false,
      autoGain: true,
      deviceId: "my-device-id",
    });

    expect(constraints.deviceId).toEqual({ exact: "my-device-id" });
  });

  it("does not include deviceId constraint when deviceId is not provided", async () => {
    const constraints = await getConstraintsAfterInit({
      gain: 1,
      cleanMode: false,
      autoGain: true,
    });

    expect(constraints.deviceId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Graph rewiring on reinitialization
// ---------------------------------------------------------------------------

describe("effects output rewiring on reinitialize", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Testing-library's auto-cleanup runs after the previous suite's afterEach, so a
    // retained runtime can outlive it and get claimed here — clear it before mounting.
    __resetRetainedVoiceRuntimeForTests();
    effectsMocks.outputNode.edges.clear();

    const processedStream = createMockStream();
    audioContextMocks.context = {
      state: "running",
      resume: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn(() => createAudioNode()),
      createAnalyser: vi.fn(() => ({
        ...createAudioNode(),
        fftSize: 0,
        smoothingTimeConstant: 0,
      })),
      createGain: vi.fn(() => ({
        ...createAudioNode(),
        gain: { value: 1 },
      })),
      createMediaStreamDestination: vi.fn(() => ({
        stream: processedStream,
      })),
    } as unknown as AudioContext;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getSupportedConstraints: vi.fn(() => ({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })),
        getUserMedia: vi.fn().mockResolvedValue(createMockStream()),
      },
    });
  });

  afterEach(() => {
    __resetRetainedVoiceRuntimeForTests();
    if (originalMediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Regression: toggling clean mode reinitializes the stream. The reinit used to call a
  // bare `effectsOutputNode.disconnect()`, which severs *every* outgoing edge — including
  // the self-monitor branch (effectsOutput → monitoringGain → speakers) owned by
  // useVoiceControls. Monitoring then reported "on" while being silent.
  it("keeps foreign edges on the effects output node when the stream reinitializes", async () => {
    const hook = renderHook(
      (props: Parameters<typeof useAudioStream>[0]) => useAudioStream(props),
      { initialProps: { gain: 1, cleanMode: false, autoGain: true } },
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream();
    });

    const createAnalyserMock = audioContextMocks.context.createAnalyser as ReturnType<typeof vi.fn>;
    const firstAnalyser = createAnalyserMock.mock.results[0]!.value as AudioNode;
    expect(effectsMocks.outputNode.edges.has(firstAnalyser)).toBe(true);

    // Simulate useVoiceControls enabling self-monitoring on the shared output node.
    const monitoringGain = createAudioNode();
    effectsMocks.outputNode.connect(monitoringGain);

    // Clean-mode toggle → forced reinitialize with new getUserMedia constraints.
    await act(async () => {
      hook.rerender({ gain: 1, cleanMode: true, autoGain: false });
    });

    const analyserCount = createAnalyserMock.mock.results.length;
    expect(analyserCount).toBeGreaterThan(1);
    const latestAnalyser = createAnalyserMock.mock.results[analyserCount - 1]!.value as AudioNode;

    // The self-monitor branch must survive the rebuild...
    expect(effectsMocks.outputNode.edges.has(monitoringGain)).toBe(true);
    // ...while the stale analyser edge is replaced by the fresh one.
    expect(effectsMocks.outputNode.edges.has(firstAnalyser)).toBe(false);
    expect(effectsMocks.outputNode.edges.has(latestAnalyser)).toBe(true);
  });

  it("detaches its analyser from the shared output node on cleanup, leaving foreign edges", async () => {
    const hook = renderHook(() =>
      useAudioStream({ gain: 1, cleanMode: false, autoGain: true }),
    );

    await act(async () => {
      await hook.result.current.initializeAudioStream();
    });

    const createAnalyserMock = audioContextMocks.context.createAnalyser as ReturnType<typeof vi.fn>;
    const analyser = createAnalyserMock.mock.results[0]!.value as AudioNode;
    const monitoringGain = createAudioNode();
    effectsMocks.outputNode.connect(monitoringGain);

    act(() => {
      hook.result.current.cleanup();
    });

    expect(effectsMocks.outputNode.edges.has(analyser)).toBe(false);
    expect(effectsMocks.outputNode.edges.has(monitoringGain)).toBe(true);
  });
});
