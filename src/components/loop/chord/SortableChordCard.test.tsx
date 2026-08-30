import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SortableChordCard } from './SortableChordCard';

const chord = {
  id: 'chord-1',
  root: 'A',
  quality: 'min7',
  bars: 1,
  notes: ['A3', 'C4', 'E4', 'G4'],
};

const noop = () => {};

const render = (isActive: boolean) =>
  renderToString(
    <SortableChordCard
      chord={chord}
      idx={0}
      totalChords={4}
      startBar={1}
      isActive={isActive}
      updateChord={noop}
      removeChord={noop}
      handleMoveChord={noop}
      handleCardPreviewMouseDown={noop}
      handleCardPreviewMouseUp={noop}
    />
  );

describe('SortableChordCard theming', () => {
  test('the card shell is a daisyUI card on base tokens', () => {
    const html = render(false);
    expect(html).toContain('card bg-panel border border-base-300');
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#12152A');
  });

  test('the active state rings the chord module colour', () => {
    const html = render(true);
    expect(html).toContain('border-module-chord ring-2 ring-module-chord/50 bg-base-200');
    // The active fill is solid. It used to carry two gradient-stop utilities
    // between these two classes, but with no direction utility alongside them
    // they emitted nothing — dead classes the assertion was locking in. The
    // contiguous match below is what proves they are gone; naming them here
    // would put them back into the CSS bundle, since Tailwind scans this file.
    expect(html).toContain('bg-module-chord text-module-chord-content');
  });

  test('bar counter and note readout are mono badges/text', () => {
    const html = render(false);
    expect(html).toContain('badge badge-sm badge-ghost tabular-nums');
    expect(html).toContain('font-mono');
  });

  test('header controls are daisyUI ghost buttons', () => {
    const html = render(false);
    expect(html).toContain('btn btn-ghost btn-xs');
    expect(html).toContain('hover:text-error');
  });

  test('the three edit selects are bordered daisyUI selects', () => {
    const html = render(false);
    expect(html).toContain('select select-xs w-full');
  });

  test('no legacy palette utilities survive', () => {
    const html = render(true);
    for (const s of ['indigo-', 'purple-', 'rose-', 'slate-', 'text-white', 'scale-102']) {
      expect(html).not.toContain(s);
    }
  });
});
