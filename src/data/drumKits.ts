/**
 * The drum-kit library: 13 kits, each a `Partial<DrumKit>` laid over
 * DEFAULT_DRUM_KIT by `mergeDrumKit` in audio/drumKits.ts.
 *
 * Kit NAMES are the persisted key (`loop.soundKit`), so renaming one is a
 * project-file change, not a cosmetic edit. `check:drums` asserts that the 13
 * stay audibly distinct — a kit that merely differs on paper is not a kit.
 */
/**
 * The kit's voice roster, in trigger order. ONE list: both drum-kit test files
 * and `check:drums` import it, and `drumKits.test.ts` asserts it is the same
 * set as `keyof DrumKit`. That assertion, not this constant, is what makes
 * adding a voice to the interface and forgetting the list impossible.
 *
 * It is NOT the grid row roster or the sequencer track roster. A grid may omit
 * a voice and may carry a row no kit plays, so those lists are different sets
 * and are declared where they are used.
 */
export const DRUM_TYPES = ['kick', 'snare', 'rimshot', 'clap', 'hihat', 'openhat', 'hitom', 'lowtom', 'ride', 'crash', 'bell'] as const;

export type DrumType = (typeof DRUM_TYPES)[number];

export interface KickParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
  clickFreq?: number;
  clickLevel?: number;
  clickDecay?: number;
  /** Level into the drum reverb send, 0..1. The BODY only — the click stays dry. */
  reverbSend: number;
}

export interface SnareParams {
  bodyFreqStart: number;
  bodyFreqEnd: number;
  bodyTime: number;
  bodyDecay: number;
  bodyGain: number;
  /**
   * The second tonal partial. An acoustic snare's (0,1) head mode produces a
   * PAIR near 180 and 330 Hz, and the 808/909/SH-101 patches all use two
   * oscillators for it; one triangle cannot. It is also what makes `rimshot`
   * a preset over this same block rather than a third synthesis path.
   */
  bodyFreqStart2: number;
  bodyFreqEnd2: number;
  bodyGain2: number;
  noiseFilter: number;
  noiseDecay: number;
  noiseGain: number;
  reverbSend: number;
}

export interface HatParams {
  /** Highpass corner, Hz. LOWER passes MORE — it is a floor, not a colour. */
  filter: number;
  /** Lowpass corner, Hz. With `filter` it makes the hat a band rather than a floor. */
  topCut: number;
  decay: number;
  gain: number;
  /**
   * 0..1 crossfade between the metallic oscillator bank and the noise burst.
   * 0 is pure noise (what every kit sounded like before slice 4), 1 is pure
   * bank. Per kit, not per voice: one constant would give all thirteen kits
   * the same bank-to-noise balance and reinstate the hat collapse one level up.
   */
  metal: number;
}

export interface ClapParams {
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
}

export interface TomParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
  /** Level into the drum reverb send, 0..1. */
  reverbSend: number;
}

export interface CrashParams {
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
  /** See HatParams.metal. */
  metal: number;
}

export interface RideParams {
  tone: number;        // bank fundamental, 120-150 Hz: a bigger plate rings lower
  ping: number;        // 0..1 crossfade, 1 = all ping, 0 = all wash
  pingFilter: number;  // ping band centre, 3.5-5 kHz
  pingDecay: number;   // 0.09-0.16 s
  washFilter: number;  // wash band centre, 7-9 kHz
  washDecay: number;   // 1.2-2.5 s
  bodyFilter: number;  // the 300-600 Hz body band
  metal: number;       // 0..1 bank vs noise, per ruling R5
  gain: number;
  reverbSend: number;
}

export interface BellParams {
  freq1: number;       // 800 Hz (808 cowbell) .. 1700 Hz (ride bell)
  freq2: number;       // freq1 / 1.481 - a detuned fifth, so the two beat
  filter: number;      // bandpass centre, ~1.1x freq1
  decay: number;
  gain: number;
  reverbSend: number;  // the ride bell's wash tail lives here
}

export interface DrumKit {
  kick: KickParams;
  snare: SnareParams;
  rimshot: SnareParams;
  clap: ClapParams;
  hihat: HatParams;
  openhat: HatParams;
  hitom: TomParams;
  lowtom: TomParams;
  ride: RideParams;
  crash: CrashParams;
  bell: BellParams;
}

// DEFAULT_DRUM_KIT follows the canonical voice order (decision 1) because it
// mirrors the DrumKit interface directly. The thirteen named kits below do
// NOT: decision 1 names five lists this order governs and DRUM_KITS is not
// one of them, so their key order is left as historical and untouched.
export const DEFAULT_DRUM_KIT: DrumKit = {
  kick: { freqStart: 150, freqEnd: 35, pitchTime: 0.03, decay: 0.35, gain: 0.9, reverbSend: 0.15 },
  snare: { bodyFreqStart: 220, bodyFreqEnd: 195, bodyTime: 0.02, bodyDecay: 0.15, bodyGain: 0.5, bodyFreqStart2: 407, bodyFreqEnd2: 361, bodyGain2: 0.3, noiseFilter: 1000, noiseDecay: 0.22, noiseGain: 0.6, reverbSend: 0.3 },
  rimshot: { bodyFreqStart: 455, bodyFreqEnd: 440, bodyTime: 0.006, bodyDecay: 0.09, bodyGain: 0.45, bodyFreqStart2: 1667, bodyFreqEnd2: 1600, bodyGain2: 0.55, noiseFilter: 3000, noiseDecay: 0.03, noiseGain: 0.15, reverbSend: 0.25 },
  clap: { filter: 1200, decay: 0.2, gain: 0.5, reverbSend: 0.3 },
  hihat: { filter: 7500, topCut: 16000, decay: 0.05, gain: 0.36, metal: 0.5 },
  openhat: { filter: 6500, topCut: 16000, decay: 0.35, gain: 0.4, metal: 0.5 },
  hitom: { freqStart: 176, freqEnd: 130, pitchTime: 0.1, decay: 0.15, gain: 0.7, reverbSend: 0.25 },
  lowtom: { freqStart: 88, freqEnd: 65, pitchTime: 0.14, decay: 0.28, gain: 0.7, reverbSend: 0.25 },
  ride: { tone: 135, ping: 0.55, pingFilter: 4200, pingDecay: 0.12, washFilter: 8000, washDecay: 1.8, bodyFilter: 450, metal: 0.5, gain: 0.34, reverbSend: 0.35 },
  crash: { filter: 5500, decay: 0.9, gain: 0.5, reverbSend: 0.4, metal: 0.55 },
  bell: { freq1: 800, freq2: 540, filter: 880, decay: 0.4, gain: 0.3, reverbSend: 0.3 },
};

