import type { KnobScale } from '@/utils/knob';
import type { BeatFilterParams, BeatVoiceId, BeatVoices } from '@/types';
import { formatPercent } from '@/utils/gainUnits';

/**
 * The Beat editor's declarative control registry: one descriptor per stored
 * parameter, naming exactly one numeric key.
 *
 * WHY IT IS HERE AND NOT IN `src/data/`. Labels, ranges, tapers and
 * Primary/More placement are UI facts — the design's ownership boundary puts
 * them under `components/loop/beat/` for the same reason `BEAT_VOICE_META`
 * lives here, and `src/data/` may hold no function, so the formatters alone
 * would disqualify it.
 *
 * THREE RULES.
 *
 * ONE KEY PER KNOB. There are no macros: every descriptor writes a single
 * field of `BeatVoices`, so what a knob does is readable from its `key` and
 * nothing edits several parameters behind the user's back. `Primary` versus
 * `More` is disclosure only — the same parameter model either way.
 *
 * EXHAUSTIVE, AND TESTED THAT WAY. `primary` plus `more` is exactly that
 * voice's stored key set (`beatControlSchema.test.ts`). A missing key would be
 * a parameter with no knob and no error; an extra one a knob writing a field
 * nothing plays. `outputTrimDb` is NOT in scope here at all — it is measured
 * calibration metadata on the patch, not a voice field, and is not editable.
 *
 * A FAMILY IS ONE TABLE. Snare and rimshot share `BeatSnareParams`, the two
 * hats share `BeatHatParams`, the two toms share `BeatTomParams` — so they
 * share the descriptor array by IDENTITY, not by copy. A range widened for a
 * snare cannot leave the rimshot behind.
 *
 * Ranges are chosen to contain every value the thirteen factory patches hold,
 * with headroom either side; the test that asserts the containment is what
 * stops a re-voiced preset from silently clamping the first time a knob moves.
 */

/**
 * The units this editor reads in. Three come from the spec — Hz for frequency,
 * ms/s for time, percent for linear gain, send and balance — and dB is
 * deliberately absent, because dB is for mixer levels and a voice `gain` is
 * linear preset voicing.
 *
 * `q` is the fourth and belongs to the bus filter alone: resonance is a
 * dimensionless Q, so it has no unit to print and no unit rule to follow. No
 * VOICE control uses it; the schema's exhaustiveness test is what keeps that
 * true, since a `q` on a voice would have to name a voice key to exist at all.
 */
export const BEAT_CONTROL_UNITS = ['hz', 'time', 'percent', 'q'] as const;
export type BeatControlUnit = (typeof BEAT_CONTROL_UNITS)[number];

export interface BeatControl {
  /**
   * The one stored key this knob writes.
   *
   * `string`, not a per-voice key union: `BeatVoices` is a heterogeneous
   * interface, so a union-generic key would narrow to the fields ALL eleven
   * voices share the moment a reader held a `BeatVoiceId` variable. The
   * per-voice checking happens where it can be exact — at construction, where
   * `control<'kick'>` names one voice — and the exhaustiveness test closes the
   * gap by comparing the whole roster against the stored shape.
   */
  key: string;
  /** The knob's visible caption — ~48px wide, so short. */
  label: string;
  unit: BeatControlUnit;
  min: number;
  max: number;
  step: number;
  scale: KnobScale;
  format: (value: number) => string;
}

export interface BeatVoiceControls {
  primary: readonly BeatControl[];
  more: readonly BeatControl[];
}

/** Frequency: Hz up to a kHz, then kHz — a five-digit Hz reading is unreadable
 *  in a knob badge and says nothing a kHz reading does not. Reached through
 *  `formatBeatValue`/a descriptor's own `format`, never named directly: a unit
 *  picks its formatter, so a caller choosing one is a caller that can mismatch. */
