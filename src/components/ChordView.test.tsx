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
