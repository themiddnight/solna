import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { PatternView } from './PatternView';

describe('PatternView', () => {
  // Moved here from SoundView.test.tsx when the lead grid left the Sound tab.
  // Asserted by id, not by the words "Lead Melody": the header names the TAB
  // now, so that string is gone from the screen — the segment row's "Lead"
  // button is the only place a segment is named.
  test('the lead melody grid renders', () => {
    const html = renderToString(<PatternView />);
    expect(html).toContain('id="select-lead-loop-length"');
    expect(html).toContain('id="btn-lead-view-scale-locked"');
  });

  // All three segments are mounted at once and gated block/hidden, so every
  // segment's markup is present in one render regardless of which is active —
  // that is the property this asserts, not "all three are visible".
  test('all three segments stay mounted, gated block/hidden', () => {
    const html = renderToString(<PatternView />);
    // Every marker here is an id owned by ONE segment's body. Segment NAMES
    // cannot serve: the row renders all three of them as button labels, so
    // "Accompaniment" would be present with ChordView unmounted — and the
    // long titles that used to be safe ("Lead Melody", "Drum Pattern") no
    // longer render at all now that the header is named for the tab.
    expect(html).toContain('id="btn-lead-view-scale-locked"');
    expect(html).toContain('id="btn-open-chord-presets-library"');
    expect(html).toContain('id="select-sequencer-grid"');
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
