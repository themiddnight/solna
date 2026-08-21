/* eslint-disable @typescript-eslint/naming-convention */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@lingui/core/macro";
import VoiceInput from "../index";
import { VoiceRuntimeProvider } from "../VoiceRuntimeProvider";
import { useVoiceStateStore } from "../stores/voiceStateStore";

const mockInitializeAudioStream = vi.fn().mockResolvedValue(undefined);
const mockCleanup = vi.fn();
const mockHandleMuteToggle = vi.fn().mockResolvedValue(undefined);
const mockAlert = vi.spyOn(window, "alert").mockImplementation(() => {});
const mockUseAudioStream = vi.fn(() => ({
  mediaStream: null,
  audioContext: null,
  gainNode: null,
  processedOutputNode: null,
  monitorTapNode: null,
  analyser: null,
  micPermission: false,
  inputDriverLatencySeconds: null,
  initializeAudioStream: mockInitializeAudioStream,
  cleanup: mockCleanup,
}));

vi.mock("../hooks/useAudioStream", () => ({
  useAudioStream: () => mockUseAudioStream(),
  __resetRetainedVoiceRuntimeForTests: vi.fn(),
  markNextVoiceInputUnmountForImmediateTeardown: vi.fn(),
}));

vi.mock("../hooks/useInputLevelMonitoring", () => ({
  useInputLevelMonitoring: () => ({
    startInputLevelMonitoring: vi.fn(),
    stopInputLevelMonitoring: vi.fn(),
  }),
}));

vi.mock("../hooks/useVoiceControls", () => ({
  useVoiceControls: () => ({
    handleMuteToggle: mockHandleMuteToggle,
    handleGainChange: vi.fn(),
    handleSelfMonitorToggle: vi.fn(),
  }),
}));

vi.mock("@/features/audio/stores/audioDeviceStore", () => ({
  useAudioDeviceStore: (selector: (state: { voiceInputDeviceId: null; setVoiceInputDeviceId: () => void }) => unknown) =>
    selector({ voiceInputDeviceId: null, setVoiceInputDeviceId: vi.fn() }),
}));

vi.mock("@/features/audio", () => ({
  RTCLatencyDisplay: () => null,
  AdaptiveAudioStatus: () => null,
}));

// Use importActual so the real Radix Popover drives open/close behaviour.
// Only override Modal and ConfirmDialog which need test-friendly stubs.
vi.mock("@/features/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Modal: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div data-testid="headphone-modal">{children}</div> : null,
    ConfirmDialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div data-testid="headphone-modal">{children}</div> : null,
  };
});

vi.mock("@iconify/react", () => ({
  Icon: () => null,
}));

vi.mock("../components/InputLevelMeter", () => ({
  InputLevelMeter: () => null,
}));

// VoiceSettings mock renders Popover.Content (real Radix) so the parent
// Popover.Root controls visibility — enabling the toggle integration tests
// and the Voice Mesh diagnostics wiring test below.
vi.mock("../components/VoiceSettings", async () => {
  const { Popover } = await import("@/features/ui");
  return {
    VoiceSettings: ({
      handleConnect,
      connectedPeers,
      totalPeers,
      onRetryConnections,
    }: {
      handleConnect: () => void;
      connectedPeers?: number;
      totalPeers?: number;
      onRetryConnections?: (() => void) | undefined;
    }) => (
      <Popover.Content>
        <div data-testid="voice-settings-panel">
          <label>
            {t`Enable`}
            <input
              type="checkbox"
              aria-label={t`Enable`}
              onChange={(event) => {
                if (event.target.checked) {
                  handleConnect();
                }
              }}
            />
          </label>
          {onRetryConnections && (
            <span data-testid="peers-text">
              {t`${connectedPeers ?? 0}/${totalPeers ?? 0} peers connected`}
            </span>
          )}
        </div>
      </Popover.Content>
    ),
  };
});

// VoiceInfo mock — latency display only; Voice Mesh moved to VoiceSettings.
vi.mock("../components/VoiceInfo", async () => {
  const { Popover } = await import("@/features/ui");
  return {
    VoiceInfo: () => (
      <Popover.Content>
        <div data-testid="voice-info-panel" />
      </Popover.Content>
    ),
  };
});

vi.mock("../components/MuteExtras", () => ({
  MuteExtras: () => null,
}));

vi.mock("../components/MonitorVolume", () => ({
  MonitorVolume: () => null,
}));

