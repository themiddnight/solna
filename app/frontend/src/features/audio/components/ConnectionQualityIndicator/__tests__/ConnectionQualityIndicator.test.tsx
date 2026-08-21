// @vitest-environment jsdom
/**
 * ConnectionQualityIndicator — renders the quality badge for the four
 * documented levels, with the compact tooltip form vs. the detailed form
 * (latency + packet-loss readouts). @/shared/ui is stubbed to a plain span
 * carrying the icon name so assertions target the indicator's own config
 * mapping (icon/color/label/tooltip per quality), not the Icon layer.
 */
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConnectionQualityIndicator } from "../index";

vi.mock("@/shared/ui", () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid="quality-icon" data-icon={name} className={className} />
  ),
}));

const QUALITY_CASES = [
  {
    quality: "excellent",
    icon: "signal-cellular-3",
    color: "text-success",
    bgColor: "bg-success/10",
    label: "Excellent",
    tooltip: "Connection quality is excellent",
  },
  {
    quality: "good",
    icon: "signal-cellular-2",
    color: "text-warning",
    bgColor: "bg-warning/10",
    label: "Good",
    tooltip: "Connection quality is good",
  },
  {
    quality: "poor",
    icon: "signal-cellular-1",
    color: "text-error",
    bgColor: "bg-error/10",
    label: "Poor",
    tooltip: "Connection quality is poor",
  },
  {
    quality: "failed",
    icon: "signal-cellular-outline",
    color: "text-base-content/30",
    bgColor: "bg-base-300",
    label: "Failed",
    tooltip: "Connection failed",
  },
] as const;

describe("ConnectionQualityIndicator — compact tooltip form", () => {
  it.each(QUALITY_CASES)(
    "$quality maps to icon $icon with the quality color and tooltip",
    ({ quality, icon, color, tooltip }) => {
      render(<ConnectionQualityIndicator quality={quality} />);
      const iconEl = screen.getByTestId("quality-icon");
      expect(iconEl).toHaveAttribute("data-icon", icon);
      expect(iconEl).toHaveClass(color);
      const wrapper = iconEl.parentElement;
      expect(wrapper).toHaveClass("tooltip");
      expect(wrapper).toHaveAttribute("data-tip", tooltip);
    },
  );

  // ACTUAL behavior (pinned): md maps to the `text-base` utility, not
  // `text-md` (the sizeClasses map in the component uses text-base for md).
  it.each([
    ["xs", "text-xs"],
    ["sm", "text-sm"],
    ["md", "text-base"],
    ["lg", "text-lg"],
  ] as const)("applies the %s size class to the wrapper", (size, expectedClass) => {
    render(<ConnectionQualityIndicator quality="good" size={size} />);
    const wrapper = screen.getByTestId("quality-icon").parentElement;
    expect(wrapper).toHaveClass(expectedClass);
  });

  it("does not render the label or latency in compact mode", () => {
    render(
      <ConnectionQualityIndicator quality="good" latency={42} showDetails={false} />,
    );
    expect(screen.queryByText("Good")).not.toBeInTheDocument();
    expect(screen.queryByText("42ms")).not.toBeInTheDocument();
  });
});

describe("ConnectionQualityIndicator — detailed form", () => {
  it.each(QUALITY_CASES)(
    "$quality shows the label with the badge background and color",
    ({ quality, color, bgColor, label }) => {
      render(<ConnectionQualityIndicator quality={quality} showDetails />);
      const badge = screen.getByText(label);
      expect(badge).toHaveClass("font-medium");
      expect(badge).toHaveClass(color);
      const pill = badge.parentElement;
      expect(pill).toHaveClass(bgColor);
    },
  );

  it("renders latency in ms with integer rounding", () => {
    render(
      <ConnectionQualityIndicator quality="good" showDetails latency={123.6} />,
    );
    expect(screen.getByText("124ms")).toBeInTheDocument();
  });

  it("renders packet loss as a percentage with one decimal", () => {
    render(
      <ConnectionQualityIndicator
        quality="poor"
        showDetails
        latency={90}
        packetLoss={0.05}
      />,
    );
    expect(screen.getByText("5.0% loss")).toBeInTheDocument();
  });

  it("hides the packet-loss readout at 0 or undefined", () => {
    const { rerender } = render(
      <ConnectionQualityIndicator quality="poor" showDetails packetLoss={0} />,
    );
    expect(screen.queryByText(/loss/)).not.toBeInTheDocument();
    // exactOptionalPropertyTypes: omit the prop instead of passing undefined
    rerender(<ConnectionQualityIndicator quality="poor" showDetails />);
    expect(screen.queryByText(/loss/)).not.toBeInTheDocument();
  });

  it("hides the latency readout when undefined", () => {
    render(
      <ConnectionQualityIndicator quality="good" showDetails packetLoss={0.1} />,
    );
    expect(screen.queryByText(/ms/)).not.toBeInTheDocument();
  });
});

describe("ConnectionQualityIndicator — memoization", () => {
  it("bails out of re-rendering when props are unchanged (same DOM node)", () => {
    const props = { quality: "good" as const, showDetails: true, latency: 42 };
    const { rerender } = render(<ConnectionQualityIndicator {...props} />);
    const firstBadge = screen.getByText("Good");
    act(() => {
      rerender(<ConnectionQualityIndicator {...props} />);
    });
    expect(screen.getByText("Good")).toBe(firstBadge);
  });

  it("re-renders when quality changes", () => {
    const { rerender } = render(
      <ConnectionQualityIndicator quality="good" showDetails />,
    );
    rerender(<ConnectionQualityIndicator quality="excellent" showDetails />);
    expect(screen.getByText("Excellent")).toBeInTheDocument();
    expect(screen.queryByText("Good")).not.toBeInTheDocument();
  });
});
