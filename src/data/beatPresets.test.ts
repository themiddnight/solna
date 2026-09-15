import { describe, expect, test } from 'bun:test';
import type { BeatVoiceId } from '@/types';
import { BEAT_PRESETS, BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID, DEFAULT_BEAT_VOICES } from './beatPresets';

/**
 * The factory Beat catalogue is what every later Beat task copies from, so the
 * questions here are completeness questions: a patch that is missing a field is
 * a patch a user cannot edit and a sanitizer has to invent a value for.
 */
describe('the factory Beat catalogue', () => {
  test('is the thirteen legacy kits, in order, under stable ids', () => {
    expect(BEAT_PRESETS.map((preset) => preset.id)).toEqual([
      'retro-drive', 'club-standard', 'trap-beat', '808-vintage', 'chrome-pulse',
      'velocity-breaks', 'sub-weight', 'warehouse', 'tight-pocket',
      'acoustic-studio', 'warm-riddim', 'lo-fi-vinyl', 'dusty-break',
    ]);
  });

  test('every patch is complete: every voice, a finite trim, and an explicit kick click', () => {
    for (const preset of BEAT_PRESETS) {
      expect(Object.keys(preset.patch.voices)).toEqual([...BEAT_VOICE_IDS]);
      expect(Number.isFinite(preset.patch.outputTrimDb)).toBe(true);
      expect(preset.patch.voices.kick.clickLevel).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The roster, spelled out. `BEAT_VOICE_IDS` used to be checked against the
   * old `DRUM_TYPES` array, which is gone — so the order is written here
   * instead of derived from the thing being tested. `BeatVoiceId` below is the
   * union the array must exhaust; the `satisfies` is what makes a member added
   * to the union and forgotten here a compile error rather than a short list
   * this test happily agrees with.
   */
  test('the voice roster is the canonical order, unchanged', () => {
    const ROSTER = [
      'kick', 'snare', 'rimshot', 'clap', 'hihat', 'openhat',
      'hitom', 'lowtom', 'ride', 'crash', 'bell',
    ] as const satisfies readonly BeatVoiceId[];
    expect([...BEAT_VOICE_IDS]).toEqual([...ROSTER]);
    // Every member of the union is named: a union member with no entry would
    // make this record miss a key and fail to compile.
    const everyMember: Record<BeatVoiceId, true> = {
      kick: true, snare: true, rimshot: true, clap: true, hihat: true, openhat: true,
      hitom: true, lowtom: true, ride: true, crash: true, bell: true,
    };
    expect(Object.keys(everyMember).sort()).toEqual([...ROSTER].sort());
  });

  /**
   * `DEFAULT_BEAT_VOICES` is the default preset's own voices object, not a copy
   * of it. The drum synth seeds its pre-patch default from that export, so a
   * second literal that drifted would make the engine start on a sound no
   * preset in the catalogue actually has.
   */
  test('DEFAULT_BEAT_VOICES is the default preset\'s own voices', () => {
    const base = BEAT_PRESETS.find((preset) => preset.id === DEFAULT_BEAT_PRESET_ID);
    expect(base).toBeDefined();
    expect(base!.patch.voices).toBe(DEFAULT_BEAT_VOICES);
  });

  test('every id is unique and the default names one of them', () => {
    const ids = BEAT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_BEAT_PRESET_ID);
  });

  test('every numeric parameter is required and finite — no optional field is left to a default', () => {
    const offenders: string[] = [];
    for (const preset of BEAT_PRESETS) {
      for (const voice of BEAT_VOICE_IDS) {
        const params = preset.patch.voices[voice] as unknown as Record<string, number>;
        for (const [field, value] of Object.entries(params)) {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            offenders.push(`${preset.id}.${voice}.${field}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every entry carries its bus filter and its factory origin and reference', () => {
    for (const preset of BEAT_PRESETS) {
      expect(preset.origin).toBe('factory');
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.reference.referent.length).toBeGreaterThan(0);
      expect(preset.reference.source.length).toBeGreaterThan(0);
      expect(preset.reference.reachable.length).toBeGreaterThan(0);
      expect(preset.patch.filter).toEqual({ type: 'lowpass', cutoff: 12000, resonance: 0.7 });
    }
  });

  /**
   * The migration-fidelity assertion that used to sit here is GONE, with the
   * legacy kit table it compared against. It asserted that every patch equalled
   * `mergeDrumKit(DRUM_KITS[name])` field for field, which was the right check
   * while both tables existed and is unrunnable now that one does not. What
   * replaced it is not another assertion: it is `bun run report:drums-diff
   * <rev>`, which reads the old side straight out of git and prints every
   * changed parameter, so a re-voicing is still visible — as a diff a reviewer
   * reads, rather than as a test nothing can fail.
   */
});