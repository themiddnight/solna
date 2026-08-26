import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BeatDots } from './BeatDots';

const dots = (html: string) => html.split('rounded-full').length - 1;

describe('BeatDots', () => {
  test('draws one dot per beat, four to the bar', () => {
    expect(dots(renderToString(<BeatDots totalBeats={4} activeBeat={null} />))).toBe(4);
    expect(dots(renderToString(<BeatDots totalBeats={8} activeBeat={null} />))).toBe(8);
  });

  test('fills every beat up to the active one, not just the active one', () => {
    const html = renderToString(<BeatDots totalBeats={4} activeBeat={2} />);
    const filled = html.split('bg-module-chord"').length - 1;
    const empty = html.split('bg-base-content/20').length - 1;
    expect(filled).toBe(3);
    expect(empty).toBe(1);
  });

  test('the contrast tone flips the fill for filled chord surfaces', () => {
    const html = renderToString(<BeatDots totalBeats={4} activeBeat={0} tone="contrast" />);
    expect(html).toContain('bg-module-chord-content');
    expect(html).toContain('bg-module-chord-content/30');
    expect(html).not.toContain('bg-base-content/20');
  });

  test('an idle counter lights nothing', () => {
    const html = renderToString(<BeatDots totalBeats={4} activeBeat={null} />);
    expect(html).not.toContain('bg-module-chord');
  });

  test('names the position for assistive tech', () => {
    const html = renderToString(<BeatDots totalBeats={8} activeBeat={5} />);
    expect(html).toContain('aria-label="Beat 6 of 8"');
  });

  test('stays on semantic tokens', () => {
    const html = renderToString(<BeatDots totalBeats={8} activeBeat={1} />);
    expect(html).toContain('bg-base-content/20');
    expect(html).not.toContain('#');
  });
});