/**
 * What a kit is modelled on. Same discipline as DrumGrid.provenance:
 * 'authored' is an honest answer and an allowlisted one; never invent a
 * source to get off that list. `reachable` is the part that matters — it
 * records, PER VOICE, which parts of the referent this engine can approach
 * and which it cannot, so the next person retuning this kit knows what is a
 * gap and what is a wall. Required on every DRUM_KITS entry, not optional: an
 * optional field makes omission the default and silence indistinguishable
 * from "nobody looked".
 *
 * This lives on the DRUM_KITS entry type, not on `DrumKit` itself: `DrumKit`
 * is also the shape `mergeDrumKit` returns and `DEFAULT_DRUM_KIT` is typed
 * as, both of which are pure engine params with no notion of a referent.
 */
export interface DrumKitReference {
  referent: string;
  source: string;
  reachable: string;
}

export const DRUM_KITS: Record<string, Partial<DrumKit> & { reference: DrumKitReference }> = {
  'Retro Drive': {
    kick: { freqStart: 140, freqEnd: 55, pitchTime: 0.018, decay: 0.22, gain: 0.85, clickFreq: 1800, clickLevel: 0.18, clickDecay: 0.008, reverbSend: 0.22 },
    snare: { bodyFreqStart: 230, bodyFreqEnd: 198, bodyTime: 0.02, bodyDecay: 0.14, bodyGain: 0.55, bodyFreqStart2: 437, bodyFreqEnd2: 376, bodyGain2: 0.33, noiseFilter: 1500, noiseDecay: 0.13, noiseGain: 0.75, reverbSend: 0.5 },
    rimshot: { bodyFreqStart: 470, bodyFreqEnd: 452, bodyTime: 0.006, bodyDecay: 0.085, bodyGain: 0.45, bodyFreqStart2: 1720, bodyFreqEnd2: 1650, bodyGain2: 0.55, noiseFilter: 3100, noiseDecay: 0.030, noiseGain: 0.16, reverbSend: 0.30 },
    hihat: { filter: 6400, topCut: 12000, decay: 0.085, gain: 0.36, metal: 0.45 },
    openhat: { filter: 5400, topCut: 12000, decay: 0.5, gain: 0.42, metal: 0.45 },
    clap: { filter: 1400, decay: 0.3, gain: 0.65, reverbSend: 0.45 },
    hitom: { freqStart: 227, freqEnd: 168, pitchTime: 0.1, decay: 0.12, gain: 0.65, reverbSend: 0.4 },
    lowtom: { freqStart: 115, freqEnd: 85, pitchTime: 0.14, decay: 0.22, gain: 0.65, reverbSend: 0.4 },
    ride: { tone: 140, ping: 0.60, pingFilter: 4400, pingDecay: 0.11, washFilter: 8200, washDecay: 1.5, bodyFilter: 500, metal: 0.45, gain: 0.32, reverbSend: 0.35 },
    crash: { filter: 6000, decay: 0.9, gain: 0.55, reverbSend: 0.4, metal: 0.50 },
    bell: { freq1: 800, freq2: 540, filter: 880, decay: 0.38, gain: 0.32, reverbSend: 0.35 },
    reference: {
      referent: 'LinnDrum / Oberheim DMX / Simmons SDS-V — early-80s pop and synthwave',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [1][2][3][4][33][34]',
      reachable:
        'hitom/lowtom yes — the Simmons toms are analogue SSM2044-filtered oscillators and a pitch ' +
        'envelope IS that topology; kick/snare/clap approximate only, the LinnDrum and DMX are 8-bit ' +
        'PCM; hihat/openhat/ride/crash/bell no, sampled at source; the gated snare needs an envelope ' +
        'on the reverb send, which the engine does not have.',
    },
  },
  'Club Standard': {
    kick: { freqStart: 175, freqEnd: 48, pitchTime: 0.03, decay: 0.3, gain: 0.95, clickFreq: 1400, clickLevel: 0.3, clickDecay: 0.01, reverbSend: 0.1 },
    snare: { bodyFreqStart: 240, bodyFreqEnd: 206, bodyTime: 0.02, bodyDecay: 0.11, bodyGain: 0.45, bodyFreqStart2: 451, bodyFreqEnd2: 387, bodyGain2: 0.27, noiseFilter: 2000, noiseDecay: 0.17, noiseGain: 0.7, reverbSend: 0.25 },
    rimshot: { bodyFreqStart: 500, bodyFreqEnd: 480, bodyTime: 0.005, bodyDecay: 0.075, bodyGain: 0.42, bodyFreqStart2: 1800, bodyFreqEnd2: 1730, bodyGain2: 0.58, noiseFilter: 3400, noiseDecay: 0.026, noiseGain: 0.14, reverbSend: 0.24 },
    hihat: { filter: 8500, topCut: 15000, decay: 0.045, gain: 0.42, metal: 0.70 },
    openhat: { filter: 7200, topCut: 15000, decay: 0.35, gain: 0.45, metal: 0.70 },
    clap: { filter: 1100, decay: 0.26, gain: 0.62, reverbSend: 0.3 },
    hitom: { freqStart: 236, freqEnd: 175, pitchTime: 0.08, decay: 0.11, gain: 0.65, reverbSend: 0.2 },
    lowtom: { freqStart: 119, freqEnd: 88, pitchTime: 0.12, decay: 0.2, gain: 0.65, reverbSend: 0.2 },
    ride: { tone: 145, ping: 0.70, pingFilter: 4800, pingDecay: 0.10, washFilter: 8600, washDecay: 1.3, bodyFilter: 520, metal: 0.70, gain: 0.33, reverbSend: 0.28 },
    crash: { filter: 6200, decay: 1.4, gain: 0.55, reverbSend: 0.3, metal: 0.72 },
    bell: { freq1: 840, freq2: 568, filter: 920, decay: 0.34, gain: 0.30, reverbSend: 0.28 },
    reference: {
      referent: 'Roland TR-909 — the house machine (Derrick May, Jeff Mills)',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1, §5.3 [5][6][7][4]',
      reachable:
        'kick/snare/rimshot/hitom/lowtom/clap YES — those voices are analogue on the machine and a ' +
        'glissando into a body with a click IS the 909 kick topology; hihat/openhat/ride/crash NO, ' +
        'and never will be: they are 6-bit PCM of real Paiste and Zildjian cymbals recorded by ' +
        'Atsushi Hoshiai, so no sample means no route, by construction rather than by difficulty. ' +
        'bell has no 909 referent at all and is ours. That split — half the kit reachable, half ' +
        'permanently not — is why the NAME dropped the machine claim while this field keeps it.',
    },
  },
  // The 0.05 sends here are a FLOOR, not a taste choice: do not "tidy" them to
  // 0. check:drums' spread() asserts max >= factor * min, so one kit at
  // exactly 0 makes the requirement 0 and the whole check passes for any
  // factor. A trap 808 is a dry sustained note, and 0.05 is how this kit says
  // so without going mute on the gate.
  'Trap Beat': {
    kick: { freqStart: 110, freqEnd: 41.2, pitchTime: 0.06, decay: 0.9, gain: 1.0, reverbSend: 0.05 },
    snare: { bodyFreqStart: 320, bodyFreqEnd: 275, bodyTime: 0.02, bodyDecay: 0.07, bodyGain: 0.3, bodyFreqStart2: 576, bodyFreqEnd2: 495, bodyGain2: 0.18, noiseFilter: 2600, noiseDecay: 0.14, noiseGain: 0.85, reverbSend: 0.1 },
    rimshot: { bodyFreqStart: 540, bodyFreqEnd: 520, bodyTime: 0.005, bodyDecay: 0.065, bodyGain: 0.40, bodyFreqStart2: 1980, bodyFreqEnd2: 1900, bodyGain2: 0.60, noiseFilter: 3800, noiseDecay: 0.022, noiseGain: 0.12, reverbSend: 0.20 },
    hihat: { filter: 9000, topCut: 16000, decay: 0.028, gain: 0.32, metal: 0.85 },
    openhat: { filter: 7600, topCut: 15000, decay: 0.22, gain: 0.36, metal: 0.85 },
    clap: { filter: 1900, decay: 0.2, gain: 0.55, reverbSend: 0.12 },
    hitom: { freqStart: 203, freqEnd: 150, pitchTime: 0.1, decay: 0.16, gain: 0.7, reverbSend: 0.1 },
    lowtom: { freqStart: 101, freqEnd: 75, pitchTime: 0.14, decay: 0.3, gain: 0.7, reverbSend: 0.1 },
    ride: { tone: 150, ping: 0.80, pingFilter: 5000, pingDecay: 0.09, washFilter: 9000, washDecay: 1.2, bodyFilter: 560, metal: 0.85, gain: 0.30, reverbSend: 0.22 },
    crash: { filter: 6000, decay: 1.3, gain: 0.5, reverbSend: 0.25, metal: 0.80 },
    bell: { freq1: 1050, freq2: 710, filter: 1150, decay: 0.30, gain: 0.28, reverbSend: 0.20 },
    reference: {
      referent: 'the TR-808 kick used as a tuned sustained sub, plus fast bright hats',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [8][9][10]',
      reachable:
        'kick yes, and closest in the library — a long low sine IS the sound; hihat/openhat yes as ' +
        'noise; snare/rimshot yes, thin and bright is a parameter setting; ride/crash/bell approximate; ' +
        'key-tracking the kick to the song is missing engine-side, not kit-side.',
    },
  },
  '808 Vintage': {
    kick: { freqStart: 90, freqEnd: 49.0, pitchTime: 0.04, decay: 0.7, gain: 0.9, reverbSend: 0.08 },
    snare: { bodyFreqStart: 190, bodyFreqEnd: 165, bodyTime: 0.03, bodyDecay: 0.16, bodyGain: 0.45, bodyFreqStart2: 542, bodyFreqEnd2: 470, bodyGain2: 0.27, noiseFilter: 1500, noiseDecay: 0.14, noiseGain: 0.4, reverbSend: 0.2 },
    rimshot: { bodyFreqStart: 455, bodyFreqEnd: 440, bodyTime: 0.006, bodyDecay: 0.100, bodyGain: 0.45, bodyFreqStart2: 1667, bodyFreqEnd2: 1600, bodyGain2: 0.55, noiseFilter: 3000, noiseDecay: 0.032, noiseGain: 0.15, reverbSend: 0.22 },
    hihat: { filter: 5200, topCut: 12000, decay: 0.05, gain: 0.34, metal: 0.90 },
    openhat: { filter: 4400, topCut: 12000, decay: 0.42, gain: 0.38, metal: 0.90 },
    clap: { filter: 1050, decay: 0.28, gain: 0.6, reverbSend: 0.25 },
    hitom: { freqStart: 189, freqEnd: 140, pitchTime: 0.1, decay: 0.13, gain: 0.65, reverbSend: 0.15 },
    lowtom: { freqStart: 108, freqEnd: 80, pitchTime: 0.14, decay: 0.25, gain: 0.65, reverbSend: 0.15 },
    ride: { tone: 125, ping: 0.75, pingFilter: 3800, pingDecay: 0.10, washFilter: 7200, washDecay: 1.4, bodyFilter: 380, metal: 0.90, gain: 0.31, reverbSend: 0.25 },
    crash: { filter: 5200, decay: 1.8, gain: 0.45, reverbSend: 0.25, metal: 0.92 },
    bell: { freq1: 800, freq2: 540, filter: 880, decay: 0.45, gain: 0.34, reverbSend: 0.25 },
    reference: {
      referent: 'Roland TR-808',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [8][11][12][13][4]',
      reachable:
        'The only machine on the §5.1 table that is analogue in EVERY voice, so this is the one kit ' +
        'where accuracy is a real target: kick/snare/rimshot/hitom/lowtom/clap yes, bridged-T topology. ' +
        'hihat/openhat/ride/crash/bell are six squares at 2-5 kHz through three highpasses — the metal ' +
        'bank of decision 30 is the mechanism; until its `metal` mix is tuned per voice this kit is the ' +
        'one holding the highest bar and the biggest gap.',
    },
  },
  'Chrome Pulse': {
    kick: { freqStart: 190, freqEnd: 42, pitchTime: 0.025, decay: 0.3, gain: 1.0, clickFreq: 2400, clickLevel: 0.4, clickDecay: 0.012, reverbSend: 0.3 },
    // noiseFilter is 3200, not the research's 3000: check:drums'
    // spread('snare.noiseFilter', 2.8) needs 2.8*min to hold once Lo-Fi
    // Vinyl sits at 1100 (3200/1100 = 2.909x; 3000 would be 2.727x and go
    // red). Margin is under 4% — do not "restore" this to 3000.
    snare: { bodyFreqStart: 300, bodyFreqEnd: 258, bodyTime: 0.02, bodyDecay: 0.09, bodyGain: 0.4, bodyFreqStart2: 558, bodyFreqEnd2: 480, bodyGain2: 0.24, noiseFilter: 3200, noiseDecay: 0.3, noiseGain: 0.8, reverbSend: 0.5 },
    rimshot: { bodyFreqStart: 520, bodyFreqEnd: 500, bodyTime: 0.004, bodyDecay: 0.060, bodyGain: 0.40, bodyFreqStart2: 1900, bodyFreqEnd2: 1820, bodyGain2: 0.60, noiseFilter: 3600, noiseDecay: 0.020, noiseGain: 0.12, reverbSend: 0.45 },
    hihat: { filter: 8800, topCut: 18000, decay: 0.022, gain: 0.34, metal: 0.75 },
    openhat: { filter: 7200, topCut: 17000, decay: 0.16, gain: 0.38, metal: 0.75 },
    clap: { filter: 1300, decay: 0.3, gain: 0.62, reverbSend: 0.5 },
    hitom: { freqStart: 296, freqEnd: 219, pitchTime: 0.07, decay: 0.12, gain: 0.65, reverbSend: 0.45 },
    lowtom: { freqStart: 149, freqEnd: 110, pitchTime: 0.1, decay: 0.22, gain: 0.65, reverbSend: 0.45 },
    ride: { tone: 148, ping: 0.65, pingFilter: 4900, pingDecay: 0.10, washFilter: 8800, washDecay: 1.6, bodyFilter: 540, metal: 0.75, gain: 0.35, reverbSend: 0.50 },
    crash: { filter: 7500, decay: 1.2, gain: 0.6, reverbSend: 0.55, metal: 0.78 },
    bell: { freq1: 1100, freq2: 743, filter: 1200, decay: 0.32, gain: 0.30, reverbSend: 0.50 },
    reference: {
      referent: 'authored',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 — unsourced, engineering judgement',
      reachable:
        "solna's own kit: the hardest transient, brightest hihat/openhat and wettest crash/ride in the " +
        'library. Every voice is reachable by definition — there is nothing to fall short of, which is ' +
        'also why it cannot overclaim.',
    },
  },
  'Velocity Breaks': {
    kick: { freqStart: 130, freqEnd: 50, pitchTime: 0.012, decay: 0.12, gain: 0.95, clickFreq: 2600, clickLevel: 0.22, clickDecay: 0.006, reverbSend: 0.12 },
    snare: { bodyFreqStart: 280, bodyFreqEnd: 241, bodyTime: 0.02, bodyDecay: 0.06, bodyGain: 0.45, bodyFreqStart2: 532, bodyFreqEnd2: 458, bodyGain2: 0.27, noiseFilter: 2200, noiseDecay: 0.13, noiseGain: 0.78, reverbSend: 0.18 },
    rimshot: { bodyFreqStart: 610, bodyFreqEnd: 590, bodyTime: 0.004, bodyDecay: 0.055, bodyGain: 0.48, bodyFreqStart2: 2100, bodyFreqEnd2: 2020, bodyGain2: 0.52, noiseFilter: 3800, noiseDecay: 0.018, noiseGain: 0.13, reverbSend: 0.20 },
    hihat: { filter: 8800, topCut: 14000, decay: 0.022, gain: 0.34, metal: 0.30 },
    openhat: { filter: 7200, topCut: 13000, decay: 0.16, gain: 0.38, metal: 0.30 },
    clap: { filter: 1600, decay: 0.13, gain: 0.45, reverbSend: 0.15 },
    hitom: { freqStart: 257, freqEnd: 190, pitchTime: 0.07, decay: 0.08, gain: 0.6, reverbSend: 0.18 },
    lowtom: { freqStart: 128, freqEnd: 95, pitchTime: 0.1, decay: 0.16, gain: 0.6, reverbSend: 0.18 },
    ride: { tone: 138, ping: 0.50, pingFilter: 4600, pingDecay: 0.09, washFilter: 8400, washDecay: 1.3, bodyFilter: 480, metal: 0.30, gain: 0.33, reverbSend: 0.22 },
    crash: { filter: 6400, decay: 0.8, gain: 0.5, reverbSend: 0.22, metal: 0.40 },
    bell: { freq1: 1700, freq2: 1150, filter: 2000, decay: 0.50, gain: 0.26, reverbSend: 0.25 },
    reference: {
      referent: 'the Amen break — a 1969 acoustic kit (G.C. Coleman, The Winstons), sampled and sped up',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [14][15]',
      reachable:
        'kick/snare/rimshot/hitom/lowtom approximate — a recording of a real kit, so the transient ' +
        'detail is out of reach; ride/crash/bell no, bronze is not bandpassed noise; and the identity ' +
        'is groove and ghost notes, which live in drumGrids.ts rather than here.',
    },
  },
  'Sub Weight': {
    kick: { freqStart: 100, freqEnd: 36.71, pitchTime: 0.02, decay: 0.5, gain: 1.0, clickFreq: 1600, clickLevel: 0.28, clickDecay: 0.008, reverbSend: 0.15 },
    snare: { bodyFreqStart: 210, bodyFreqEnd: 181, bodyTime: 0.03, bodyDecay: 0.16, bodyGain: 0.55, bodyFreqStart2: 546, bodyFreqEnd2: 471, bodyGain2: 0.33, noiseFilter: 1600, noiseDecay: 0.3, noiseGain: 0.8, reverbSend: 0.45 },
    rimshot: { bodyFreqStart: 430, bodyFreqEnd: 415, bodyTime: 0.007, bodyDecay: 0.110, bodyGain: 0.50, bodyFreqStart2: 1580, bodyFreqEnd2: 1520, bodyGain2: 0.50, noiseFilter: 2800, noiseDecay: 0.035, noiseGain: 0.16, reverbSend: 0.45 },
    hihat: { filter: 7200, topCut: 13000, decay: 0.035, gain: 0.3, metal: 0.35 },
    openhat: { filter: 6200, topCut: 12000, decay: 0.3, gain: 0.34, metal: 0.35 },
    clap: { filter: 1500, decay: 0.32, gain: 0.6, reverbSend: 0.4 },
    hitom: { freqStart: 194, freqEnd: 144, pitchTime: 0.1, decay: 0.21, gain: 0.7, reverbSend: 0.3 },
    lowtom: { freqStart: 97, freqEnd: 72, pitchTime: 0.14, decay: 0.4, gain: 0.7, reverbSend: 0.3 },
    ride: { tone: 128, ping: 0.40, pingFilter: 3900, pingDecay: 0.13, washFilter: 7400, washDecay: 2.2, bodyFilter: 400, metal: 0.35, gain: 0.34, reverbSend: 0.50 },
    crash: { filter: 5600, decay: 1.2, gain: 0.6, reverbSend: 0.5, metal: 0.45 },
    bell: { freq1: 840, freq2: 568, filter: 920, decay: 0.48, gain: 0.32, reverbSend: 0.50 },
    reference: {
      referent: 'dubstep at 140 BPM, halftime — transient-shaped kick and snare over a sub layer',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [16][17]',
      reachable:
        'kick/snare/clap yes — dubstep drums are themselves synthesised and layered, so there is no ' +
        'vintage box to fall short of; hitom/lowtom yes; hihat/openhat yes; ride/crash/bell approximate.',
    },
  },
  'Warehouse': {
    kick: { freqStart: 150, freqEnd: 40, pitchTime: 0.02, decay: 0.4, gain: 1.0, clickFreq: 1100, clickLevel: 0.35, clickDecay: 0.008, reverbSend: 0.45 },
    snare: { bodyFreqStart: 220, bodyFreqEnd: 189, bodyTime: 0.03, bodyDecay: 0.1, bodyGain: 0.4, bodyFreqStart2: 422, bodyFreqEnd2: 363, bodyGain2: 0.24, noiseFilter: 1800, noiseDecay: 0.14, noiseGain: 0.62, reverbSend: 0.4 },
    rimshot: { bodyFreqStart: 560, bodyFreqEnd: 540, bodyTime: 0.004, bodyDecay: 0.070, bodyGain: 0.42, bodyFreqStart2: 2000, bodyFreqEnd2: 1920, bodyGain2: 0.58, noiseFilter: 3600, noiseDecay: 0.022, noiseGain: 0.13, reverbSend: 0.40 },
    hihat: { filter: 8800, topCut: 14000, decay: 0.022, gain: 0.34, metal: 0.80 },
    openhat: { filter: 7200, topCut: 13000, decay: 0.16, gain: 0.38, metal: 0.80 },
    clap: { filter: 1200, decay: 0.3, gain: 0.7, reverbSend: 0.35 },
    hitom: { freqStart: 216, freqEnd: 160, pitchTime: 0.07, decay: 0.09, gain: 0.65, reverbSend: 0.4 },
    lowtom: { freqStart: 124, freqEnd: 92, pitchTime: 0.1, decay: 0.18, gain: 0.65, reverbSend: 0.4 },
    ride: { tone: 142, ping: 0.60, pingFilter: 4700, pingDecay: 0.11, washFilter: 8600, washDecay: 2.0, bodyFilter: 520, metal: 0.80, gain: 0.32, reverbSend: 0.45 },
    crash: { filter: 6600, decay: 1.0, gain: 0.5, reverbSend: 0.45, metal: 0.82 },
    bell: { freq1: 1150, freq2: 776, filter: 1250, decay: 0.36, gain: 0.29, reverbSend: 0.45 },
    reference: {
      referent: 'Berlin / warehouse techno — saturated 909 kick into a mono low-passed reverb',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [18][19][20]',
      reachable:
        'kick yes now that kick.reverbSend exists — the defining trait is routing, not values; ' +
        'snare/clap yes, overdriven is a gain and decay setting; hihat/openhat approximate; ' +
        'ride/crash/bell approximate. This is the shortest-decay kit in the library, and that is the ' +
        'correct fit for techno\'s rigid hats and crushing kick ' +
        '(docs/research/2026-09-06-genre-drum-voice-selection.md, Part 4) — it is deliberately NOT the ' +
        'fit for a long-tail grid: `ambient-sparse-drift` used to name this kit and was moved to ' +
        'Acoustic Studio for that reason (src/data/vibes.ts, deep-ambient).',
    },
  },
  // The 0.05 sends are a FLOOR, not a taste choice: do not "tidy" them to 0.
  // check:drums' spread() asserts max >= factor * min, so one kit at exactly 0
  // makes the requirement 0 and the whole check passes for any factor. This is
  // the driest kit in the library and 0.05 is how it says so without going mute
  // on the gate.
  'Tight Pocket': {
    kick: { freqStart: 120, freqEnd: 58, pitchTime: 0.013, decay: 0.13, gain: 0.85, clickFreq: 2200, clickLevel: 0.25, clickDecay: 0.006, reverbSend: 0.05 },
    snare: { bodyFreqStart: 260, bodyFreqEnd: 224, bodyTime: 0.03, bodyDecay: 0.08, bodyGain: 0.5, bodyFreqStart2: 481, bodyFreqEnd2: 414, bodyGain2: 0.30, noiseFilter: 1900, noiseDecay: 0.11, noiseGain: 0.62, reverbSend: 0.12 },
    rimshot: { bodyFreqStart: 800, bodyFreqEnd: 780, bodyTime: 0.004, bodyDecay: 0.045, bodyGain: 0.55, bodyFreqStart2: 2450, bodyFreqEnd2: 2350, bodyGain2: 0.35, noiseFilter: 4000, noiseDecay: 0.018, noiseGain: 0.10, reverbSend: 0.15 },
    hihat: { filter: 3600, topCut: 9000, decay: 0.045, gain: 0.26, metal: 0.20 },
    openhat: { filter: 3200, topCut: 8500, decay: 0.3, gain: 0.28, metal: 0.20 },
    clap: { filter: 1300, decay: 0.16, gain: 0.5, reverbSend: 0.12 },
    hitom: { freqStart: 243, freqEnd: 180, pitchTime: 0.07, decay: 0.09, gain: 0.65, reverbSend: 0.08 },
    lowtom: { freqStart: 122, freqEnd: 90, pitchTime: 0.1, decay: 0.18, gain: 0.65, reverbSend: 0.08 },
    ride: { tone: 130, ping: 0.75, pingFilter: 4000, pingDecay: 0.10, washFilter: 7000, washDecay: 1.4, bodyFilter: 420, metal: 0.20, gain: 0.36, reverbSend: 0.18 },
    crash: { filter: 5400, decay: 0.9, gain: 0.48, reverbSend: 0.15, metal: 0.30 },
    bell: { freq1: 880, freq2: 594, filter: 960, decay: 0.35, gain: 0.33, reverbSend: 0.18 },
    reference: {
      referent: '"Funky Drummer" (Clyde Stubblefield, King Studios 1969) — a kick deadened with blankets, no gates or compression',
      source:
        'docs/research/2026-09-06-drum-kit-identities.md §1 [21][22]; the source names the kick shell ' +
        'as a Ludwig Vistalite, dropped here as unverifiable — Vistalite shells did not ship until ' +
        'c.1972, three years after this 1969 session, so the model cannot be right even though the ' +
        'recording and its blanket-damped sound are not in question',
      reachable:
        'kick approximate — the deadening is physical, a blanket, not a filter; snare/rimshot ' +
        "approximate, the Acrolite's 6-10 kHz head sound needs a second noise band; hitom/lowtom yes; " +
        'hihat/openhat approximate, 14" Zildjian K; crash absent from the referent by design and ' +
        'ride/bell out of reach as bronze.',
    },
  },
  'Acoustic Studio': {
    kick: { freqStart: 180, freqEnd: 65, pitchTime: 0.012, decay: 0.32, gain: 0.9, clickFreq: 3000, clickLevel: 0.28, clickDecay: 0.008, reverbSend: 0.28 },
    snare: { bodyFreqStart: 240, bodyFreqEnd: 206, bodyTime: 0.03, bodyDecay: 0.2, bodyGain: 0.55, bodyFreqStart2: 439, bodyFreqEnd2: 377, bodyGain2: 0.33, noiseFilter: 1400, noiseDecay: 0.26, noiseGain: 0.5, reverbSend: 0.35 },
    rimshot: { bodyFreqStart: 760, bodyFreqEnd: 740, bodyTime: 0.004, bodyDecay: 0.050, bodyGain: 0.56, bodyFreqStart2: 2350, bodyFreqEnd2: 2260, bodyGain2: 0.34, noiseFilter: 4200, noiseDecay: 0.020, noiseGain: 0.11, reverbSend: 0.45 },
    hihat: { filter: 6400, topCut: 13000, decay: 0.085, gain: 0.36, metal: 0.15 },
    openhat: { filter: 5400, topCut: 13000, decay: 0.5, gain: 0.42, metal: 0.15 },
    clap: { filter: 1400, decay: 0.32, gain: 0.55, reverbSend: 0.4 },
    hitom: { freqStart: 236, freqEnd: 175, pitchTime: 0.1, decay: 0.24, gain: 0.75, reverbSend: 0.5 },
    lowtom: { freqStart: 135, freqEnd: 100, pitchTime: 0.14, decay: 0.45, gain: 0.75, reverbSend: 0.5 },
    ride: { tone: 122, ping: 0.45, pingFilter: 3600, pingDecay: 0.15, washFilter: 7000, washDecay: 2.5, bodyFilter: 320, metal: 0.15, gain: 0.38, reverbSend: 0.50 },
    crash: { filter: 5000, decay: 2.0, gain: 0.6, reverbSend: 0.5, metal: 0.25 },
    bell: { freq1: 1700, freq2: 1150, filter: 2000, decay: 0.55, gain: 0.31, reverbSend: 0.50 },
    reference: {
      referent: 'a close-miked acoustic rock kit',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [23]',
      reachable:
        'kick yes, 60-100 Hz body with a 2-4 kHz beater click; snare/rimshot yes, 150-200 Hz fatness ' +
        'plus a head band; hitom/lowtom yes, and genuinely long in a room; hihat/openhat approximate; ' +
        'ride/crash/bell are the ceiling — bandpassed noise is not bronze, and this is the kit where ' +
        'that is most audible because the referent is nothing but real cymbals.',
    },
  },
  'Warm Riddim': {
    kick: { freqStart: 100, freqEnd: 52, pitchTime: 0.025, decay: 0.28, gain: 0.85, reverbSend: 0.35 },
    // Slice 1 put a cross-stick on this row because there was no rimshot voice
    // to hold one. There is now: the cross-stick moved to `rimshot` below (spec
    // decision 38 — reggae's backbeat lives on that row, not on the snare), and
    // this is an ordinary snare again. Do NOT move it back up toward 900 Hz.
    // The old comment's warning still applies, one row down: `rimshot` here sits
    // at 875 Hz, 2.11x the library's lowest rimshot (Sub Weight, 415) and
    // 1.12x its next-highest (Tight Pocket, 780), by design, and must not be
    // "corrected" toward them.
    // Two values here are load-bearing: bodyTime 0.01 is the minimum of
    // spread('snare.bodyTime') (0.02 makes that spread 1.5x and fails the gate),
    // and noiseDecay 0.06 is what separates this kit from Retro Drive now that
    // the 900 Hz body no longer does (measured: 1.12, against 0.766 at 0.08).
    snare: { bodyFreqStart: 250, bodyFreqEnd: 213, bodyTime: 0.01, bodyDecay: 0.09, bodyGain: 0.5, bodyFreqStart2: 463, bodyFreqEnd2: 392, bodyGain2: 0.3, noiseFilter: 2400, noiseDecay: 0.06, noiseGain: 0.5, reverbSend: 0.45 },
    // Slice 1's cross-stick, moved here intact (step 4) and glided 900->875
    // rather than 900->800: a click does not sweep a fifth of an octave. Its
    // second partial breaks the library's 1.85 rule on purpose: 1.85 over a
    // 900 Hz body lands at 1665 Hz, shrill and outside the click this row
    // exists to make, so this uses 1.50 and a 0.35 gain factor instead. It
    // sits at 875 Hz, 2.11x the library's lowest rimshot (Sub Weight, 415) and
    // 1.12x its next-highest (Tight Pocket, 780), by design; do not "correct"
    // it toward them.
    rimshot: { bodyFreqStart: 900, bodyFreqEnd: 875, bodyTime: 0.004, bodyDecay: 0.045, bodyGain: 0.55, bodyFreqStart2: 1350, bodyFreqEnd2: 1310, bodyGain2: 0.19, noiseFilter: 4000, noiseDecay: 0.018, noiseGain: 0.10, reverbSend: 0.50 },
    hihat: { filter: 5200, topCut: 10000, decay: 0.05, gain: 0.34, metal: 0.25 },
    openhat: { filter: 4400, topCut: 9500, decay: 0.42, gain: 0.38, metal: 0.25 },
    clap: { filter: 1000, decay: 0.3, gain: 0.45, reverbSend: 0.5 },
    hitom: { freqStart: 203, freqEnd: 150, pitchTime: 0.1, decay: 0.18, gain: 0.6, reverbSend: 0.45 },
    lowtom: { freqStart: 101, freqEnd: 75, pitchTime: 0.14, decay: 0.35, gain: 0.6, reverbSend: 0.45 },
    ride: { tone: 126, ping: 0.35, pingFilter: 3700, pingDecay: 0.14, washFilter: 7200, washDecay: 2.3, bodyFilter: 360, metal: 0.25, gain: 0.30, reverbSend: 0.50 },
    crash: { filter: 4800, decay: 1.5, gain: 0.48, reverbSend: 0.5, metal: 0.35 },
    bell: { freq1: 1050, freq2: 710, filter: 1150, decay: 0.42, gain: 0.30, reverbSend: 0.50 },
    reference: {
      referent: 'reggae one drop (Carlton Barrett) and its dub treatment (King Tubby)',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [24][25][26][27]',
      reachable:
        'rimshot YES and this is the best return in the library — a cross-stick is a short pitched ' +
        'wooden tock, which a triangle oscillator with a fast decay does well, and the one drop puts ' +
        'kick and cross-stick together on beat 3; kick/snare yes; hihat/openhat yes; hitom/lowtom yes; ' +
        "ride/crash/bell approximate. Dub's tape echo is an effect-rack question, not a kit one.",
    },
  },
  'Lo-Fi Vinyl': {
    kick: { freqStart: 95, freqEnd: 45, pitchTime: 0.03, decay: 0.32, gain: 0.8, clickFreq: 900, clickLevel: 0.15, clickDecay: 0.012, reverbSend: 0.18 },
    snare: { bodyFreqStart: 175, bodyFreqEnd: 151, bodyTime: 0.03, bodyDecay: 0.15, bodyGain: 0.42, bodyFreqStart2: 327, bodyFreqEnd2: 282, bodyGain2: 0.25, noiseFilter: 1100, noiseDecay: 0.16, noiseGain: 0.3, reverbSend: 0.28 },
    rimshot: { bodyFreqStart: 720, bodyFreqEnd: 700, bodyTime: 0.005, bodyDecay: 0.055, bodyGain: 0.55, bodyFreqStart2: 2200, bodyFreqEnd2: 2120, bodyGain2: 0.35, noiseFilter: 3400, noiseDecay: 0.022, noiseGain: 0.12, reverbSend: 0.28 },
    // hihat.topCut is the low end of check:drums' spread('hihat.topCut', 2.0):
    // Chrome Pulse's 18000 clears the floor at exactly 2.40x this value, and
    // the second-lowest (Tight Pocket, 9000) would land the ratio on exactly
    // 2.00 if this one were ever raised — the check would then pass only on
    // the `>=`. Raising this number puts the gate on its boundary.
    hihat: { filter: 3600, topCut: 7500, decay: 0.045, gain: 0.26, metal: 0.30 },
    openhat: { filter: 3200, topCut: 7000, decay: 0.3, gain: 0.28, metal: 0.30 },
    clap: { filter: 950, decay: 0.24, gain: 0.42, reverbSend: 0.22 },
    hitom: { freqStart: 173, freqEnd: 128, pitchTime: 0.1, decay: 0.16, gain: 0.55, reverbSend: 0.22 },
    lowtom: { freqStart: 95, freqEnd: 70, pitchTime: 0.14, decay: 0.3, gain: 0.55, reverbSend: 0.22 },
    ride: { tone: 120, ping: 0.30, pingFilter: 3500, pingDecay: 0.16, washFilter: 7000, washDecay: 1.9, bodyFilter: 300, metal: 0.30, gain: 0.28, reverbSend: 0.30 },
    crash: { filter: 4600, decay: 1.0, gain: 0.4, reverbSend: 0.3, metal: 0.38 },
    bell: { freq1: 900, freq2: 608, filter: 980, decay: 0.40, gain: 0.25, reverbSend: 0.30 },
    reference: {
      referent: 'lo-fi hip hop through an E-mu SP-1200 — 12-bit at 26.04 kHz',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [28][29][30]',
      reachable:
        'hihat/openhat yes now that hat.topCut exists — the SP-1200 folds the top back and softens ' +
        'transients, and until slice 3 this kit had the BRIGHTEST hat in the set, pointed the wrong ' +
        'way; kick/snare/rimshot approximate — the sound is the converter, not the drum; hitom/lowtom ' +
        'yes; ride/crash/bell approximate. True bit reduction is an engine feature nobody has built.',
    },
  },

  // Gap 1 in drum-kit-identities.md section 4: boom bap is acoustic breaks
  // through a 12-bit SP-1200, not a TR-808. Lo-Fi Vinyl's darkness, Acoustic
  // Studio's snare crack, a hard short kick — "boom" and "bap" are the impact,
  // which is why the kick gain is high and its decay short.
  'Dusty Break': {
    kick: { freqStart: 150, freqEnd: 52, pitchTime: 0.02, decay: 0.2, gain: 0.95, clickFreq: 2400, clickLevel: 0.3, clickDecay: 0.006, reverbSend: 0.2 },
    snare: { bodyFreqStart: 250, bodyFreqEnd: 215, bodyTime: 0.03, bodyDecay: 0.12, bodyGain: 0.55, bodyFreqStart2: 465, bodyFreqEnd2: 400, bodyGain2: 0.33, noiseFilter: 1800, noiseDecay: 0.18, noiseGain: 0.7, reverbSend: 0.25 },
    rimshot: { bodyFreqStart: 780, bodyFreqEnd: 760, bodyTime: 0.004, bodyDecay: 0.048, bodyGain: 0.54, bodyFreqStart2: 2400, bodyFreqEnd2: 2300, bodyGain2: 0.36, noiseFilter: 3900, noiseDecay: 0.019, noiseGain: 0.11, reverbSend: 0.30 },
    hihat: { filter: 7000, topCut: 11000, decay: 0.034, gain: 0.3, metal: 0.25 },
    openhat: { filter: 5200, topCut: 9500, decay: 0.22, gain: 0.34, metal: 0.25 },
    clap: { filter: 1300, decay: 0.18, gain: 0.5, reverbSend: 0.15 },
    hitom: { freqStart: 246, freqEnd: 182, pitchTime: 0.06, decay: 0.16, gain: 0.7, reverbSend: 0.25 },
    lowtom: { freqStart: 128, freqEnd: 95, pitchTime: 0.08, decay: 0.3, gain: 0.7, reverbSend: 0.25 },
    ride: { tone: 132, ping: 0.55, pingFilter: 4100, pingDecay: 0.12, washFilter: 7600, washDecay: 1.7, bodyFilter: 440, metal: 0.25, gain: 0.33, reverbSend: 0.30 },
    crash: { filter: 4800, decay: 1.1, gain: 0.5, reverbSend: 0.3, metal: 0.34 },
    bell: { freq1: 1700, freq2: 1150, filter: 2000, decay: 0.52, gain: 0.27, reverbSend: 0.30 },
    reference: {
      referent: 'boom bap — acoustic breaks chopped through a 12-bit SP-1200 / SP-12',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [28][29]; drumGrids.ts provenance',
      reachable:
        'kick/snare/rimshot approximate — the referent is a sampled acoustic kit twice removed, once ' +
        'by the room and once by the converter; hitom/lowtom yes; hihat/openhat yes, dusty is a decay ' +
        'and a topCut; ride/crash/bell approximate. It is deliberately NOT 808 Vintage: boom bap ' +
        "instruments are breaks through a 12-bit sampler, the opposite of a bridged-T sine.",
    },
  },
};
