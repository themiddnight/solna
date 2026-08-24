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
    expect(html).toContain('card bg-base-100 border border-base-300');
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#12152A');
  });

  test('the active state rings primary', () => {
    const html = render(true);
    expect(html).toContain('border-primary ring-2 ring-primary/50 bg-base-200');
    expect(html).toContain('from-primary to-secondary text-primary-content');
  });

  test('bar counter and note readout are mono badges/text', () => {
    const html = render(false);
    expect(html).toContain('badge badge-sm badge-ghost font-mono');
    expect(html).toContain('font-mono');
  });

  test('header controls are daisyUI ghost buttons', () => {
    const html = render(false);
    expect(html).toContain('btn btn-ghost btn-xs');
    expect(html).toContain('hover:text-error');
  });

  test('the three edit selects are bordered daisyUI selects', () => {
    const html = render(false);
    expect(html).toContain('select select-xs select-bordered w-full');
  });

  test('no legacy palette utilities survive', () => {
    const html = render(true);
    for (const s of ['indigo-', 'purple-', 'rose-', 'slate-', 'text-white', 'scale-102']) {
      expect(html).not.toContain(s);
    }
  });
});
