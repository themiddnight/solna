import { beforeEach, describe, expect, test } from 'bun:test';
import { FACTORY_BASS_PRESETS } from './bassPresets';
import {
  FACTORY_PRESETS,
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
  SYNTH_CATEGORIES,
  getCustomPresets,
  saveCustomPreset,
  updateCustomPreset,
  deleteCustomPreset,
} from './synthPresets';
import type { SynthPresetItem } from './synthPresets';
import type { ChordItem } from '../types';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
import { useAppStore } from '../store/store';
import {
  getCustomChordProgressions,
  saveCustomChordProgression,
  deleteCustomChordProgression,
} from '../components/ChordPresetLibrary';

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
    expect(all).toContain(FACTORY_PRESETS[0]);
    expect(all).toContain(FACTORY_BASS_PRESETS[0]);
  });
});

describe('findPresetByName', () => {
  test('resolves a preset name to the matching preset item', () => {
    expect(findPresetByName('Round Pluck', FACTORY_BASS_PRESETS)?.id).toBe('bass-round-pluck');
  });

  test('returns undefined when no preset has that name', () => {
    expect(findPresetByName('Not A Preset', FACTORY_BASS_PRESETS)).toBe(undefined);
  });

  test('returns undefined for an empty name', () => {
    expect(findPresetByName('', FACTORY_BASS_PRESETS)).toBe(undefined);
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

describe('custom preset helpers (store-backed wrappers)', () => {
  beforeEach(() => {
    useAppStore.setState({ customSynthPresets: [], customChordProgressions: [] });
  });

  test('getCustomPresets reads the custom presets from the store', () => {
    expect(getCustomPresets()).toEqual([]);
    useAppStore.setState({ customSynthPresets: [custom] });
    expect(getCustomPresets()).toEqual([custom]);
  });

  test('saveCustomPreset writes through the store and strips the preset label', () => {
    const saved = saveCustomPreset(
      'My Patch',
      { ...INITIAL_SYNTH_PARAMS, preset: 'Cosmic Lead' },
      'Lead',
      'a punchy lead'
    );
    const inStore = useAppStore.getState().customSynthPresets;
    expect(inStore).toHaveLength(1);
    expect(inStore[0]).toEqual(saved);
    expect(saved.name).toBe('My Patch');
    expect(saved.category).toBe('Lead');
    expect(saved.description).toBe('a punchy lead');
    expect(saved.isFactory).toBe(false);
    expect(saved.params).not.toHaveProperty('preset');
  });

  test('updateCustomPreset and deleteCustomPreset mutate the store and return the new list', () => {
    const saved = saveCustomPreset('My Patch', INITIAL_SYNTH_PARAMS);
    const updated = updateCustomPreset(saved.id, { name: 'Renamed Patch' });
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('Renamed Patch');
    expect(getCustomPresets()[0].name).toBe('Renamed Patch');

    expect(deleteCustomPreset(saved.id)).toEqual([]);
    expect(getCustomPresets()).toEqual([]);
  });
});

describe('custom chord progression helpers (store-backed wrappers)', () => {
  beforeEach(() => {
    useAppStore.setState({ customSynthPresets: [], customChordProgressions: [] });
  });

  test('save/get/delete route through the store', () => {
    expect(getCustomChordProgressions()).toEqual([]);
    const chord: ChordItem = {
      id: 'c1',
      root: 'C',
      quality: 'maj7',
      bars: 1,
      notes: ['C4', 'E4', 'G4', 'B4'],
    };
    const saved = saveCustomChordProgression('My Prog', [chord], 'User', 'desc', 'I - IV');
    expect(saved.roman).toBe('I - IV');

    const inStore = useAppStore.getState().customChordProgressions;
    expect(inStore).toHaveLength(1);
    expect(inStore[0]).toEqual(saved);

    expect(deleteCustomChordProgression(saved.id)).toEqual([]);
    expect(getCustomChordProgressions()).toEqual([]);
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
        saveCustomChordProgression(item.name, item.chords, item.category, item.description, item.roman);
      });

    const inStore = useAppStore.getState().customChordProgressions;
    expect(inStore).toHaveLength(2);
    const ids = inStore.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);

    deleteCustomChordProgression(inStore[0].id);
    expect(getCustomChordProgressions()).toHaveLength(1);
  });
});
