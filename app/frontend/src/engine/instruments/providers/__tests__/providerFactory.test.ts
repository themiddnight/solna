 
import { describe, expect, it } from "vitest";

import { getAcousticDrumKitConfig } from "../../acoustic-drumset/acousticDrumKits";
import { InstrumentCategory } from "../../shared/constants";
import { getInstrumentDescriptor } from "../../shared/instrumentCatalog";
import type { SampleInstrumentDescriptor } from "../types";
import {
  createInstrumentProvider,
  isSampleInstrumentDescriptor,
} from "../providerFactory";

describe("createInstrumentProvider", () => {
  it("creates the smplr soundfont provider from a melodic descriptor", () => {
    const descriptor = getInstrumentDescriptor("acoustic_grand_piano");

    expect(descriptor?.providerKey).toBe("smplr-soundfont");
    if (!descriptor || !isSampleInstrumentDescriptor(descriptor)) {
      throw new Error("Expected acoustic grand piano to use a sample provider");
    }
    expect(createInstrumentProvider(descriptor)).toBeDefined();
  });

  it("creates the smplr drum-abuse provider with the catalog machine id", () => {
    const descriptor = getInstrumentDescriptor("drumabuse:roland-tr-909");

    expect(descriptor).toMatchObject({
      category: InstrumentCategory.DrumBeat,
      providerKey: "smplr-drum-abuse",
      providerConfig: { machine: "roland-tr-909" },
    });
    if (!descriptor || !isSampleInstrumentDescriptor(descriptor)) {
      throw new Error("Expected DrumAbuse to use a sample provider");
    }
    expect(createInstrumentProvider(descriptor)).toBeDefined();
  });

  it("creates the acoustic drumset provider from the acoustic descriptor", () => {
    const descriptor = getInstrumentDescriptor("versilian_drumset");

    expect(descriptor?.providerKey).toBe("versilian-acoustic-drumset");
    if (!descriptor || !isSampleInstrumentDescriptor(descriptor)) {
      throw new Error("Expected acoustic drumset to use a sample provider");
    }
    expect(createInstrumentProvider(descriptor)).toBeDefined();
  });

  it("sources the acoustic drumset provider key per kit from the kit config", () => {
    const descriptor = getInstrumentDescriptor("versilian_drumset");
    const kit = getAcousticDrumKitConfig("versilian_drumset");

    // The catalog reads providerKey from the kit config — not a hardcoded key.
    expect(descriptor?.providerKey).toBe(kit.providerKey);
    expect(descriptor?.providerConfig).toMatchObject({ kit: "versilian_drumset" });
  });

  it("creates a provider for the reserved SF2 acoustic-kit scaffold slot", () => {
    const descriptor: SampleInstrumentDescriptor = {
      id: "future-sf2-kit",
      label: "Future SF2 Kit",
      category: InstrumentCategory.AcousticDrumset,
      controlType: getInstrumentDescriptor("versilian_drumset")!.controlType,
      providerKey: "sf2-acoustic-drumset",
      providerConfig: {},
      capabilities: { isPercussion: true, supportsSamples: true },
    };

    const provider = createInstrumentProvider(descriptor);
    expect(provider).toBeDefined();
    // Direct-MIDI providers expose no sample names, so the drum engine skips
    // the GM-note↔sample-name remap.
    expect(provider.getAvailableSamples()).toEqual([]);
  });

  it("keeps synth descriptors out of the sample provider factory", () => {
    const descriptor = getInstrumentDescriptor("analog_poly");

    expect(descriptor?.providerKey).toBe("tone-synth");
    expect(isSampleInstrumentDescriptor(descriptor!)).toBe(false);
  });
});
