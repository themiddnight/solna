/**
 * Whole-patch validation for the engine-discriminated synth domain (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "Validation and compatibility").
 *
 * A malformed patch is never partially merged: `sanitizeActiveSynth` either
 * accepts a complete, structurally valid patch (clamping any finite
 * out-of-range number in place) or returns the complete supplied fallback
 * plus at least one `SynthValidationIssue` explaining why. Non-finite or
 * wrong-typed fields, wrong enums, a wrong tuple length, and a route array
 * over its cap all invalidate the WHOLE patch — they never truncate or
 * partially install. There is no migration chain for the old flat
 * `SynthParams` shape: it simply fails validation like any other malformed
 * input and falls back with an issue recorded.
 *
 * Every accepted value is rebuilt field-by-field into a fresh object, so
 * nothing here can hand back a nested object or array that is `===` to a
 * piece of the untrusted input — an installed patch can never alias state a
 * caller still holds a mutable reference to.
 */

import type {
  ActiveSynth,
  AdsrParams,
  ArpSettings,
  CommonVoiceParams,
  FilterParams,
  FilterType,
  LfoParams,
  LfoRate,
  LfoTriggerMode,
  LfoWaveform,
  ModRoute,
  ModTarget,
  NoiseColor,
  NoteDivision,
  NoteDivisionModifier,
  NoteDivisionValue,
  OscillatorParams,
  OscillatorWaveform,
  SubtractiveParams,
  UtilitySourceParams,
  VoiceMode,
} from '@/types/synth';
import { LFO_DB_ROUTE_LIMIT, MOD_ROUTE_RANGES, SYNTH_GAIN_FLOOR_DB } from '@/utils/synthPatch';

export interface SynthValidationIssue {
  /** Dotted/bracketed path into the input value, e.g. `synth.patch.synth.filter.cutoffHz`. */
  path: string;
  message: string;
}

/** Sentinel distinguishing "this field failed validation" from a legitimately valid `null`. */
const INVALID = Symbol('synth-validation-invalid');
type Invalid = typeof INVALID;

function isInvalid(value: unknown): value is Invalid {
  return value === INVALID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Every numeric range below is a validator-owned convention, not a DSP contract. */
const GAIN_DB_MIN = SYNTH_GAIN_FLOOR_DB;
const GAIN_DB_MAX = 0;
const OUTPUT_GAIN_DB_MAX = 12;
const OCTAVE_MIN = -4;
const OCTAVE_MAX = 4;
const SEMITONE_MIN = -12;
const SEMITONE_MAX = 12;
const FINE_CENTS_MIN = -100;
const FINE_CENTS_MAX = 100;
/** "Usable range below Nyquist" (design doc) — the engine clamps further against the live sample rate. */
const CUTOFF_HZ_MIN = 20;
const CUTOFF_HZ_MAX = 20_000;
const DRIVE_DB_MIN = 0;
const DRIVE_DB_MAX = 24;
const ENV_TIME_MIN = 0;
const ENV_TIME_MAX = 20;
const GLIDE_SECONDS_MAX = 5;
const UNISON_VOICES_MIN = 1;
const UNISON_VOICES_MAX = 8;
const UNISON_DETUNE_CENTS_MAX = 100;
const LFO_PHASE_MAX = 360;
const LFO_HZ_MIN = 0.01;
const LFO_HZ_MAX = 20;
// Route amounts come from `MOD_ROUTE_RANGES` (utils/synthPatch.ts), which the
// Pro amount knob reads too, so a stored route is always a value its own knob
// can reach. The dB pair is the arithmetic limit, NOT the patch's level range:
// a dB route is summed into a gain based at 1, so past `1 / GAIN_PER_DB_AT_UNITY`
// the trough goes negative and the voice inverts phase.
const ARP_OCTAVES_MIN = 1;
const ARP_OCTAVES_MAX = 4;

const OSCILLATOR_WAVEFORMS = ['sawtooth', 'square', 'triangle', 'sine'] as const;
const NOISE_COLORS = ['white', 'pink', 'brown'] as const;
const SUB_OCTAVES = [-1, -2] as const;
const FILTER_TYPES = ['lowpass', 'bandpass', 'highpass', 'notch'] as const;
const LFO_WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square', 'sample-and-hold'] as const;
const LFO_TRIGGER_MODES = ['transport', 'note'] as const;
const NOTE_DIVISION_VALUES = [1, 2, 4, 8, 16, 32] as const;
const NOTE_DIVISION_MODIFIERS = ['straight', 'dotted', 'triplet'] as const;
const VOICE_MODES = ['mono', 'poly'] as const;
const SEMITONE_ROUTE_TARGETS = new Set<ModTarget>(['pitch-all', 'osc1-pitch', 'osc2-pitch', 'filter-cutoff']);
const DB_ROUTE_TARGETS = new Set<ModTarget>(['osc1-level', 'osc2-level', 'amplitude']);
const ARP_MODES = ['up', 'down', 'updown', 'random'] as const;
const ARP_RATES = ['4n', '8n', '16n', '32n'] as const;

function clampFinite(raw: unknown, min: number, max: number, path: string, issues: SynthValidationIssue[]): number | Invalid {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    issues.push({ path, message: `expected a finite number, got ${describe(raw)}` });
    return INVALID;
  }
  const clamped = Math.min(max, Math.max(min, raw));
  if (clamped !== raw) {
    issues.push({ path, message: `clamped ${raw} to ${clamped} (range ${min}..${max})` });
  }
  return clamped;
}