function formatHz(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

/** Time: ms below a second, seconds above it. Drum times are mostly ms. */
function formatTime(value: number): string {
  return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
}

/** Q: a bare number, one decimal — there is no unit to print. */
function formatQ(value: number): string {
  return value.toFixed(1);
}

const FORMATTERS: Record<BeatControlUnit, (value: number) => string> = {
  hz: formatHz,
  time: formatTime,
  percent: formatPercent,
  q: formatQ,
};

export function formatBeatValue(unit: BeatControlUnit, value: number): string {
  return FORMATTERS[unit](value);
}

/**
 * One descriptor. The formatter is derived from the unit rather than passed,
 * so a Hz control cannot be given a percent readout by a typo, and a `percent`
 * control's range is fixed at 0..1 linear — the only range a fraction has.
 */
function makeControl(
  key: string,
  label: string,
  unit: BeatControlUnit,
  min: number,
  max: number,
  step: number,
  scale?: KnobScale,
): BeatControl {
  return {
    key,
    label,
    unit,
    min,
    max,
    step,
    // Hz and time are perceptually logarithmic; a fraction is not, and a log
    // taper on one would mean a knob that can never reach zero. The override is
    // for the one control whose taper is not implied by its unit — filter Q,
    // which has shipped linear since the card this editor replaces, and whose
    // feel is not a docs question to re-decide here.
    scale: scale ?? (unit === 'percent' ? 'linear' : ('log' as KnobScale)),
    format: FORMATTERS[unit],
  };
}

/** A voice control: `makeControl` with the key narrowed to that voice's own
 *  fields, which is the ONLY thing this adds. */
function control<V extends BeatVoiceId>(
  key: Extract<keyof BeatVoices[V], string>,
  label: string,
  unit: BeatControlUnit,
  min: number,
  max: number,
  step: number,
  scale?: KnobScale,
): BeatControl {
  return makeControl(key, label, unit, min, max, step, scale);
}

/** A 0..1 fraction: gain, send, balance. */
function pct<V extends BeatVoiceId>(
  key: Extract<keyof BeatVoices[V], string>,
  label: string,
): BeatControl {
  return control<V>(key, label, 'percent', 0, 1, 0.01);
}

const KICK: BeatVoiceControls = {
  primary: [
    control<'kick'>('freqEnd', 'Tune', 'hz', 20, 200, 1),
    control<'kick'>('decay', 'Decay', 'time', 0.02, 2, 0.005),
    pct<'kick'>('gain', 'Level'),
    pct<'kick'>('clickLevel', 'Click'),
  ],
  more: [
    control<'kick'>('freqStart', 'Sweep', 'hz', 40, 400, 1),
    control<'kick'>('pitchTime', 'Drop', 'time', 0.002, 0.2, 0.001),
    control<'kick'>('clickFreq', 'Click Hz', 'hz', 200, 8000, 10),
    control<'kick'>('clickDecay', 'Click Dec', 'time', 0.001, 0.05, 0.001),
    pct<'kick'>('reverbSend', 'Reverb'),
  ],
};

/** Snare AND rimshot: one `BeatSnareParams` family, one table. */
const SNARE: BeatVoiceControls = {
  primary: [
    control<'snare'>('bodyFreqEnd', 'Tune', 'hz', 50, 1200, 1),
    control<'snare'>('bodyDecay', 'Body Dec', 'time', 0.01, 1, 0.005),
    pct<'snare'>('bodyGain', 'Body'),
    control<'snare'>('noiseFilter', 'Noise Hz', 'hz', 200, 12000, 10),
    control<'snare'>('noiseDecay', 'Noise Dec', 'time', 0.005, 1, 0.001),
    pct<'snare'>('noiseGain', 'Noise'),
  ],
  more: [
    control<'snare'>('bodyFreqStart', 'Sweep', 'hz', 60, 1500, 1),
    control<'snare'>('bodyTime', 'Drop', 'time', 0.001, 0.1, 0.001),
    control<'snare'>('bodyFreqStart2', 'P2 Sweep', 'hz', 100, 4000, 1),
    control<'snare'>('bodyFreqEnd2', 'P2 Tune', 'hz', 100, 4000, 1),
    pct<'snare'>('bodyGain2', 'P2 Level'),
    pct<'snare'>('reverbSend', 'Reverb'),
  ],
};

const CLAP: BeatVoiceControls = {
  primary: [
    control<'clap'>('filter', 'Tone', 'hz', 200, 8000, 10),
    control<'clap'>('decay', 'Decay', 'time', 0.02, 1, 0.005),
    pct<'clap'>('gain', 'Level'),
  ],
  more: [pct<'clap'>('reverbSend', 'Reverb')],
};

/** Closed AND open hat: one `BeatHatParams` family, one table. */
const HAT: BeatVoiceControls = {
  primary: [
    control<'hihat'>('filter', 'Tone', 'hz', 500, 14000, 10),
    control<'hihat'>('topCut', 'Top Cut', 'hz', 2000, 20000, 100),
    control<'hihat'>('decay', 'Decay', 'time', 0.005, 1.5, 0.005),
    pct<'hihat'>('gain', 'Level'),
    pct<'hihat'>('metal', 'Metal'),
  ],
  more: [],
};

/** Hi AND low tom: one `BeatTomParams` family, one table. */
const TOM: BeatVoiceControls = {
  primary: [
    control<'hitom'>('freqEnd', 'Tune', 'hz', 30, 400, 1),
    control<'hitom'>('freqStart', 'Sweep', 'hz', 40, 600, 1),
    control<'hitom'>('pitchTime', 'Drop', 'time', 0.005, 0.4, 0.001),
    control<'hitom'>('decay', 'Decay', 'time', 0.02, 2, 0.005),
    pct<'hitom'>('gain', 'Level'),
  ],
  more: [pct<'hitom'>('reverbSend', 'Reverb')],
};

const RIDE: BeatVoiceControls = {
  primary: [
    control<'ride'>('tone', 'Tone', 'hz', 40, 600, 1),
    pct<'ride'>('ping', 'Ping'),
    control<'ride'>('pingDecay', 'Ping Dec', 'time', 0.01, 1, 0.005),
    control<'ride'>('washDecay', 'Wash Dec', 'time', 0.1, 5, 0.01),
    pct<'ride'>('metal', 'Metal'),
    pct<'ride'>('gain', 'Level'),
  ],
  more: [
    control<'ride'>('pingFilter', 'Ping Hz', 'hz', 500, 12000, 10),
    control<'ride'>('washFilter', 'Wash Hz', 'hz', 1000, 16000, 10),
    control<'ride'>('bodyFilter', 'Body Hz', 'hz', 100, 2000, 10),
    pct<'ride'>('reverbSend', 'Reverb'),
  ],
};

const CRASH: BeatVoiceControls = {
  primary: [
    control<'crash'>('filter', 'Tone', 'hz', 500, 14000, 10),
    control<'crash'>('decay', 'Decay', 'time', 0.05, 5, 0.01),
    pct<'crash'>('gain', 'Level'),
    pct<'crash'>('metal', 'Metal'),
  ],
  more: [pct<'crash'>('reverbSend', 'Reverb')],
};

const BELL: BeatVoiceControls = {
  primary: [
    control<'bell'>('freq1', 'Tone', 'hz', 100, 4000, 1),
    control<'bell'>('filter', 'Body', 'hz', 200, 8000, 10),
    control<'bell'>('decay', 'Decay', 'time', 0.02, 2, 0.005),
    pct<'bell'>('gain', 'Level'),
  ],
  more: [
    control<'bell'>('freq2', 'Partial', 'hz', 100, 4000, 1),
    pct<'bell'>('reverbSend', 'Reverb'),
  ],
};

/**
 * The roster, in `BEAT_VOICE_IDS` order so the editor and the engine walk the
 * same list. The three shared tables are referenced, never copied.
 */
export const BEAT_CONTROL_SCHEMA: Record<BeatVoiceId, BeatVoiceControls> = {
  kick: KICK,
  snare: SNARE,
  rimshot: SNARE,
  clap: CLAP,
  hihat: HAT,
  openhat: HAT,
  hitom: TOM,
  lowtom: TOM,
  ride: RIDE,
  crash: CRASH,
  bell: BELL,
};

/**
 * The Beat-wide bus filter's two knobs, in the same descriptor shape as every
 * voice control.
 *
 * They were inline props on the panel, which put them outside the containment
 * test that holds every other parameter's range over the factory library: a
 * cutoff range that no longer reached the shipped 12 kHz would have clamped the
 * patch on first touch with nothing failing. `type` is not here — it is a
 * three-way switch, not a knob, and has no range to contain.
 */
function filterControl(
  key: Extract<keyof BeatFilterParams, string>,
  label: string,
  unit: BeatControlUnit,
  min: number,
  max: number,
  step: number,
  scale?: KnobScale,
): BeatControl {
  return makeControl(key, label, unit, min, max, step, scale);
}

export const BEAT_FILTER_CONTROLS: readonly BeatControl[] = [
  filterControl('cutoff', 'Cutoff', 'hz', 50, 12000, 10),
  filterControl('resonance', 'Res', 'q', 0.1, 20, 0.1, 'linear'),
];

/**
 * One voice parameter, by key.
 *
 * The single cast in the Beat editor, and it is here so it is nowhere else:
 * `BeatVoices` is a heterogeneous interface (the eight families are shaped
 * differently on purpose), so indexing it by a key resolved at runtime has no
 * type. What makes it safe is the schema's exhaustiveness test — a `key` that
 * is not a field of that voice fails there, not silently at a knob.
 */
export function readBeatParam(
  voices: BeatVoices,
  voice: BeatVoiceId,
  key: string,
): number {
  return (voices[voice] as unknown as Record<string, number>)[key];
}
