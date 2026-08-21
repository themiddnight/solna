import { ControlType } from "@/shared/types";

import type { PercussionRegion, PercussionSetConfig } from "./types";

export type { PercussionSetConfig } from "./types";

/**
 * Data-driven configuration for the percussion sets (DEV-283).
 *
 * A set is added by adding a config entry here — no engine or factory logic
 * changes. Each set declares the VCSL sample list + GM note → region mapping
 * it needs. This module only defines the config shape + the first real set
 * (Congas & Bongos); wiring into the catalog/provider-factory happens in a
 * later task.
 */

const CONGA_INSTRUMENT = "Membranophones/Struck Membranophones/Conga";
const BONGOS_INSTRUMENT = "Membranophones/Struck Membranophones/Bongos";

/**
 * Conga/Bongos are not in the existing acoustic drum kit, so there is no
 * prior articulation-accurate note to reuse. Per the VCSL note-selection
 * guidance, default to note 60 (middle C) for every articulation.
 *
 * OWNER BY-EAR FLAG: all five pads below currently trigger the same sample
 * (note 60) within their instrument — hi/low bongo and mute/open/low conga
 * are NOT yet differentiated by distinct sample-map notes. Verify against
 * the real VCSL sfz note ranges and adjust per-articulation notes by ear.
 */
const HI_BONGO: PercussionRegion = { instrument: BONGOS_INSTRUMENT, note: 60, label: "Bongo Hi" };
const LOW_BONGO: PercussionRegion = {
  instrument: BONGOS_INSTRUMENT,
  note: 60,
  label: "Bongo Low",
};
const MUTE_HI_CONGA: PercussionRegion = {
  instrument: CONGA_INSTRUMENT,
  note: 60,
  label: "Conga Mute",
};
const OPEN_HI_CONGA: PercussionRegion = {
  instrument: CONGA_INSTRUMENT,
  note: 60,
  label: "Conga Open",
};
const LOW_CONGA: PercussionRegion = { instrument: CONGA_INSTRUMENT, note: 60, label: "Conga Low" };

export const CONGAS_BONGOS_SET: PercussionSetConfig = {
  id: "percussion_congas_bongos",
  label: "Congas & Bongos",
  icon: "drum",
  controlType: ControlType.Drumpad,
  providerKey: "versilian-percussion",
  gmNoteToRegion: {
    60: HI_BONGO,
    61: LOW_BONGO,
    62: MUTE_HI_CONGA,
    63: OPEN_HI_CONGA,
    64: LOW_CONGA,
  },
};

/*
 * ---------------------------------------------------------------------------
 * World Hand Drums
 * ---------------------------------------------------------------------------
 * Cajon, Darbuka, Frame Drum, Ocean Drum, Slit Drum have no standard General
 * MIDI percussion assignment (GM percussion only covers notes 35-81, plus the
 * GM2 extension 82-87 — none of these five instruments are in either range).
 * Keys 90-94 are an internal, non-GM extended slot block chosen for this set
 * only (each set's `gmNoteToRegion` is independent — no cross-set collision).
 *
 * OWNER BY-EAR FLAG: every pad below defaults to note 60 (middle C) per the
 * VCSL note-selection guidance — none of these instruments overlap the
 * existing acoustic drum kit, so there is no prior articulation-accurate note
 * to reuse. Verify against the real VCSL sfz note ranges by ear.
 */
const CAJON_INSTRUMENT = "Idiophones/Struck Idiophones/Cajon";
const DARBUKA_INSTRUMENT = "Membranophones/Struck Membranophones/Darbuka";
const FRAME_DRUM_INSTRUMENT = "Membranophones/Struck Membranophones/Frame Drum";
const OCEAN_DRUM_INSTRUMENT = "Membranophones/Other Membranophones/Ocean Drum";
const SLIT_DRUM_INSTRUMENT = "Idiophones/Struck Idiophones/Slit Drum";

const CAJON: PercussionRegion = { instrument: CAJON_INSTRUMENT, note: 60, label: "Cajon" };
const DARBUKA: PercussionRegion = { instrument: DARBUKA_INSTRUMENT, note: 60, label: "Darbuka" };
const FRAME_DRUM: PercussionRegion = {
  instrument: FRAME_DRUM_INSTRUMENT,
  note: 60,
  label: "Frame Drum",
};
const OCEAN_DRUM: PercussionRegion = {
  instrument: OCEAN_DRUM_INSTRUMENT,
  note: 60,
  label: "Ocean Drum",
};
const SLIT_DRUM: PercussionRegion = {
  instrument: SLIT_DRUM_INSTRUMENT,
  note: 60,
  label: "Slit Drum",
};

