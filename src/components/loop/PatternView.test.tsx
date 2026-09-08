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
    expect(html).toContain('Accompaniment');
    expect(html).toContain('Drum Pattern');
    // The three gate wrappers are the only bare block/hidden divs in this
    // tree today, so counting them is counting the gates. `lead` is the
    // creation-time segment, hence one `block` and two `hidden`.
    expect(html.match(/class="hidden"/g)?.length).toBe(2);
    expect(html.match(/class="block"/g)?.length).toBe(1);
  });
});
