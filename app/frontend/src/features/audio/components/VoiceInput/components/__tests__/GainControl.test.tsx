import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GainControl } from "../GainControl";
import { dbToSliderPos } from "@/shared/audio/gainUnits";
import { VOICE_INPUT_GAIN_MIN_DB, VOICE_INPUT_GAIN_MAX_DB } from "../../stores/voiceStateStore";

describe("GainControl — dB pass-through, non-linear taper (DEV-307)", () => {
  it("displays the gain prop directly as dB, with no round-trip conversion", () => {
    render(<GainControl gain={6} onGainChange={() => {}} />);
    expect(screen.getByText(/\+6\.0dB|\+6dB/)).toBeInTheDocument();
  });

  it("Fader slider operates on normalized 0..1 positions, not raw dB range", () => {
    render(<GainControl gain={0} onGainChange={() => {}} />);
    const slider = screen.getByRole("slider");
    // Fader maps dB → [0, 1] slider position via non-linear taper
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "1");
  });

  it("onGainChange receives the mapped dB value when the slider position changes", () => {
    const onGainChange = vi.fn((_db: number) => {});
    render(<GainControl gain={0} onGainChange={onGainChange} />);
    const slider = screen.getByRole("slider");

    // -12 dB maps to slider position ~0.6 with piecewise DAW taper
    const targetDb = -12;
    const targetPos = dbToSliderPos(targetDb, VOICE_INPUT_GAIN_MIN_DB, VOICE_INPUT_GAIN_MAX_DB);
    fireEvent.change(slider, { target: { value: String(targetPos) } });

    expect(onGainChange).toHaveBeenCalledTimes(1);
    expect(onGainChange).toHaveBeenCalledWith(expect.closeTo(targetDb, 0));
  });

  it("initial slider position reflects the gain prop through the non-linear taper", () => {
    render(<GainControl gain={-12} onGainChange={() => {}} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    const expectedPos = dbToSliderPos(-12, VOICE_INPUT_GAIN_MIN_DB, VOICE_INPUT_GAIN_MAX_DB);
    expect(parseFloat(slider.value)).toBeCloseTo(expectedPos, 3);
  });
});
