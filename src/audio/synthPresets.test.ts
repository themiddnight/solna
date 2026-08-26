import { beforeEach, describe, expect, test } from 'bun:test';
import { FACTORY_BASS_PRESETS } from './bassPresets';
import {
  ALL_FACTORY_PRESETS,
  FACTORY_PRESETS,
  SYNTH_CATEGORIES,
  getAllSynthPresets,
  findPresetByName,
  getCategoryMeta,
  getPresetsGroupedByCategory,
  presetById,
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

describe('preset library invariants', () => {
  test('every preset id in ALL_FACTORY_PRESETS is unique', () => {
    const ids = ALL_FACTORY_PRESETS.map((p) => p.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  test('every preset name in ALL_FACTORY_PRESETS is unique', () => {
    // resolveVibeSynthParams stamps the resolved preset's *name* into
    // params.preset, and the preset library UI selects a preset back by name
    // via findPresetByName. A duplicate name would make a vibe silently
    // highlight the wrong patch in the picker.
    const names = ALL_FACTORY_PRESETS.map((p) => p.name);
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });

  test('no preset bakes arpeggiator settings into its params', () => {
    // Arp is a performance setting the user drives from the UI, not a timbre:
    // a preset carrying it would arpeggiate in every role it was reused for.
    const ARP_FIELDS = ['arpActive', 'arpMode', 'arpRate', 'arpOctaves'] as const;
    const offenders: string[] = [];
    for (const preset of ALL_FACTORY_PRESETS) {
      for (const field of ARP_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(preset.params, field)) {
          offenders.push(`${preset.id}.${field}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('factory-neon-poly-saw', () => {
  // 118 BPM (synthwave-80s) -> one eighth note is 60/118/2 ≈ 0.254 s.
  const EIGHTH_AT_118 = 60 / 118 / 2;

  test('is a Pad-category detuned saw', () => {
    const p = presetById('factory-neon-poly-saw');
    expect(p).toBeDefined();
    expect(p!.category).toBe('Pad');
    expect(p!.params.oscType).toBe('sawtooth');
    expect(p!.params.detune).toBe(15);
  });

  test('reaches full level well inside one eighth note at 118 BPM', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.attack! < EIGHTH_AT_118).toBe(true);
  });

  test('releases longer than the note gap so consecutive stabs glue into a bed', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.release! >= EIGHTH_AT_118).toBe(true);
  });

  test('gets its brightness from the filter envelope, not a permanently open cutoff', () => {
    const p = presetById('factory-neon-poly-saw')!;
    expect(p.params.filterCutoff).toBe(2600);
    expect(p.params.filterEnvAmount).toBe(1200);
    // must stay under factory-hyper-saw-lead, which is this vibe's own lead
    expect(p.params.filterCutoff! < presetById('factory-hyper-saw-lead')!.params.filterCutoff!).toBe(true);
  });

  test('does not transpose, so the comp stays in its authored register', () => {
    expect(presetById('factory-neon-poly-saw')!.params.octave).toBe(0);
  });
});

describe('factory-koto-pluck', () => {
  test('is a Pluck-category triangle string body', () => {
    const p = presetById('factory-koto-pluck');
    expect(p).toBeDefined();
    expect(p!.category).toBe('Pluck');
    expect(p!.params.oscType).toBe('triangle');
  });

  test('pins a near-instant attack and a nonzero noiseVolume field', () => {
    // noiseVolume is authored data only: the engine's synth voice path never
    // reads it (only the drum path does), so it contributes no audible noise
    // burst today. This just pins the values, not a pick-transient claim.
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.attack! <= 0.005).toBe(true);
    expect(p.params.noiseVolume! > 0).toBe(true);
  });

  test('pins a filter envelope that closes well before the amp decay finishes', () => {
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.filterEnvAmount).toBe(2200);
    expect(p.params.filterSustain! <= 0.15).toBe(true);
    expect(p.params.filterDecay! < p.params.decay!).toBe(true);
  });

  test('keeps the residual ring both existing Pluck presets lack', () => {
    const p = presetById('factory-koto-pluck')!;
    expect(p.params.sustain! > presetById('factory-pluck')!.params.sustain!).toBe(true);
    expect(p.params.sustain! > presetById('factory-trance-pluck')!.params.sustain!).toBe(true);
    // a bar at 78 BPM is 4 * 60/78 ≈ 3.08 s; decay + release must cover most of it
    expect(p.params.decay! + p.params.release! >= 2.4).toBe(true);
  });

  test('does not transpose, so the comp stays in its authored register', () => {
    expect(presetById('factory-koto-pluck')!.params.octave).toBe(0);
  });
});
