import { audibleAtDb, defaultRouteFor, oscillatorBalance, writeOscillatorBalance } from './synthPatch';
import type {
  ActiveSynth,
  LfoParams,
  ModRoute,
  OscillatorParams,
  OscillatorWaveform,
  SubtractiveParams,
} from '@/types/synth';

/**
 * The Simple view of a subtractive patch, as pure functions over the patch the
 * Pro surface edits (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md; layout:
 * the prototype's Variant B).
 *
 * Simple is a LOSSLESS VIEW, which has a precise meaning here: it stores
 * nothing of its own, and every control but Shape reads and writes exactly ONE
 * canonical parameter — the same field the Pro panel's own knob writes. Shape
 * is the single documented exception, a reversible equal-power crossfade over
 * the two oscillator LEVELS (`writeOscillatorBalance`), which is still
 * reversible and still touches only those two numbers.
 *
 * Consequences a reader should not have to rediscover:
 *
 * - **Nothing here is stored.** A descriptor ("Warm", "Wide") is computed from
 *   the value every time it is read. A Simple-only field would be a second
 *   source of truth for a sound the engine already has one for, and the first
 *   preset load would put the two out of step.
 * - **Simple has no control over unison detune at all.** Pro's *Spread* is
 *   `common.unisonDetuneCents`; Pro's *Width* and Simple's *Width* are both
 *   `common.stereoWidth`. The three spread-ish names drifted into each other
 *   once and the design pins them apart; `subtractiveSimple.test.ts` holds it.
 * - **Reference identity is part of the contract.** A write returns the same
 *   objects for every branch it did not touch, so a consumer comparing patch
 *   branches by reference sees exactly one change per gesture.
 *
 * Pure math over a patch, per the layering rules for `src/utils/`: no store, no
 * engine, no React. The knob RANGES and the group layout are deliberately not
 * here — they are what the panel draws, not what the patch means.
 */

export const SIMPLE_CONTROL_IDS = [
  'shape',
  'weight',
  'brightness',
  'bite',
  'attack',
  'tail',
  'movement',
  'width',
] as const;

export type SimpleControlId = (typeof SIMPLE_CONTROL_IDS)[number];

/** What one Simple control reads: the canonical value, and the phrase for it. */
export interface SimpleReading {
  /** The canonical parameter's own value, in its own unit. Never rescaled. */
  value: number;
  /** Derived from `value` on every read. Never stored, never persisted. */
  descriptor: string;
}

export type SimpleSynthReadings = Record<SimpleControlId, SimpleReading>;

type SubtractiveSynth = ActiveSynth<'subtractive'>;

/**
 * The three-band phrase every descriptor uses: below `low`, below `high`,
 * above. One helper rather than eight nested ternaries, for the reason the
 * previous Simple panel's `describe` gave — the phrasing IS the behaviour of
 * this view, and a band edge that drifts inside a ternary chain is invisible.
 */
function band(value: number, low: number, high: number, under: string, mid: string, over: string) {
  if (value < low) return under;
  if (value < high) return mid;
  return over;
}

/**
 * Band edges, each chosen for what a listener hears at it rather than for
 * where it sits on a knob. They are calibration and they are one-way: from the
 * commit that adds them, an edge moves because the SOUND at it was described
 * wrongly, never to make a screenshot match.
 *
 * - Sub level: a sub more than 40 dB under the oscillators is felt, not heard;
 *   within 12 dB of them it owns the bottom of the sound.
 * - Cutoff: below 700 Hz a lowpass has taken the harmonics off a mid-register
 *   note entirely; above 5 kHz it is above them and the sound reads as open.
 * - Resonance: a peak under 0.2 is not audible as a peak; over 0.6 it whistles.
 * - Attack: 20 ms is roughly where an onset stops reading as a click; a quarter
 *   second is where it reads as a swell rather than a note starting.
 * - Release: under 250 ms the note stops with the key; over 1.5 s it hangs.
 * - LFO depth: under 5% is not movement; half depth and up is obvious motion.
 * - Stereo width: under 0.2 is a point source, 0.7 and up is the full spread.
 */
const WEIGHT_LIGHT_DB = -40;
const WEIGHT_HEAVY_DB = -12;
const BRIGHT_DARK_HZ = 700;
const BRIGHT_OPEN_HZ = 5000;
const BITE_SMOOTH = 0.2;
const BITE_SHARP = 0.6;
const ATTACK_INSTANT_S = 0.02;
const ATTACK_SOFT_S = 0.25;
const TAIL_SHORT_S = 0.25;
const TAIL_LASTING_S = 1.5;
const MOVEMENT_STILL = 0.05;
const MOVEMENT_STRONG = 0.5;
const WIDTH_CENTRED = 0.2;
const WIDTH_WIDE = 0.7;

/**
 * The balance at which one layer is carrying the sound rather than blending
 * with the other. Symmetric about centre, so neither oscillator is privileged.
 */
