import { describe, expect, it, vi } from "vitest";

import { DrumEngine } from "@/engine/instruments/drum/DrumEngine";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import type {
  InstrumentProvider,
  InstrumentProviderPlayOptions,
} from "@/engine/instruments/providers/types";

/**
 * A provider that plays by direct MIDI note returns [] from
 * getAvailableSamples(). The drum engine must then skip its GM-note↔sample-name
 * remap and forward the raw note straight through.
 */
describe("DrumEngine direct-MIDI provider (empty getAvailableSamples)", () => {
  it("forwards the raw note when the provider reports no sample names", () => {
    const play = vi.fn(
      (_options: InstrumentProviderPlayOptions) => () => undefined,
    );
    const provider: Pick<
      InstrumentProvider,
      "play" | "getAvailableSamples"
    > = {
      play,
      getAvailableSamples: () => [],
    };

    const engine = new DrumEngine({
      userId: "u",
      username: "n",
      instrumentName: "direct-midi-kit",
      category: InstrumentCategory.AcousticDrumset,
    });
    // @ts-expect-error test seam: inject a loaded direct-MIDI provider
    engine.provider = provider;
    // @ts-expect-error test seam: mark the engine loaded
    engine.isLoaded = true;
    // @ts-expect-error test seam: inject audio context
    engine.audioContext = { currentTime: 0 };

    expect(engine.getAvailableSamples()).toEqual([]);

    engine.playNote({ note: 38, velocity: 0.8 });

    expect(play).toHaveBeenCalledTimes(1);
    // No remap happened — the GM note 38 is forwarded as-is, not swapped for a
    // resolved sample name.
    expect(play.mock.calls[0]![0]).toMatchObject({ note: "38" });
  });
});
