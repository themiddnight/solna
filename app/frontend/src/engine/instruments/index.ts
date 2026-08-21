/**
 * Instrument engine core barrel — "how sound is made" (Web-Audio / Tone.js
 * instrument engines + providers), extracted from `features/instruments` as
 * part of the room/engine re-layering.
 */

// Note event contract (shared by all engines)
export type { NoteEvent, NoteStopEvent } from "./noteEvent";

// Shared engine base + config/state types
export { BaseInstrumentEngine } from "./shared/BaseInstrumentEngine";
export type {
  SynthState,
  InstrumentEngineConfig,
  InstrumentEngine,
} from "./shared/types";
export {
  DRUM_BEAT_INSTRUMENTS,
  SYNTHESIZER_INSTRUMENTS,
  InstrumentCategory,
  isDrumpadCategory,
  getInstrumentIcon,
} from "./shared/constants";
export {
  PICK_UP_VELOCITY_MULTIPLIER,
  STRUM_UP_VELOCITY_MULTIPLIER,
  HYBRID_CHORD_VELOCITY_MULTIPLIER,
  BASS_PICK_UP_VELOCITY_MULTIPLIER,
  HAMMER_ON_VELOCITY_MULTIPLIER,
  PULL_OFF_VELOCITY_MULTIPLIER,
  HAMMER_ON_WINDOW_MS,
  VELOCITY_STEP,
  MIN_VELOCITY,
  MAX_VELOCITY,
  INSTRUMENT_DEFAULTS,
  DEFAULT_VELOCITY_BOUNDS,
  DEFAULT_OCTAVE_BOUNDS,
  BASS_OCTAVE_BOUNDS,
  BASS_VELOCITY_BOUNDS,
} from "./shared/constants/instrumentSettings";
export type {
  GroupedOption,
  InstrumentCatalog,
  GroupedInstrumentCatalog,
  InstrumentDescriptorCatalog,
} from "./shared/instrumentCatalog";
export {
  GROUPED_INSTRUMENT_CATALOG,
  getDefaultInstrumentForCategoryFromCatalog,
  getInstrumentDescriptor,
  getInstrumentControlTypeFromCatalog,
  findInstrumentInCatalog,
} from "./shared/instrumentCatalog";
export { createEngine } from "./shared/engineFactory";

// Concrete engines
export { MelodicEngine } from "./melodic/MelodicEngine";
export { SOUNDFONT_INSTRUMENTS } from "./melodic/constants";
export { DrumEngine } from "./drum/DrumEngine";
export {
  isDrumAbuseInstrumentId,
  getDrumAbuseMachineId,
  DRUM_MACHINES,
} from "./drum/constants";
export { SynthEngine } from "./synthesizer/SynthEngine";
export { SynthParamManager } from "./synthesizer/SynthParamManager";
export { Arpeggiator } from "./synthesizer/utils/Arpeggiator";
export type { ArpMode } from "./synthesizer/utils/Arpeggiator";
export { AcousticDrumEngine } from "./acoustic-drumset/AcousticDrumEngine";
export { VersilianAcousticDrumProvider } from "./acoustic-drumset/VersilianAcousticDrumProvider";
export {
  mapGmNoteToAcousticDrumPiece,
  getRepresentativeGmNoteForPiece,
} from "./acoustic-drumset/acousticDrumMapping";
export {
  DEFAULT_ACOUSTIC_DRUMSET_ID,
  ACOUSTIC_DRUMSET_INSTRUMENTS,
} from "./acoustic-drumset/constants";
export type {
  AcousticDrumPiece,
  DrumHit,
  DrumKitProvider,
} from "./acoustic-drumset/types";

// Sample providers
export * from "./providers";

// Engine-level utilities
export { InstrumentEnginePool } from "./utils/InstrumentEnginePool";
export {
  groupSoundfontInstruments,
  groupSynthesizerInstruments,
  groupDrumMachines,
  groupAcousticDrumsets,
  getGroupedInstrumentsForCategory,
} from "./utils/instrumentGrouping";
export {
  getInstrumentCategoryById,
  getInstrumentLabelById,
  getDefaultInstrumentForCategory,
} from "./utils/instrumentLookup";