function validateBoolean(raw: unknown, path: string, issues: SynthValidationIssue[]): boolean | Invalid {
  if (typeof raw === 'boolean') return raw;
  issues.push({ path, message: `expected a boolean, got ${describe(raw)}` });
  return INVALID;
}

function validateEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  path: string,
  issues: SynthValidationIssue[],
): T | Invalid {
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  issues.push({ path, message: `expected one of ${allowed.join('/')}, got ${describe(raw)}` });
  return INVALID;
}

function validateNumberEnum<T extends number>(
  raw: unknown,
  allowed: readonly T[],
  path: string,
  issues: SynthValidationIssue[],
): T | Invalid {
  if (typeof raw === 'number' && (allowed as readonly number[]).includes(raw)) {
    return raw as T;
  }
  issues.push({ path, message: `expected one of ${allowed.join('/')}, got ${describe(raw)}` });
  return INVALID;
}

function validateOscillator(raw: unknown, path: string, issues: SynthValidationIssue[]): OscillatorParams | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected an oscillator object, got ${describe(raw)}` });
    return INVALID;
  }
  const enabled = validateBoolean(raw.enabled, `${path}.enabled`, issues);
  const waveform = validateEnum<OscillatorWaveform>(raw.waveform, OSCILLATOR_WAVEFORMS, `${path}.waveform`, issues);
  const octave = clampFinite(raw.octave, OCTAVE_MIN, OCTAVE_MAX, `${path}.octave`, issues);
  const semitone = clampFinite(raw.semitone, SEMITONE_MIN, SEMITONE_MAX, `${path}.semitone`, issues);
  const fineCents = clampFinite(raw.fineCents, FINE_CENTS_MIN, FINE_CENTS_MAX, `${path}.fineCents`, issues);
  const levelDb = clampFinite(raw.levelDb, GAIN_DB_MIN, GAIN_DB_MAX, `${path}.levelDb`, issues);
  if (
    isInvalid(enabled) ||
    isInvalid(waveform) ||
    isInvalid(octave) ||
    isInvalid(semitone) ||
    isInvalid(fineCents) ||
    isInvalid(levelDb)
  ) {
    return INVALID;
  }
  return { enabled, waveform, octave, semitone, fineCents, levelDb };
}

function validateUtility(raw: unknown, path: string, issues: SynthValidationIssue[]): UtilitySourceParams | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected a utility source object, got ${describe(raw)}` });
    return INVALID;
  }
  const subEnabled = validateBoolean(raw.subEnabled, `${path}.subEnabled`, issues);
  const subOctave = validateNumberEnum(raw.subOctave, SUB_OCTAVES, `${path}.subOctave`, issues);
  const subLevelDb = clampFinite(raw.subLevelDb, GAIN_DB_MIN, GAIN_DB_MAX, `${path}.subLevelDb`, issues);
  const noiseEnabled = validateBoolean(raw.noiseEnabled, `${path}.noiseEnabled`, issues);
  const noiseColor = validateEnum<NoiseColor>(raw.noiseColor, NOISE_COLORS, `${path}.noiseColor`, issues);
  const noiseLevelDb = clampFinite(raw.noiseLevelDb, GAIN_DB_MIN, GAIN_DB_MAX, `${path}.noiseLevelDb`, issues);
  if (
    isInvalid(subEnabled) ||
    isInvalid(subOctave) ||
    isInvalid(subLevelDb) ||
    isInvalid(noiseEnabled) ||
    isInvalid(noiseColor) ||
    isInvalid(noiseLevelDb)
  ) {
    return INVALID;
  }
  return { subEnabled, subOctave, subLevelDb, noiseEnabled, noiseColor, noiseLevelDb };
}

