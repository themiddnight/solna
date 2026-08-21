export type EffectType =
  | "reverb" | "delay" | "filter" | "compressor" | "autofilter"
  | "autopanner" | "autowah" | "bitcrusher" | "chorus" | "distortion"
  | "phaser" | "pingpongdelay" | "stereowidener" | "tremolo"
  | "vibrato" | "graphiceq" | "autotune" | "vocoder" | "ducker" | "vocoderext";

/** Enum-style accessor so former `EffectType.REVERB` (enum) call sites migrate mechanically. */
export const EFFECT_TYPE = {
  REVERB: "reverb", DELAY: "delay", FILTER: "filter", COMPRESSOR: "compressor",
  AUTOFILTER: "autofilter", AUTOPANNER: "autopanner", AUTOWAH: "autowah",
  BITCRUSHER: "bitcrusher", CHORUS: "chorus", DISTORTION: "distortion",
  PHASER: "phaser", PINGPONGDELAY: "pingpongdelay", STEREOWIDENER: "stereowidener",
  TREMOLO: "tremolo", VIBRATO: "vibrato", GRAPHICEQ: "graphiceq",
  AUTOTUNE: "autotune", VOCODER: "vocoder", DUCKER: "ducker", VOCODEREXT: "vocoderext",
} as const satisfies Record<string, EffectType>;
