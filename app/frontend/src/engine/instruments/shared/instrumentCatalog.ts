import type { Instrument } from "@/shared/types";

import { getAcousticDrumKitConfig } from "../acoustic-drumset/acousticDrumKits";
import { ACOUSTIC_DRUMSET_INSTRUMENTS } from "../acoustic-drumset/constants";
import {
  DRUM_ABUSE_SET_OVERRIDE_BY_ID,
  DRUM_BEAT_INSTRUMENTS,
  getDrumAbuseMachineId,
  isDrumAbuseInstrumentId,
} from "../drum/constants";
import { SOUNDFONT_INSTRUMENTS } from "../melodic/constants";
import { PERCUSSION_INSTRUMENTS } from "../percussion/constants";
import { getPercussionSetConfig } from "../percussion/percussionSets";
import { SYNTHESIZER_INSTRUMENTS } from "../synthesizer/constants";
import type { InstrumentDescriptor } from "../providers";
import { InstrumentCategory } from "./constants";
import {
  groupAcousticDrumsets,
  groupDrumMachines,
  groupPercussionSets,
  groupSoundfontInstruments,
  groupSynthesizerInstruments,
} from "../utils/instrumentGrouping";

export interface GroupedOption {
  value: string;
  label: string;
  group: string;
  icon?: string;
}

export type InstrumentCatalog = Readonly<Record<InstrumentCategory, readonly Instrument[]>>;
export type GroupedInstrumentCatalog = Readonly<Record<InstrumentCategory, readonly GroupedOption[]>>;
export type InstrumentDescriptorCatalog = Readonly<Record<string, InstrumentDescriptor>>;

const INSTRUMENT_CATALOG: InstrumentCatalog = {
  [InstrumentCategory.Melodic]: SOUNDFONT_INSTRUMENTS,
  [InstrumentCategory.DrumBeat]: DRUM_BEAT_INSTRUMENTS,
  [InstrumentCategory.AcousticDrumset]: ACOUSTIC_DRUMSET_INSTRUMENTS,
  [InstrumentCategory.Percussions]: PERCUSSION_INSTRUMENTS,
  [InstrumentCategory.Synthesizer]: SYNTHESIZER_INSTRUMENTS,
};

export const GROUPED_INSTRUMENT_CATALOG: GroupedInstrumentCatalog = {
  [InstrumentCategory.Melodic]: groupSoundfontInstruments(),
  [InstrumentCategory.DrumBeat]: groupDrumMachines(INSTRUMENT_CATALOG[InstrumentCategory.DrumBeat]),
  [InstrumentCategory.AcousticDrumset]: groupAcousticDrumsets(),
  [InstrumentCategory.Percussions]: groupPercussionSets(),
  [InstrumentCategory.Synthesizer]: groupSynthesizerInstruments(),
};

const toDescriptor = (
  category: InstrumentCategory,
  instrument: Instrument,
): InstrumentDescriptor => {
  if (category === InstrumentCategory.Melodic) {
    return {
      id: instrument.value,
      label: instrument.label,
      category,
      controlType: instrument.defaultControlType,
      providerKey: "smplr-soundfont",
      providerConfig: { instrument: instrument.value },
      capabilities: { supportsSustain: true },
    };
  }

  if (category === InstrumentCategory.DrumBeat) {
    const isDrumAbuse = isDrumAbuseInstrumentId(instrument.value);
    const drumAbuseMachineId = isDrumAbuse ? getDrumAbuseMachineId(instrument.value) : undefined;
    const setOverride = drumAbuseMachineId ? DRUM_ABUSE_SET_OVERRIDE_BY_ID[drumAbuseMachineId] : undefined;
    return {
      id: instrument.value,
      label: instrument.label,
      category,
      controlType: instrument.defaultControlType,
      providerKey: isDrumAbuse ? "smplr-drum-abuse" : "smplr-drum-machine",
      providerConfig: drumAbuseMachineId
        ? { machine: drumAbuseMachineId, ...(setOverride ? { set: setOverride } : {}) }
        : { instrument: instrument.value },
      capabilities: { isPercussion: true, supportsSamples: true },
    };
  }

  if (category === InstrumentCategory.AcousticDrumset) {
    // providerKey is selected PER KIT from the kit config — adding a kit backed
    // by a different sample source needs no change here.
    const kit = getAcousticDrumKitConfig(instrument.value);
    return {
      id: instrument.value,
      label: instrument.label,
      category,
      controlType: instrument.defaultControlType,
      providerKey: kit.providerKey,
      providerConfig: { kit: instrument.value },
      capabilities: { isPercussion: true, supportsSamples: true },
    };
  }

  if (category === InstrumentCategory.Percussions) {
    // providerKey is selected PER SET from the set config — currently always
    // "versilian-percussion", but stays data-driven for future providers.
    const set = getPercussionSetConfig(instrument.value);
    return {
      id: instrument.value,
      label: instrument.label,
      category,
      controlType: instrument.defaultControlType,
      providerKey: set.providerKey,
      providerConfig: { set: instrument.value },
      capabilities: { isPercussion: true, supportsSamples: true },
    };
  }

  return {
    id: instrument.value,
    label: instrument.label,
    category,
    controlType: instrument.defaultControlType,
    providerKey: "tone-synth",
    providerConfig: { synthId: instrument.value },
    capabilities: { supportsSustain: true, supportsSynthParams: true },
  };
};

const INSTRUMENT_DESCRIPTORS: InstrumentDescriptorCatalog = Object.freeze(
  Object.fromEntries(
    Object.entries(INSTRUMENT_CATALOG).flatMap(([category, instruments]) =>
      instruments.map((instrument) => {
        const descriptor = toDescriptor(category as InstrumentCategory, instrument);
        return [descriptor.id, descriptor];
      }),
    ),
  ),
);

export const getDefaultInstrumentForCategoryFromCatalog = (
  category: InstrumentCategory,
): string => {
  return INSTRUMENT_CATALOG[category][0]?.value ?? "";
};

export const getInstrumentDescriptor = (
  instrumentId: string,
): InstrumentDescriptor | null => INSTRUMENT_DESCRIPTORS[instrumentId] ?? null;

/** Every instrument in the catalog, across all categories — consumed by the calibration
 * harness (DEV-311) to batch-render/measure the full instrument list and by its CI locking
 * test to confirm none are missing a committed trim entry. */
export const getAllInstrumentDescriptors = (): readonly InstrumentDescriptor[] =>
  Object.values(INSTRUMENT_DESCRIPTORS);

export const getInstrumentControlTypeFromCatalog = (
  instrumentId: string,
) => getInstrumentDescriptor(instrumentId)?.controlType ?? null;

export const findInstrumentInCatalog = (instrumentId: string): {
  category: InstrumentCategory;
  instrument: Instrument;
} | null => {
  for (const [category, instruments] of Object.entries(INSTRUMENT_CATALOG)) {
    const instrument = instruments.find((candidate) => candidate.value === instrumentId);
    if (instrument) {
      return {
        category: category as InstrumentCategory,
        instrument,
      };
    }
  }

  return null;
};
