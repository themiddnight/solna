import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { PatternView } from './PatternView';

describe('PatternView', () => {
  // Moved here from SoundView.test.tsx when the lead grid left the Sound tab:
  // the assertion is unchanged, only the view it renders through.
  test('the lead melody grid renders', () => {
    const html = renderToString(<PatternView />);
    expect(html).toContain('Lead Melody');
    expect(html).toContain('id="select-lead-loop-length"');
  });

  // All three segments are mounted at once and gated block/hidden, so every
  // segment's markup is present in one render regardless of which is active —
  // that is the property this asserts, not "all three are visible".
  test('all three segments stay mounted, gated block/hidden', () => {
    const html = renderToString(<PatternView />);
    expect(html).toContain('Lead Melody');
    // NOT 'Accompaniment': PatternSegmentRow renders that word as the segment
    // button's own label, so it would be present with ChordView unmounted.
    // This id is ChordView's and nothing else's.
    expect(html).toContain('id="btn-open-chord-presets-library"');
    // 'Drum Pattern' is safe the same way — the row's button reads 'Beat'.
    expect(html).toContain('Drum Pattern');
    // The three gate wrappers are the only bare block/hidden divs in this
    // tree today, so counting them is counting the gates. `lead` is the
    // creation-time segment, hence one `block` and two `hidden`.
    expect(html.match(/class="hidden"/g)?.length).toBe(2);
    expect(html.match(/class="block"/g)?.length).toBe(1);
  });
});

describe('Pattern › Lead track solo', () => {
  test('the Lead segment header carries the Lead solo', () => {
    const html = renderToString(<PatternView />);
    expect(html).toContain('aria-label="Solo Lead"');
  });
});
