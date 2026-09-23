import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { BEAT_PRESETS } from '@/data/beatPresets';
import type { BeatPreset } from '@/types';
import { BeatPresetLibrary, buildCategories, toLibraryEntry } from './BeatPresetLibrary';

const source = readFileSync(join(process.cwd(), 'src/components/loop/beat/BeatPresetLibrary.tsx'), 'utf8');

const noop = () => {};

const html = renderToString(<BeatPresetLibrary isOpen onClose={noop} />);

/**
 * `toLibraryEntry`/`buildCategories` are the two pure functions the drawer's
 * grouping and origin counts reduce to. Rendered assertions cover the store's
 * CREATION-time state only (`customBeatPresets` starts `[]` under
 * `renderToString`, .claude/rules/testing.md), so a mixed factory+user
 * catalogue — needed to pin "My Kits" vs "Factory" and the delete gate — is
 * exercised here instead, the same way `SynthPresetLibrary`'s equivalents are
 * pure-tested rather than rendered.
 */
describe('toLibraryEntry', () => {
  const userPreset: BeatPreset = { id: 'user-1', name: 'My Kit', origin: 'user', patch: BEAT_PRESETS[0].patch };
  const factoryPreset: BeatPreset = BEAT_PRESETS[0];

  test('a user preset is grouped under "My Kits" and is not factory', () => {
    const entry = toLibraryEntry(userPreset);
    expect(entry.category).toBe('My Kits');
    expect(entry.isFactory).toBe(false);
    expect(entry.id).toBe('user-1');
    expect(entry.name).toBe('My Kit');
  });

  test('a factory preset is grouped under "Factory" and IS factory — the default row\'s delete gate (`!entry.isFactory && onDelete`) therefore never offers delete on it', () => {
    const entry = toLibraryEntry(factoryPreset);
    expect(entry.category).toBe('Factory');
    expect(entry.isFactory).toBe(true);
  });
});

describe('buildCategories', () => {
  test('counts My Kits and Factory from origin, and All from the total', () => {
    const entries = [BEAT_PRESETS[0], BEAT_PRESETS[1]].map(toLibraryEntry).concat(
      toLibraryEntry({ id: 'user-1', name: 'My Kit', origin: 'user', patch: BEAT_PRESETS[0].patch }),
    );
    const categories = buildCategories(entries);
    expect(categories.map((c) => c.id)).toEqual(['All', 'My Kits', 'Factory']);
    expect(categories.find((c) => c.id === 'All')?.count).toBe('3');
    expect(categories.find((c) => c.id === 'My Kits')?.count).toBe('1');
    expect(categories.find((c) => c.id === 'Factory')?.count).toBe('2');
  });

  test('an empty user library still names both categories, at zero', () => {
    const categories = buildCategories(BEAT_PRESETS.map(toLibraryEntry));
    expect(categories.find((c) => c.id === 'My Kits')?.count).toBe('0');
    expect(categories.find((c) => c.id === 'Factory')?.count).toBe(String(BEAT_PRESETS.length));
  });
});

describe('BeatPresetLibrary rendering', () => {
  test('names the drawer and every factory kit', () => {
    expect(html).toContain('Beat Kit Library');
    for (const preset of BEAT_PRESETS) {
      expect(html).toContain(preset.name);
    }
  });

  test('the header badge counts the live catalogue', () => {
    expect(html).toContain(`${BEAT_PRESETS.length} Total`);
  });

  test('categories are All / My Kits / Factory, derived from origin — no custom category UI', () => {
    expect(html).toContain('>All<');
    expect(html).toContain('>My Kits<');
    expect(html).toContain('>Factory<');
  });

  test('search is by name only — no category or description field on the inline save form', () => {
    expect(html).toContain('Search kits by name...');
    expect(html).not.toContain('Description (Optional)');
  });

  test('no audition control renders (Q2 resolved: no audition)', () => {
    expect(html).not.toContain('Audition');
  });

  test('with the store starting with no custom presets, every entry is factory and none offers delete', () => {
    for (const preset of BEAT_PRESETS) {
      expect(html).not.toContain(`Delete ${preset.name}`);
    }
  });

  test('isOpen=false renders nothing', () => {
    expect(renderToString(<BeatPresetLibrary isOpen={false} onClose={noop} />)).toBe('');
  });
});

/**
 * Select and delete both hand off to the store, and neither is reachable
 * through a click under `renderToString` (no DOM, .claude/rules/testing.md) —
 * so the wiring itself is pinned at the source level, the same technique
 * `PresetLibrary.test.tsx` uses for its memoization guard.
 */
describe('BeatPresetLibrary wiring', () => {
  test('selecting an entry installs its preset and closes the drawer — never left open on a stale library', () => {
    expect(source).toMatch(/onSelect=\{\(entry\) => \{\s*setBeatPreset\(entry\.id\);\s*onClose\(\);\s*\}\}/);
  });

  test('delete is requested by id, resolved back to a name, and goes through the confirm step before touching the store', () => {
    expect(source).toMatch(/onDelete=\{\(id\) => \{\s*const entry = entries\.find\(\(e\) => e\.id === id\);\s*if \(entry\) requestDelete\(id, entry\.name\);\s*\}\}/);
    expect(source).toContain('deleteCustomBeatPreset(pendingDelete.id)');
    expect(source).toContain('<ConfirmDialog');
  });

  test('save reads the live beatParams at submit time, not a snapshot taken when the drawer opened', () => {
    expect(source).toContain('saveCustomBeatPreset(draft.name, useAppStore.getState().beatParams)');
  });

  test('save reports through its own inline toast, never through showFeedback — Quick Save already owns that host toast', () => {
    expect(source).not.toContain('showFeedback(');
    expect(source).not.toMatch(/\bs\.showFeedback\b/);
    expect(source).toContain('useLibraryToast');
  });
});
