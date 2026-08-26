import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { PresetLibrary } from './PresetLibrary';
import type { PresetLibraryEntry } from './PresetLibrary';

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
    expect(chord).toContain('input input-sm input-bordered');
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
