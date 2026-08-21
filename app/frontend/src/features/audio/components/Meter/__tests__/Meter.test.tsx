import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Meter } from "../Meter";
import { classifyZone } from "@/shared/audio/meterZones";
import { meterColorForZone } from "../meterColor";
import { dbfsToPercent } from "@/shared/audio/meterScale";
import type { MeterLevel } from "@/features/audio/hooks/useMeterLevel";

function level(overrides: Partial<MeterLevel> = {}): MeterLevel {
  return { peakDbfs: -3, rmsDbfs: -10, heldPeakDbfs: -3, ...overrides };
}

describe("Meter", () => {
  it("renders a fill whose color matches the current zone, not a rescaling gradient", () => {
    const { container } = render(
      <Meter levels={[level({ peakDbfs: -3, rmsDbfs: -10, heldPeakDbfs: -3 })]} />,
    );
    const fill = container.querySelector("[data-testid='meter-fill']");
    expect(fill).not.toBeNull();
    expect(fill?.className).not.toMatch(/from-green.*to-red|bg-linear-to-r/); // no gradient class
  });

  it("renders exactly one bar for a mono (single-element) levels array", () => {
    const { container } = render(<Meter levels={[level()]} />);
    expect(container.querySelectorAll("[data-testid='meter-fill']")).toHaveLength(1);
  });

  it("renders one bar per entry for a stereo (two-element) levels array", () => {
    const { container } = render(<Meter levels={[level(), level()]} />);
    expect(container.querySelectorAll("[data-testid='meter-fill']")).toHaveLength(2);
  });

  it("renders bar count driven by the array length, not hard-coded to 1 or 2", () => {
    const { container } = render(<Meter levels={[level(), level(), level()]} />);
    expect(container.querySelectorAll("[data-testid='meter-fill']")).toHaveLength(3);
  });

  it("classifies each bar's zone from its own peakDbfs -- a hot left must not paint a quiet right hot too", () => {
    const hotLeft = level({ peakDbfs: -2 }); // "hot" zone
    const quietRight = level({ peakDbfs: -40 }); // "tooQuiet" zone
    const { container } = render(<Meter levels={[hotLeft, quietRight]} />);
    const fills = container.querySelectorAll("[data-testid='meter-fill']");
    expect(fills).toHaveLength(2);

    expect(fills[0]).toHaveStyle({
      backgroundColor: meterColorForZone(classifyZone(hotLeft.peakDbfs)),
    });
    expect(fills[1]).toHaveStyle({
      backgroundColor: meterColorForZone(classifyZone(quietRight.peakDbfs)),
    });
    // Sanity: the two zones really are different colors, otherwise the assertions above
    // wouldn't distinguish a real bug from a coincidence.
    expect(fills[0]).not.toHaveStyle({
      backgroundColor: meterColorForZone(classifyZone(quietRight.peakDbfs)),
    });
  });

  it("classifies each bar's RMS fill from its own rmsDbfs independently", () => {
    const loud = level({ peakDbfs: -2, rmsDbfs: -2 });
    const quiet = level({ peakDbfs: -40, rmsDbfs: -40 });
    const { container } = render(<Meter levels={[loud, quiet]} />);
    const rmsFills = container.querySelectorAll("[data-testid='meter-rms-fill']");
    expect(rmsFills).toHaveLength(2);
    expect((rmsFills[0] as HTMLElement).style.width).not.toBe(
      (rmsFills[1] as HTMLElement).style.width,
    );
  });

  describe("orientation", () => {
    it("horizontal (default) drives the fill by width, not height", () => {
      const { container } = render(<Meter levels={[level({ peakDbfs: -6 })]} />);
      const fill = container.querySelector("[data-testid='meter-fill']") as HTMLElement;
      expect(fill.style.width).not.toBe("");
      expect(fill.style.height).toBe("");
    });

    it("vertical drives the fill by height, not width", () => {
      const { container } = render(
        <Meter levels={[level({ peakDbfs: -6 })]} orientation="vertical" />,
      );
      const fill = container.querySelector("[data-testid='meter-fill']") as HTMLElement;
      expect(fill.style.height).not.toBe("");
      expect(fill.style.width).toBe("");
    });

    it("stacks horizontal bars along the column axis (flex-col)", () => {
      const { container } = render(<Meter levels={[level(), level()]} />);
      const bars = container.querySelector("[data-testid='meter-bars']");
      expect(bars?.className).toMatch(/flex-col/);
    });

    it("stacks vertical bars along the row axis (flex-row), not the column axis", () => {
      const { container } = render(<Meter levels={[level(), level()]} orientation="vertical" />);
      const bars = container.querySelector("[data-testid='meter-bars']");
      expect(bars?.className).toMatch(/flex-row/);
      expect(bars?.className).not.toMatch(/flex-col/);
    });

    it("keeps per-bar independent zone classification in vertical orientation", () => {
      const hotLeft = level({ peakDbfs: -2 }); // "hot" zone
      const quietRight = level({ peakDbfs: -40 }); // "tooQuiet" zone
      const { container } = render(
        <Meter levels={[hotLeft, quietRight]} orientation="vertical" />,
      );
      const fills = container.querySelectorAll("[data-testid='meter-fill']");
      expect(fills).toHaveLength(2);
      expect(fills[0]).toHaveStyle({
        backgroundColor: meterColorForZone(classifyZone(hotLeft.peakDbfs)),
      });
      expect(fills[1]).toHaveStyle({
        backgroundColor: meterColorForZone(classifyZone(quietRight.peakDbfs)),
      });
    });

  });

  describe("thickness", () => {
    function barHeights(thickness: "sm" | "md" | "lg") {
      const { container } = render(<Meter levels={[level(), level()]} thickness={thickness} />);
      const bars = container.querySelectorAll("[data-testid='meter-bar']");
      return Array.from(bars).map((bar) => (bar as HTMLElement).style.height);
    }

    it("applies the same thickness to every bar in a stereo pair", () => {
      const heights = barHeights("lg");
      expect(heights).toHaveLength(2);
      expect(heights[0]).not.toBe("");
      expect(heights[0]).toBe(heights[1]);
    });

    it("maps each thickness value to a distinct dimension", () => {
      const sm = barHeights("sm")[0];
      const md = barHeights("md")[0];
      const lg = barHeights("lg")[0];
      expect(new Set([sm, md, lg]).size).toBe(3);
    });

    it("drives width instead of height when orientation is vertical", () => {
      const { container } = render(
        <Meter levels={[level()]} orientation="vertical" thickness="lg" />,
      );
      const bar = container.querySelector("[data-testid='meter-bar']") as HTMLElement;
      expect(bar.style.width).not.toBe("");
      expect(bar.style.height).toBe("");
    });
  });

  describe("peak-hold marker", () => {
    it("does not render a peak-hold marker by default", () => {
      const { container } = render(<Meter levels={[level()]} />);
      expect(container.querySelector("[data-testid='meter-peak-hold']")).toBeNull();
    });

    it("renders a peak-hold marker positioned from heldPeakDbfs when showPeakHold is true", () => {
      const { container } = render(
        <Meter levels={[level({ heldPeakDbfs: -12 })]} showPeakHold />,
      );
      const marker = container.querySelector("[data-testid='meter-peak-hold']") as HTMLElement;
      expect(marker).not.toBeNull();
      expect(marker.style.left).toBe(`${dbfsToPercent(-12)}%`);
    });

    it("tracks heldPeakDbfs -- a higher held peak moves the marker further along the bar", () => {
      const { container: lowContainer } = render(
        <Meter levels={[level({ heldPeakDbfs: -30 })]} showPeakHold />,
      );
      const { container: highContainer } = render(
        <Meter levels={[level({ heldPeakDbfs: -6 })]} showPeakHold />,
      );
      const lowMarker = lowContainer.querySelector("[data-testid='meter-peak-hold']") as HTMLElement;
      const highMarker = highContainer.querySelector("[data-testid='meter-peak-hold']") as HTMLElement;

      const lowPercent = parseFloat(lowMarker.style.left);
      const highPercent = parseFloat(highMarker.style.left);
      expect(highPercent).toBeGreaterThan(lowPercent);
    });

    it("positions the peak-hold marker as a bottom-anchored horizontal line in vertical orientation", () => {
      const { container } = render(
        <Meter levels={[level({ heldPeakDbfs: -12 })]} showPeakHold orientation="vertical" />,
      );
      const marker = container.querySelector("[data-testid='meter-peak-hold']") as HTMLElement;
      expect(marker).not.toBeNull();
      expect(marker.style.bottom).toBe(`${dbfsToPercent(-12)}%`);
      expect(marker.style.left).toBe("");
    });

    it("renders one peak-hold marker per bar, each from its own heldPeakDbfs", () => {
      const { container } = render(
        <Meter
          levels={[level({ heldPeakDbfs: -30 }), level({ heldPeakDbfs: -6 })]}
          showPeakHold
        />,
      );
      const markers = container.querySelectorAll("[data-testid='meter-peak-hold']");
      expect(markers).toHaveLength(2);
      expect((markers[0] as HTMLElement).style.left).not.toBe(
        (markers[1] as HTMLElement).style.left,
      );
    });

    it("renders the marker at the very end when heldPeakDbfs reaches the ceiling", () => {
      const { container } = render(
        <Meter levels={[level({ heldPeakDbfs: 6 })]} showPeakHold />,
      );
      const marker = container.querySelector("[data-testid='meter-peak-hold']") as HTMLElement;
      expect(marker).not.toBeNull();
      expect(marker.style.left).toBe("100%");
    });

    it("clamps a peak past the ceiling to the end rather than a clipped-out >100% position", () => {
      const { container } = render(
        <Meter levels={[level({ heldPeakDbfs: 12 })]} showPeakHold />,
      );
      const marker = container.querySelector("[data-testid='meter-peak-hold']") as HTMLElement;
      expect(marker).not.toBeNull();
      expect(marker.style.left).toBe("100%");
    });

    it("keeps a 0 dBFS peak short of the end, so clipping is still visible past it", () => {
      const { container } = render(
        <Meter levels={[level({ heldPeakDbfs: 0 })]} showPeakHold />,
      );
      const marker = container.querySelector("[data-testid='meter-peak-hold']") as HTMLElement;
      expect(marker.style.left).toBe(`${dbfsToPercent(0)}%`);
      expect(parseFloat(marker.style.left)).toBeLessThan(100);
    });

    it("renders no peak-hold marker when heldPeakDbfs is -Infinity (no peak recorded yet)", () => {
      const { container } = render(
        <Meter levels={[level({ heldPeakDbfs: -Infinity })]} showPeakHold />,
      );
      expect(container.querySelector("[data-testid='meter-peak-hold']")).toBeNull();
    });
  });

  it("renders no clip indicator, no target line, and no tick labels -- clip indication and the target line both live outside `scaleDetail` now", () => {
    const { container } = render(
      <Meter levels={[level({ peakDbfs: 3, heldPeakDbfs: 3 })]} />,
    );
    // The two props deleted in DEV-327 (showClipIndicator/isClipped, showTargetLine) rendered
    // these testids; asserting their absence directly (rather than `textContent === ""`,
    // which only happened to pass because `medium`'s ticks are unlabelled) keeps this test
    // from silently drifting if the default `scaleDetail` ever grows labelled ticks.
    expect(container.querySelector("[data-testid='meter-clip-indicator']")).toBeNull();
    expect(container.querySelector("[data-testid='meter-target-line']")).toBeNull();
    expect(container.querySelector("[data-testid='meter-tick-label']")).toBeNull();
  });

  it("drives fill and RMS fill from the shared scale", () => {
    const { container } = render(
      <Meter levels={[level({ peakDbfs: -12, rmsDbfs: -20, heldPeakDbfs: -12 })]} />,
    );
    const fill = container.querySelector("[data-testid='meter-fill']") as HTMLElement;
    const rmsFill = container.querySelector("[data-testid='meter-rms-fill']") as HTMLElement;

    expect(fill.style.width).toBe(`${dbfsToPercent(-12)}%`);
    expect(rmsFill.style.width).toBe(`${dbfsToPercent(-20)}%`);
  });

  it("leaves the over-zone visible: a 0 dBFS peak does not fill the whole bar", () => {
    const { container } = render(<Meter levels={[level({ peakDbfs: 0 })]} />);
    const fill = container.querySelector("[data-testid='meter-fill']") as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeLessThan(100);
    expect(parseFloat(fill.style.width)).toBeCloseTo(86, 5);
  });

  describe("scaleDetail", () => {
    it("renders the three ticks by default", () => {
      const { container } = render(<Meter levels={[level()]} />);
      const ticks = container.querySelectorAll("[data-testid='meter-tick']");
      expect(Array.from(ticks).map((t) => (t as HTMLElement).dataset.dbfs)).toEqual([
        "-24",
        "-6",
        "0",
      ]);
    });

    it("renders no ticks when scaleDetail is 'none'", () => {
      const { container } = render(<Meter levels={[level()]} scaleDetail="none" />);
      expect(container.querySelector("[data-testid='meter-scale']")).toBeNull();
      expect(container.querySelectorAll("[data-testid='meter-tick']")).toHaveLength(0);
    });

    it("renders only the 0 dBFS tick when scaleDetail is 'minimal'", () => {
      const { container } = render(<Meter levels={[level()]} scaleDetail="minimal" />);
      const ticks = container.querySelectorAll("[data-testid='meter-tick']");
      expect(ticks).toHaveLength(1);
      expect((ticks[0] as HTMLElement).dataset.dbfs).toBe("0");
    });

    it("renders the three ticks without labels when scaleDetail is 'medium'", () => {
      const { container } = render(<Meter levels={[level()]} scaleDetail="medium" />);
      expect(container.querySelectorAll("[data-testid='meter-tick']")).toHaveLength(3);
      expect(container.querySelector("[data-testid='meter-tick-label']")).toBeNull();
    });

    it("costs no extra layout below 'full' -- unlabelled ticks live in the bar, not in a row of their own", () => {
      for (const detail of ["minimal", "medium"] as const) {
        const { container } = render(<Meter levels={[level()]} scaleDetail={detail} />);
        expect(container.querySelectorAll("[data-testid='meter-tick']").length).toBeGreaterThan(0);
        expect(container.querySelector("[data-testid='meter-scale']")).toBeNull();
      }
    });

    it("draws every tick inside its bar, so the scale reads over the fill rather than beside it", () => {
      const { container } = render(<Meter levels={[level()]} scaleDetail="medium" />);
      const bar = container.querySelector("[data-testid='meter-bar']") as HTMLElement;
      const ticks = container.querySelectorAll("[data-testid='meter-tick']");
      expect(ticks).toHaveLength(3);
      for (const tick of ticks) {
        expect(bar.contains(tick)).toBe(true);
      }
    });

    it("labels every tick when scaleDetail is 'full'", () => {
      const { container } = render(<Meter levels={[level()]} scaleDetail="full" />);
      const labels = container.querySelectorAll("[data-testid='meter-tick-label']");
      expect(Array.from(labels).map((label) => label.textContent)).toEqual(["-24", "-6", "0"]);
    });

    it("labels the two endpoints without ticking them, in 'full' only", () => {
      const { container } = render(<Meter levels={[level()]} scaleDetail="full" />);
      const endpoints = container.querySelectorAll("[data-testid='meter-scale-endpoint']");
      expect(Array.from(endpoints).map((e) => e.textContent)).toEqual(["-∞", "+6"]);
      // an endpoint is a label, never a tick -- a line there duplicates the bar's own edge
      expect(container.querySelectorAll("[data-testid='meter-tick']")).toHaveLength(3);
    });

    it("renders no endpoint labels below 'full'", () => {
      for (const detail of ["none", "minimal", "medium"] as const) {
        const { container } = render(<Meter levels={[level()]} scaleDetail={detail} />);
        expect(container.querySelector("[data-testid='meter-scale-endpoint']")).toBeNull();
      }
    });

    it("positions ticks with bottom (not left) in vertical orientation", () => {
      const { container } = render(
        <Meter levels={[level()]} scaleDetail="minimal" orientation="vertical" />,
      );
      const tick = container.querySelector("[data-testid='meter-tick']") as HTMLElement;
      expect(tick.style.bottom).not.toBe("");
      expect(tick.style.left).toBe("");
    });

    it("renders the label row exactly once for a multi-bar meter, not once per bar -- L and R share one dB axis", () => {
      const { container } = render(
        <Meter levels={[level(), level()]} scaleDetail="full" />,
      );
      expect(container.querySelectorAll("[data-testid='meter-scale']")).toHaveLength(1);
      expect(container.querySelectorAll("[data-testid='meter-tick-label']")).toHaveLength(3);
      expect(container.querySelectorAll("[data-testid='meter-scale-endpoint']")).toHaveLength(2);
      // The lines themselves are per-bar by construction -- each bar draws its own scale over
      // its own fill -- so a stereo meter carries two full tick sets, one per channel.
      expect(container.querySelectorAll("[data-testid='meter-tick']")).toHaveLength(6);
    });
  });

  describe("showRms", () => {
    it("renders the RMS fill by default (prop omitted)", () => {
      const { container } = render(<Meter levels={[level()]} />);
      expect(container.querySelector("[data-testid='meter-rms-fill']")).not.toBeNull();
    });

    it("renders the RMS fill when showRms is explicitly true", () => {
      const { container } = render(<Meter levels={[level()]} showRms />);
      expect(container.querySelector("[data-testid='meter-rms-fill']")).not.toBeNull();
    });

    it("omits the RMS fill when showRms is false", () => {
      const { container } = render(<Meter levels={[level()]} showRms={false} />);
      expect(container.querySelector("[data-testid='meter-rms-fill']")).toBeNull();
    });

    it("omits the RMS fill for every bar in a multi-channel meter when showRms is false", () => {
      const { container } = render(
        <Meter levels={[level(), level()]} showRms={false} />,
      );
      expect(container.querySelectorAll("[data-testid='meter-rms-fill']")).toHaveLength(0);
      expect(container.querySelectorAll("[data-testid='meter-fill']")).toHaveLength(2);
    });
  });
});
