import { SOUNDFONT_INSTRUMENTS } from "../melodic/constants";
import { ACOUSTIC_DRUMSET_INSTRUMENTS } from "../acoustic-drumset/constants";
import { SYNTHESIZER_INSTRUMENTS } from "../synthesizer/constants";
import { PERCUSSION_INSTRUMENTS } from "../percussion/constants";
import {
  DRUM_ABUSE_GROUP_BY_ID,
  STUDIO_HD_GROUP,
  getDrumAbuseMachineId,
  isDrumAbuseInstrumentId,
} from "../drum/constants";
import type { GroupedOption } from "../shared/instrumentCatalog";
import type { Instrument } from "@/shared/types";

// Group soundfont instruments by category
export const groupSoundfontInstruments = (): GroupedOption[] => {
  const groups: Record<string, GroupedOption[]> = {
    Piano: [],
    "Chromatic Percussion": [],
    Organ: [],
    Guitar: [],
    Bass: [],
    Strings: [],
    Ensemble: [],
    Brass: [],
    Reed: [],
    Pipe: [],
    "Synth Lead": [],
    "Synth Pad": [],
    "Synth Effects": [],
    Ethnic: [],
    Percussive: [],
    "Sound Effects": [],
  };

  SOUNDFONT_INSTRUMENTS.forEach((instrument) => {
    // Determine group based on instrument value
    let group = "Other";

    if (
      instrument.value.includes("piano") ||
      instrument.value.includes("harpsichord") ||
      instrument.value.includes("clavinet")
    ) {
      group = "Piano";
    } else if (
      instrument.value.includes("celesta") ||
      instrument.value.includes("glockenspiel") ||
      instrument.value.includes("music_box") ||
      instrument.value.includes("vibraphone") ||
      instrument.value.includes("marimba") ||
      instrument.value.includes("xylophone") ||
      instrument.value.includes("tubular_bells") ||
      instrument.value.includes("dulcimer")
    ) {
      group = "Chromatic Percussion";
    } else if (
      instrument.value.includes("organ") ||
      instrument.value.includes("accordion") ||
      instrument.value.includes("harmonica")
    ) {
      group = "Organ";
    } else if (instrument.value.includes("guitar")) {
      group = "Guitar";
    } else if (instrument.value.includes("bass")) {
      group = "Bass";
    } else if (
      instrument.value.includes("violin") ||
      instrument.value.includes("viola") ||
      instrument.value.includes("cello") ||
      instrument.value.includes("contrabass") ||
      instrument.value.includes("strings") ||
      instrument.value.includes("harp") ||
      instrument.value.includes("timpani")
    ) {
      group = "Strings";
    } else if (
      instrument.value.includes("ensemble") ||
      instrument.value.includes("choir") ||
      instrument.value.includes("voice") ||
      instrument.value.includes("orchestra")
    ) {
      group = "Ensemble";
    } else if (
      instrument.value.includes("trumpet") ||
      instrument.value.includes("trombone") ||
      instrument.value.includes("tuba") ||
      instrument.value.includes("horn") ||
      instrument.value.includes("brass")
    ) {
      group = "Brass";
    } else if (
      instrument.value.includes("sax") ||
      instrument.value.includes("oboe") ||
      instrument.value.includes("bassoon") ||
      instrument.value.includes("clarinet")
    ) {
      group = "Reed";
    } else if (
      instrument.value.includes("piccolo") ||
      instrument.value.includes("flute") ||
      instrument.value.includes("recorder") ||
      instrument.value.includes("pan_flute") ||
      instrument.value.includes("bottle") ||
      instrument.value.includes("shakuhachi") ||
      instrument.value.includes("whistle") ||
      instrument.value.includes("ocarina")
    ) {
      group = "Pipe";
    } else if (instrument.value.includes("lead_")) {
      group = "Synth Lead";
    } else if (instrument.value.includes("pad_")) {
      group = "Synth Pad";
    } else if (instrument.value.includes("fx_")) {
      group = "Synth Effects";
    } else if (
      instrument.value.includes("sitar") ||
      instrument.value.includes("banjo") ||
      instrument.value.includes("shamisen") ||
      instrument.value.includes("koto") ||
      instrument.value.includes("kalimba") ||
      instrument.value.includes("bagpipe") ||
      instrument.value.includes("fiddle") ||
      instrument.value.includes("shanai")
    ) {
      group = "Ethnic";
    } else if (
      instrument.value.includes("bell") ||
      instrument.value.includes("agogo") ||
      instrument.value.includes("steel_drums") ||
      instrument.value.includes("woodblock") ||
      instrument.value.includes("taiko") ||
      instrument.value.includes("tom") ||
      instrument.value.includes("synth_drum") ||
      instrument.value.includes("cymbal")
    ) {
      group = "Percussive";
    } else if (
      instrument.value.includes("noise") ||
      instrument.value.includes("seashore") ||
      instrument.value.includes("bird") ||
      instrument.value.includes("telephone") ||
      instrument.value.includes("helicopter") ||
      instrument.value.includes("applause") ||
      instrument.value.includes("gunshot")
    ) {
      group = "Sound Effects";
    }

    if (groups[group]) {
      const groupOptions = groups[group];
      if (!groupOptions) return;
      groupOptions.push({
        value: instrument.value,
        label: instrument.label,
        group: group,
        ...(instrument.icon !== undefined ? { icon: instrument.icon } : {}),
      });
    }
  });

  // Convert to flat array and filter out empty groups
  return Object.entries(groups)
    .filter(([, instruments]) => instruments.length > 0)
    .flatMap(([, instruments]) => instruments);
};

