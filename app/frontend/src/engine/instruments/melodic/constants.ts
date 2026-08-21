import { ControlType } from "@/shared/types";
import type { Instrument } from "@/shared/types";

// List of available soundfont instruments
export const SOUNDFONT_INSTRUMENTS: Instrument[] = [
  // Piano
  {
    value: "acoustic_grand_piano",
    label: "Acoustic Grand Piano",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "bright_acoustic_piano",
    label: "Bright Acoustic Piano",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "electric_grand_piano",
    label: "Electric Grand Piano",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "honkytonk_piano",
    label: "Honky-tonk Piano",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "electric_piano_1",
    label: "Electric Piano 1",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "electric_piano_2",
    label: "Electric Piano 2",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "harpsichord",
    label: "Harpsichord",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "clavinet",
    label: "Clavinet",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },

  // Chromatic Percussion
  {
    value: "celesta",
    label: "Celesta",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "glockenspiel",
    label: "Glockenspiel",
    defaultControlType: ControlType.Keyboard,
    icon: "music",
  },
  {
    value: "music_box",
    label: "Music Box",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "vibraphone",
    label: "Vibraphone",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "marimba",
    label: "Marimba",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "xylophone",
    label: "Xylophone",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "tubular_bells",
    label: "Tubular Bells",
    defaultControlType: ControlType.Keyboard,
    icon: "bell",
  },
  {
    value: "dulcimer",
    label: "Dulcimer",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },

  // Organ
  {
    value: "drawbar_organ",
    label: "Drawbar Organ",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "percussive_organ",
    label: "Percussive Organ",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "rock_organ",
    label: "Rock Organ",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "church_organ",
    label: "Church Organ",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "reed_organ",
    label: "Reed Organ",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "accordion",
    label: "Accordion",
    defaultControlType: ControlType.Keyboard,
    icon: "music",
  },
  {
    value: "harmonica",
    label: "Harmonica",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "tango_accordion",
    label: "Tango Accordion",
    defaultControlType: ControlType.Keyboard,
    icon: "music",
  },

  // Guitar
  {
    value: "acoustic_guitar_nylon",
    label: "Acoustic Guitar (Nylon)",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },
  {
    value: "acoustic_guitar_steel",
    label: "Acoustic Guitar (Steel)",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },
  {
    value: "electric_guitar_jazz",
    label: "Electric Guitar (Jazz)",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },
  {
    value: "electric_guitar_clean",
    label: "Electric Guitar (Clean)",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },
  {
    value: "electric_guitar_muted",
    label: "Electric Guitar (Muted)",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },
  {
    value: "overdriven_guitar",
    label: "Overdriven Guitar",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },
  {
    value: "distortion_guitar",
    label: "Distortion Guitar",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },
  {
    value: "guitar_harmonics",
    label: "Guitar Harmonics",
    defaultControlType: ControlType.Guitar,
    icon: "guitar-electric",
  },

  // Bass
  {
    value: "acoustic_bass",
    label: "Acoustic Bass",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },
  {
    value: "electric_bass_finger",
    label: "Electric Bass (Finger)",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },
  {
    value: "electric_bass_pick",
    label: "Electric Bass (Pick)",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },
  {
    value: "fretless_bass",
    label: "Fretless Bass",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },
  {
    value: "slap_bass_1",
    label: "Slap Bass 1",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },
  {
    value: "slap_bass_2",
    label: "Slap Bass 2",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },
  {
    value: "synth_bass_1",
    label: "Synth Bass 1",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },
  {
    value: "synth_bass_2",
    label: "Synth Bass 2",
    defaultControlType: ControlType.Bass,
    icon: "guitar-electric",
  },

  // Strings
  {
    value: "violin",
    label: "Violin",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "viola",
    label: "Viola",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "cello",
    label: "Cello",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "contrabass",
    label: "Contrabass",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "tremolo_strings",
    label: "Tremolo Strings",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "pizzicato_strings",
    label: "Pizzicato Strings",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "orchestral_harp",
    label: "Orchestral Harp",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "timpani",
    label: "Timpani",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },

  // Ensemble
  {
    value: "string_ensemble_1",
    label: "String Ensemble 1",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "string_ensemble_2",
    label: "String Ensemble 2",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "synth_strings_1",
    label: "Synth Strings 1",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "synth_strings_2",
    label: "Synth Strings 2",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "choir_aahs",
    label: "Choir Aahs",
    defaultControlType: ControlType.Keyboard,
    icon: "microphone-variant",
  },
  {
    value: "voice_oohs",
    label: "Voice Oohs",
    defaultControlType: ControlType.Keyboard,
    icon: "microphone-variant",
  },
  {
    value: "synth_choir",
    label: "Synth Choir",
    defaultControlType: ControlType.Keyboard,
    icon: "microphone-variant",
  },
  {
    value: "orchestra_hit",
    label: "Orchestra Hit",
    defaultControlType: ControlType.Keyboard,
    icon: "music",
  },

  // Brass
  {
    value: "trumpet",
    label: "Trumpet",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },
  {
    value: "trombone",
    label: "Trombone",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },
  {
    value: "tuba",
    label: "Tuba",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },
  {
    value: "muted_trumpet",
    label: "Muted Trumpet",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },
  {
    value: "french_horn",
    label: "French Horn",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },
  {
    value: "brass_section",
    label: "Brass Section",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },
  {
    value: "synth_brass_1",
    label: "Synth Brass 1",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },
  {
    value: "synth_brass_2",
    label: "Synth Brass 2",
    defaultControlType: ControlType.Keyboard,
    icon: "trumpet",
  },

  // Reed
  {
    value: "soprano_sax",
    label: "Soprano Sax",
    defaultControlType: ControlType.Keyboard,
    icon: "saxophone",
  },
  {
    value: "alto_sax",
    label: "Alto Sax",
    defaultControlType: ControlType.Keyboard,
    icon: "saxophone",
  },
  {
    value: "tenor_sax",
    label: "Tenor Sax",
    defaultControlType: ControlType.Keyboard,
    icon: "saxophone",
  },
  {
    value: "baritone_sax",
    label: "Baritone Sax",
    defaultControlType: ControlType.Keyboard,
    icon: "saxophone",
  },
  {
    value: "oboe",
    label: "Oboe",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "english_horn",
    label: "English Horn",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "bassoon",
    label: "Bassoon",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "clarinet",
    label: "Clarinet",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },

  // Pipe
  {
    value: "piccolo",
    label: "Piccolo",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "flute",
    label: "Flute",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "recorder",
    label: "Recorder",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "pan_flute",
    label: "Pan Flute",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "blown_bottle",
    label: "Blown Bottle",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "shakuhachi",
    label: "Shakuhachi",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "whistle",
    label: "Whistle",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "ocarina",
    label: "Ocarina",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },

  // Synth Lead
  {
    value: "lead_1_square",
    label: "Lead 1 (Square)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "lead_2_sawtooth",
    label: "Lead 2 (Sawtooth)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "lead_3_calliope",
    label: "Lead 3 (Calliope)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "lead_4_chiff",
    label: "Lead 4 (Chiff)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "lead_5_charang",
    label: "Lead 5 (Charang)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "lead_6_voice",
    label: "Lead 6 (Voice)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "lead_7_fifths",
    label: "Lead 7 (Fifths)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "lead_8_bass__lead",
    label: "Lead 8 (Bass + Lead)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },

  // Synth Pad
  {
    value: "pad_1_new_age",
    label: "Pad 1 (New Age)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "pad_2_warm",
    label: "Pad 2 (Warm)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "pad_3_polysynth",
    label: "Pad 3 (Polysynth)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "pad_4_choir",
    label: "Pad 4 (Choir)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "pad_5_bowed",
    label: "Pad 5 (Bowed)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "pad_6_metallic",
    label: "Pad 6 (Metallic)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "pad_7_halo",
    label: "Pad 7 (Halo)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "pad_8_sweep",
    label: "Pad 8 (Sweep)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },

  // Synth Effects
  {
    value: "fx_1_rain",
    label: "FX 1 (Rain)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "fx_2_soundtrack",
    label: "FX 2 (Soundtrack)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "fx_3_crystal",
    label: "FX 3 (Crystal)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "fx_4_atmosphere",
    label: "FX 4 (Atmosphere)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "fx_5_brightness",
    label: "FX 5 (Brightness)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "fx_6_goblins",
    label: "FX 6 (Goblins)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "fx_7_echoes",
    label: "FX 7 (Echoes)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "fx_8_scifi",
    label: "FX 8 (Sci-Fi)",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },

  // Ethnic
  {
    value: "sitar",
    label: "Sitar",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "banjo",
    label: "Banjo",
    defaultControlType: ControlType.Keyboard,
    icon: "music",
  },
  {
    value: "shamisen",
    label: "Shamisen",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "koto",
    label: "Koto",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "kalimba",
    label: "Kalimba",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "bagpipe",
    label: "Bagpipe",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },
  {
    value: "fiddle",
    label: "Fiddle",
    defaultControlType: ControlType.Keyboard,
    icon: "violin",
  },
  {
    value: "shanai",
    label: "Shanai",
    defaultControlType: ControlType.Keyboard,
    icon: "music-note",
  },

  // Percussive
  {
    value: "tinkle_bell",
    label: "Tinkle Bell",
    defaultControlType: ControlType.Keyboard,
    icon: "bell",
  },
  {
    value: "agogo",
    label: "Agogo",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },
  {
    value: "steel_drums",
    label: "Steel Drums",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },
  {
    value: "woodblock",
    label: "Woodblock",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },
  {
    value: "taiko_drum",
    label: "Taiko Drum",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },
  {
    value: "melodic_tom",
    label: "Melodic Tom",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },
  {
    value: "synth_drum",
    label: "Synth Drum",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },
  {
    value: "reverse_cymbal",
    label: "Reverse Cymbal",
    defaultControlType: ControlType.Keyboard,
    icon: "drum",
  },

  // Sound Effects
  {
    value: "guitar_fret_noise",
    label: "Guitar Fret Noise",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "breath_noise",
    label: "Breath Noise",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
  {
    value: "seashore",
    label: "Seashore",
    defaultControlType: ControlType.Keyboard,
    icon: "waves",
  },
  {
    value: "bird_tweet",
    label: "Bird Tweet",
    defaultControlType: ControlType.Keyboard,
    icon: "bird",
  },
  {
    value: "telephone_ring",
    label: "Telephone Ring",
    defaultControlType: ControlType.Keyboard,
    icon: "phone-classic",
  },
  {
    value: "helicopter",
    label: "Helicopter",
    defaultControlType: ControlType.Keyboard,
    icon: "helicopter",
  },
  {
    value: "applause",
    label: "Applause",
    defaultControlType: ControlType.Keyboard,
    icon: "hand-clap",
  },
  {
    value: "gunshot",
    label: "Gunshot",
    defaultControlType: ControlType.Keyboard,
    icon: "piano",
  },
];


