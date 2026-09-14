import { describe, expect, test } from 'bun:test';
import { TRACK_SYNTH_DEFAULTS } from '@/store/initialState';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import type { ActiveSynth, ArpSettings } from '@/types/synth';
import { TRACK_ARP_DEFAULTS } from './initialState';
import { sanitizeActiveSynth, sanitizeArpSettings } from './sanitizeSynth';

/** A legacy flat SynthParams-shaped object — no `engine`, no `patch`. */
const LEGACY_SYNTH_PARAMS = {
  oscType: 'sawtooth',
  subOscVolume: 0.3,
  noiseVolume: 0.02,
  detune: 6,
  filterType: 'lowpass',
  filterCutoff: 2400,
  filterResonance: 3.0,
  filterEnvAmount: 1200,
  attack: 0.02,
  decay: 0.4,
  sustain: 0.6,
  release: 0.5,
  filterAttack: 0.02,
  filterDecay: 0.4,
  filterSustain: 0,
  filterRelease: 0.5,
  lfoRate: 3.5,
  lfoDepth: 0.2,
  lfoTarget: 'cutoff',
  octave: 0,
  arpActive: false,
  arpMode: 'up',
  arpRate: '16n',
  arpOctaves: 1,
  preset: 'Cosmic Lead',
};

describe('sanitizeActiveSynth: acceptance', () => {
  test('accepts a complete, valid patch unchanged', () => {
    expect(sanitizeActiveSynth(SUBTRACTIVE_INIT, SUBTRACTIVE_INIT).value).toEqual(SUBTRACTIVE_INIT);
  });

  test('accepting a valid patch never aliases the input', () => {
    const result = sanitizeActiveSynth(SUBTRACTIVE_INIT, SUBTRACTIVE_INIT);
    expect(result.value).not.toBe(SUBTRACTIVE_INIT);
    expect(result.value.patch).not.toBe(SUBTRACTIVE_INIT.patch);
    expect(result.value.patch.synth.oscillators).not.toBe(SUBTRACTIVE_INIT.patch.synth.oscillators);
  });

  test('clamps a finite out-of-range number without invalidating the rest of the patch', () => {
    const clipped = structuredClone(SUBTRACTIVE_INIT);
    clipped.patch.synth.filter.cutoffHz = 99_000;
    const result = sanitizeActiveSynth(clipped, SUBTRACTIVE_INIT);
    expect(result.value.patch.synth.filter.cutoffHz).toBe(20_000);
    // Everything else in the accepted patch matches the (otherwise valid) input.
    expect(result.value.patch.synth.filter.type).toBe(clipped.patch.synth.filter.type);
    expect(result.value.patch.common).toEqual(clipped.patch.common);
  });
});

