import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { centerScrollDelta, PresetLibrary } from './PresetLibrary';
import type { PresetLibraryEntry } from './PresetLibrary';

const source = readFileSync(join(process.cwd(), 'src/components/ui/PresetLibrary.tsx'), 'utf8');

const entries: PresetLibraryEntry[] = [
  { id: 'p1', name: 'Sunset Pad', category: 'Pop & EDM', description: 'warm', isFactory: false },
];

const categories = [
  { id: 'All', label: 'All', badgeClass: 'badge-primary', description: '', count: '1' },
  { id: 'Pop & EDM', label: 'Pop & EDM', badgeClass: 'badge-primary', description: '' },
];

const render = (variant: 'chord' | 'synth') =>
  renderToString(
    <PresetLibrary
      isOpen
      onClose={() => {}}
      title="Preset Library"
      headerBadge="24 Total"
      headerSubtitle="Key of C"
      toast="Saved!"
      toastPlacement="top"
      variant={variant}
      entries={entries}
      categories={categories}
      saveButton={{ label: 'Save Current', inToolbar: variant === 'synth' }}
      save={{
        heading: 'Save Progression Preset',
        buttonLabel: 'Save',
        withCategory: true,
        withDescription: true,
        withRoman: false,
        defaultCategory: 'Pop & EDM',
        variant: variant === 'chord' ? 'modal' : 'inline',
      }}
      onSelect={() => {}}
      onDelete={() => {}}
      onSave={() => true}
    />,
  );

describe('PresetLibrary chrome', () => {
  const chord = render('chord');

  test('renders a daisyUI end-drawer instead of a hand-rolled overlay', () => {
    expect(chord).toContain('drawer drawer-end');
    expect(chord).toContain('drawer-toggle');
    expect(chord).toContain('drawer-side');
    expect(chord).toContain('drawer-overlay');
    expect(chord).not.toContain('bg-black/60');
  });

  test('uses base tokens for the shell', () => {
    expect(chord).toContain('bg-base-100');
    expect(chord).toContain('bg-base-200');
    expect(chord).toContain('border-base-300');
    expect(chord).not.toContain('#12152A');
    expect(chord).not.toContain('#252B48');
    expect(chord).not.toContain('#0E1022');
    expect(chord).not.toContain('#0B0D19');
  });

  test('search is a daisyUI input and chips are daisyUI badges/buttons', () => {
    expect(chord).toContain('input input-sm');
    expect(chord).toContain('btn btn-xs');
    expect(chord).toContain('badge badge-sm');
  });

  test('the header badge is a tabular-nums outline badge', () => {
    expect(chord).toContain('badge badge-sm badge-primary badge-outline tabular-nums');
    expect(chord).toContain('24 Total');
  });

  test('the toast is a daisyUI success alert', () => {
    expect(chord).toContain('alert alert-success');
    expect(chord).toContain('Saved!');
    expect(chord).not.toContain('emerald');
  });

  test('no palette classes, no text-white, no invalid utilities survive', () => {
    for (const bad of ['indigo', 'slate', 'emerald', 'text-white', 'py-0.2', 'z-60', 'animate-in', 'slide-in-from-right']) {
      expect(chord).not.toContain(bad);
    }
  });

  test('the synth variant renders the inline save form path', () => {
    const synth = render('synth');
    expect(synth).toContain('drawer-side');
    expect(synth).not.toContain('indigo');
    expect(synth).not.toContain('#12152A');
  });

  test('isOpen=false still renders nothing', () => {
    const html = renderToString(
      <PresetLibrary
        isOpen={false}
        onClose={() => {}}
        title="Preset Library"
        variant="chord"
        entries={entries}
        categories={categories}
        save={{
          heading: 'x', buttonLabel: 'Save', withCategory: false, withDescription: false,
          withRoman: false, defaultCategory: 'All', variant: 'modal',
        }}
        onSelect={() => {}}
        onSave={() => true}
      />,
    );
    expect(html).toBe('');
  });
});

/**
 * Perf fix (react-perf-fixes task 10): `groups = buildGroups(...)` used to
 * run on every render with no memoization at all. `filtered` was already
 * `useMemo`'d, but `groups` (derived from `filtered`) was not, so the
 * grouping walk re-ran even when nothing it reads had changed.
 *
 * Memoizing `groups` alone is inert if `groupEntries` is a fresh closure
 * every render at the call site (see `ChordPresetLibrary.test.tsx`'s
 * corresponding test for the caller half of this fix) — this file only
 * proves the half that lives here: the memo exists, depends on the right
 * things, and — critically, since hooks must run unconditionally — is
 * declared *before* the `if (!isOpen) return null;` early return rather
 * than after it, which would make its call conditional on `isOpen` and
 * violate the Rules of Hooks (a call-order bug `bun run lint`'s
 * `react-hooks` plugin would not necessarily catch source-statically in
 * every shape, so this is pinned directly). A runtime render-count is not
 * testable in this no-DOM harness, so this proves the code-shape properties
 * that jointly guarantee the memo is real and safe.
 */
describe('PresetLibrary groups is memoized correctly', () => {
  test('groups is computed via useMemo depending on [groupEntries, filtered, query, category]', () => {
    expect(source).toMatch(
      /const groups = useMemo\(\s*\(\) => buildGroups\(groupEntries, filtered, query, category\),\s*\[groupEntries, filtered, query, category\],\s*\);/,
    );
  });

  test('the groups useMemo is declared before the isOpen early return, not after', () => {
    const groupsIdx = source.indexOf('const groups = useMemo(');
    const earlyReturnIdx = source.indexOf('if (!isOpen) return null;');
    expect(groupsIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(groupsIdx).toBeLessThan(earlyReturnIdx);
  });

  test('filtered stays memoized (regression guard for the dependency this memo relies on)', () => {
    expect(source).toMatch(
      /const filtered = useMemo\(\s*\(\) => filterPresets\(entries, filterEntries, query, category\),\s*\[entries, category, query, filterEntries\],\s*\);/,
    );
  });
});

/**
 * Opening the drawer scrolls its list so the active entry is already on screen.
 * The scroll needs a live layout, but the arithmetic that drives it does not —
 * that part is `centerScrollDelta`, and it is what these tests pin.
 */
describe('centerScrollDelta', () => {
  const container = { top: 100, height: 400 };

  test('an entry already centred needs no scroll', () => {
    expect(centerScrollDelta(container, { top: 280, height: 40 })).toBe(0);
  });

  test('an entry below the fold scrolls the list down', () => {
    expect(centerScrollDelta(container, { top: 900, height: 40 })).toBe(620);
  });

  test('an entry scrolled off the top scrolls the list back up', () => {
    expect(centerScrollDelta(container, { top: -100, height: 40 })).toBe(-380);
  });

  test('the delta is relative to the container, not the viewport', () => {
    const moved = { top: 0, height: 400 };
    expect(centerScrollDelta(moved, { top: 180, height: 40 })).toBe(
      centerScrollDelta(container, { top: 280, height: 40 }),
    );
  });
});
