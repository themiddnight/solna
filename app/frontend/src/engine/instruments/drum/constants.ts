import { ControlType } from "@/shared/types";
import type { Instrument } from "@/shared/types";

const DRUM_ABUSE_INSTRUMENT_PREFIX = "drumabuse:";

export const isDrumAbuseInstrumentId = (instrumentId: string): boolean =>
  instrumentId.startsWith(DRUM_ABUSE_INSTRUMENT_PREFIX);

export const getDrumAbuseMachineId = (instrumentId: string): string =>
  instrumentId.slice(DRUM_ABUSE_INSTRUMENT_PREFIX.length);

// Available drum machines from smplr
export const DRUM_MACHINES: Instrument[] = [
  {
    value: "MFB-512",
    label: "Fricke MFB-512",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: "TR-808",
    label: "Roland TR-808",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: "LM-2",
    label: "LinnDrum LM-2",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: "Casio-RZ1",
    label: "Casio RZ-1",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: "Roland CR-8000",
    label: "Roland CR-8000",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
];

export const STUDIO_HD_GROUP = "Studio HD";

// DEV-321: this machine's default (first) DrumAbuse sample set is .aif — a container Chromium's
// decodeAudioData can't decode, so every note plays silently. Pin it to a set that isn't
// (verified against the machine's manifest: set "2" is 52 samples of plain lowercase .wav).
export const DRUM_ABUSE_SET_OVERRIDE_BY_ID: Record<string, string> = {
  "ace-tone-rhythm-ace-fr-1": "2",
};

// Character group for each curated DrumAbuse machine id (DEV-294 Phase C).
// Kept as a separate lookup (not on Instrument) per TR-28 — the shared
// Instrument type stays lean; grouping is a drum-catalog-only concern.
export const DRUM_ABUSE_GROUP_BY_ID: Record<string, string> = {
  // Analog & Boomy (10)
  "roland-cr-78": "Analog & Boomy",
  "ace-tone-rhythm-ace-fr-1": "Analog & Boomy",
  "roland-cr-68": "Analog & Boomy",
  "roland-cr-1000": "Analog & Boomy",
  "roland-tr-606": "Analog & Boomy",
  "korg-minipops-series": "Analog & Boomy",
  "roland-tr-77": "Analog & Boomy",
  "roland-tr-66": "Analog & Boomy",
  "korg-kr-55": "Analog & Boomy",
  "boss-dr-55": "Analog & Boomy",
  // Punchy & Dance (3)
  "roland-tr-909": "Punchy & Dance",
  "roland-tr-707": "Punchy & Dance",
  "roland-tr-505": "Punchy & Dance",
  // Vintage Digital 80s (12)
  "linn-lm-1": "Vintage Digital 80s",
  "linn-9000": "Vintage Digital 80s",
  "oberheim-dmx": "Vintage Digital 80s",
  "oberheim-dx": "Vintage Digital 80s",
  "emu-sp-12": "Vintage Digital 80s",
  "emu-drumulator": "Vintage Digital 80s",
  "sequential-circuits-drumtraks": "Vintage Digital 80s",
  "yamaha-rx-5": "Vintage Digital 80s",
  "korg-ddd-1": "Vintage Digital 80s",
  "korg-ddm-110": "Vintage Digital 80s",
  "korg-kpr-77": "Vintage Digital 80s",
  "boss-dr-110": "Vintage Digital 80s",
  // Electronic & Sci-Fi (8)
  "mattel-electronics-synsonics-pro": "Electronic & Sci-Fi",
  "pollard-syndrum-178": "Electronic & Sci-Fi",
  "star-instruments-synare-3": "Electronic & Sci-Fi",
  "simmons-sds-1000": "Electronic & Sci-Fi",
  "simmons-sds-5": "Electronic & Sci-Fi",
  "simmons-sdx": "Electronic & Sci-Fi",
  "pearl-sc-40": "Electronic & Sci-Fi",
  "simmons-sds-1": "Electronic & Sci-Fi",
  // Lo-Fi & Toy (4)
  "cheetah-spec-drum": "Lo-Fi & Toy",
  "elka-drumstar-80": "Lo-Fi & Toy",
  "casio-sk-1": "Lo-Fi & Toy",
  "casio-vl-1": "Lo-Fi & Toy",
};

// Curated DrumAbuse machines (DEV-294 Phase C), ordered by character group:
// Analog & Boomy -> Punchy & Dance -> Vintage Digital 80s -> Electronic &
// Sci-Fi -> Lo-Fi & Toy (Task C3 relies on this order for group headings).
const DRUM_ABUSE_MACHINES: Instrument[] = [
  // Analog & Boomy
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-cr-78`,
    label: "Roland CR-78",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}ace-tone-rhythm-ace-fr-1`,
    label: "Ace Tone Rhythm Ace FR-1",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-cr-68`,
    label: "Roland CR-68",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-cr-1000`,
    label: "Roland CR-1000",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-tr-606`,
    label: "Roland TR-606",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}korg-minipops-series`,
    label: "Korg Minipops",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-tr-77`,
    label: "Roland TR-77",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-tr-66`,
    label: "Roland TR-66",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}korg-kr-55`,
    label: "Korg KR-55",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}boss-dr-55`,
    label: "Boss DR-55",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  // Punchy & Dance
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-tr-909`,
    label: "Roland TR-909",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-tr-707`,
    label: "Roland TR-707",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}roland-tr-505`,
    label: "Roland TR-505",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  // Vintage Digital 80s
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}linn-lm-1`,
    label: "Linn LM-1",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}linn-9000`,
    label: "Linn 9000",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}oberheim-dmx`,
    label: "Oberheim DMX",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}oberheim-dx`,
    label: "Oberheim DX",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}emu-sp-12`,
    label: "E-mu SP-12",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}emu-drumulator`,
    label: "E-mu Drumulator",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}sequential-circuits-drumtraks`,
    label: "Sequential Circuits Drumtraks",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}yamaha-rx-5`,
    label: "Yamaha RX-5",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}korg-ddd-1`,
    label: "Korg DDD-1",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}korg-ddm-110`,
    label: "Korg DDM-110",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}korg-kpr-77`,
    label: "Korg KPR-77",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}boss-dr-110`,
    label: "Boss DR-110",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  // Electronic & Sci-Fi
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}mattel-electronics-synsonics-pro`,
    label: "Mattel Synsonics Pro",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}pollard-syndrum-178`,
    label: "Pollard Syndrum 178",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}star-instruments-synare-3`,
    label: "Star Instruments Synare 3",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}simmons-sds-1000`,
    label: "Simmons SDS-1000",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}simmons-sds-5`,
    label: "Simmons SDS-5",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}simmons-sdx`,
    label: "Simmons SDX",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}pearl-sc-40`,
    label: "Pearl SC-40",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}simmons-sds-1`,
    label: "Simmons SDS-1",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  // Lo-Fi & Toy
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}cheetah-spec-drum`,
    label: "Cheetah Spec Drum",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}elka-drumstar-80`,
    label: "Elka Drumstar 80",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}casio-sk-1`,
    label: "Casio SK-1",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
  {
    value: `${DRUM_ABUSE_INSTRUMENT_PREFIX}casio-vl-1`,
    label: "Casio VL-1",
    defaultControlType: ControlType.Drumpad,
    icon: "grid",
  },
];

export const DRUM_BEAT_INSTRUMENTS: Instrument[] = [
  ...DRUM_MACHINES,
  ...DRUM_ABUSE_MACHINES,
];
