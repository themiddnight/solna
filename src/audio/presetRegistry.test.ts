import { beforeEach, describe, expect, test } from 'bun:test';
import { SYNTH_CATEGORIES, SYNTH_PRESETS } from '../data/synthPresets';
import type { SynthPresetItem } from '../data/synthPresets';
import {
  getAllSynthPresets,
  findPresetByName,
  getCategoryMeta,
  getPresetsGroupedByCategory,
  presetById,
} from './presetRegistry';
import type { ChordItem, ArpMode, ArpRate } from '../types';
import { INITIAL_SYNTH_PARAMS, INITIAL_EFFECTS } from '../store/initialState';
import { useAppStore } from '../store/store';

const custom: SynthPresetItem = {
  id: 'custom-1',
  name: 'My Patch',
  category: 'User',
  params: {},
};

describe('getAllSynthPresets', () => {
  test('includes dedicated bass presets alongside factory presets', () => {
    const all = getAllSynthPresets([]);
    const names = all.map((p) => p.name);
    expect(names).toContain('Cosmic Lead');
    expect(names).toContain('Deep Sine Sub');
    expect(names).toContain('Saw Growl');
  });

  test('lists custom presets before factory presets', () => {
    const all = getAllSynthPresets([custom]);
    expect(all[0]).toBe(custom);
    expect(all).toContain(SYNTH_PRESETS[0]);
    expect(all).toContain(SYNTH_PRESETS[SYNTH_PRESETS.length - 1]);
  });
});

describe('findPresetByName', () => {
  test('resolves a preset name to the matching preset item', () => {
    expect(findPresetByName('Round Pluck', SYNTH_PRESETS)?.id).toBe('bass-round-pluck');
  });

  test('returns undefined when no preset has that name', () => {
    expect(findPresetByName('Not A Preset', SYNTH_PRESETS)).toBe(undefined);
  });

  test('returns undefined for an empty name', () => {
    expect(findPresetByName('', SYNTH_PRESETS)).toBe(undefined);
  });
});

describe('getPresetsGroupedByCategory', () => {
  test('organizes presets into distinct categories including Bass, Lead, Pad, and Keys', () => {
    const all = getAllSynthPresets([custom]);
    const groups = getPresetsGroupedByCategory(all);
    const categoryIds = groups.map((g) => g.category);

    expect(categoryIds).toContain('Bass');
    expect(categoryIds).toContain('Lead');
    expect(categoryIds).toContain('Pad');
    expect(categoryIds).toContain('Keys');
    expect(categoryIds).toContain('User');

    const bassGroup = groups.find((g) => g.category === 'Bass');
    expect(bassGroup?.presets.some((p) => p.name === '808 Deep Bass' || p.name === 'Deep Sine Sub')).toBe(true);

    const leadGroup = groups.find((g) => g.category === 'Lead');
    expect(leadGroup?.presets.some((p) => p.name === 'Cosmic Lead')).toBe(true);

    const padGroup = groups.find((g) => g.category === 'Pad');
    expect(padGroup?.presets.some((p) => p.name === 'Warm PolyPad')).toBe(true);

    const keysGroup = groups.find((g) => g.category === 'Keys');
    expect(keysGroup?.presets.some((p) => p.name === 'Dream Keys')).toBe(true);
  });
});

describe('custom preset store actions', () => {
  beforeEach(() => {
    useAppStore.setState({ customSynthPresets: [], customChordProgressions: [] });
  });

  test('saveCustomPreset writes through the store and strips the preset label', () => {
    const saved = useAppStore.getState().saveCustomPreset('My Patch', INITIAL_SYNTH_PARAMS, 'Lead');
    expect(saved.name).toBe('My Patch');
    expect(saved.params.preset).toBeUndefined();
    expect(useAppStore.getState().customSynthPresets[0].id).toBe(saved.id);
  });

  test('deleteCustomPreset removes the preset and returns the new list', () => {
    const saved = useAppStore.getState().saveCustomPreset('My Patch', INITIAL_SYNTH_PARAMS);
    expect(useAppStore.getState().deleteCustomPreset(saved.id)).toEqual([]);
    expect(useAppStore.getState().customSynthPresets).toEqual([]);
  });
});

