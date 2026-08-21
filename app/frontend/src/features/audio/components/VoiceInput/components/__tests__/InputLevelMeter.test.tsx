import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MeterLevel } from "@/features/audio/hooks/useMeterLevel";
import type * as UseMeterLevelModule from "@/features/audio/hooks/useMeterLevel";
import { meterColorForZone } from "@/features/audio/components/Meter/meterColor";
import { classifyZone } from "@/shared/audio/meterZones";

// Shared mock state referenced inside vi.mock() factories must go through vi.hoisted() --
// factories are hoisted above normal module-scope `let`/`const` declarations (same convention as
// useMasterMeter.test.ts).
const mocks = vi.hoisted(() => ({
  useMeterLevelMock: vi.fn(),
}));

vi.mock("@/features/audio/hooks/useMeterLevel", async () => {
  const actual = await vi.importActual<typeof UseMeterLevelModule>(
    "@/features/audio/hooks/useMeterLevel",
  );
  return { ...actual, useMeterLevel: mocks.useMeterLevelMock };
});

import { InputLevelMeter } from "../InputLevelMeter";

const SILENT: MeterLevel = {
  peakDbfs: -Infinity,
  rmsDbfs: -Infinity,
  heldPeakDbfs: -Infinity,
};
// -3 dBFS: >= ZONE_GOOD_MAX (-6) and < ZONE_HOT_MAX (-1) -> "hot" zone.
const HOT_LEVEL: MeterLevel = { peakDbfs: -3, rmsDbfs: -10, heldPeakDbfs: -3 };

const fakeAnalyser = { fftSize: 2048 } as unknown as AnalyserNode;

describe("InputLevelMeter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMeterLevelMock.mockReturnValue(SILENT);
  });

  it("renders the fill color from meterColorForZone for the current peak, not a discrete threshold class", () => {
    mocks.useMeterLevelMock.mockReturnValue(HOT_LEVEL);

    const { container } = render(
      <InputLevelMeter analyser={fakeAnalyser} isConnected isMuted={false} />,
    );

    const fill = container.querySelector("[data-testid='meter-fill']");
    expect(fill).not.toBeNull();
    expect((fill as HTMLElement).style.backgroundColor).toBe(
      meterColorForZone(classifyZone(HOT_LEVEL.peakDbfs)),
    );
    // Old discrete-threshold Tailwind classes must be gone.
    expect(fill?.className).not.toMatch(/bg-green-500|bg-yellow-500|bg-red-500|bg-gray-400/);
  });

  it("calls useMeterLevel with the given analyser and tier 'track'", () => {
    render(<InputLevelMeter analyser={fakeAnalyser} isConnected isMuted={false} />);

    expect(mocks.useMeterLevelMock).toHaveBeenCalledWith(fakeAnalyser, { tier: "track" });
  });

  it("reads as the tooQuiet zone color when the analyser is null (nothing connected)", () => {
    const { container } = render(
      <InputLevelMeter analyser={null} isConnected={false} isMuted={false} />,
    );

    const fill = container.querySelector("[data-testid='meter-fill']");
    expect((fill as HTMLElement).style.backgroundColor).toBe(
      meterColorForZone(classifyZone(SILENT.peakDbfs)),
    );
  });

  // Regression test: the analyser taps the effects chain UPSTREAM of the muted
  // MediaStreamTrack (see useAudioStream.ts's graph: effectsOutputNode -> analyser ->
  // destination); useVoiceControls.ts mutes a downstream track on `destination.stream`, a
  // separate object. Muting does NOT propagate upstream through the Web Audio graph, so the
  // analyser keeps reading live signal the entire time the user is muted. Without an explicit
  // isMuted override, this would render a live "hot" color while muted -- a real, permanent
  // display bug, not a one-frame flash.
  it("forces the silent/tooQuiet color while muted, even when the analyser reports a hot level", () => {
    mocks.useMeterLevelMock.mockReturnValue(HOT_LEVEL);

    const { container } = render(
      <InputLevelMeter analyser={fakeAnalyser} isConnected isMuted={true} />,
    );

    const fill = container.querySelector("[data-testid='meter-fill']");
    expect((fill as HTMLElement).style.backgroundColor).toBe(
      meterColorForZone(classifyZone(SILENT.peakDbfs)),
    );
    expect((fill as HTMLElement).style.backgroundColor).not.toBe(
      meterColorForZone(classifyZone(HOT_LEVEL.peakDbfs)),
    );
  });
});
