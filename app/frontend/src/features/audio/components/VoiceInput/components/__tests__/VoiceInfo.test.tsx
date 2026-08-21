// @vitest-environment jsdom
/**
 * Unit tests: VoiceInfo — per-stage latency breakdown in the info popup (DEV-257)
 *
 * The popup renders every stage of the mouth-to-ear chain with a readable
 * description, shows "—" for stages the platform can't measure, and its total
 * is the exact sum of the rows (same computeLatencyBreakdown as the headline).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { i18n } from "@lingui/core";
import { VoiceInfo } from "../VoiceInfo";
import { getWebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";
import type { WebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";

i18n.load("en", {});
i18n.activate("en");

vi.mock("@/shared/webrtc/webrtcCapabilities", () => ({
  getWebRTCCapabilities: vi.fn(),
}));

/** Platform flags drive the guidance copy — default to a plain desktop. */
const mockPlatform = (overrides: Partial<WebRTCCapabilities> = {}) => {
  vi.mocked(getWebRTCCapabilities).mockReturnValue({
    isMacOS: false,
    isWindows: false,
    ...overrides,
  } as WebRTCCapabilities);
};

vi.mock("@/shared/ui", () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Icon: () => null,
}));

vi.mock("@/features/ui", () => ({
  Popover: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}));

vi.mock("@/features/audio", () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  AdaptiveAudioStatus: () => null,
}));

const baseProps = {
  isConnecting: false,
  connectionError: false,
  rtcLatencyActive: true,
  rtcLatency: 40,
  userCount: 2,
};

describe("VoiceInfo — latency breakdown", () => {
  beforeEach(() => mockPlatform());

  it("renders all stages and a total equal to their sum", () => {
    render(
      <VoiceInfo
        {...baseProps}
        inputLatencyMs={5}
        browserAudioLatency={10}
        meshLatency={40}
        jitterBufferMs={35}
      />,
    );
    expect(screen.getByTestId("voice-info-input-driver").textContent).toBe("5ms");
    expect(screen.getByTestId("voice-info-rtt-latency").textContent).toBe("20ms");
    expect(screen.getByTestId("voice-info-jitter-buffer").textContent).toBe("35ms");
    expect(screen.getByTestId("voice-info-audio-processing").textContent).toBe("10ms");
    expect(screen.getByTestId("voice-info-total-latency").textContent).toBe("70ms+");
  });

  it("shows an em dash for unmeasurable stages and excludes them from the total", () => {
    render(
      <VoiceInfo
        {...baseProps}
        browserAudioLatency={10}
        meshLatency={40}
        jitterBufferMs={null}
      />,
    );
    expect(screen.getByTestId("voice-info-input-driver").textContent).toBe("—");
    expect(screen.getByTestId("voice-info-jitter-buffer").textContent).toBe("—");
    expect(screen.getByTestId("voice-info-total-latency").textContent).toBe("30ms+");
  });

  it("warns about unusually high output latency", () => {
    render(
      <VoiceInfo
        {...baseProps}
        browserAudioLatency={120}
        meshLatency={40}
        jitterBufferMs={30}
      />,
    );
    expect(screen.getByTestId("voice-info-output-warning")).toBeTruthy();
  });

  it("names built-in speakers alongside Bluetooth — measured at ~50ms on a MacBook", () => {
    render(
      <VoiceInfo
        {...baseProps}
        browserAudioLatency={49}
        meshLatency={40}
        jitterBufferMs={30}
      />,
    );
    const warning = screen.getByTestId("voice-info-output-warning").textContent ?? "";
    expect(warning).toMatch(/speaker/i);
    expect(warning).toMatch(/bluetooth/i);
  });

  it("adds the audio-enhancements hint on Windows only", () => {
    mockPlatform({ isWindows: true });
    const { unmount } = render(
      <VoiceInfo {...baseProps} browserAudioLatency={80} meshLatency={40} jitterBufferMs={30} />,
    );
    expect(screen.getByTestId("voice-info-output-warning").textContent).toMatch(
      /enhancement/i,
    );
    unmount();

    mockPlatform({ isMacOS: true });
    render(
      <VoiceInfo {...baseProps} browserAudioLatency={80} meshLatency={40} jitterBufferMs={30} />,
    );
    expect(screen.getByTestId("voice-info-output-warning").textContent).not.toMatch(
      /enhancement/i,
    );
  });

  it("does not warn when output latency is in the wired range", () => {
    render(
      <VoiceInfo
        {...baseProps}
        browserAudioLatency={10}
        meshLatency={40}
        jitterBufferMs={30}
      />,
    );
    expect(screen.queryByTestId("voice-info-output-warning")).toBeNull();
  });

  it("shows the no-connection state instead of the breakdown when there is no network measurement", () => {
    render(
      <VoiceInfo
        {...baseProps}
        rtcLatencyActive={false}
        browserAudioLatency={10}
        meshLatency={null}
      />,
    );
    expect(screen.getByTestId("voice-info-no-connection")).toBeTruthy();
    expect(screen.queryByTestId("voice-info-total-latency")).toBeNull();
  });
});

