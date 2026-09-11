import { describe, expect, test, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { PatternView, segmentVisibilityClass } from './PatternView';
import { MIX_LAYER_IDS, segmentForFocus } from '@/store/focusTrack';
import { PATTERN_SEGMENT_IDS } from '@/types';
import { useAppStore } from '@/store/store';

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

  // All four segments are mounted at once and gated block/hidden, so every
  // segment's markup is present in one render regardless of which is active —
  // that is the property this asserts, not "all four are visible".
  test('all four segments stay mounted, gated block/hidden', () => {
    const html = renderToString(<PatternView />);
    // Every marker here is an id owned by ONE segment's body. Segment NAMES
    // cannot serve: the row renders all four of them as button labels, so
    // "Accompaniment" would be present with ChordView unmounted — and the
    // long titles that used to be safe ("Lead Melody", "Drum Pattern") no
    // longer render at all now that the header is named for the tab.
    expect(html).toContain('id="btn-lead-view-scale-locked"');
    expect(html).toContain('id="btn-fx-view-scale-locked"');
    expect(html).toContain('id="btn-open-chord-presets-library"');
    expect(html).toContain('id="select-sequencer-grid"');
    // The four gate wrappers are the only bare block/hidden divs in this
    // tree today, so counting them is counting the gates. `lead` is the
    // creation-time segment, hence one `block` and three `hidden`.
    expect(html.match(/class="hidden"/g)?.length).toBe(3);
    expect(html.match(/class="block"/g)?.length).toBe(1);
  });
});

describe('segmentVisibilityClass', () => {
  /**
   * Tested as a pure function rather than by counting `class="hidden"` in a
   * render: PatternView's tree pulls in ChordView, SequencerView and two
   * melody grids, and the property being asserted — exactly one segment
   * un-hidden, for EVERY focus — is a property of the projection, not of that
   * markup. The render test below still counts the gates for the default
   * focus, which is what proves the projection is actually wired in.
   */
  test('leaves exactly one segment showing, for every focus', () => {
    for (const focus of MIX_LAYER_IDS) {
      const shown = PATTERN_SEGMENT_IDS.filter(
        (segment) => segmentVisibilityClass(focus, segment) === 'block',
      );
      expect(shown).toEqual([segmentForFocus(focus)]);
    }
  });

  test('the three accompaniment focuses all show the accompaniment segment', () => {
    for (const focus of ['chord', 'bass', 'pad'] as const) {
      expect(segmentVisibilityClass(focus, 'accompaniment')).toBe('block');
      expect(segmentVisibilityClass(focus, 'beat')).toBe('hidden');
    }
  });
});

describe('the Pattern gate is wired to focusTrack', () => {
  afterEach(() => {
    useAppStore.setState({ focusTrack: 'synth' });
  });

  test('a drum focus shows the beat segment and hides the other three', () => {
    useAppStore.setState({ focusTrack: 'drum' });
    const html = renderToString(<PatternView />);
    expect(html.match(/class="hidden"/g)?.length).toBe(3);
    expect(html.match(/class="block"/g)?.length).toBe(1);
    // The Beat segment's own header row is the one that draws the segment
    // buttons, and it only draws when its segment is active.
    expect(html).toContain('id="segment-beat"');
  });
});

describe('Pattern › Lead track solo', () => {
  test('the Lead segment header carries the Lead solo', () => {
    const html = renderToString(<PatternView />);
    expect(html).toContain('aria-label="Solo Lead"');
  });

  test('the FX segment header carries the FX solo', () => {
    const html = renderToString(<PatternView />);
    expect(html).toContain('aria-label="Solo FX"');
  });
});

describe('Pattern › segment paste buttons', () => {
  // The button moved out of the segment header and into each card's own
  // ModuleHeader `right` slot, so it lives in the melody grid now — one grid
  // mounted per track, picking its group from `trackId`. Asserted as the two
  // group literals because the grid builds the prop with a ternary.
  test('the melody grid carries its pattern paste button, per track', () => {
    const src = readFileSync(
      new URL('./lead/LeadMelodyGrid.tsx', import.meta.url),
      'utf8',
    );
    expect(src).toContain("'lead-pattern'");
    expect(src).toContain("'fx-pattern'");
  });
});