export const WORLD_HAND_DRUMS_SET: PercussionSetConfig = {
  id: "percussion_world_hand_drums",
  label: "World Hand Drums",
  icon: "drum",
  controlType: ControlType.Drumpad,
  providerKey: "versilian-percussion",
  gmNoteToRegion: {
    90: CAJON,
    91: DARBUKA,
    92: FRAME_DRUM,
    93: OCEAN_DRUM,
    94: SLIT_DRUM,
  },
};

/*
 * ---------------------------------------------------------------------------
 * Small Hand Perc
 * ---------------------------------------------------------------------------
 * Uses real GM percussion / GM2-extension notes where one exists (54, 56, 58,
 * 67-70, 73-77, 80-83); Finger Cymbals has no GM/GM2 assignment at all, so it
 * gets key 95 (an internal extended slot, distinct from the World Hand Drums
 * 90-94 block purely for readability — no actual collision risk since each
 * set's `gmNoteToRegion` is independent).
 *
 * This set is claves(75)'s home — DEV-284 Phase B removes claves from the
 * acoustic drum kit once this set exists (see module doc + DEV-283 notes).
 *
 * Maracas has no VCSL source; per DEV-283 notes it is substituted with the
 * Shaker (Small = GM 70's slot, Large = GM2 82's shaker slot).
 *
 * OWNER BY-EAR FLAG: paired articulations that share one VCSL instrument
 * across two GM keys (Agogo Bells 67/68, Guiro 73/74, Woodblock 76/77,
 * Triangles 80/81) currently trigger the SAME sample (note 60) for both GM
 * keys — not yet differentiated by distinct sample-map notes. Verify against
 * the real VCSL sfz note ranges and adjust per-articulation notes by ear.
 */
const CLAVES_INSTRUMENT = "Idiophones/Struck Idiophones/Claves";
const WOODBLOCK_INSTRUMENT = "Idiophones/Struck Idiophones/Woodblock";
const COWBELLS_INSTRUMENT = "Idiophones/Struck Idiophones/Cowbells";
const AGOGO_BELLS_INSTRUMENT = "Idiophones/Struck Idiophones/Agogo Bells";
const GUIRO_INSTRUMENT = "Idiophones/Struck Idiophones/Guiro";
const CABASA_INSTRUMENT = "Idiophones/Struck Idiophones/Cabasa";
const SHAKER_SMALL_INSTRUMENT = "Idiophones/Struck Idiophones/Shaker, Small";
const SHAKER_LARGE_INSTRUMENT = "Idiophones/Struck Idiophones/Shaker, Large";
const VIBRASLAP_INSTRUMENT = "Idiophones/Struck Idiophones/Vibraslap";
const TAMBOURINE_INSTRUMENT = "Idiophones/Struck Idiophones/Tambourine 1";
const TRIANGLES_INSTRUMENT = "Idiophones/Struck Idiophones/Triangles";
const SLEIGH_BELLS_INSTRUMENT = "Idiophones/Struck Idiophones/Sleigh Bells";
const FINGER_CYMBALS_INSTRUMENT = "Idiophones/Struck Idiophones/Finger Cymbals";

const CLAVES: PercussionRegion = { instrument: CLAVES_INSTRUMENT, note: 60, label: "Claves" };
const WOODBLOCK_HI: PercussionRegion = {
  instrument: WOODBLOCK_INSTRUMENT,
  note: 60,
  label: "Woodblock Hi",
};
const WOODBLOCK_LOW: PercussionRegion = {
  instrument: WOODBLOCK_INSTRUMENT,
  note: 60,
  label: "Woodblock Low",
};
const COWBELLS: PercussionRegion = { instrument: COWBELLS_INSTRUMENT, note: 62, label: "Cowbell" };
const AGOGO_HI: PercussionRegion = {
  instrument: AGOGO_BELLS_INSTRUMENT,
  note: 60,
  label: "Agogo Hi",
};
const AGOGO_LOW: PercussionRegion = {
  instrument: AGOGO_BELLS_INSTRUMENT,
  note: 60,
  label: "Agogo Low",
};
const GUIRO_SHORT: PercussionRegion = {
  instrument: GUIRO_INSTRUMENT,
  note: 60,
  label: "Guiro Short",
};
const GUIRO_LONG: PercussionRegion = {
  instrument: GUIRO_INSTRUMENT,
  note: 60,
  label: "Guiro Long",
};
const CABASA: PercussionRegion = { instrument: CABASA_INSTRUMENT, note: 60, label: "Cabasa" };
const SHAKER_SMALL: PercussionRegion = {
  instrument: SHAKER_SMALL_INSTRUMENT,
  note: 60,
  label: "Shaker S",
};
const SHAKER_LARGE: PercussionRegion = {
  instrument: SHAKER_LARGE_INSTRUMENT,
  note: 60,
  label: "Shaker L",
};
const VIBRASLAP: PercussionRegion = {
  instrument: VIBRASLAP_INSTRUMENT,
  note: 60,
  label: "Vibraslap",
};
const TAMBOURINE: PercussionRegion = {
  instrument: TAMBOURINE_INSTRUMENT,
  note: 60,
  label: "Tambourine",
};
const TRIANGLE_MUTE: PercussionRegion = {
  instrument: TRIANGLES_INSTRUMENT,
  note: 60,
  label: "Triangle Mute",
};
const TRIANGLE_OPEN: PercussionRegion = {
  instrument: TRIANGLES_INSTRUMENT,
  note: 60,
  label: "Triangle Open",
};
const SLEIGH_BELLS: PercussionRegion = {
  instrument: SLEIGH_BELLS_INSTRUMENT,
  note: 60,
  label: "Sleigh Bells",
};
const FINGER_CYMBALS: PercussionRegion = {
  instrument: FINGER_CYMBALS_INSTRUMENT,
  note: 60,
  label: "Finger Cymbals",
};

