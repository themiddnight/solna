/**
 * The factory Beat catalogue: thirteen complete patches, one per legacy drum
 * kit, under STABLE IDS.
 *
 * An id, not a name, is the key from here on. The kit table this replaced was
 * keyed by display name — a loop persisted that name and `DRUM_TRIMS` looked a
 * trim up by it — so renaming a kit was a project-file change. An id is
 * renameable-proof: the
 * name is a label, the id is the identity a loop's `basePresetId` and the
 * calibration table both carry.
 *
 * Every patch is COMPLETE. The kit table this replaced held PARTIAL voices laid
 * over one shared default; these are the merged result with the optional
 * kick-click fields made explicit, because a patch a user can edit, save and
 * export must not depend on a default table it does not carry. Where a kit had
 * no click, the click is `clickLevel: 0` — the disabled state, stated. The
 * migration was pinned value-for-value against the old table while it existed;
 * from here on `report:drums-diff` is what shows a re-voicing, because every
 * number in this file is authored and none of it is inherited.
 *
 * `outputTrimDb` is the measured calibration trim from `src/data/trimTable.ts`,
 * embedded rather than looked up: this file is a src/data/ LEAF and imports no
 * sibling. The lock test (`scripts/calibration/trimTable.lock.test.ts`) is what
 * keeps the two copies equal, and runtime audio reads only this one.
 *
 * `filter` is the loop's shipped drum-bus default — fully open, so it reads as
 * bypass until touched.
 *
 * `reference` is required on every entry, for the reason recorded on the type:
 * an optional field makes omission the default and silence indistinguishable
 * from "nobody looked".
 */
import type { BeatVoiceId, BeatVoices, FactoryBeatPreset } from '@/types';

/**
 * The canonical voice roster and order. It is spelled out here, rather than
 * derived from `BeatVoiceId`, because a union has no order and this file is a
 * leaf that may import no sibling to get one. `beatPresets.test.ts` asserts
 * this array is exactly the union's members in exactly this sequence, so the
 * two cannot drift silently.
 */
export const BEAT_VOICE_IDS: readonly BeatVoiceId[] = [
  'kick', 'snare', 'rimshot', 'clap', 'hihat', 'openhat',
  'hitom', 'lowtom', 'ride', 'crash', 'bell',
];

/**
 * The default preset's eleven voices, named so that a consumer needing a
 * COMPLETE patch before any store write has reached it — the drum synth's own
 * pre-patch seed — does not index this table by position. `retro-drive`'s
 * entry below holds this same object, and `beatPresets.test.ts` pins that it
 * is the same one rather than a copy that can drift.
 *
 * Shared by reference on purpose and safe because nothing hands it out:
 * every read path (`beatParamsFromPreset`, `setBeatParams`, `readBeatState`)
 * clones before the value can be edited.
 */
export const DEFAULT_BEAT_VOICES: BeatVoices = {
  kick: { freqStart: 140, freqEnd: 55, pitchTime: 0.018, decay: 0.22, gain: 0.85, clickFreq: 1800, clickLevel: 0.18, clickDecay: 0.008, reverbSend: 0.22 },
  snare: { bodyFreqStart: 230, bodyFreqEnd: 198, bodyTime: 0.02, bodyDecay: 0.14, bodyGain: 0.55, bodyFreqStart2: 437, bodyFreqEnd2: 376, bodyGain2: 0.33, noiseFilter: 1500, noiseDecay: 0.13, noiseGain: 0.75, reverbSend: 0.5 },
  rimshot: { bodyFreqStart: 470, bodyFreqEnd: 452, bodyTime: 0.006, bodyDecay: 0.085, bodyGain: 0.45, bodyFreqStart2: 1720, bodyFreqEnd2: 1650, bodyGain2: 0.55, noiseFilter: 3100, noiseDecay: 0.03, noiseGain: 0.16, reverbSend: 0.3 },
  clap: { filter: 1400, decay: 0.3, gain: 0.65, reverbSend: 0.45 },
  hihat: { filter: 6400, topCut: 12000, decay: 0.085, gain: 0.36, metal: 0.45 },
  openhat: { filter: 5400, topCut: 12000, decay: 0.5, gain: 0.42, metal: 0.45 },
  hitom: { freqStart: 227, freqEnd: 168, pitchTime: 0.1, decay: 0.12, gain: 0.65, reverbSend: 0.4 },
  lowtom: { freqStart: 115, freqEnd: 85, pitchTime: 0.14, decay: 0.22, gain: 0.65, reverbSend: 0.4 },
  ride: { tone: 140, ping: 0.6, pingFilter: 4400, pingDecay: 0.11, washFilter: 8200, washDecay: 1.5, bodyFilter: 500, metal: 0.45, gain: 0.32, reverbSend: 0.35 },
  crash: { filter: 6000, decay: 0.9, gain: 0.55, reverbSend: 0.4, metal: 0.5 },
  bell: { freq1: 800, freq2: 540, filter: 880, decay: 0.38, gain: 0.32, reverbSend: 0.35 },
};

/** What a loop starts on, and what an unresolvable id falls back to. */
export const DEFAULT_BEAT_PRESET_ID = 'retro-drive';