// Group synthesizer instruments by type
export const groupSynthesizerInstruments = (): GroupedOption[] => {
  const groups: Record<string, GroupedOption[]> = {
    Analog: [],
    FM: [],
  };

  SYNTHESIZER_INSTRUMENTS.forEach((instrument) => {
    const group = instrument.type === "analog" ? "Analog" : "FM";
    const groupOptions = groups[group];
    if (!groupOptions) return;
    groupOptions.push({
      value: instrument.value,
      label: instrument.label,
      group: group,
      ...(instrument.icon !== undefined ? { icon: instrument.icon } : {}),
    });
  });

  return Object.entries(groups)
    .filter(([, instruments]) => instruments.length > 0)
    .flatMap(([, instruments]) => instruments);
};

// Group drum machines by sound character (DEV-294 Phase C): Studio HD
// (the 5 hi-fi DRUM_MACHINES) vs. curated DrumAbuse machines bucketed into
// their character group (Analog & Boomy, Punchy & Dance, Vintage Digital
// 80s, Electronic & Sci-Fi, Lo-Fi & Toy). Group order in the picker follows
// first-seen order, which follows DRUM_BEAT_INSTRUMENTS array order.
export const groupDrumMachines = (
  drumMachines: readonly Instrument[],
): GroupedOption[] => {
  return drumMachines.map((instrument) => {
    const group = isDrumAbuseInstrumentId(instrument.value)
      ? (DRUM_ABUSE_GROUP_BY_ID[getDrumAbuseMachineId(instrument.value)] ??
        "Other")
      : STUDIO_HD_GROUP;
    return {
      value: instrument.value,
      label: instrument.label,
      group,
      ...(instrument.icon !== undefined ? { icon: instrument.icon } : {}),
    };
  });
};

export const groupAcousticDrumsets = (): GroupedOption[] => {
  return ACOUSTIC_DRUMSET_INSTRUMENTS.map((instrument) => ({
    value: instrument.value,
    label: instrument.label,
    group: "Acoustic Kits",
    ...(instrument.icon !== undefined ? { icon: instrument.icon } : {}),
  }));
};

export const groupPercussionSets = (): GroupedOption[] =>
  PERCUSSION_INSTRUMENTS.map((instrument) => ({
    value: instrument.value,
    label: instrument.label,
    group: "Percussion Sets",
    ...(instrument.icon !== undefined ? { icon: instrument.icon } : {}),
  }));

// Get grouped instruments for a specific category
export const getGroupedInstrumentsForCategory = (
  category: string,
  drumMachines: readonly Instrument[],
): GroupedOption[] => {
  switch (category) {
    case "melodic":
      return groupSoundfontInstruments();
    case "drum_beat":
      return groupDrumMachines(drumMachines);
    case "acoustic_drumset":
      return groupAcousticDrumsets();
    case "percussions":
      return groupPercussionSets();
    case "synthesizer":
      return groupSynthesizerInstruments();
    default:
      return groupSoundfontInstruments();
  }
};