describe("VoiceInfo — connection diagnostics", () => {
  const connected = {
    ...baseProps,
    browserAudioLatency: 10,
    meshLatency: 8,
    jitterBufferMs: 30,
  };

  beforeEach(() => mockPlatform());

  it("names the route the audio actually takes", () => {
    render(<VoiceInfo {...connected} connectionPath="local" networkJitterMs={4} />);
    expect(screen.getByTestId("voice-info-connection-path").textContent).toMatch(
      /local network/i,
    );
  });

  it("distinguishes an internet detour from a relayed hop", () => {
    const { unmount } = render(<VoiceInfo {...connected} connectionPath="internet" />);
    expect(screen.getByTestId("voice-info-connection-path").textContent).toMatch(
      /internet/i,
    );
    unmount();

    render(<VoiceInfo {...connected} connectionPath="relayed" />);
    expect(screen.getByTestId("voice-info-connection-path").textContent).toMatch(
      /relay/i,
    );
  });

  it("shows raw network jitter separately from the buffer it causes", () => {
    render(<VoiceInfo {...connected} networkJitterMs={4} connectionPath="local" />);
    expect(screen.getByTestId("voice-info-network-jitter").textContent).toBe("4ms");
  });

  it("keeps diagnostics out of the mouth-to-ear total", () => {
    // 8/2 + 30 + 10 = 44. Network jitter must not be added on top.
    render(<VoiceInfo {...connected} networkJitterMs={4} connectionPath="local" />);
    expect(screen.getByTestId("voice-info-total-latency").textContent).toBe("44ms+");
  });

  it("stays quiet about diagnostics the browser has not reported yet", () => {
    render(<VoiceInfo {...connected} />);
    expect(screen.queryByTestId("voice-info-connection-path")).toBeNull();
    expect(screen.queryByTestId("voice-info-network-jitter")).toBeNull();
  });

  it("advises fixing router isolation on an internet detour", () => {
    render(<VoiceInfo {...connected} connectionPath="internet" networkJitterMs={20} />);
    expect(screen.getByTestId("voice-info-path-warning").textContent).toMatch(
      /isolation/i,
    );
  });

  it("warns and points at VPN on a relayed path", () => {
    render(<VoiceInfo {...connected} connectionPath="relayed" networkJitterMs={20} />);
    expect(screen.getByTestId("voice-info-path-warning").textContent).toMatch(/vpn/i);
  });

  it("does not warn about a healthy local path", () => {
    render(<VoiceInfo {...connected} connectionPath="local" networkJitterMs={4} />);
    expect(screen.queryByTestId("voice-info-path-warning")).toBeNull();
  });

  it("leads with the action when recurring stalls are detected", () => {
    render(
      <VoiceInfo
        {...connected}
        jitterBufferMs={175}
        networkJitterMs={4}
        connectionPath="local"
        networkStall={{ hasStall: true, baselineMs: 4, worstMs: 160 }}
      />,
    );
    const warning = screen.getByTestId("voice-info-stall-warning");
    expect(warning).toBeTruthy();
    // Collapsed: what to DO, not a diagnosis. The numbers live in details.
    expect(warning.textContent).not.toContain("160");
  });

  it("names AirDrop and Handoff as the likely cause on macOS only", () => {
    const stall = { hasStall: true, baselineMs: 4, worstMs: 160 } as const;
    mockPlatform({ isMacOS: true });
    const { unmount } = render(
      <VoiceInfo {...connected} jitterBufferMs={175} networkStall={stall} />,
    );
    expect(screen.getByTestId("voice-info-stall-warning").textContent).toMatch(
      /airdrop/i,
    );
    unmount();

    mockPlatform({ isWindows: true });
    render(<VoiceInfo {...connected} jitterBufferMs={175} networkStall={stall} />);
    expect(screen.getByTestId("voice-info-stall-warning").textContent).not.toMatch(
      /airdrop/i,
    );
  });

  it("does not cry stall when the buffer is already healthy", () => {
    // Spikes exist but NetEq absorbed them without inflating — nothing to fix.
    render(
      <VoiceInfo
        {...connected}
        jitterBufferMs={30}
        networkStall={{ hasStall: true, baselineMs: 4, worstMs: 160 }}
      />,
    );
    expect(screen.queryByTestId("voice-info-stall-warning")).toBeNull();
  });

  it("does not warn when no stall is detected", () => {
    render(
      <VoiceInfo
        {...connected}
        jitterBufferMs={175}
        networkStall={{ hasStall: false, baselineMs: 90, worstMs: 95 }}
      />,
    );
    expect(screen.queryByTestId("voice-info-stall-warning")).toBeNull();
  });
});

