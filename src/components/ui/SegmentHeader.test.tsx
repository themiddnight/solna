import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SegmentHeader } from './SegmentHeader';
import { ViewHeader } from './ViewHeader';

describe('SegmentHeader', () => {
  test('reads its title from PATTERN_SEGMENTS, not from a prop', () => {
    const html = renderToString(<SegmentHeader segment="accompaniment" />);
    expect(html).toContain('Accompaniment');
  });

  test('renders the badge and actions slots the same way ViewHeader does', () => {
    const html = renderToString(
      <SegmentHeader segment="beat" badge="16-Step" actions={<button id="x">x</button>} />,
    );
    expect(html).toContain('Drum Pattern');
    expect(html).toContain('16-Step');
    expect(html).toContain('id="x"');
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
