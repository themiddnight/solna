import { describe, expect, test } from 'bun:test';
import { LOOP_FLAT_KEYS } from './loop';
import { createDefaultLoop } from './loopSlice';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import { DEFAULT_LEAD_GATE } from '@/audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION, LEAD_TICKS_PER_BAR } from '@/utils/stepResolution';
import { PROJECT_DB_LEVEL_KEYS } from './projectFormat';
import { sanitizeLoops } from './sanitize';

const FX_KEYS = [
  'fxMelodySteps',
  'fxLoopLength',
  'fxStepResolution',
  'fxMelodyView',
  'fxMelodyOctave',
  'fxGate',
  'fxSynthParams',
  'fxVolume',
  'fxMuted',
] as const;

describe('the nine FX loop keys', () => {
  test('every one is a per-loop field', () => {
    const flat = new Set<string>(LOOP_FLAT_KEYS);
    expect(FX_KEYS.filter((k) => !flat.has(k))).toEqual([]);
  });

  /**
   * The fx block sits with its lead siblings and its bus pair sits with the
   * other bus pairs, so a reviewer comparing the fx block to the pad block is
   * comparing like with like. Asserted on POSITION, not membership, because a
   * key appended at the end would pass a membership check and still leave the
   * fingerprint order (PROJECT_LOOP_KEYS derives from this array) scattered.
   */
  test('the six melody keys sit directly after the lead block', () => {
    const keys = [...LOOP_FLAT_KEYS] as string[];
    expect(keys.slice(keys.indexOf('leadGate') + 1, keys.indexOf('leadGate') + 7)).toEqual([
      'fxMelodySteps',
      'fxLoopLength',
      'fxStepResolution',
      'fxMelodyView',
      'fxMelodyOctave',
      'fxGate',
    ]);
  });

  test('fxSynthParams sits with the other per-loop patches', () => {
    const keys = [...LOOP_FLAT_KEYS] as string[];
    expect(keys.indexOf('fxSynthParams')).toBe(keys.indexOf('padSynthParams') + 1);
  });

  test('the fx bus pair sits with the other bus pairs', () => {
    const keys = [...LOOP_FLAT_KEYS] as string[];
    expect(keys.slice(keys.indexOf('bassMuted') + 1, keys.indexOf('bassMuted') + 3)).toEqual([
      'fxVolume',
      'fxMuted',
    ]);
  });
});