export const BEAT_PRESETS: readonly FactoryBeatPreset[] = [
  {
    id: 'retro-drive',
    name: 'Retro Drive',
    origin: 'factory',
    reference: {
      referent: 'LinnDrum / Oberheim DMX / Simmons SDS-V — early-80s pop and synthwave',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [1][2][3][4][33][34]',
      reachable:
        'hitom/lowtom yes — the Simmons toms are analogue SSM2044-filtered oscillators and a pitch ' +
        'envelope IS that topology; kick/snare/clap approximate only, the LinnDrum and DMX are ' +
        '8-bit PCM; hihat/openhat/ride/crash/bell no, sampled at source; the gated snare needs an ' +
        'envelope on the reverb send, which the engine does not have.',
    },
    patch: {
      outputTrimDb: 1.1,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: DEFAULT_BEAT_VOICES,
    },
  },
  {
    id: 'club-standard',
    name: 'Club Standard',
    origin: 'factory',
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
    patch: {
      outputTrimDb: 0.2,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 175, freqEnd: 48, pitchTime: 0.03, decay: 0.3, gain: 0.95, clickFreq: 1400, clickLevel: 0.3, clickDecay: 0.01, reverbSend: 0.1 },
        snare: { bodyFreqStart: 240, bodyFreqEnd: 206, bodyTime: 0.02, bodyDecay: 0.11, bodyGain: 0.45, bodyFreqStart2: 451, bodyFreqEnd2: 387, bodyGain2: 0.27, noiseFilter: 2000, noiseDecay: 0.17, noiseGain: 0.7, reverbSend: 0.25 },
        rimshot: { bodyFreqStart: 500, bodyFreqEnd: 480, bodyTime: 0.005, bodyDecay: 0.075, bodyGain: 0.42, bodyFreqStart2: 1800, bodyFreqEnd2: 1730, bodyGain2: 0.58, noiseFilter: 3400, noiseDecay: 0.026, noiseGain: 0.14, reverbSend: 0.24 },
        clap: { filter: 1100, decay: 0.26, gain: 0.62, reverbSend: 0.3 },
        hihat: { filter: 8500, topCut: 15000, decay: 0.045, gain: 0.42, metal: 0.7 },
        openhat: { filter: 7200, topCut: 15000, decay: 0.35, gain: 0.45, metal: 0.7 },
        hitom: { freqStart: 236, freqEnd: 175, pitchTime: 0.08, decay: 0.11, gain: 0.65, reverbSend: 0.2 },
        lowtom: { freqStart: 119, freqEnd: 88, pitchTime: 0.12, decay: 0.2, gain: 0.65, reverbSend: 0.2 },
        ride: { tone: 145, ping: 0.7, pingFilter: 4800, pingDecay: 0.1, washFilter: 8600, washDecay: 1.3, bodyFilter: 520, metal: 0.7, gain: 0.33, reverbSend: 0.28 },
        crash: { filter: 6200, decay: 1.4, gain: 0.55, reverbSend: 0.3, metal: 0.72 },
        bell: { freq1: 840, freq2: 568, filter: 920, decay: 0.34, gain: 0.3, reverbSend: 0.28 },
      },
    },
  },
  {
    id: 'trap-beat',
    name: 'Trap Beat',
    origin: 'factory',
    reference: {
      referent: 'the TR-808 kick used as a tuned sustained sub, plus fast bright hats',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [8][9][10]',
      reachable:
        'kick yes, and closest in the library — a long low sine IS the sound; hihat/openhat yes as ' +
        'noise; snare/rimshot yes, thin and bright is a parameter setting; ride/crash/bell ' +
        'approximate; key-tracking the kick to the song is missing engine-side, not kit-side.',
    },
    patch: {
      outputTrimDb: -2.4,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        // No beater click in the legacy kit: `clickLevel: 0` is the disabled
        // state, and the two siblings are where a raised click would land.
        // `reverbSend: 0.05` here (and on every voice of this preset) is a
        // FLOOR, not a taste choice: do not "tidy" it to 0. check:drums'
        // spread() asserts max >= factor * min, so one preset at exactly 0
        // makes the requirement 0 and the whole check passes for any factor.
        // A trap 808 is a dry sustained note, and 0.05 is how this preset says
        // so without going mute on the gate.
        kick: { freqStart: 110, freqEnd: 41.2, pitchTime: 0.06, decay: 0.9, gain: 1, clickFreq: 2000, clickLevel: 0, clickDecay: 0.01, reverbSend: 0.05 },
        snare: { bodyFreqStart: 320, bodyFreqEnd: 275, bodyTime: 0.02, bodyDecay: 0.07, bodyGain: 0.3, bodyFreqStart2: 576, bodyFreqEnd2: 495, bodyGain2: 0.18, noiseFilter: 2600, noiseDecay: 0.14, noiseGain: 0.85, reverbSend: 0.1 },
        rimshot: { bodyFreqStart: 540, bodyFreqEnd: 520, bodyTime: 0.005, bodyDecay: 0.065, bodyGain: 0.4, bodyFreqStart2: 1980, bodyFreqEnd2: 1900, bodyGain2: 0.6, noiseFilter: 3800, noiseDecay: 0.022, noiseGain: 0.12, reverbSend: 0.2 },
        clap: { filter: 1900, decay: 0.2, gain: 0.55, reverbSend: 0.12 },
        hihat: { filter: 9000, topCut: 16000, decay: 0.028, gain: 0.32, metal: 0.85 },
        openhat: { filter: 7600, topCut: 15000, decay: 0.22, gain: 0.36, metal: 0.85 },
        hitom: { freqStart: 203, freqEnd: 150, pitchTime: 0.1, decay: 0.16, gain: 0.7, reverbSend: 0.1 },
        lowtom: { freqStart: 101, freqEnd: 75, pitchTime: 0.14, decay: 0.3, gain: 0.7, reverbSend: 0.1 },
        ride: { tone: 150, ping: 0.8, pingFilter: 5000, pingDecay: 0.09, washFilter: 9000, washDecay: 1.2, bodyFilter: 560, metal: 0.85, gain: 0.3, reverbSend: 0.22 },
        crash: { filter: 6000, decay: 1.3, gain: 0.5, reverbSend: 0.25, metal: 0.8 },
        bell: { freq1: 1050, freq2: 710, filter: 1150, decay: 0.3, gain: 0.28, reverbSend: 0.2 },
      },
    },
  },
  {
    id: '808-vintage',
    name: '808 Vintage',
    origin: 'factory',
    reference: {
      referent: 'Roland TR-808',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [8][11][12][13][4]',
      reachable:
        'The only machine on the §5.1 table that is analogue in EVERY voice, so this is the one kit ' +
        'where accuracy is a real target: kick/snare/rimshot/hitom/lowtom/clap yes, bridged-T ' +
        'topology. hihat/openhat/ride/crash/bell are six squares at 2-5 kHz through three ' +
        'highpasses — the metal bank of decision 30 is the mechanism; until its `metal` mix is ' +
        'tuned per voice this kit is the one holding the highest bar and the biggest gap.',
    },
    patch: {
      outputTrimDb: -0.1,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        // No beater click in the legacy kit: `clickLevel: 0` is the disabled
        // state, and the two siblings are where a raised click would land.
        kick: { freqStart: 90, freqEnd: 49, pitchTime: 0.04, decay: 0.7, gain: 0.9, clickFreq: 2000, clickLevel: 0, clickDecay: 0.01, reverbSend: 0.08 },
        snare: { bodyFreqStart: 190, bodyFreqEnd: 165, bodyTime: 0.03, bodyDecay: 0.16, bodyGain: 0.45, bodyFreqStart2: 542, bodyFreqEnd2: 470, bodyGain2: 0.27, noiseFilter: 1500, noiseDecay: 0.14, noiseGain: 0.4, reverbSend: 0.2 },
        rimshot: { bodyFreqStart: 455, bodyFreqEnd: 440, bodyTime: 0.006, bodyDecay: 0.1, bodyGain: 0.45, bodyFreqStart2: 1667, bodyFreqEnd2: 1600, bodyGain2: 0.55, noiseFilter: 3000, noiseDecay: 0.032, noiseGain: 0.15, reverbSend: 0.22 },
        clap: { filter: 1050, decay: 0.28, gain: 0.6, reverbSend: 0.25 },
        hihat: { filter: 5200, topCut: 12000, decay: 0.05, gain: 0.34, metal: 0.9 },
        openhat: { filter: 4400, topCut: 12000, decay: 0.42, gain: 0.38, metal: 0.9 },
        hitom: { freqStart: 189, freqEnd: 140, pitchTime: 0.1, decay: 0.13, gain: 0.65, reverbSend: 0.15 },
        lowtom: { freqStart: 108, freqEnd: 80, pitchTime: 0.14, decay: 0.25, gain: 0.65, reverbSend: 0.15 },
        ride: { tone: 125, ping: 0.75, pingFilter: 3800, pingDecay: 0.1, washFilter: 7200, washDecay: 1.4, bodyFilter: 380, metal: 0.9, gain: 0.31, reverbSend: 0.25 },
        crash: { filter: 5200, decay: 1.8, gain: 0.45, reverbSend: 0.25, metal: 0.92 },
        bell: { freq1: 800, freq2: 540, filter: 880, decay: 0.45, gain: 0.34, reverbSend: 0.25 },
      },
    },
  },
  {
    id: 'chrome-pulse',
    name: 'Chrome Pulse',
    origin: 'factory',
    reference: {
      referent: 'authored',
      source:
        'docs/research/2026-09-06-drum-kit-identities.md §1 — unsourced, engineering judgement',
      reachable:
        'solna\'s own kit: the hardest transient, brightest hihat/openhat and wettest crash/ride in ' +
        'the library. Every voice is reachable by definition — there is nothing to fall short of, ' +
        'which is also why it cannot overclaim.',
    },
    patch: {
      outputTrimDb: -1.2,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 190, freqEnd: 42, pitchTime: 0.025, decay: 0.3, gain: 1, clickFreq: 2400, clickLevel: 0.4, clickDecay: 0.012, reverbSend: 0.3 },
        // noiseFilter is 3200, not the research's 3000: check:drums'
        // spread('snare.noiseFilter', 2.8) needs 2.8*min to hold once Lo-Fi
        // Vinyl sits at 1100 (3200/1100 = 2.909x; 3000 would be 2.727x and go
        // red). Margin is under 4% — do not "restore" this to 3000.
        snare: { bodyFreqStart: 300, bodyFreqEnd: 258, bodyTime: 0.02, bodyDecay: 0.09, bodyGain: 0.4, bodyFreqStart2: 558, bodyFreqEnd2: 480, bodyGain2: 0.24, noiseFilter: 3200, noiseDecay: 0.3, noiseGain: 0.8, reverbSend: 0.5 },
        rimshot: { bodyFreqStart: 520, bodyFreqEnd: 500, bodyTime: 0.004, bodyDecay: 0.06, bodyGain: 0.4, bodyFreqStart2: 1900, bodyFreqEnd2: 1820, bodyGain2: 0.6, noiseFilter: 3600, noiseDecay: 0.02, noiseGain: 0.12, reverbSend: 0.45 },
        clap: { filter: 1300, decay: 0.3, gain: 0.62, reverbSend: 0.5 },
        hihat: { filter: 8800, topCut: 18000, decay: 0.022, gain: 0.34, metal: 0.75 },
        openhat: { filter: 7200, topCut: 17000, decay: 0.16, gain: 0.38, metal: 0.75 },
        hitom: { freqStart: 296, freqEnd: 219, pitchTime: 0.07, decay: 0.12, gain: 0.65, reverbSend: 0.45 },
        lowtom: { freqStart: 149, freqEnd: 110, pitchTime: 0.1, decay: 0.22, gain: 0.65, reverbSend: 0.45 },
        ride: { tone: 148, ping: 0.65, pingFilter: 4900, pingDecay: 0.1, washFilter: 8800, washDecay: 1.6, bodyFilter: 540, metal: 0.75, gain: 0.35, reverbSend: 0.5 },
        crash: { filter: 7500, decay: 1.2, gain: 0.6, reverbSend: 0.55, metal: 0.78 },
        bell: { freq1: 1100, freq2: 743, filter: 1200, decay: 0.32, gain: 0.3, reverbSend: 0.5 },
      },
    },
  },
  {
    id: 'velocity-breaks',
    name: 'Velocity Breaks',
    origin: 'factory',
    reference: {
      referent:
        'the Amen break — a 1969 acoustic kit (G.C. Coleman, The Winstons), sampled and sped up',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [14][15]',
      reachable:
        'kick/snare/rimshot/hitom/lowtom approximate — a recording of a real kit, so the transient ' +
        'detail is out of reach; ride/crash/bell no, bronze is not bandpassed noise; and the ' +
        'identity is groove and ghost notes, which live in drumGrids.ts rather than here.',
    },
    patch: {
      outputTrimDb: 2.6,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 130, freqEnd: 50, pitchTime: 0.012, decay: 0.12, gain: 0.95, clickFreq: 2600, clickLevel: 0.22, clickDecay: 0.006, reverbSend: 0.12 },
        snare: { bodyFreqStart: 280, bodyFreqEnd: 241, bodyTime: 0.02, bodyDecay: 0.06, bodyGain: 0.45, bodyFreqStart2: 532, bodyFreqEnd2: 458, bodyGain2: 0.27, noiseFilter: 2200, noiseDecay: 0.13, noiseGain: 0.78, reverbSend: 0.18 },
        rimshot: { bodyFreqStart: 610, bodyFreqEnd: 590, bodyTime: 0.004, bodyDecay: 0.055, bodyGain: 0.48, bodyFreqStart2: 2100, bodyFreqEnd2: 2020, bodyGain2: 0.52, noiseFilter: 3800, noiseDecay: 0.018, noiseGain: 0.13, reverbSend: 0.2 },
        clap: { filter: 1600, decay: 0.13, gain: 0.45, reverbSend: 0.15 },
        hihat: { filter: 8800, topCut: 14000, decay: 0.022, gain: 0.34, metal: 0.3 },
        openhat: { filter: 7200, topCut: 13000, decay: 0.16, gain: 0.38, metal: 0.3 },
        hitom: { freqStart: 257, freqEnd: 190, pitchTime: 0.07, decay: 0.08, gain: 0.6, reverbSend: 0.18 },
        lowtom: { freqStart: 128, freqEnd: 95, pitchTime: 0.1, decay: 0.16, gain: 0.6, reverbSend: 0.18 },
        ride: { tone: 138, ping: 0.5, pingFilter: 4600, pingDecay: 0.09, washFilter: 8400, washDecay: 1.3, bodyFilter: 480, metal: 0.3, gain: 0.33, reverbSend: 0.22 },
        crash: { filter: 6400, decay: 0.8, gain: 0.5, reverbSend: 0.22, metal: 0.4 },
        bell: { freq1: 1700, freq2: 1150, filter: 2000, decay: 0.5, gain: 0.26, reverbSend: 0.25 },
      },
    },
  },
  {
    id: 'sub-weight',
    name: 'Sub Weight',
    origin: 'factory',
    reference: {
      referent: 'dubstep at 140 BPM, halftime — transient-shaped kick and snare over a sub layer',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [16][17]',
      reachable:
        'kick/snare/clap yes — dubstep drums are themselves synthesised and layered, so there is no ' +
        'vintage box to fall short of; hitom/lowtom yes; hihat/openhat yes; ride/crash/bell ' +
        'approximate.',
    },
    patch: {
      outputTrimDb: -1.5,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 100, freqEnd: 36.71, pitchTime: 0.02, decay: 0.5, gain: 1, clickFreq: 1600, clickLevel: 0.28, clickDecay: 0.008, reverbSend: 0.15 },
        snare: { bodyFreqStart: 210, bodyFreqEnd: 181, bodyTime: 0.03, bodyDecay: 0.16, bodyGain: 0.55, bodyFreqStart2: 546, bodyFreqEnd2: 471, bodyGain2: 0.33, noiseFilter: 1600, noiseDecay: 0.3, noiseGain: 0.8, reverbSend: 0.45 },
        rimshot: { bodyFreqStart: 430, bodyFreqEnd: 415, bodyTime: 0.007, bodyDecay: 0.11, bodyGain: 0.5, bodyFreqStart2: 1580, bodyFreqEnd2: 1520, bodyGain2: 0.5, noiseFilter: 2800, noiseDecay: 0.035, noiseGain: 0.16, reverbSend: 0.45 },
        clap: { filter: 1500, decay: 0.32, gain: 0.6, reverbSend: 0.4 },
        hihat: { filter: 7200, topCut: 13000, decay: 0.035, gain: 0.3, metal: 0.35 },
        openhat: { filter: 6200, topCut: 12000, decay: 0.3, gain: 0.34, metal: 0.35 },
        hitom: { freqStart: 194, freqEnd: 144, pitchTime: 0.1, decay: 0.21, gain: 0.7, reverbSend: 0.3 },
        lowtom: { freqStart: 97, freqEnd: 72, pitchTime: 0.14, decay: 0.4, gain: 0.7, reverbSend: 0.3 },
        ride: { tone: 128, ping: 0.4, pingFilter: 3900, pingDecay: 0.13, washFilter: 7400, washDecay: 2.2, bodyFilter: 400, metal: 0.35, gain: 0.34, reverbSend: 0.5 },
        crash: { filter: 5600, decay: 1.2, gain: 0.6, reverbSend: 0.5, metal: 0.45 },
        bell: { freq1: 840, freq2: 568, filter: 920, decay: 0.48, gain: 0.32, reverbSend: 0.5 },
      },
    },
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    origin: 'factory',
    reference: {
      referent: 'Berlin / warehouse techno — saturated 909 kick into a mono low-passed reverb',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [18][19][20]',
      reachable:
        'kick yes now that kick.reverbSend exists — the defining trait is routing, not values; ' +
        'snare/clap yes, overdriven is a gain and decay setting; hihat/openhat approximate; ' +
        'ride/crash/bell approximate. This is the shortest-decay kit in the library, and that is ' +
        'the correct fit for techno\'s rigid hats and crushing kick ' +
        '(docs/research/2026-09-06-genre-drum-voice-selection.md, Part 4) — it is deliberately NOT ' +
        'the fit for a long-tail grid: `ambient-sparse-drift` used to name this kit and was moved ' +
        'to Acoustic Studio for that reason (src/data/vibes.ts, deep-ambient).',
    },
    patch: {
      outputTrimDb: 0.8,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 150, freqEnd: 40, pitchTime: 0.02, decay: 0.4, gain: 1, clickFreq: 1100, clickLevel: 0.35, clickDecay: 0.008, reverbSend: 0.45 },
        snare: { bodyFreqStart: 220, bodyFreqEnd: 189, bodyTime: 0.03, bodyDecay: 0.1, bodyGain: 0.4, bodyFreqStart2: 422, bodyFreqEnd2: 363, bodyGain2: 0.24, noiseFilter: 1800, noiseDecay: 0.14, noiseGain: 0.62, reverbSend: 0.4 },
        rimshot: { bodyFreqStart: 560, bodyFreqEnd: 540, bodyTime: 0.004, bodyDecay: 0.07, bodyGain: 0.42, bodyFreqStart2: 2000, bodyFreqEnd2: 1920, bodyGain2: 0.58, noiseFilter: 3600, noiseDecay: 0.022, noiseGain: 0.13, reverbSend: 0.4 },
        clap: { filter: 1200, decay: 0.3, gain: 0.7, reverbSend: 0.35 },
        hihat: { filter: 8800, topCut: 14000, decay: 0.022, gain: 0.34, metal: 0.8 },
        openhat: { filter: 7200, topCut: 13000, decay: 0.16, gain: 0.38, metal: 0.8 },
        hitom: { freqStart: 216, freqEnd: 160, pitchTime: 0.07, decay: 0.09, gain: 0.65, reverbSend: 0.4 },
        lowtom: { freqStart: 124, freqEnd: 92, pitchTime: 0.1, decay: 0.18, gain: 0.65, reverbSend: 0.4 },
        ride: { tone: 142, ping: 0.6, pingFilter: 4700, pingDecay: 0.11, washFilter: 8600, washDecay: 2, bodyFilter: 520, metal: 0.8, gain: 0.32, reverbSend: 0.45 },
        crash: { filter: 6600, decay: 1, gain: 0.5, reverbSend: 0.45, metal: 0.82 },
        bell: { freq1: 1150, freq2: 776, filter: 1250, decay: 0.36, gain: 0.29, reverbSend: 0.45 },
      },
    },
  },
  {
    id: 'tight-pocket',
    name: 'Tight Pocket',
    origin: 'factory',
    reference: {
      referent:
        '"Funky Drummer" (Clyde Stubblefield, King Studios 1969) — a kick deadened with blankets, ' +
        'no gates or compression',
      source:
        'docs/research/2026-09-06-drum-kit-identities.md §1 [21][22]; the source names the kick ' +
        'shell as a Ludwig Vistalite, dropped here as unverifiable — Vistalite shells did not ship ' +
        'until c.1972, three years after this 1969 session, so the model cannot be right even ' +
        'though the recording and its blanket-damped sound are not in question',
      reachable:
        'kick approximate — the deadening is physical, a blanket, not a filter; snare/rimshot ' +
        'approximate, the Acrolite\'s 6-10 kHz head sound needs a second noise band; hitom/lowtom ' +
        'yes; hihat/openhat approximate, 14" Zildjian K; crash absent from the referent by design ' +
        'and ride/bell out of reach as bronze.',
    },
    patch: {
      outputTrimDb: 3.7,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        // `reverbSend: 0.05` is a FLOOR, not a taste choice: do not "tidy" it
        // to 0. check:drums' spread() asserts max >= factor * min, so one
        // preset at exactly 0 makes the requirement 0 and the whole check
        // passes for any factor. This is the driest preset in the catalogue
        // and 0.05 is how it says so without going mute on the gate.
        kick: { freqStart: 120, freqEnd: 58, pitchTime: 0.013, decay: 0.13, gain: 0.85, clickFreq: 2200, clickLevel: 0.25, clickDecay: 0.006, reverbSend: 0.05 },
        snare: { bodyFreqStart: 260, bodyFreqEnd: 224, bodyTime: 0.03, bodyDecay: 0.08, bodyGain: 0.5, bodyFreqStart2: 481, bodyFreqEnd2: 414, bodyGain2: 0.3, noiseFilter: 1900, noiseDecay: 0.11, noiseGain: 0.62, reverbSend: 0.12 },
        rimshot: { bodyFreqStart: 800, bodyFreqEnd: 780, bodyTime: 0.004, bodyDecay: 0.045, bodyGain: 0.55, bodyFreqStart2: 2450, bodyFreqEnd2: 2350, bodyGain2: 0.35, noiseFilter: 4000, noiseDecay: 0.018, noiseGain: 0.1, reverbSend: 0.15 },
        clap: { filter: 1300, decay: 0.16, gain: 0.5, reverbSend: 0.12 },
        hihat: { filter: 3600, topCut: 9000, decay: 0.045, gain: 0.26, metal: 0.2 },
        openhat: { filter: 3200, topCut: 8500, decay: 0.3, gain: 0.28, metal: 0.2 },
        hitom: { freqStart: 243, freqEnd: 180, pitchTime: 0.07, decay: 0.09, gain: 0.65, reverbSend: 0.08 },
        lowtom: { freqStart: 122, freqEnd: 90, pitchTime: 0.1, decay: 0.18, gain: 0.65, reverbSend: 0.08 },
        ride: { tone: 130, ping: 0.75, pingFilter: 4000, pingDecay: 0.1, washFilter: 7000, washDecay: 1.4, bodyFilter: 420, metal: 0.2, gain: 0.36, reverbSend: 0.18 },
        crash: { filter: 5400, decay: 0.9, gain: 0.48, reverbSend: 0.15, metal: 0.3 },
        bell: { freq1: 880, freq2: 594, filter: 960, decay: 0.35, gain: 0.33, reverbSend: 0.18 },
      },
    },
  },
  {
    id: 'acoustic-studio',
    name: 'Acoustic Studio',
    origin: 'factory',
    reference: {
      referent: 'a close-miked acoustic rock kit',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [23]',
      reachable:
        'kick yes, 60-100 Hz body with a 2-4 kHz beater click; snare/rimshot yes, 150-200 Hz ' +
        'fatness plus a head band; hitom/lowtom yes, and genuinely long in a room; hihat/openhat ' +
        'approximate; ride/crash/bell are the ceiling — bandpassed noise is not bronze, and this is ' +
        'the kit where that is most audible because the referent is nothing but real cymbals.',
    },
    patch: {
      outputTrimDb: -0.5,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 180, freqEnd: 65, pitchTime: 0.012, decay: 0.32, gain: 0.9, clickFreq: 3000, clickLevel: 0.28, clickDecay: 0.008, reverbSend: 0.28 },
        snare: { bodyFreqStart: 240, bodyFreqEnd: 206, bodyTime: 0.03, bodyDecay: 0.2, bodyGain: 0.55, bodyFreqStart2: 439, bodyFreqEnd2: 377, bodyGain2: 0.33, noiseFilter: 1400, noiseDecay: 0.26, noiseGain: 0.5, reverbSend: 0.35 },
        rimshot: { bodyFreqStart: 760, bodyFreqEnd: 740, bodyTime: 0.004, bodyDecay: 0.05, bodyGain: 0.56, bodyFreqStart2: 2350, bodyFreqEnd2: 2260, bodyGain2: 0.34, noiseFilter: 4200, noiseDecay: 0.02, noiseGain: 0.11, reverbSend: 0.45 },
        clap: { filter: 1400, decay: 0.32, gain: 0.55, reverbSend: 0.4 },
        hihat: { filter: 6400, topCut: 13000, decay: 0.085, gain: 0.36, metal: 0.15 },
        openhat: { filter: 5400, topCut: 13000, decay: 0.5, gain: 0.42, metal: 0.15 },
        hitom: { freqStart: 236, freqEnd: 175, pitchTime: 0.1, decay: 0.24, gain: 0.75, reverbSend: 0.5 },
        lowtom: { freqStart: 135, freqEnd: 100, pitchTime: 0.14, decay: 0.45, gain: 0.75, reverbSend: 0.5 },
        ride: { tone: 122, ping: 0.45, pingFilter: 3600, pingDecay: 0.15, washFilter: 7000, washDecay: 2.5, bodyFilter: 320, metal: 0.15, gain: 0.38, reverbSend: 0.5 },
        crash: { filter: 5000, decay: 2, gain: 0.6, reverbSend: 0.5, metal: 0.25 },
        bell: { freq1: 1700, freq2: 1150, filter: 2000, decay: 0.55, gain: 0.31, reverbSend: 0.5 },
      },
    },
  },
  {
    id: 'warm-riddim',
    name: 'Warm Riddim',
    origin: 'factory',
    reference: {
      referent: 'reggae one drop (Carlton Barrett) and its dub treatment (King Tubby)',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [24][25][26][27]',
      reachable:
        'rimshot YES and this is the best return in the library — a cross-stick is a short pitched ' +
        'wooden tock, which a triangle oscillator with a fast decay does well, and the one drop ' +
        'puts kick and cross-stick together on beat 3; kick/snare yes; hihat/openhat yes; ' +
        'hitom/lowtom yes; ride/crash/bell approximate. Dub\'s tape echo is an effect-rack question, ' +
        'not a kit one.',
    },
    patch: {
      outputTrimDb: 2.7,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        // No beater click in the legacy kit: `clickLevel: 0` is the disabled
        // state, and the two siblings are where a raised click would land.
        kick: { freqStart: 100, freqEnd: 52, pitchTime: 0.025, decay: 0.28, gain: 0.85, clickFreq: 2000, clickLevel: 0, clickDecay: 0.01, reverbSend: 0.35 },
        // Two values on this row are load-bearing: bodyTime 0.01 is the
        // MINIMUM of spread('snare.bodyTime') (0.02 makes that spread 1.5x and
        // fails the gate), and noiseDecay 0.06 is what separates this preset
        // from Retro Drive now that a 900 Hz body no longer does (measured:
        // 1.12, against 0.766 at 0.08). This is an ordinary snare — reggae's
        // backbeat lives on `rimshot` below — so do NOT move it back up
        // toward 900 Hz.
        snare: { bodyFreqStart: 250, bodyFreqEnd: 213, bodyTime: 0.01, bodyDecay: 0.09, bodyGain: 0.5, bodyFreqStart2: 463, bodyFreqEnd2: 392, bodyGain2: 0.3, noiseFilter: 2400, noiseDecay: 0.06, noiseGain: 0.5, reverbSend: 0.45 },
        // The cross-stick, glided 900->875 rather than 900->800: a click does
        // not sweep a fifth of an octave. Its second partial breaks the
        // catalogue's 1.85 rule on purpose — 1.85 over a 900 Hz body lands at
        // 1665 Hz, shrill and outside the click this row exists to make — so
        // it uses 1.50 and a 0.35 gain factor instead. It sits at 875 Hz,
        // 2.11x the catalogue's lowest rimshot (Sub Weight, 415) and 1.12x its
        // next-highest (Tight Pocket, 780), by design; do not "correct" it
        // toward them.
        rimshot: { bodyFreqStart: 900, bodyFreqEnd: 875, bodyTime: 0.004, bodyDecay: 0.045, bodyGain: 0.55, bodyFreqStart2: 1350, bodyFreqEnd2: 1310, bodyGain2: 0.19, noiseFilter: 4000, noiseDecay: 0.018, noiseGain: 0.1, reverbSend: 0.5 },
        clap: { filter: 1000, decay: 0.3, gain: 0.45, reverbSend: 0.5 },
        hihat: { filter: 5200, topCut: 10000, decay: 0.05, gain: 0.34, metal: 0.25 },
        openhat: { filter: 4400, topCut: 9500, decay: 0.42, gain: 0.38, metal: 0.25 },
        hitom: { freqStart: 203, freqEnd: 150, pitchTime: 0.1, decay: 0.18, gain: 0.6, reverbSend: 0.45 },
        lowtom: { freqStart: 101, freqEnd: 75, pitchTime: 0.14, decay: 0.35, gain: 0.6, reverbSend: 0.45 },
        ride: { tone: 126, ping: 0.35, pingFilter: 3700, pingDecay: 0.14, washFilter: 7200, washDecay: 2.3, bodyFilter: 360, metal: 0.25, gain: 0.3, reverbSend: 0.5 },
        crash: { filter: 4800, decay: 1.5, gain: 0.48, reverbSend: 0.5, metal: 0.35 },
        bell: { freq1: 1050, freq2: 710, filter: 1150, decay: 0.42, gain: 0.3, reverbSend: 0.5 },
      },
    },
  },
  {
    id: 'lo-fi-vinyl',
    name: 'Lo-Fi Vinyl',
    origin: 'factory',
    reference: {
      referent: 'lo-fi hip hop through an E-mu SP-1200 — 12-bit at 26.04 kHz',
      source: 'docs/research/2026-09-06-drum-kit-identities.md §1 [28][29][30]',
      reachable:
        'hihat/openhat yes now that hat.topCut exists — the SP-1200 folds the top back and softens ' +
        'transients, and until slice 3 this kit had the BRIGHTEST hat in the set, pointed the wrong ' +
        'way; kick/snare/rimshot approximate — the sound is the converter, not the drum; ' +
        'hitom/lowtom yes; ride/crash/bell approximate. True bit reduction is an engine feature ' +
        'nobody has built.',
    },
    patch: {
      outputTrimDb: 3.2,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 95, freqEnd: 45, pitchTime: 0.03, decay: 0.32, gain: 0.8, clickFreq: 900, clickLevel: 0.15, clickDecay: 0.012, reverbSend: 0.18 },
        snare: { bodyFreqStart: 175, bodyFreqEnd: 151, bodyTime: 0.03, bodyDecay: 0.15, bodyGain: 0.42, bodyFreqStart2: 327, bodyFreqEnd2: 282, bodyGain2: 0.25, noiseFilter: 1100, noiseDecay: 0.16, noiseGain: 0.3, reverbSend: 0.28 },
        rimshot: { bodyFreqStart: 720, bodyFreqEnd: 700, bodyTime: 0.005, bodyDecay: 0.055, bodyGain: 0.55, bodyFreqStart2: 2200, bodyFreqEnd2: 2120, bodyGain2: 0.35, noiseFilter: 3400, noiseDecay: 0.022, noiseGain: 0.12, reverbSend: 0.28 },
        clap: { filter: 950, decay: 0.24, gain: 0.42, reverbSend: 0.22 },
        // hihat.topCut is the LOW END of check:drums' spread('hihat.topCut',
        // 2.0): Chrome Pulse's 18000 clears the floor at exactly 2.40x this
        // value, and the second-lowest (Tight Pocket, 9000) would land the
        // ratio on exactly 2.00 if this one were ever raised — the check would
        // then pass only on the `>=`. Raising this number puts the gate on its
        // boundary.
        hihat: { filter: 3600, topCut: 7500, decay: 0.045, gain: 0.26, metal: 0.3 },
        openhat: { filter: 3200, topCut: 7000, decay: 0.3, gain: 0.28, metal: 0.3 },
        hitom: { freqStart: 173, freqEnd: 128, pitchTime: 0.1, decay: 0.16, gain: 0.55, reverbSend: 0.22 },
        lowtom: { freqStart: 95, freqEnd: 70, pitchTime: 0.14, decay: 0.3, gain: 0.55, reverbSend: 0.22 },
        ride: { tone: 120, ping: 0.3, pingFilter: 3500, pingDecay: 0.16, washFilter: 7000, washDecay: 1.9, bodyFilter: 300, metal: 0.3, gain: 0.28, reverbSend: 0.3 },
        crash: { filter: 4600, decay: 1, gain: 0.4, reverbSend: 0.3, metal: 0.38 },
        bell: { freq1: 900, freq2: 608, filter: 980, decay: 0.4, gain: 0.25, reverbSend: 0.3 },
      },
    },
  },
  {
    id: 'dusty-break',
    name: 'Dusty Break',
    origin: 'factory',
    reference: {
      referent: 'boom bap — acoustic breaks chopped through a 12-bit SP-1200 / SP-12',
      source:
        'docs/research/2026-09-06-drum-kit-identities.md §1, §5.1 [28][29]; drumGrids.ts provenance',
      reachable:
        'kick/snare/rimshot approximate — the referent is a sampled acoustic kit twice removed, ' +
        'once by the room and once by the converter; hitom/lowtom yes; hihat/openhat yes, dusty is ' +
        'a decay and a topCut; ride/crash/bell approximate. It is deliberately NOT 808 Vintage: ' +
        'boom bap instruments are breaks through a 12-bit sampler, the opposite of a bridged-T ' +
        'sine.',
    },
    patch: {
      outputTrimDb: 0.8,
      filter: { type: 'lowpass', cutoff: 12000, resonance: 0.7 },
      voices: {
        kick: { freqStart: 150, freqEnd: 52, pitchTime: 0.02, decay: 0.2, gain: 0.95, clickFreq: 2400, clickLevel: 0.3, clickDecay: 0.006, reverbSend: 0.2 },
        snare: { bodyFreqStart: 250, bodyFreqEnd: 215, bodyTime: 0.03, bodyDecay: 0.12, bodyGain: 0.55, bodyFreqStart2: 465, bodyFreqEnd2: 400, bodyGain2: 0.33, noiseFilter: 1800, noiseDecay: 0.18, noiseGain: 0.7, reverbSend: 0.25 },
        rimshot: { bodyFreqStart: 780, bodyFreqEnd: 760, bodyTime: 0.004, bodyDecay: 0.048, bodyGain: 0.54, bodyFreqStart2: 2400, bodyFreqEnd2: 2300, bodyGain2: 0.36, noiseFilter: 3900, noiseDecay: 0.019, noiseGain: 0.11, reverbSend: 0.3 },
        clap: { filter: 1300, decay: 0.18, gain: 0.5, reverbSend: 0.15 },
        hihat: { filter: 7000, topCut: 11000, decay: 0.034, gain: 0.3, metal: 0.25 },
        openhat: { filter: 5200, topCut: 9500, decay: 0.22, gain: 0.34, metal: 0.25 },
        hitom: { freqStart: 246, freqEnd: 182, pitchTime: 0.06, decay: 0.16, gain: 0.7, reverbSend: 0.25 },
        lowtom: { freqStart: 128, freqEnd: 95, pitchTime: 0.08, decay: 0.3, gain: 0.7, reverbSend: 0.25 },
        ride: { tone: 132, ping: 0.55, pingFilter: 4100, pingDecay: 0.12, washFilter: 7600, washDecay: 1.7, bodyFilter: 440, metal: 0.25, gain: 0.33, reverbSend: 0.3 },
        crash: { filter: 4800, decay: 1.1, gain: 0.5, reverbSend: 0.3, metal: 0.34 },
        bell: { freq1: 1700, freq2: 1150, filter: 2000, decay: 0.52, gain: 0.27, reverbSend: 0.3 },
      },
    },
  },
];
