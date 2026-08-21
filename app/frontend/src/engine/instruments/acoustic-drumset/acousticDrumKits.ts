import { ControlType } from "@/shared/types";
import type { IconName } from "@/shared/ui/icon/registry";

import type { SampleInstrumentProviderKey } from "../providers/types";
import type { AcousticDrumPiece } from "./types";

/**
 * Data-driven configuration for the acoustic drum / percussion sets (DEV-282).
 *
 * A kit is added by adding a config entry here — no engine or factory logic
 * changes. Each kit declares:
 *   - which provider backs it (`providerKey`), selected PER KIT, and
 *   - the sample list + GM/piece → region mapping for that kit.
 *
 * The `providerKey` is the extension slot: a future external sample source
 * (SF2 bank, custom pack) plugs in by adding a new provider key + factory case
 * + provider class, then declaring a kit config with that key — without
 * touching the catalog or the drum engines. See `Sf2DrumKitConfig` for the
 * reserved scaffold shape.
 */

/** Canonical, ordered list of acoustic drum pieces (single source of truth). */
export const ACOUSTIC_DRUM_PIECES: readonly AcousticDrumPiece[] = [
  "kick",
  "snare",
  "clap",
  "hihatClosed",
  "hihatOpen",
  "tomLow",
  "tomMid",
  "tomHigh",
  "crash",
  "ride",
  "tambourine",
  "cowbell",
];

/** Provider keys that can back an acoustic drum kit. */
export type AcousticDrumProviderKey = Extract<
  SampleInstrumentProviderKey,
  "versilian-acoustic-drumset" | "sf2-acoustic-drumset"
>;

/** A single playable Versilian region: which VCSL instrument + SFZ note. */
export type VersilianDrumRegion = {
  piece: AcousticDrumPiece;
  instrument: string;
  note: number;
};

interface AcousticDrumKitBase {
  id: string;
  label: string;
  icon: IconName;
  controlType: ControlType;
  providerKey: AcousticDrumProviderKey;
}

/** Kit backed by the Versilian VCSL sample library. */
export interface VersilianDrumKitConfig extends AcousticDrumKitBase {
  providerKey: "versilian-acoustic-drumset";
  /** Fallback region per piece when a GM note has no dedicated mapping. */
  pieceRegions: Record<AcousticDrumPiece, VersilianDrumRegion>;
  /** GM percussion note → dedicated Versilian region (articulation-accurate). */
  gmNoteToRegion: Record<number, VersilianDrumRegion>;
}

/**
 * Reserved scaffold for a future SF2 (SoundFont) backed kit (DEV-283/DEV-284).
 * No kit instance uses this yet — it exists so the config union, catalog, and
 * factory already accommodate a second sample source without a rewrite.
 */
export interface Sf2DrumKitConfig extends AcousticDrumKitBase {
  providerKey: "sf2-acoustic-drumset";
  /** URL to the .sf2 bank (no bank hosted yet — scaffold only). */
  soundfontUrl: string;
  /** GM percussion note → SF2 preset note (direct-MIDI playback). */
  gmNoteToPreset: Record<number, number>;
}

export type AcousticDrumKitConfig = VersilianDrumKitConfig | Sf2DrumKitConfig;

export const DEFAULT_ACOUSTIC_DRUMSET_ID = "versilian_drumset";

const VERSILIAN_PIECE_REGIONS: Record<AcousticDrumPiece, VersilianDrumRegion> = {
  kick: {
    piece: "kick",
    instrument: "Membranophones/Struck Membranophones/Bass Drum 1",
    note: 60,
  },
  snare: {
    piece: "snare",
    instrument: "Membranophones/Struck Membranophones/Snare Drum, Modern 1",
    note: 61,
  },
  clap: { piece: "clap", instrument: "Idiophones/Struck Idiophones/Claps", note: 60 },
  hihatClosed: {
    piece: "hihatClosed",
    instrument: "Idiophones/Struck Idiophones/Hi-Hat Cymbal",
    note: 42,
  },
  hihatOpen: {
    piece: "hihatOpen",
    instrument: "Idiophones/Struck Idiophones/Hi-Hat Cymbal",
    note: 46,
  },
  tomLow: {
    piece: "tomLow",
    instrument: "Membranophones/Struck Membranophones/Tom 2",
    note: 62,
  },
  tomMid: {
    piece: "tomMid",
    instrument: "Membranophones/Struck Membranophones/Tom 2",
    note: 62,
  },
  tomHigh: {
    piece: "tomHigh",
    instrument: "Membranophones/Struck Membranophones/Tom 1",
    note: 64,
  },
  crash: {
    piece: "crash",
    instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 1",
    note: 68,
  },
  ride: {
    piece: "ride",
    instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 2",
    note: 66,
  },
  tambourine: {
    piece: "tambourine",
    instrument: "Idiophones/Struck Idiophones/Tambourine 1",
    note: 60,
  },
  cowbell: {
    piece: "cowbell",
    instrument: "Idiophones/Struck Idiophones/Cowbells",
    note: 62,
  },
};