describe('createDefaultLoop — the FX defaults', () => {
  const loop = createDefaultLoop();

  test('the melody starts empty at the full stored width', () => {
    expect(loop.fxMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
    expect(loop.fxMelodySteps.every((row) => row.length === 0)).toBe(true);
  });

  test('the view fields mirror the lead defaults', () => {
    expect(loop.fxLoopLength).toBe(1);
    expect(loop.fxStepResolution).toBe(DEFAULT_LEAD_STEP_RESOLUTION);
    expect(loop.fxMelodyView).toBe('scale-locked');
    expect(loop.fxMelodyOctave).toBe(3);
    expect(loop.fxGate).toBe(DEFAULT_LEAD_GATE);
  });

  /**
   * The measured headroom trim every source bus defaults to (DEV-383). The spec
   * called this "the pad's level, the quietest of the melodic buses" — the pad
   * is not quieter than its siblings, all five buses default to the same
   * DEFAULT_BUS_TRIM_DB, so the intent ("start where the pad starts") and the
   * value coincide. Not muted: a track a user has to unmute before it makes a
   * sound reads as broken.
   */
  test('the fx bus starts at the measured bus trim, unmuted', () => {
    expect(loop.fxVolume).toBe(DEFAULT_BUS_TRIM_DB);
    expect(loop.fxMuted).toBe(false);
  });
});

describe('PROJECT_DB_LEVEL_KEYS', () => {
  /**
   * The one key list in the format that does NOT derive. Its own comment
   * records the padVolume incident: a fader missing from it reaches
   * faderDbToGain unvalidated, and that function fails SAFE TO SILENCE — so a
   * corrupt stored fxVolume would mute the FX bus rather than default it, with
   * nothing on screen explaining why.
   */
  test('names fxVolume', () => {
    expect(PROJECT_DB_LEVEL_KEYS).toContain('fxVolume');
  });

  test('is the seven flat faders, in bus order', () => {
    expect([...PROJECT_DB_LEVEL_KEYS]).toEqual([
      'masterVolume',
      'synthVolume',
      'chordVolume',
      'bassVolume',
      'padVolume',
      'fxVolume',
      'masterSequencerVolume',
    ]);
  });
});

describe('sanitizeLoops — the FX keys', () => {
  const one = (raw: Record<string, unknown>) => sanitizeLoops([{ id: 'l1', ...raw }])![0];

  /**
   * The additive-model payoff, asserted rather than assumed: a project written
   * before FX existed carries none of these keys, and a MISSING key takes its
   * default on every read regardless of which version wrote the payload. It
   * opens with an empty FX track and nothing else changes.
   */
  test('a pre-FX row opens with the factory FX track', () => {
    const loop = one({});
    expect(loop.fxMelodySteps.every((row) => row.length === 0)).toBe(true);
    expect(loop.fxLoopLength).toBe(1);
    expect(loop.fxVolume).toBe(DEFAULT_BUS_TRIM_DB);
    expect(loop.fxMuted).toBe(false);
  });

  test('a stored FX melody survives untouched', () => {
    const steps = Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as { note: string; len: number }[]);
    steps[0] = [{ note: 'C4', len: 24 }];
    expect(one({ fxMelodySteps: steps }).fxMelodySteps[0]).toEqual([{ note: 'C4', len: 24 }]);
  });

  test('a garbage melody falls back to the default rather than throwing', () => {
    expect(one({ fxMelodySteps: 'nope' }).fxMelodySteps.every((r) => r.length === 0)).toBe(true);
  });

  /**
   * asFaderDb, not a bare typeof: an out-of-range number reaching faderDbToGain
   * fails SAFE TO SILENCE, so a corrupt fxVolume must clamp to the default here
   * rather than mute the bus downstream.
   */
  test('an out-of-range fxVolume takes the default, not silence', () => {
    expect(one({ fxVolume: 999 }).fxVolume).toBe(DEFAULT_BUS_TRIM_DB);
    expect(one({ fxVolume: Number.NaN }).fxVolume).toBe(DEFAULT_BUS_TRIM_DB);
    expect(one({ fxVolume: -Infinity }).fxVolume).toBe(DEFAULT_BUS_TRIM_DB);
  });

  test('an in-range fxVolume passes through', () => {
    expect(one({ fxVolume: -12 }).fxVolume).toBe(-12);
  });

  test('the enumerated fields reject anything outside their set', () => {
    expect(one({ fxMelodyView: 'sideways' }).fxMelodyView).toBe('scale-locked');
    expect(one({ fxMelodyView: 'chromatic' }).fxMelodyView).toBe('chromatic');
    expect(one({ fxStepResolution: 'quarter-ish' }).fxStepResolution).toBe(
      DEFAULT_LEAD_STEP_RESOLUTION,
    );
    // clampFinite clamps a finite out-of-range number to the boundary rather
    // than defaulting it — the same rule leadMelodyOctave is validated by, and
    // fx deliberately validates identically (see sanitize.ts Step 9's rationale).
    // 99 clamps to LEAD_OCTAVE_MAX (6), not to the factory default (3).
    expect(one({ fxMelodyOctave: 99 }).fxMelodyOctave).toBe(6);
    // Same clampFinite-clamps-not-defaults behavior as fxMelodyOctave above:
    // 4 clamps to the gate's declared max (1), not to DEFAULT_LEAD_GATE (0.85).
    expect(one({ fxGate: 4 }).fxGate).toBe(1);
    expect(one({ fxLoopLength: 0 }).fxLoopLength).toBe(1);
    expect(one({ fxMuted: 'yes' }).fxMuted).toBe(false);
  });
});