export const SMALL_HAND_PERC_SET: PercussionSetConfig = {
  id: "percussion_small_hand_perc",
  label: "Small Hand Perc",
  icon: "drum",
  controlType: ControlType.Drumpad,
  providerKey: "versilian-percussion",
  gmNoteToRegion: {
    54: TAMBOURINE,
    56: COWBELLS,
    58: VIBRASLAP,
    67: AGOGO_HI,
    68: AGOGO_LOW,
    69: CABASA,
    70: SHAKER_SMALL,
    73: GUIRO_SHORT,
    74: GUIRO_LONG,
    75: CLAVES,
    76: WOODBLOCK_HI,
    77: WOODBLOCK_LOW,
    80: TRIANGLE_MUTE,
    81: TRIANGLE_OPEN,
    82: SHAKER_LARGE,
    83: SLEIGH_BELLS,
    95: FINGER_CYMBALS,
  },
};

/*
 * ---------------------------------------------------------------------------
 * Orchestral / Concert
 * ---------------------------------------------------------------------------
 * Only Bell Tree has a standard assignment (GM2 extension note 84). The rest
 * of these concert/orchestral effects have no GM or GM2 assignment at all, so
 * they get an internal extended slot block (100-113), distinct from the
 * World Hand Drums / Small Hand Perc blocks purely for readability — no
 * actual collision risk since each set's `gmNoteToRegion` is independent.
 *
 * Suspended Cymbal 1/2 reuse the exact notes the existing acoustic drum kit
 * already uses for crash(68)/ride(66) on the same VCSL instruments (see
 * `acousticDrumKits.ts` VERSILIAN_PIECE_REGIONS). Clash Cymbals 1 reuses the
 * kit's note 60 (its "crash" GM-52 region). All other pads default to note
 * 60 per the VCSL note-selection guidance (OWNER BY-EAR verification item).
 */
const GONG_1_INSTRUMENT = "Idiophones/Struck Idiophones/Gong 1";
const GONG_2_INSTRUMENT = "Idiophones/Struck Idiophones/Gong 2";
const ANVIL_INSTRUMENT = "Idiophones/Struck Idiophones/Anvil";
const BRAKE_DRUM_INSTRUMENT = "Idiophones/Struck Idiophones/Brake Drum";
const CLASH_CYMBALS_1_INSTRUMENT = "Idiophones/Struck Idiophones/Clash Cymbals 1";
const CLASH_CYMBALS_2_INSTRUMENT = "Idiophones/Struck Idiophones/Clash Cymbals 2";
const SUSPENDED_CYMBAL_1_INSTRUMENT = "Idiophones/Struck Idiophones/Suspended Cymbal 1";
const SUSPENDED_CYMBAL_2_INSTRUMENT = "Idiophones/Struck Idiophones/Suspended Cymbal 2";
const RATCHET_INSTRUMENT = "Idiophones/Struck Idiophones/Ratchet";
const SLAPSTICK_INSTRUMENT = "Idiophones/Struck Idiophones/Slapstick";
const FLEXATONE_INSTRUMENT = "Idiophones/Struck Idiophones/Flexatone";
const MARK_TREES_INSTRUMENT = "Idiophones/Struck Idiophones/Mark Trees";
const BELL_TREE_INSTRUMENT = "Idiophones/Struck Idiophones/Bell Tree - Stroke";
const HAND_BELLS_INSTRUMENT = "Idiophones/Struck Idiophones/Hand Bells, Nepalese";
const HAND_CHIMES_INSTRUMENT = "Idiophones/Struck Idiophones/Hand Chimes";

