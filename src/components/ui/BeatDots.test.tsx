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

  // Bar dividers are drawn by grouping dots into inner wrapper divs; each
  // wrapper carries the exact class string `flex items-center gap-1` (the
  // `md` DOT_GAP), so counting that substring counts the bar groups without
  // depending on internal markup details.
  const barGroupCount = (html: string) => html.split('flex items-center gap-1"').length - 1;

  describe('beatsPerBar', () => {
    test('a 6/8 counter (2 beats per bar) draws two bar groups for one bar', () => {
      const html = renderToString(<BeatDots totalBeats={4} activeBeat={null} beatsPerBar={2} />);
      expect(barGroupCount(html)).toBe(2);
    });

    test('a 5/4 counter (5 beats per bar) keeps a whole bar in one group', () => {
      const html = renderToString(<BeatDots totalBeats={5} activeBeat={null} beatsPerBar={5} />);
      expect(barGroupCount(html)).toBe(1);
    });

    test('4/4 is unchanged: an explicit beatsPerBar of 4 renders byte-identically to the default', () => {
      const withDefault = renderToString(<BeatDots totalBeats={8} activeBeat={3} />);
      const withExplicit = renderToString(
        <BeatDots totalBeats={8} activeBeat={3} beatsPerBar={4} />,
      );
      expect(withExplicit).toBe(withDefault);
      expect(barGroupCount(withDefault)).toBe(2);
    });
  });
});
