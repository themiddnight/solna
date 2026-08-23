import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { DrumPads } from './DrumPads';

describe('DrumPads', () => {
  test('renders the pad grid without a title or kit selector', () => {
    const html = renderToString(<DrumPads />);
    // The title and kit selector moved to the Step Matrix header card.
    expect(html.includes('Drum Pads')).toBe(false);
    expect(html.includes('<select')).toBe(false);
    // The pad grid itself survives the header removal.
    expect(html).toContain('Kick Drum');
    expect(html).toContain('Crash Cymbal');
    expect(html).toContain('btn-pad-kick');
  });
});