function validateFilter(raw: unknown, path: string, issues: SynthValidationIssue[]): FilterParams | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected a filter object, got ${describe(raw)}` });
    return INVALID;
  }
  const type = validateEnum<FilterType>(raw.type, FILTER_TYPES, `${path}.type`, issues);
  const cutoffHz = clampFinite(raw.cutoffHz, CUTOFF_HZ_MIN, CUTOFF_HZ_MAX, `${path}.cutoffHz`, issues);
  const resonance = clampFinite(raw.resonance, 0, 1, `${path}.resonance`, issues);
  const driveDb = clampFinite(raw.driveDb, DRIVE_DB_MIN, DRIVE_DB_MAX, `${path}.driveDb`, issues);
  const keyTrack = clampFinite(raw.keyTrack, 0, 1, `${path}.keyTrack`, issues);
  if (isInvalid(type) || isInvalid(cutoffHz) || isInvalid(resonance) || isInvalid(driveDb) || isInvalid(keyTrack)) {
    return INVALID;
  }
  return { type, cutoffHz, resonance, driveDb, keyTrack };
}

function validateAdsr(raw: unknown, path: string, issues: SynthValidationIssue[]): AdsrParams | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected an envelope object, got ${describe(raw)}` });
    return INVALID;
  }
  const attack = clampFinite(raw.attack, ENV_TIME_MIN, ENV_TIME_MAX, `${path}.attack`, issues);
  const decay = clampFinite(raw.decay, ENV_TIME_MIN, ENV_TIME_MAX, `${path}.decay`, issues);
  const sustain = clampFinite(raw.sustain, 0, 1, `${path}.sustain`, issues);
  const release = clampFinite(raw.release, ENV_TIME_MIN, ENV_TIME_MAX, `${path}.release`, issues);
  if (isInvalid(attack) || isInvalid(decay) || isInvalid(sustain) || isInvalid(release)) {
    return INVALID;
  }
  return { attack, decay, sustain, release };
}

