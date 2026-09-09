import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SegmentHeader } from './SegmentHeader';
import { ViewHeader } from './ViewHeader';

describe('SegmentHeader', () => {
  test('is named for the TAB, not the segment, and never from a prop', () => {
    const html = renderToString(<SegmentHeader segment="accompaniment" />);
    // The segment row inside it is what says which segment; the title saying
    // it too was the duplication that moving the row in here removed.
    expect(html).toContain('>Pattern</h2>');
  });

  // No badge slot: it had one caller (Beat's meter chip) and that moved down
  // to the drum card, next to the grid it describes.
  test('renders the actions slot the same way ViewHeader does', () => {
    const html = renderToString(
      <SegmentHeader segment="beat" actions={<button id="x">x</button>} />,
    );
    expect(html).toContain('id="x"');
  });

  /**
   * All three segments stay mounted, so if every one of them drew the row the
   * DOM would carry three `id="segment-lead"` buttons. Only the active
   * segment's header may draw it — under renderToString the store serves its
   * creation-time state, so `lead` is the active one here.
   */
  test('only the active segment draws the segment row', () => {
    const active = renderToString(<SegmentHeader segment="lead" />);
    const hidden = renderToString(<SegmentHeader segment="beat" />);
    expect(active).toContain('id="segment-lead"');
    expect(hidden).not.toContain('id="segment-lead"');
  });

  // The two share one card, so a restyle of one cannot skip the other. This
  // compares the OUTER wrapper markup, which is the part that must not drift.
  test('shares its card markup with ViewHeader', () => {
    const segment = renderToString(<SegmentHeader segment="lead" />);
    const view = renderToString(<ViewHeader view="sound" />);
    const shell = 'card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5';
    expect(segment).toContain(shell);
    expect(view).toContain(shell);
  });
});