const SHAPE_DOMINANT = 0.35;

/** The words Simple uses for a waveform. Short, because a knob caption is ~48px. */
const WAVEFORM_WORDS: Record<OscillatorWaveform, string> = {
  sawtooth: 'Saw',
  square: 'Square',
  triangle: 'Triangle',
  sine: 'Sine',
};

/** The two oscillator levels Shape is a balance of. */
function levelPair(synth: SubtractiveParams) {
  return { osc1Db: synth.oscillators[0].levelDb, osc2Db: synth.oscillators[1].levelDb };
}

/**
 * Shape's phrase names the waveform actually carrying the sound.
 *
 * A balance has no three-band adjective of its own — at either end ONE layer is
 * the sound, and only the middle is a blend — so a word like "Edgy" at 64%
 * would be describing a waveform the patch may not even hold. Naming it is both
 * derived and true.
 */
function shapeDescriptor(synth: SubtractiveParams, balance: number): string {
  if (balance <= SHAPE_DOMINANT) return WAVEFORM_WORDS[synth.oscillators[0].waveform];
  if (balance >= 1 - SHAPE_DOMINANT) return WAVEFORM_WORDS[synth.oscillators[1].waveform];
  return 'Blended';
}

/**
 * The stereo-width phrase, shared by the Width control and the header summary
 * so the two can never contradict each other about the same number.
 */
function widthDescriptor(stereoWidth: number): string {
  return band(stereoWidth, WIDTH_CENTRED, WIDTH_WIDE, 'Centred', 'Spacious', 'Wide');
}

/** The eight readings, each one its canonical parameter plus a derived phrase. */
export function readSubtractiveSimple(activeSynth: SubtractiveSynth): SimpleSynthReadings {
  const { common, synth } = activeSynth.patch;
  const balance = oscillatorBalance(levelPair(synth));

  return {
    shape: { value: balance, descriptor: shapeDescriptor(synth, balance) },
    weight: {
      value: synth.utility.subLevelDb,
      descriptor: band(
        synth.utility.subLevelDb,
        WEIGHT_LIGHT_DB,
        WEIGHT_HEAVY_DB,
        'Light',
        'Full',
        'Heavy',
      ),
    },
    brightness: {
      value: synth.filter.cutoffHz,
      descriptor: band(
        synth.filter.cutoffHz,
        BRIGHT_DARK_HZ,
        BRIGHT_OPEN_HZ,
        'Dark',
        'Open',
        'Bright',
      ),
    },
    bite: {
      value: synth.filter.resonance,
      descriptor: band(synth.filter.resonance, BITE_SMOOTH, BITE_SHARP, 'Smooth', 'Warm', 'Sharp'),
    },
    attack: {
      value: synth.ampEnvelope.attack,
      descriptor: band(
        synth.ampEnvelope.attack,
        ATTACK_INSTANT_S,
        ATTACK_SOFT_S,
        'Instant',
        'Quick',
        'Soft',
      ),
    },
    tail: {
      value: synth.ampEnvelope.release,
      descriptor: band(
        synth.ampEnvelope.release,
        TAIL_SHORT_S,
        TAIL_LASTING_S,
        'Short',
        'Natural',
        'Lasting',
      ),
    },
    movement: {
      value: synth.lfo.depth,
      descriptor: band(synth.lfo.depth, MOVEMENT_STILL, MOVEMENT_STRONG, 'Still', 'Gentle', 'Strong'),
    },
    width: { value: common.stereoWidth, descriptor: widthDescriptor(common.stereoWidth) },
  };
}

/**
 * The header's one-line summary of the patch: two axes rather than eight.
 *
 * The two words are sourced differently on purpose. The SPREAD word is
 * `widthDescriptor` itself — the very phrase the Width knob's own badge shows —
 * because both are statements about `common.stereoWidth`, and a header that
 * invented a synonym could say "Focused" over a badge reading "Centred" and
 * leave the reader deciding which one to believe. The COLOUR word is drawn
 * from a set no control uses (`muted` / `rounded` / `vivid`), because it
 * stands in for the whole tone of the patch rather than for the cutoff alone,
 * and reusing Brightness's own band word there WOULD make it read as a ninth
 * copy of that knob.
 */
export function simpleFeelSummary(activeSynth: SubtractiveSynth): string {
  const { common, synth } = activeSynth.patch;
  const colour = band(synth.filter.cutoffHz, BRIGHT_DARK_HZ, BRIGHT_OPEN_HZ, 'muted', 'rounded', 'vivid');
  return `${widthDescriptor(common.stereoWidth)} & ${colour}`;
}

/** A new patch with one subtractive branch replaced; every other one is `===`. */
function withSynth(activeSynth: SubtractiveSynth, next: Partial<SubtractiveParams>): SubtractiveSynth {
  return {
    ...activeSynth,
    patch: { ...activeSynth.patch, synth: { ...activeSynth.patch.synth, ...next } },
  };
}