const renderWithProvider = (
  ui: ReactNode,
  providerProps?: Partial<ComponentProps<typeof VoiceRuntimeProvider>>,
) => render(
  <VoiceRuntimeProvider
    isVoiceEnabled={true}
    canTransmitVoice={true}
    userCount={1}
    connectedPeers={0}
    totalPeers={0}
    {...providerProps}
  >
    {ui}
  </VoiceRuntimeProvider>,
);

beforeEach(() => {
  useVoiceStateStore.setState({
    isMuted: false,
    gain: 1,
    inputLevel: 0,
    isSelfMonitoring: false,
    isConnected: false,
    hasSeenHeadphoneModal: false,
    cleanMode: false,
    autoGain: true,
  });
  vi.clearAllMocks();
});

describe("VoiceInput provider/view integration", () => {
  it("throws clearly when rendered outside VoiceRuntimeProvider", () => {
    expect(() => render(<VoiceInput />)).toThrow(/VoiceInputView must be rendered inside VoiceRuntimeProvider/);
  });

  it("renders compact controls without full-only settings controls", () => {
    renderWithProvider(<VoiceInput variant="compact" />);

    expect(screen.getByTestId("voice-input")).toHaveAttribute("data-variant", "compact");
    expect(screen.getByLabelText(/mute microphone/i)).toBeInTheDocument();
    expect(screen.queryByTitle("Voice settings")).not.toBeInTheDocument();
  });

  it("renders the full voice input card with settings controls", () => {
    renderWithProvider(<VoiceInput />);

    expect(screen.getByTestId("voice-input")).toHaveAttribute("data-variant", "full");
    expect(screen.getByTitle("Voice settings")).toBeInTheDocument();
  });

  it("toggles microphone mute through the shared runtime", async () => {
    renderWithProvider(<VoiceInput />);

    fireEvent.click(screen.getByRole("button", { name: /mute microphone/i }));

    await waitFor(() => expect(mockHandleMuteToggle).toHaveBeenCalledTimes(1));
  });

  it("toggles the settings panel from the full view", async () => {
    renderWithProvider(<VoiceInput />);

    fireEvent.click(screen.getByTitle("Voice settings"));
    expect(await screen.findByTestId("voice-settings-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Voice settings"));
    await waitFor(() => expect(screen.queryByTestId("voice-settings-panel")).not.toBeInTheDocument());
  });

  it("uses one audio runtime for multiple mounted voice input views", async () => {
    renderWithProvider(
      <>
        <VoiceInput variant="compact" />
        <VoiceInput />
      </>,
    );

    await waitFor(() => expect(mockInitializeAudioStream).toHaveBeenCalledTimes(1));
    expect(mockUseAudioStream).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("voice-input")).toHaveLength(2);
  });

  it("does not initialize the microphone when voice is disabled", async () => {
    renderWithProvider(<VoiceInput />, { isVoiceEnabled: false });

    await waitFor(() => expect(mockUseAudioStream).toHaveBeenCalledTimes(1));
    expect(mockInitializeAudioStream).not.toHaveBeenCalled();
  });

  it("does not initialize the microphone when the user cannot transmit voice", async () => {
    renderWithProvider(<VoiceInput />, { canTransmitVoice: false });

    await waitFor(() => expect(mockUseAudioStream).toHaveBeenCalledTimes(1));
    expect(mockInitializeAudioStream).not.toHaveBeenCalled();
  });

  it("blocks manual voice connect when the active band member capacity is full", async () => {
    renderWithProvider(<VoiceInput />, { activeBandMemberCount: 10 });

    await waitFor(() => expect(mockInitializeAudioStream).toHaveBeenCalledTimes(1));
    mockInitializeAudioStream.mockClear();

    fireEvent.click(screen.getByTitle("Voice settings"));
    fireEvent.click(await screen.findByRole("checkbox", { name: /enable/i }));

    expect(mockAlert).toHaveBeenCalledWith("ห้องเต็มแล้ว (10/10 active members) - ไม่สามารถเปิด voice input ได้");
    expect(mockInitializeAudioStream).not.toHaveBeenCalled();
  });

  it("passes connection stats from provider to the voice settings panel", async () => {
    const onRetryConnections = vi.fn();
    renderWithProvider(<VoiceInput />, {
      connectedPeers: 1,
      totalPeers: 3,
      onRetryConnections,
    });

    fireEvent.click(screen.getByTitle("Voice settings"));

    expect(await screen.findByTestId("peers-text")).toHaveTextContent("1/3 peers connected");
  });
});