const GONG_1: PercussionRegion = { instrument: GONG_1_INSTRUMENT, note: 60, label: "Gong 1" };
const GONG_2: PercussionRegion = { instrument: GONG_2_INSTRUMENT, note: 60, label: "Gong 2" };
const ANVIL: PercussionRegion = { instrument: ANVIL_INSTRUMENT, note: 60, label: "Anvil" };
const BRAKE_DRUM: PercussionRegion = {
  instrument: BRAKE_DRUM_INSTRUMENT,
  note: 60,
  label: "Brake Drum",
};
const CLASH_CYMBALS_1: PercussionRegion = {
  instrument: CLASH_CYMBALS_1_INSTRUMENT,
  note: 60,
  label: "Clash Cym 1",
};
const CLASH_CYMBALS_2: PercussionRegion = {
  instrument: CLASH_CYMBALS_2_INSTRUMENT,
  note: 60,
  label: "Clash Cym 2",
};
const SUSPENDED_CYMBAL_1: PercussionRegion = {
  instrument: SUSPENDED_CYMBAL_1_INSTRUMENT,
  note: 68,
  label: "Susp Cym 1",
};
const SUSPENDED_CYMBAL_2: PercussionRegion = {
  instrument: SUSPENDED_CYMBAL_2_INSTRUMENT,
  note: 66,
  label: "Susp Cym 2",
};
const RATCHET: PercussionRegion = { instrument: RATCHET_INSTRUMENT, note: 60, label: "Ratchet" };
const SLAPSTICK: PercussionRegion = {
  instrument: SLAPSTICK_INSTRUMENT,
  note: 60,
  label: "Slapstick",
};
const FLEXATONE: PercussionRegion = {
  instrument: FLEXATONE_INSTRUMENT,
  note: 60,
  label: "Flexatone",
};
const MARK_TREES: PercussionRegion = {
  instrument: MARK_TREES_INSTRUMENT,
  note: 60,
  label: "Mark Trees",
};
const BELL_TREE: PercussionRegion = {
  instrument: BELL_TREE_INSTRUMENT,
  note: 60,
  label: "Bell Tree",
};
const HAND_BELLS: PercussionRegion = {
  instrument: HAND_BELLS_INSTRUMENT,
  note: 60,
  label: "Hand Bells",
};
const HAND_CHIMES: PercussionRegion = {
  instrument: HAND_CHIMES_INSTRUMENT,
  note: 60,
  label: "Hand Chimes",
};

export const ORCHESTRAL_PERC_SET: PercussionSetConfig = {
  id: "percussion_orchestral",
  label: "Orchestral",
  icon: "drum",
  controlType: ControlType.Drumpad,
  providerKey: "versilian-percussion",
  gmNoteToRegion: {
    84: BELL_TREE,
    100: GONG_1,
    101: GONG_2,
    102: ANVIL,
    103: BRAKE_DRUM,
    104: CLASH_CYMBALS_1,
    105: CLASH_CYMBALS_2,
    106: SUSPENDED_CYMBAL_1,
    107: SUSPENDED_CYMBAL_2,
    108: RATCHET,
    109: SLAPSTICK,
    110: FLEXATONE,
    111: MARK_TREES,
    112: HAND_BELLS,
    113: HAND_CHIMES,
  },
};

/*
 * Timbale, Whistle, Cuica are confirmed ABSENT from the VCSL manifest (see
 * `.superpowers/sdd/2026-07-29-drum-percussion-catalog-reorg/vcsl-percussion-paths.md`)
 * — they are intentionally omitted from every set above rather than faked.
 */

/**
 * Registry of every percussion set, keyed by id.
 */
export const PERCUSSION_SETS: Record<string, PercussionSetConfig> = {
  [CONGAS_BONGOS_SET.id]: CONGAS_BONGOS_SET,
  [WORLD_HAND_DRUMS_SET.id]: WORLD_HAND_DRUMS_SET,
  [SMALL_HAND_PERC_SET.id]: SMALL_HAND_PERC_SET,
  [ORCHESTRAL_PERC_SET.id]: ORCHESTRAL_PERC_SET,
};

export const DEFAULT_PERCUSSION_SET_ID = CONGAS_BONGOS_SET.id;

/** Resolve a percussion set config by id, falling back to the default set. */
export const getPercussionSetConfig = (id: string): PercussionSetConfig =>
  PERCUSSION_SETS[id] ?? CONGAS_BONGOS_SET;

/**
 * The de-duplicated list of VCSL instruments a percussion set needs. The
 * provider loads exactly these — only the selected set's samples are fetched.
 */
export const getPercussionSetInstruments = (set: PercussionSetConfig): string[] => [
  ...new Set(Object.values(set.gmNoteToRegion).map((region) => region.instrument)),
];