/**
 * The popup's default job is "how am I doing / what do I fix" — numbers and
 * actions. The "what is a jitter buffer" reading is a one-time need, so it sits
 * behind a single toggle rather than crowding every visit.
 */
describe("VoiceInfo — progressive disclosure", () => {
  const connected = {
    ...baseProps,
    browserAudioLatency: 10,
    meshLatency: 8,
    jitterBufferMs: 30,
  };

  beforeEach(() => mockPlatform());

  it("shows numbers without explanations by default", () => {
    render(<VoiceInfo {...connected} connectionPath="local" networkJitterMs={4} />);
    expect(screen.getByTestId("voice-info-jitter-buffer").textContent).toBe("30ms");
    expect(screen.queryByText(/held briefly to smooth out/i)).toBeNull();
    expect(screen.queryByText(/shortest route available/i)).toBeNull();
  });

  it("reveals every explanation at once from a single toggle", async () => {
    const user = userEvent.setup();
    render(<VoiceInfo {...connected} connectionPath="local" networkJitterMs={4} />);

    await user.click(screen.getByTestId("voice-info-details-toggle"));

    expect(screen.getByText(/held briefly to smooth out/i)).toBeTruthy();
    expect(screen.getByText(/shortest route available/i)).toBeTruthy();
  });

  it("hides the explanations again on a second click", async () => {
    const user = userEvent.setup();
    render(<VoiceInfo {...connected} connectionPath="local" />);
    const toggle = screen.getByTestId("voice-info-details-toggle");

    await user.click(toggle);
    await user.click(toggle);

    expect(screen.queryByText(/held briefly to smooth out/i)).toBeNull();
  });

  it("adds the diagnosis behind the stall action once details are open", async () => {
    const user = userEvent.setup();
    render(
      <VoiceInfo
        {...connected}
        jitterBufferMs={175}
        networkStall={{ hasStall: true, baselineMs: 4, worstMs: 160 }}
      />,
    );

    await user.click(screen.getByTestId("voice-info-details-toggle"));

    const warning = screen.getByTestId("voice-info-stall-warning").textContent ?? "";
    expect(warning).toContain("160");
    expect(warning).toContain("4");
  });

  it("explains the em dashes only when a stage is actually unmeasured", () => {
    const { unmount } = render(<VoiceInfo {...connected} inputLatencyMs={5} />);
    expect(screen.queryByTestId("voice-info-total-note")).toBeNull();
    unmount();

    // Input driver unreported (Safari) → the dash needs explaining.
    render(<VoiceInfo {...connected} />);
    expect(screen.getByTestId("voice-info-total-note")).toBeTruthy();
  });

  it("offers no toggle when there is nothing to explain", () => {
    render(<VoiceInfo {...connected} rtcLatencyActive={false} meshLatency={null} />);
    expect(screen.queryByTestId("voice-info-details-toggle")).toBeNull();
  });
});