function validateModRoute(
  raw: unknown,
  path: string,
  issues: SynthValidationIssue[],
  // The LFO sums a dB route bipolar into a gain based at 1, so it caps deeper
  // than an ENV2 route, which is scheduled as an explicit base-to-peak ramp and
  // has no trough to take through zero.
  dbRange: { min: number; max: number } = MOD_ROUTE_RANGES.db,
): ModRoute | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected a modulation route object, got ${describe(raw)}` });
    return INVALID;
  }
  const target = raw.target;
  if (typeof target !== 'string') {
    issues.push({ path: `${path}.target`, message: `expected a modulation target, got ${describe(target)}` });
    return INVALID;
  }
  if (SEMITONE_ROUTE_TARGETS.has(target as ModTarget)) {
    if (raw.unit !== 'semitones') {
      issues.push({ path: `${path}.unit`, message: `expected 'semitones' for target ${target}, got ${describe(raw.unit)}` });
      return INVALID;
    }
    const amount = clampFinite(raw.amount, MOD_ROUTE_RANGES.semitones.min, MOD_ROUTE_RANGES.semitones.max, `${path}.amount`, issues);
    if (isInvalid(amount)) return INVALID;
    return { target: target as 'pitch-all' | 'osc1-pitch' | 'osc2-pitch' | 'filter-cutoff', unit: 'semitones', amount };
  }
  if (DB_ROUTE_TARGETS.has(target as ModTarget)) {
    if (raw.unit !== 'db') {
      issues.push({ path: `${path}.unit`, message: `expected 'db' for target ${target}, got ${describe(raw.unit)}` });
      return INVALID;
    }
    const amount = clampFinite(raw.amount, dbRange.min, dbRange.max, `${path}.amount`, issues);
    if (isInvalid(amount)) return INVALID;
    return { target: target as 'osc1-level' | 'osc2-level' | 'amplitude', unit: 'db', amount };
  }
  if (target === 'filter-resonance') {
    if (raw.unit !== 'normalized') {
      issues.push({ path: `${path}.unit`, message: `expected 'normalized' for target ${target}, got ${describe(raw.unit)}` });
      return INVALID;
    }
    const amount = clampFinite(raw.amount, MOD_ROUTE_RANGES.normalized.min, MOD_ROUTE_RANGES.normalized.max, `${path}.amount`, issues);
    if (isInvalid(amount)) return INVALID;
    return { target: 'filter-resonance', unit: 'normalized', amount };
  }
  if (target === 'pan') {
    if (raw.unit !== 'pan') {
      issues.push({ path: `${path}.unit`, message: `expected 'pan' for target ${target}, got ${describe(raw.unit)}` });
      return INVALID;
    }
    const amount = clampFinite(raw.amount, MOD_ROUTE_RANGES.pan.min, MOD_ROUTE_RANGES.pan.max, `${path}.amount`, issues);
    if (isInvalid(amount)) return INVALID;
    return { target: 'pan', unit: 'pan', amount };
  }
  issues.push({ path: `${path}.target`, message: `unknown modulation target ${describe(target)}` });
  return INVALID;
}

/** Validates an ENV2-style route array, capped at `maxLength`. Over the cap invalidates the WHOLE array. */
function validateModRouteArray(
  raw: unknown,
  maxLength: number,
  path: string,
  issues: SynthValidationIssue[],
): ModRoute[] | Invalid {
  if (!Array.isArray(raw)) {
    issues.push({ path, message: `expected an array, got ${describe(raw)}` });
    return INVALID;
  }
  if (raw.length > maxLength) {
    issues.push({ path, message: `expected at most ${maxLength} routes, got ${raw.length}` });
    return INVALID;
  }
  const routes: ModRoute[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const route = validateModRoute(raw[i], `${path}[${i}]`, issues);
    if (isInvalid(route)) return INVALID;
    routes.push(route);
  }
  return routes;
}

function validateNoteDivision(raw: unknown, path: string, issues: SynthValidationIssue[]): NoteDivision | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected a note division object, got ${describe(raw)}` });
    return INVALID;
  }
  const value = validateNumberEnum<NoteDivisionValue>(raw.value, NOTE_DIVISION_VALUES, `${path}.value`, issues);
  const modifier = validateEnum<NoteDivisionModifier>(raw.modifier, NOTE_DIVISION_MODIFIERS, `${path}.modifier`, issues);
  if (isInvalid(value) || isInvalid(modifier)) return INVALID;
  return { value, modifier };
}

function validateLfoRate(raw: unknown, path: string, issues: SynthValidationIssue[]): LfoRate | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected a rate object, got ${describe(raw)}` });
    return INVALID;
  }
  if (raw.mode === 'hz') {
    const hz = clampFinite(raw.hz, LFO_HZ_MIN, LFO_HZ_MAX, `${path}.hz`, issues);
    if (isInvalid(hz)) return INVALID;
    return { mode: 'hz', hz };
  }
  if (raw.mode === 'sync') {
    const division = validateNoteDivision(raw.division, `${path}.division`, issues);
    if (isInvalid(division)) return INVALID;
    return { mode: 'sync', division };
  }
  issues.push({ path: `${path}.mode`, message: `expected 'hz' or 'sync', got ${describe(raw.mode)}` });
  return INVALID;
}

/**
 * The LFO's single route slot: `null` (no route) or exactly one valid
 * `ModRoute`. Anything else — including an array, which is how a caller might
 * mistakenly try to assign more than the LFO's one-route cap — invalidates.
 */
function validateLfoRoute(raw: unknown, path: string, issues: SynthValidationIssue[]): ModRoute | null | Invalid {
  if (raw === null) return null;
  return validateModRoute(raw, path, issues, { min: -LFO_DB_ROUTE_LIMIT, max: LFO_DB_ROUTE_LIMIT });
}

function validateLfo(raw: unknown, path: string, issues: SynthValidationIssue[]): LfoParams | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected an LFO object, got ${describe(raw)}` });
    return INVALID;
  }
  const waveform = validateEnum<LfoWaveform>(raw.waveform, LFO_WAVEFORMS, `${path}.waveform`, issues);
  const depth = clampFinite(raw.depth, 0, 1, `${path}.depth`, issues);
  const phaseDegrees = clampFinite(raw.phaseDegrees, 0, LFO_PHASE_MAX, `${path}.phaseDegrees`, issues);
  const triggerMode = validateEnum<LfoTriggerMode>(raw.triggerMode, LFO_TRIGGER_MODES, `${path}.triggerMode`, issues);
  const rate = validateLfoRate(raw.rate, `${path}.rate`, issues);
  const route = validateLfoRoute(raw.route, `${path}.route`, issues);
  if (
    isInvalid(waveform) ||
    isInvalid(depth) ||
    isInvalid(phaseDegrees) ||
    isInvalid(triggerMode) ||
    isInvalid(rate) ||
    isInvalid(route)
  ) {
    return INVALID;
  }
  return { waveform, depth, phaseDegrees, triggerMode, rate, route };
}

