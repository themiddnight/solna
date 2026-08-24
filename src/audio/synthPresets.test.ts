import { beforeEach, describe, expect, test } from 'bun:test';
import { FACTORY_BASS_PRESETS } from './bassPresets';
import {
  FACTORY_PRESETS,
  getAllSynthPresets,
  findPresetByName,
  getPresetsGroupedByCategory,
} from './synthPresets';
import type { SynthPresetItem } from './synthPresets';
import type { ChordItem } from '../types';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';
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