describe('custom chord progression helpers (store-backed wrappers)', () => {
  beforeEach(() => {
    useAppStore.setState({ customSynthPresets: [], customChordProgressions: [] });
  });

  test('save/get/delete route through the store', () => {
    expect(useAppStore.getState().customChordProgressions).toEqual([]);
    const chord: ChordItem = {
      id: 'c1',
      root: 'C',
      quality: 'maj7',
      bars: 1,
      notes: ['C4', 'E4', 'G4', 'B4'],
    };
    const saved = useAppStore
      .getState()
      .saveCustomChordProgression('My Prog', [chord], 'User', 'desc', 'I - IV');
    expect(saved.roman).toBe('I - IV');

    const inStore = useAppStore.getState().customChordProgressions;
    expect(inStore).toHaveLength(1);
    expect(inStore[0]).toEqual(saved);

    expect(useAppStore.getState().deleteCustomChordProgression(saved.id)).toEqual([]);
    expect(useAppStore.getState().customChordProgressions).toEqual([]);
  });

  test('importing multiple progressions yields distinct ids and delete-one-leaves-one', () => {
    const chord: ChordItem = {
      id: 'c1',
      root: 'C',
      quality: 'maj7',
      bars: 1,
      notes: ['C4', 'E4', 'G4', 'B4'],
    };
    const imported = [
      { name: 'Prog A', category: 'User', description: '', roman: 'I', chords: [chord] },
      { name: 'Prog B', category: 'User', description: '', roman: 'ii', chords: [chord] },
    ];
    // Mirror the import handler's loop (reverse walk, one save per item).
    [...imported]
      .reverse()
      .forEach((item) => {
        useAppStore
          .getState()
          .saveCustomChordProgression(item.name, item.chords, item.category, item.description, item.roman);
      });

    const inStore = useAppStore.getState().customChordProgressions;
    expect(inStore).toHaveLength(2);
    const ids = inStore.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);

    useAppStore.getState().deleteCustomChordProgression(inStore[0].id);
    expect(useAppStore.getState().customChordProgressions).toHaveLength(1);
  });
});

const PALETTE =
  /\b(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

describe('SYNTH_CATEGORIES badge classes', () => {
  test('no category carries a raw Tailwind palette colour', () => {
    for (const meta of SYNTH_CATEGORIES) {
      expect(meta.badgeClass).not.toMatch(PALETTE);
    }
  });

  test('every badgeClass is a complete daisyUI badge class list', () => {
    for (const meta of SYNTH_CATEGORIES) {
      expect(meta.badgeClass.startsWith('badge ')).toBe(true);
    }
  });

  test('the eight categories map onto the documented tokens', () => {
    expect(
      Object.fromEntries(SYNTH_CATEGORIES.map((m) => [m.id, m.badgeClass]))
    ).toEqual({
      Bass: 'badge badge-accent',
      Lead: 'badge badge-secondary',
      Pad: 'badge badge-primary',
      Keys: 'badge badge-accent badge-outline',
      Pluck: 'badge badge-primary badge-outline',
      Brass: 'badge badge-primary badge-soft',
      FX: 'badge badge-secondary badge-soft',
      User: 'badge badge-success badge-outline',
    });
  });

  test('the unknown-category fallback is a neutral badge', () => {
    expect(getCategoryMeta('Nope' as never).badgeClass).toBe('badge badge-ghost');
  });
});

describe('presetById', () => {
  test('resolves a factory synth preset id to its entry', () => {
    expect(presetById('factory-mellow-epiano')?.name).toBe('Mellow E-Piano');
  });

  test('resolves a factory bass preset id to its entry', () => {
    expect(presetById('bass-deep-sine')?.category).toBe('Bass');
  });

  test('returns undefined for an id no preset carries', () => {
    expect(presetById('not-a-real-preset')).toBe(undefined);
  });

  test('returns undefined for an empty id', () => {
    expect(presetById('')).toBe(undefined);
  });
});

describe('SynthParams arp contract', () => {
  test('every arp field is present on the factory defaults', () => {
    // The fields are declared required, so nothing downstream may need a `??`.
    expect(typeof INITIAL_SYNTH_PARAMS.arpActive).toBe('boolean');
    expect(typeof INITIAL_SYNTH_PARAMS.arpMode).toBe('string');
    expect(typeof INITIAL_SYNTH_PARAMS.arpRate).toBe('string');
    expect(typeof INITIAL_SYNTH_PARAMS.arpOctaves).toBe('number');
  });

  test('ArpMode and ArpRate have exactly one definition, re-exported by the audio modules', async () => {
    const arpeggiator = await import('./arpeggiator');
    const arpSchedule = await import('./arpSchedule');
    // Types erase at runtime, so this pins the RE-EXPORT surface instead: both
    // modules must still expose the names the rest of the app imports.
    expect(Object.keys(arpeggiator)).toContain('buildArpSequence');
    expect(Object.keys(arpSchedule)).toContain('computeArpTriggers');
    const mode: ArpMode = 'updown';
    const rate: ArpRate = '32n';
    // 'updown' with 2 held notes plays both endpoints on the way up and both
    // again on the way down (only interior notes are deduped), so length is 4.
    expect(arpeggiator.buildArpSequence(['C4', 'E4'], mode, 1).length).toBe(4);
    expect(arpSchedule.computeArpTriggers(0, 2, rate, 0.25).length).toBe(2);
  });
});

describe('MasterEffects has no unimplemented fields', () => {
  test('the factory effects object is exactly the implemented set', () => {
    // A declared-but-unimplemented field is an invitation to wire UI to it;
    // store.ts's migrate already strips these from old payloads.
    expect(Object.keys(INITIAL_EFFECTS).sort()).toEqual([
      'compressorThreshold', 'delayFeedback', 'delayWet', 'distortionWet',
      'eqHigh', 'eqLow', 'eqMid', 'reverbDecay', 'reverbWet',
    ]);
  });
});