function validateCommon(raw: unknown, path: string, issues: SynthValidationIssue[]): CommonVoiceParams | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected a common voice object, got ${describe(raw)}` });
    return INVALID;
  }
  const voiceMode = validateEnum<VoiceMode>(raw.voiceMode, VOICE_MODES, `${path}.voiceMode`, issues);
  const glideSeconds = clampFinite(raw.glideSeconds, 0, GLIDE_SECONDS_MAX, `${path}.glideSeconds`, issues);
  const unisonVoices = clampFinite(raw.unisonVoices, UNISON_VOICES_MIN, UNISON_VOICES_MAX, `${path}.unisonVoices`, issues);
  const unisonDetuneCents = clampFinite(raw.unisonDetuneCents, 0, UNISON_DETUNE_CENTS_MAX, `${path}.unisonDetuneCents`, issues);
  const stereoWidth = clampFinite(raw.stereoWidth, 0, 1, `${path}.stereoWidth`, issues);
  const velocityToAmplitude = clampFinite(raw.velocityToAmplitude, 0, 1, `${path}.velocityToAmplitude`, issues);
  const outputGainDb = clampFinite(raw.outputGainDb, GAIN_DB_MIN, OUTPUT_GAIN_DB_MAX, `${path}.outputGainDb`, issues);
  if (
    isInvalid(voiceMode) ||
    isInvalid(glideSeconds) ||
    isInvalid(unisonVoices) ||
    isInvalid(unisonDetuneCents) ||
    isInvalid(stereoWidth) ||
    isInvalid(velocityToAmplitude) ||
    isInvalid(outputGainDb)
  ) {
    return INVALID;
  }
  return { voiceMode, glideSeconds, unisonVoices, unisonDetuneCents, stereoWidth, velocityToAmplitude, outputGainDb };
}

function validateSubtractiveParams(raw: unknown, path: string, issues: SynthValidationIssue[]): SubtractiveParams | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected a subtractive patch object, got ${describe(raw)}` });
    return INVALID;
  }
  if (!Array.isArray(raw.oscillators) || raw.oscillators.length !== 2) {
    issues.push({ path: `${path}.oscillators`, message: `expected exactly two oscillators, got ${describe(raw.oscillators)}` });
    return INVALID;
  }
  const osc1 = validateOscillator(raw.oscillators[0], `${path}.oscillators[0]`, issues);
  const osc2 = validateOscillator(raw.oscillators[1], `${path}.oscillators[1]`, issues);
  const utility = validateUtility(raw.utility, `${path}.utility`, issues);
  const filter = validateFilter(raw.filter, `${path}.filter`, issues);
  const ampEnvelope = validateAdsr(raw.ampEnvelope, `${path}.ampEnvelope`, issues);
  const modEnvelope = validateAdsr(raw.modEnvelope, `${path}.modEnvelope`, issues);
  const env2Routes = validateModRouteArray(raw.env2Routes, 2, `${path}.env2Routes`, issues);
  const lfo = validateLfo(raw.lfo, `${path}.lfo`, issues);
  if (
    isInvalid(osc1) ||
    isInvalid(osc2) ||
    isInvalid(utility) ||
    isInvalid(filter) ||
    isInvalid(ampEnvelope) ||
    isInvalid(modEnvelope) ||
    isInvalid(env2Routes) ||
    isInvalid(lfo)
  ) {
    return INVALID;
  }
  return { oscillators: [osc1, osc2], utility, filter, ampEnvelope, modEnvelope, env2Routes, lfo };
}