/**
 * One oscillator at a new level, with `enabled` following the level.
 *
 * `enabled: false` is this model's spelling of SILENCE — `OscillatorParams`
 * says so outright, and the patch never stores `-Infinity` as a level — so the
 * flag is part of the level coordinate Shape transforms, not a second
 * parameter beside it. Writing the number alone is how Shape came to be able
 * to MUTE a patch: the Init preset ships oscillator 2 as
 * `{ enabled: false, levelDb: SYNTH_GAIN_FLOOR_DB }`, so a balance of 1 moved
 * every bit of power onto a switched-off oscillator and drove the audible one
 * down to the floor — a knob that silences the instrument and can only be
 * undone by opening Pro.
 *
 * The rule runs BOTH ways, which is what keeps the transform reversible in the
 * patch and not merely in the balance: a level that lands above the floor
 * enables, a level that lands ON it disables. Enabling only would leave an
 * oscillator switched on at silence after a round trip, so the patch a user
 * returned to would not be the patch they left.
 */
function withLevel(oscillator: OscillatorParams, levelDb: number): OscillatorParams {
  return { ...oscillator, levelDb, enabled: audibleAtDb(levelDb) };
}

/**
 * The route Movement assigns when it lifts a patch off zero.
 *
 * `filter-cutoff` rather than `amplitude`: a cutoff wobble is audible on every
 * patch in the library, bass and pad alike, and it cannot take a gain through
 * zero however deep the LFO goes. The AMOUNT is not chosen here — it is
 * whatever Pro would offer for the same destination, so the two surfaces
 * cannot come to disagree about what a fresh route is.
 */
const MOVEMENT_DEFAULT_ROUTE: ModRoute = defaultRouteFor('filter-cutoff');

/**
 * `route: null` is this model's spelling of NO MODULATION — `isSilent` in the
 * LFO bank gates on `route === null || depth === 0`, so a depth written over a
 * null route is inert. The flag is therefore part of the depth coordinate
 * Movement transforms, exactly as `enabled` is part of the level coordinate
 * Shape transforms, and for the same reason: 18 of the factory presets ship
 * `route: null`, so writing the number alone made Movement a knob that reads
 * 'Strong' while producing nothing, undoable only by opening Pro.
 *
 * One way only, unlike `withLevel`. A depth of zero is already silent with the
 * route in place, and clearing it would throw away a destination the user may
 * have chosen in Pro — so dropping to zero parks the route rather than
 * deleting it, and lifting off zero again returns the same modulation.
 */
function withDepth(lfo: LfoParams, depth: number): LfoParams {
  if (depth <= 0 || lfo.route !== null) return { ...lfo, depth };
  return { ...lfo, depth, route: MOVEMENT_DEFAULT_ROUTE };
}

/**
 * Write one Simple control back onto the patch.
 *
 * `value` is in the canonical parameter's OWN unit — Hz for Brightness, seconds
 * for Attack and Tail, dB for Weight — never a normalized 0..1 the caller has
 * to remember to convert. A projection that rescaled would need an inverse for
 * every control and would stop being lossless the first time one of them
 * rounded.
 *
 * Nothing is clamped here except Shape, whose clamp belongs to
 * `writeOscillatorBalance`: a control's range is what the panel offers, and a
 * silent clamp in the adapter would hide a range the panel got wrong.
 */
export function writeSubtractiveSimple(
  activeSynth: SubtractiveSynth,
  control: SimpleControlId,
  value: number,
): SubtractiveSynth {
  const { common, synth } = activeSynth.patch;

  switch (control) {
    case 'shape': {
      const next = writeOscillatorBalance(levelPair(synth), value);
      return withSynth(activeSynth, {
        oscillators: [
          withLevel(synth.oscillators[0], next.osc1Db),
          withLevel(synth.oscillators[1], next.osc2Db),
        ],
      });
    }
    case 'weight':
      return withSynth(activeSynth, {
        utility: { ...synth.utility, subLevelDb: value, subEnabled: audibleAtDb(value) },
      });
    case 'brightness':
      return withSynth(activeSynth, { filter: { ...synth.filter, cutoffHz: value } });
    case 'bite':
      return withSynth(activeSynth, { filter: { ...synth.filter, resonance: value } });
    case 'attack':
      return withSynth(activeSynth, { ampEnvelope: { ...synth.ampEnvelope, attack: value } });
    case 'tail':
      return withSynth(activeSynth, { ampEnvelope: { ...synth.ampEnvelope, release: value } });
    case 'movement':
      return withSynth(activeSynth, { lfo: withDepth(synth.lfo, value) });
    case 'width':
      return {
        ...activeSynth,
        patch: { ...activeSynth.patch, common: { ...common, stereoWidth: value } },
      };
  }
}
