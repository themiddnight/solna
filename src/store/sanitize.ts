import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';
import { EFFECT_LIMITS, clampEffectValue, type EffectNumericKey } from '../audio/effectLimits';
import type { SynthParams, ChordItem, SequencerTrack, FilterType } from '../types';
import type { BassStepChoice } from '../audio/bassPatterns';
import { createDefaultLoop } from './loopSlice';
import { LEAD_OCTAVE_MAX, LEAD_OCTAVE_MIN } from './leadSlice';
import type { Loop } from './types';

// Type-guards for a parsed persisted payload AND for a parsed `.solna` file.
// Wrong-typed values survive JSON.parse and would flow straight into engine
// setters (`bpm: "fast"` -> NaN clock, a string volume -> setTargetAtTime(NaN)),
// so both readers go through this one module — see projectFile.ts.
const OSC_TYPES = new Set(['sawtooth', 'square', 'sine', 'triangle']);
export const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass']);
const LFO_TARGETS = new Set(['cutoff', 'pitch', 'volume']);
const ARP_MODES = new Set(['up', 'down', 'updown', 'random']);
const ARP_RATES = new Set(['4n', '8n', '16n', '32n']);

/**
 * Synth params are written straight onto AudioParams, so a wrong-typed
 * persisted value (a string cutoff, a null attack) would land as
 * setValueAtTime(NaN) and silence the voice. Each field keeps its stored value
 * only when the type matches the factory default — and, for the enum fields,
 * only when the engine and arpeggiator actually understand it.
 */
export function sanitizeSynthParams(value: unknown): SynthParams {
  const fallback = INITIAL_SYNTH_PARAMS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const out = { ...fallback } as Record<string, unknown>;

  for (const [key, def] of Object.entries(fallback)) {
    const stored = raw[key];
    if (typeof def === 'number') {
      out[key] = typeof stored === 'number' && Number.isFinite(stored) ? stored : def;
    } else if (typeof def === 'boolean') {
      out[key] = typeof stored === 'boolean' ? stored : def;
    } else if (typeof def === 'string') {
      out[key] = typeof stored === 'string' ? stored : def;
    }
  }

  if (!OSC_TYPES.has(out.oscType as string)) out.oscType = fallback.oscType;
  if (!FILTER_TYPES.has(out.filterType as string)) out.filterType = fallback.filterType;
  if (!LFO_TARGETS.has(out.lfoTarget as string)) out.lfoTarget = fallback.lfoTarget;
  if (!ARP_MODES.has(out.arpMode as string)) out.arpMode = fallback.arpMode;
  if (!ARP_RATES.has(out.arpRate as string)) out.arpRate = fallback.arpRate;

  return out as unknown as SynthParams;
}

// The MasterEffects payload: plain-object check (a partial effects object
// with valid fields is preserved as-is; anything else falls back to the
// factory defaults), every numeric field clamped through the SAME table the
// engine uses (audio/effectLimits.ts) so the two can no longer drift — the
// old code clamped only reverbDecay and compressorThreshold and let a
// persisted delayFeedback of 1.2 through to a runaway feedback loop. The
// ternary can hand back the SHARED INITIAL_EFFECTS constant — clone before
// writing so the module constant is never mutated. Fields removed from
// MasterEffects must not resurrect from old persisted payloads.
export function sanitizeEffectsValue(effects: unknown): unknown {
  let result =
    typeof effects === 'object' && effects !== null && !Array.isArray(effects)
      ? effects
      : INITIAL_EFFECTS;

  if (result && typeof result === 'object') {
    if (result === INITIAL_EFFECTS) result = { ...INITIAL_EFFECTS };
    const fxWritable = result as Record<string, unknown>;
    for (const key of Object.keys(EFFECT_LIMITS) as EffectNumericKey[]) {
      fxWritable[key] = clampEffectValue(key, fxWritable[key]);
    }
  }

  if (result && typeof result === 'object') {
    const fx = result as Record<string, unknown>;
    for (const key of ['chorusRate', 'chorusDepth', 'chorusWet', 'compressorRatio', 'compressorBypass', 'delayTime', 'distortionDrive']) {
      delete fx[key];
    }
  }

  return result;
}

export function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** For a persisted field whose absence is meaningful (no project, no baseline). */
export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function isPatternMode(value: unknown): value is 'preset' | 'custom' {
  return value === 'preset' || value === 'custom';
}

export function asPatternMode(value: unknown, fallback: 'preset' | 'custom'): 'preset' | 'custom' {
  return isPatternMode(value) ? value : fallback;
}

export function asFilterType(value: unknown, fallback: FilterType): FilterType {
  return FILTER_TYPES.has(value as string) ? (value as FilterType) : fallback;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function asPositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

export function isStringMatrix(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((n) => typeof n === 'string'))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((n) => typeof n === 'string');
}

/**
 * An array is kept only when EVERY element passes. All-or-nothing on purpose:
 * a per-element drop would silently shorten a chord progression or a drum
 * pattern into something the user never wrote, and the caller's fallback (the
 * default loop's value) is the honest answer to a corrupt array.
 */
function asCheckedArray<T>(value: unknown, isElement: (v: unknown) => boolean, fallback: T[]): T[] {
  return Array.isArray(value) && value.every(isElement) ? (value as T[]) : fallback;
}

/**
 * A chord is read by deriveChordNotes and played straight out of `notes`, so
 * every field the chord path dereferences must be the right type — a missing
 * `notes` array is a crash in the chord scheduler, not a wrong sound.
 */
function isChordItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.root === 'string' &&
    typeof value.quality === 'string' &&
    typeof value.bars === 'number' &&
    Number.isFinite(value.bars) &&
    value.bars > 0 &&
    isStringArray(value.notes)
  );
}

/** The engine reads `instrument` and indexes `steps`; the rest is presentation. */
function isSequencerTrack(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.instrument === 'string' &&
    Array.isArray(value.steps) &&
    value.steps.every((s) => typeof s === 'boolean')
  );
}

// Exhaustive by construction: a new BassStepChoice member fails to compile
// here until it is listed, so the guard cannot drift from the union.
const BASS_STEP_CHOICES: Record<BassStepChoice, true> = {
  rest: true, root: true, third: true, fifth: true, seventh: true, octave: true,
};

function isBassStepChoice(value: unknown): boolean {
  return typeof value === 'string' && Object.hasOwn(BASS_STEP_CHOICES, value);
}

/**
 * Validates a persisted `loops` array. Each loop is rebuilt through the
 * same per-field guards/clamps the flat payload used (synth params, finite
 * clamps, string/enum checks), with createDefaultLoop() as the fallback for
 * missing or wrong-typed fields. Rows that are not plain objects are dropped;
 * an empty result means "no valid loops" and the caller falls back to the
 * default single loop.
 *
 * The array fields are checked ELEMENT-WISE, not just for Array.isArray: this
 * is also the import path for a `.solna` file that came from somebody else's
 * device (projectFile.ts), so `{"chords": [1, 2, 3]}` must never reach the
 * chord scheduler.
 */
export function sanitizeLoops(value: unknown): Loop[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const loops: Loop[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const fallback = createDefaultLoop();
    const r = { ...fallback, ...(raw as Record<string, unknown>) } as Record<string, unknown>;
    loops.push({
      id: typeof r.id === 'string' && r.id.length > 0 ? r.id : `loop-${loops.length}`,
      name: typeof r.name === 'string' && r.name.length > 0 ? r.name : `Loop ${loops.length + 1}`,
      repeatCount: clampFinite(asPositiveInteger(r.repeatCount, fallback.repeatCount ?? 1), 1, 32, 1),
      scaleRoot: asString(r.scaleRoot, fallback.scaleRoot),
      scaleType: asString(r.scaleType, fallback.scaleType),
      synthParams: sanitizeSynthParams(r.synthParams),
      chordSynthParams: sanitizeSynthParams(r.chordSynthParams),
      bassSynthParams: sanitizeSynthParams(r.bassSynthParams),
      chords: asCheckedArray<ChordItem>(r.chords, isChordItem, fallback.chords),
      chordRhythmId: asString(r.chordRhythmId, fallback.chordRhythmId),
      chordRhythmMode: asPatternMode(r.chordRhythmMode, fallback.chordRhythmMode),
      customChordRhythm: asCheckedArray<boolean>(r.customChordRhythm, (v) => typeof v === 'boolean', fallback.customChordRhythm),
      chordFeel: clampFinite(r.chordFeel, 0, 1, fallback.chordFeel),
      chordOctave: clampFinite(r.chordOctave, 0, 8, fallback.chordOctave),
      bassPatternId: asString(r.bassPatternId, fallback.bassPatternId),
      bassPatternMode: asPatternMode(r.bassPatternMode, fallback.bassPatternMode),
      customBassPattern: asCheckedArray<BassStepChoice>(r.customBassPattern, isBassStepChoice, fallback.customBassPattern),
      bassFeel: clampFinite(r.bassFeel, 0, 1, fallback.bassFeel),
      bassOctave: clampFinite(r.bassOctave, 0, 8, fallback.bassOctave),
      leadMelodySteps: isStringMatrix(r.leadMelodySteps) ? (r.leadMelodySteps as string[][]) : fallback.leadMelodySteps,
      leadLoopLength: asPositiveInteger(r.leadLoopLength, fallback.leadLoopLength),
      leadMelodyView: r.leadMelodyView === 'chromatic' ? 'chromatic' : 'scale-locked',
      leadMelodyOctave: clampFinite(
        r.leadMelodyOctave, LEAD_OCTAVE_MIN, LEAD_OCTAVE_MAX, fallback.leadMelodyOctave,
      ),
      sequencerTracks: asCheckedArray<SequencerTrack>(r.sequencerTracks, isSequencerTrack, fallback.sequencerTracks),
      soundKit: asString(r.soundKit, fallback.soundKit),
      drumFilterCutoff: clampFinite(r.drumFilterCutoff, 50, 12000, fallback.drumFilterCutoff),
      drumFilterResonance: clampFinite(r.drumFilterResonance, 0.1, 20, fallback.drumFilterResonance),
      drumFilterType: asFilterType(r.drumFilterType, fallback.drumFilterType),
      synthVolume: clampFinite(r.synthVolume, 0, 1.5, fallback.synthVolume),
      synthMuted: asBoolean(r.synthMuted),
      chordVolume: clampFinite(r.chordVolume, 0, 1.5, fallback.chordVolume),
      chordMuted: asBoolean(r.chordMuted),
      bassVolume: clampFinite(r.bassVolume, 0, 1.5, fallback.bassVolume),
      bassMuted: asBoolean(r.bassMuted),
      masterSequencerVolume: clampFinite(r.masterSequencerVolume, 0, 1, fallback.masterSequencerVolume),
      drumMuted: asBoolean(r.drumMuted),
    });
  }
  return loops.length > 0 ? loops : undefined;
}
