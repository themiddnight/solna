import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { TransportBar } from './TransportBar';

describe('TransportBar', () => {
  test('the BPM label uses a real Tailwind breakpoint, not the phantom xs:', () => {
    const html = renderToString(<TransportBar />);

    // `xs` is not a Tailwind v4 default breakpoint and this repo has no
    // tailwind.config, so `xs:inline` never generates a rule and the label
    // stays display:none at every viewport width.
    expect(html).not.toContain('xs:inline');
    expect(html).toContain('sm:inline');
  });

  test('transport controls are daisyUI buttons on semantic tokens', () => {
    const html = renderToString(<TransportBar />);

    expect(html).toContain('btn btn-sm btn-success');
    expect(html).toContain('btn btn-sm btn-primary');
    expect(html).toContain('input input-xs input-ghost');
    expect(html).toContain('range range-xs range-primary');
  });
});