function validateActiveSynthShape(
  raw: unknown,
  path: string,
  issues: SynthValidationIssue[],
): ActiveSynth<'subtractive'> | Invalid {
  if (!isRecord(raw)) {
    issues.push({ path, message: `expected an active synth object, got ${describe(raw)}` });
    return INVALID;
  }
  if (raw.engine !== 'subtractive') {
    issues.push({ path: `${path}.engine`, message: `unsupported engine ${describe(raw.engine)}` });
    return INVALID;
  }
  if (!isRecord(raw.patch)) {
    issues.push({ path: `${path}.patch`, message: `expected a patch object, got ${describe(raw.patch)}` });
    return INVALID;
  }
  const common = validateCommon(raw.patch.common, `${path}.patch.common`, issues);
  const synth = validateSubtractiveParams(raw.patch.synth, `${path}.patch.synth`, issues);
  let sourcePresetId: string | null | Invalid;
  if (raw.sourcePresetId === null || typeof raw.sourcePresetId === 'string') {
    sourcePresetId = raw.sourcePresetId;
  } else {
    issues.push({ path: `${path}.sourcePresetId`, message: `expected a string or null, got ${describe(raw.sourcePresetId)}` });
    sourcePresetId = INVALID;
  }
  if (isInvalid(common) || isInvalid(synth) || isInvalid(sourcePresetId)) {
    return INVALID;
  }
  return { engine: 'subtractive', patch: { common, synth }, sourcePresetId };
}

/**
 * Accept-or-reject, with no fallback to substitute.
 *
 * `sanitizeActiveSynth` below is the right call wherever a track MUST end up
 * holding a playable patch. This one is for the caller that would rather DROP
 * an invalid value than replace it: a custom preset is a named thing a user
 * saved, so silently handing it the init patch under its own name is worse
 * than the entry disappearing from the library.
 *
 * Clamping still happens — a finite out-of-range number is repaired and
 * reported in `issues`, exactly as in the fallback path.
 */
export function validateActiveSynth(
  value: unknown,
): { value: ActiveSynth<'subtractive'> | null; issues: SynthValidationIssue[] } {
  const issues: SynthValidationIssue[] = [];
  const candidate = validateActiveSynthShape(value, 'synth', issues);
  return { value: isInvalid(candidate) ? null : candidate, issues };
}

/**
 * Validates an untrusted value against the `ActiveSynth<'subtractive'>` shape.
 * Accepts a structurally complete patch (clamping finite out-of-range numbers
 * in place) or returns a fresh deep copy of `fallback` plus the issues that
 * caused the fallback. Never partially merges.
 */
export function sanitizeActiveSynth(
  value: unknown,
  fallback: ActiveSynth<'subtractive'>,
): { value: ActiveSynth<'subtractive'>; issues: SynthValidationIssue[] } {
  const { value: candidate, issues } = validateActiveSynth(value);
  if (candidate === null) {
    return { value: structuredClone(fallback), issues };
  }
  return { value: candidate, issues };
}

/**
 * Validates an untrusted value against the `ArpSettings` shape. Whole-value,
 * like `sanitizeActiveSynth`: any invalid field falls back to a fresh deep
 * copy of `fallback` rather than merging.
 */
export function sanitizeArpSettings(value: unknown, fallback: ArpSettings): ArpSettings {
  const issues: SynthValidationIssue[] = [];
  if (!isRecord(value)) {
    return structuredClone(fallback);
  }
  const active = validateBoolean(value.active, 'arp.active', issues);
  const mode = validateEnum<ArpSettings['mode']>(value.mode, ARP_MODES, 'arp.mode', issues);
  const rate = validateEnum<ArpSettings['rate']>(value.rate, ARP_RATES, 'arp.rate', issues);
  const octaves = clampFinite(value.octaves, ARP_OCTAVES_MIN, ARP_OCTAVES_MAX, 'arp.octaves', issues);
  if (isInvalid(active) || isInvalid(mode) || isInvalid(rate) || isInvalid(octaves)) {
    return structuredClone(fallback);
  }
  return { active, mode, rate, octaves };
}