describe('sanitizeActiveSynth: whole-patch fallback', () => {
  test('an unknown engine falls back to the complete fallback', () => {
    const result = sanitizeActiveSynth({ engine: 'fm', patch: {} }, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('a known engine with an incomplete patch falls back to the complete fallback', () => {
    const result = sanitizeActiveSynth({ engine: 'subtractive', patch: {} }, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('a legacy flat SynthParams object falls back with an issue', () => {
    const result = sanitizeActiveSynth(LEGACY_SYNTH_PARAMS, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('null and undefined both fall back to the complete fallback', () => {
    expect(sanitizeActiveSynth(null, SUBTRACTIVE_INIT).value).toEqual(SUBTRACTIVE_INIT);
    expect(sanitizeActiveSynth(undefined, SUBTRACTIVE_INIT).value).toEqual(SUBTRACTIVE_INIT);
  });
});

describe('sanitizeActiveSynth: route caps', () => {
  describe('ENV2 route cap', () => {
    const validRoute = { target: 'filter-cutoff', unit: 'semitones', amount: 6 } as const;

    test('exactly two ENV2 routes is valid', () => {
      const patch = structuredClone(SUBTRACTIVE_INIT);
      patch.patch.synth.env2Routes = [validRoute, validRoute];
      const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
      expect(result.value.patch.synth.env2Routes).toEqual([validRoute, validRoute]);
    });

    test('more than two ENV2 routes invalidates the whole patch', () => {
      const patch = structuredClone(SUBTRACTIVE_INIT);
      patch.patch.synth.env2Routes = [validRoute, validRoute, validRoute];
      const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
      expect(result.value).toEqual(SUBTRACTIVE_INIT);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('LFO route cap', () => {
    test('a null LFO route is valid', () => {
      const patch = structuredClone(SUBTRACTIVE_INIT);
      patch.patch.synth.lfo.route = null;
      const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
      expect(result.value.patch.synth.lfo.route).toBeNull();
    });

    test('a single valid LFO route is valid', () => {
      const patch = structuredClone(SUBTRACTIVE_INIT);
      patch.patch.synth.lfo.route = { target: 'pan', unit: 'pan', amount: 0.3 };
      const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
      expect(result.value.patch.synth.lfo.route).toEqual({ target: 'pan', unit: 'pan', amount: 0.3 });
    });

    test('an array in the LFO route slot invalidates the whole patch', () => {
      const patch = structuredClone(SUBTRACTIVE_INIT) as unknown as { patch: { synth: { lfo: { route: unknown } } } };
      patch.patch.synth.lfo.route = [
        { target: 'pan', unit: 'pan', amount: 0.3 },
        { target: 'pan', unit: 'pan', amount: -0.3 },
      ];
      const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
      expect(result.value).toEqual(SUBTRACTIVE_INIT);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });
});

describe('sanitizeActiveSynth: type and shape errors', () => {
  test('a wrong enum value invalidates the whole patch', () => {
    const patch = structuredClone(SUBTRACTIVE_INIT) as unknown as { patch: { synth: { filter: { type: string } } } };
    patch.patch.synth.filter.type = 'comb';
    const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('a mismatched ModRoute unit for its target invalidates the whole patch', () => {
    const patch = structuredClone(SUBTRACTIVE_INIT);
    patch.patch.synth.env2Routes = [{ target: 'filter-cutoff', unit: 'db', amount: 6 } as never];
    const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('a non-finite number invalidates the whole patch rather than clamping', () => {
    const patch = structuredClone(SUBTRACTIVE_INIT) as unknown as { patch: { synth: { filter: { cutoffHz: number } } } };
    patch.patch.synth.filter.cutoffHz = Number.NaN;
    const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('a wrong-typed field invalidates the whole patch', () => {
    const patch = structuredClone(SUBTRACTIVE_INIT) as unknown as { patch: { synth: { filter: { cutoffHz: unknown } } } };
    patch.patch.synth.filter.cutoffHz = '2400';
    const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('a wrong oscillator tuple length invalidates the whole patch', () => {
    const patch = structuredClone(SUBTRACTIVE_INIT) as unknown as { patch: { synth: { oscillators: unknown[] } } };
    patch.patch.synth.oscillators = [patch.patch.synth.oscillators[0]];
    const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
    expect(result.value).toEqual(SUBTRACTIVE_INIT);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('the fallback itself is never mutated by a failed validation', () => {
    const fallback: ActiveSynth<'subtractive'> = structuredClone(SUBTRACTIVE_INIT);
    const frozenSnapshot = structuredClone(fallback);
    sanitizeActiveSynth({ engine: 'fm', patch: {} }, fallback);
    expect(fallback).toEqual(frozenSnapshot);
  });
});

describe('sanitizeArpSettings', () => {
  const fallback: ArpSettings = { active: false, mode: 'up', rate: '16n', octaves: 1 };

  test('accepts a complete, valid value unchanged', () => {
    const valid: ArpSettings = { active: true, mode: 'random', rate: '8n', octaves: 2 };
    expect(sanitizeArpSettings(valid, fallback)).toEqual(valid);
  });

  test('clamps an out-of-range octaves count', () => {
    const result = sanitizeArpSettings({ active: true, mode: 'up', rate: '16n', octaves: 99 }, fallback);
    expect(result.octaves).toBeLessThanOrEqual(4);
  });

  test('a wrong enum falls back to the complete fallback', () => {
    const result = sanitizeArpSettings({ active: true, mode: 'sideways', rate: '16n', octaves: 1 }, fallback);
    expect(result).toEqual(fallback);
  });

  test('a non-object value falls back to the complete fallback', () => {
    expect(sanitizeArpSettings(null, fallback)).toEqual(fallback);
    expect(sanitizeArpSettings('up', fallback)).toEqual(fallback);
  });
});

describe('factory defaults are themselves valid', () => {
  test('every TRACK_SYNTH_DEFAULTS entry round-trips through sanitizeActiveSynth unchanged', () => {
    for (const patch of Object.values(TRACK_SYNTH_DEFAULTS)) {
      const result = sanitizeActiveSynth(patch, SUBTRACTIVE_INIT);
      expect(result.value).toEqual(patch);
      expect(result.issues).toEqual([]);
      // A distinct-patches guard: no track's default is a bare copy of the neutral init.
      expect(patch).not.toEqual(SUBTRACTIVE_INIT);
    }
  });

  test('every TRACK_ARP_DEFAULTS entry round-trips through sanitizeArpSettings unchanged', () => {
    for (const arp of Object.values(TRACK_ARP_DEFAULTS)) {
      expect(sanitizeArpSettings(arp, arp)).toEqual(arp);
    }
  });

  test('the five TRACK_SYNTH_DEFAULTS entries are pairwise distinct', () => {
    const entries = Object.entries(TRACK_SYNTH_DEFAULTS);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        expect(entries[i][1]).not.toEqual(entries[j][1]);
      }
    }
  });
});
