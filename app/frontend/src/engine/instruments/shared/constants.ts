import { DRUM_BEAT_INSTRUMENTS } from "../drum/constants";
import { SYNTHESIZER_INSTRUMENTS } from "../synthesizer/constants";
import { SOUNDFONT_INSTRUMENTS } from "../melodic/constants";
import { ACOUSTIC_DRUMSET_INSTRUMENTS } from "../acoustic-drumset/constants";
import type { IconName } from "@/shared/ui/icon/registry";

export {
  DRUM_BEAT_INSTRUMENTS,
  SYNTHESIZER_INSTRUMENTS,
};

// Instrument categories
export enum InstrumentCategory {
  Melodic = "melodic",
  DrumBeat = "drum_beat",
  AcousticDrumset = "acoustic_drumset",
  Percussions = "percussions",
  Synthesizer = "synthesizer",
}

export const isDrumpadCategory = (category: InstrumentCategory | string): boolean =>
  category === InstrumentCategory.DrumBeat ||
  category === InstrumentCategory.AcousticDrumset ||
  category === InstrumentCategory.Percussions;

// ----------------------------------------------------------------------------
// Non-synth instrument pre-gain (DEV-301)
// ----------------------------------------------------------------------------
// Lives here (not `synthesizer/constants.ts`, where `DEFAULT_SYNTH_GAIN_DB` lives) because this
// file is already the shared constants module every instrument engine imports (see
// `InstrumentCategory` above, consumed by `BaseInstrumentEngine`) — importing a gain constant
// from the synth-specific module into Drum/Melodic/AcousticDrum/Percussion engines would create
// a needless cross-family dependency within the engine tier (TR-38).

/** Pre-gain default, in dB (0 = unity/untouched), for non-synth instrument engines. */
export const DEFAULT_INSTRUMENT_GAIN_DB = 0;

/** Minimum pre-gain trim, in dB, for non-synth instrument engines. */
export const INSTRUMENT_GAIN_MIN_DB = -24;

/** Maximum pre-gain trim, in dB, for non-synth instrument engines. */
export const INSTRUMENT_GAIN_MAX_DB = 24;

// Helper function to get instrument icon
export const getInstrumentIcon = (instrumentValue: string): IconName => {
  // Check all instrument arrays for the matching value
  const allInstruments = [
    ...DRUM_BEAT_INSTRUMENTS,
    ...ACOUSTIC_DRUMSET_INSTRUMENTS,
    ...SYNTHESIZER_INSTRUMENTS,
    ...SOUNDFONT_INSTRUMENTS,
  ];

  const instrument = allInstruments.find(
    (inst) => inst.value === instrumentValue,
  );
  return instrument?.icon ?? "piano"; // Default to piano icon if not found
};
