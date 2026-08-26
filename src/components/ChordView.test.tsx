import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChordView } from './ChordView';

describe('ChordView preview UI', () => {
  test('renders separate chord and bass pattern preview buttons', () => {
    const html = renderToString(<ChordView />);

    expect(html).toContain('btn-preview-chord-pattern');
    expect(html).toContain('btn-preview-bass-pattern');
    expect(html).toContain('Hold to Preview Chord Pattern Loop');
    expect(html).toContain('Hold to Preview Bass Pattern Loop');
    // The two modules no longer share one combined preview.
    expect(html).not.toContain('Chord &amp; Bass Pattern Loop');
    // Progression pads preview the chord legato, not the old pattern hold.
    expect(html).toContain('Hold to Preview Chord');
    expect(html).not.toContain(
      'title="Hold to Preview Chord &amp; Bass Pattern"',
    );
  });
});

describe('ChordView theming', () => {
  const html = renderToString(<ChordView />);

  test('panels are daisyUI cards on base tokens', () => {
    expect(html).toContain('card bg-base-100 border border-base-300');
    expect(html).toContain('border-module-chord/30');
    expect(html).toContain('border-module-bass/30');
  });

  test('every select is a bordered daisyUI select', () => {
    expect(html).toContain('select select-sm select-bordered');
  });

  test('the library counter badge uses a valid padding step', () => {
    expect(html).toContain('badge badge-sm badge-outline tabular-nums');
    expect(html).not.toContain('py-0.2');
  });

  test('chord chips are keyboard-reachable buttons with font-mono labels', () => {
    // Real <button> elements, not divs with click handlers — that is what makes
    // the chips tab-reachable. btn-soft is the daisyUI variant they wear since
    // a1b4ac2; the earlier btn-outline was a styling choice, not a contract.
    expect(html).toContain('<button type="button" class="btn btn-xs btn-soft');
    expect(html).toContain('font-mono');
  });

  test('no legacy hex or palette utilities survive', () => {
    expect(/#[0-9a-fA-F]{6}\b/.test(html)).toBe(false);
    for (const s of [
      'amber-',
      'indigo-',
      'slate-',
      'rose-',
      'cyan-',
      'emerald-',
      'purple-',
      'violet-',
      'pink-',
      'teal-',
      'blue-',
      'red-',
      'orange-',
      'yellow-',
      'zinc-',
      'gray-',
      'text-white',
      'bg-black',
      'ring-white',
      'rgba(',
    ]) {
      expect(html).not.toContain(s);
    }
  });
});
