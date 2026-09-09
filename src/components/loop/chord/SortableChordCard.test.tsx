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

const render = (
  isActive: boolean,
  key: { scaleRoot: string; scaleType: string } = { scaleRoot: 'A', scaleType: 'Natural Minor' },
  item = chord,
) =>
  renderToString(
    <SortableChordCard
      chord={item}
      idx={0}
      totalChords={4}
      startBar={1}
      isActive={isActive}
      scaleRoot={key.scaleRoot}
      scaleType={key.scaleType}
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

  test('the bar counter is a tabular ghost badge and nothing is monospaced', () => {
    const html = render(false);
    expect(html).toContain('badge badge-sm badge-ghost tabular-nums');
    expect(html).not.toContain('font-mono');
  });

  test('header controls are daisyUI ghost buttons', () => {
    const html = render(false);
    expect(html).toContain('btn btn-square btn-xs btn-ghost');
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

describe('SortableChordCard spelling', () => {
  const flatChord = {
    id: 'chord-2',
    root: 'D#',
    quality: 'maj',
    bars: 1,
    notes: ['D#4', 'G4', 'A#4'],
  };
  const flatKey = { scaleRoot: 'A#', scaleType: 'Major' };

  test('the pad reads the chord root the way the key writes it', () => {
    const html = render(false, flatKey, flatChord);
    expect(html).toContain('Eb');
    expect(html).not.toContain('D#4');
  });

  test('the root select keeps ROOTS values and spells only the labels', () => {
    const html = render(false, flatKey, flatChord);
    // The stored identity is what the option carries as its value.
    expect(html).toContain('value="D#"');
    expect(html).toContain('>Eb</option>');
  });

  test('a sharp key leaves the sharp names alone', () => {
    const html = render(false, { scaleRoot: 'E', scaleType: 'Major' }, flatChord);
    expect(html).toContain('D#');
    expect(html).not.toContain('Eb');
  });
});