const VERSILIAN_GM_NOTE_TO_REGION: Record<number, VersilianDrumRegion> = {
  35: {
    piece: "kick",
    instrument: "Membranophones/Struck Membranophones/Bass Drum 2",
    note: 62,
  },
  36: {
    piece: "kick",
    instrument: "Membranophones/Struck Membranophones/Bass Drum 1",
    note: 60,
  },
  // GM 37 (side-stick) has no dedicated VCSL rimshot source — best-effort
  // substitute using Snare Modern 3. Real-grade kit is a deferred SF2
  // follow-up (see `sf2-acoustic-drumset` scaffold, DEV-282).
  37: {
    piece: "snare",
    instrument: "Membranophones/Struck Membranophones/Snare Drum, Modern 3",
    note: 62,
  },
  38: {
    piece: "snare",
    instrument: "Membranophones/Struck Membranophones/Snare Drum, Modern 1",
    note: 61,
  },
  39: {
    piece: "clap",
    instrument: "Idiophones/Struck Idiophones/Claps",
    note: 60,
  },
  40: {
    piece: "snare",
    instrument: "Membranophones/Struck Membranophones/Snare Drum, Modern 2",
    note: 61,
  },
  41: {
    piece: "tomLow",
    instrument: "Membranophones/Struck Membranophones/Tom 2",
    note: 62,
  },
  42: {
    piece: "hihatClosed",
    instrument: "Idiophones/Struck Idiophones/Hi-Hat Cymbal",
    note: 42,
  },
  43: {
    piece: "tomLow",
    instrument: "Membranophones/Struck Membranophones/Tom 2",
    note: 64,
  },
  44: {
    piece: "hihatClosed",
    instrument: "Idiophones/Struck Idiophones/Hi-Hat Cymbal",
    note: 44,
  },
  45: {
    piece: "tomLow",
    instrument: "Membranophones/Struck Membranophones/Tom 2",
    note: 64,
  },
  46: {
    piece: "hihatOpen",
    instrument: "Idiophones/Struck Idiophones/Hi-Hat Cymbal",
    note: 46,
  },
  47: {
    piece: "tomMid",
    instrument: "Membranophones/Struck Membranophones/Tom 1",
    note: 62,
  },
  48: {
    piece: "tomMid",
    instrument: "Membranophones/Struck Membranophones/Tom 1",
    note: 62,
  },
  49: {
    piece: "crash",
    instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 1",
    note: 68,
  },
  50: {
    piece: "tomHigh",
    instrument: "Membranophones/Struck Membranophones/Tom 1",
    note: 64,
  },
  // GM 51 (ride) — VCSL has no dedicated ride source; best-effort substitute
  // using Suspended Cymbal 2 (real-grade kit deferred to SF2 follow-up).
  51: {
    piece: "ride",
    instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 2",
    note: 66,
  },
  // GM 52 (china) — VCSL has no dedicated china source; best-effort
  // substitute using Clash Cymbals 1 (real-grade kit deferred to SF2
  // follow-up).
  52: {
    piece: "crash",
    instrument: "Idiophones/Struck Idiophones/Clash Cymbals 1",
    note: 60,
  },
  // GM 53 (ride bell) — same Suspended Cymbal 2 substitute as GM 51/59.
  53: {
    piece: "ride",
    instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 2",
    note: 67,
  },
  54: {
    piece: "tambourine",
    instrument: "Idiophones/Struck Idiophones/Tambourine 1",
    note: 60,
  },
  // GM 55 (splash) — VCSL has no dedicated splash source; best-effort
  // substitute using Clash Cymbals 1, same as GM 52.
  55: {
    piece: "crash",
    instrument: "Idiophones/Struck Idiophones/Clash Cymbals 1",
    note: 61,
  },
  56: {
    piece: "cowbell",
    instrument: "Idiophones/Struck Idiophones/Cowbells",
    note: 62,
  },
  57: {
    piece: "crash",
    instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 2",
    note: 66,
  },
  // GM 59 (ride cymbal 2) — same Suspended Cymbal 2 substitute as GM 51/53.
  59: {
    piece: "ride",
    instrument: "Idiophones/Struck Idiophones/Suspended Cymbal 2",
    note: 68,
  },
};

export const VERSILIAN_DRUMSET_KIT: VersilianDrumKitConfig = {
  id: DEFAULT_ACOUSTIC_DRUMSET_ID,
  label: "Versilian Drumset",
  icon: "drum",
  controlType: ControlType.Drumpad,
  providerKey: "versilian-acoustic-drumset",
  pieceRegions: VERSILIAN_PIECE_REGIONS,
  gmNoteToRegion: VERSILIAN_GM_NOTE_TO_REGION,
};

/**
 * Registry of every acoustic drum kit, keyed by id. Add a kit by adding an
 * entry here (and, for a new sample source, a provider — see module doc).
 */
export const ACOUSTIC_DRUM_KITS: Record<string, AcousticDrumKitConfig> = {
  [VERSILIAN_DRUMSET_KIT.id]: VERSILIAN_DRUMSET_KIT,
};

/** Resolve a kit config by id, falling back to the default kit. */
export const getAcousticDrumKitConfig = (id: string): AcousticDrumKitConfig =>
  ACOUSTIC_DRUM_KITS[id] ?? VERSILIAN_DRUMSET_KIT;

/** Resolve a kit id to a Versilian kit config, asserting the source. */
export const getVersilianDrumKit = (id: string): VersilianDrumKitConfig => {
  const kit = getAcousticDrumKitConfig(id);
  if (kit.providerKey !== "versilian-acoustic-drumset") {
    throw new Error(
      `Acoustic drum kit "${id}" is not backed by the Versilian provider`,
    );
  }
  return kit;
};

/**
 * The de-duplicated list of VCSL instruments a Versilian kit needs. The
 * provider loads exactly these — only the selected kit's samples are fetched.
 */
export const getVersilianKitInstruments = (
  kit: VersilianDrumKitConfig,
): string[] => [
  ...new Set([
    ...ACOUSTIC_DRUM_PIECES.map((piece) => kit.pieceRegions[piece].instrument),
    ...Object.values(kit.gmNoteToRegion).map((region) => region.instrument),
  ]),
];
