import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { GroupFrame } from './GroupFrame';

describe('GroupFrame', () => {
  test('draws a 1px neutral border and no background', () => {
    const html = renderToString(<GroupFrame><span>x</span></GroupFrame>);
    // `rounded-box`, the theme token index.css defines, not a raw Tailwind
    // radius: a hard-coded 1rem here would be the one surface a future radius
    // change in index.css could not reach.
    expect(html).toContain('border border-base-300 rounded-box');
    expect(html).not.toContain('bg-');
  });

  /**
   * The point of the whole component. index.css spaces chord (125deg), bass
   * (256deg) and pad (40deg) around the OKLCH wheel so the three stay
   * separable; a group tint would undo that to say something the enclosure
   * already says. The frame groups by enclosure; the dots keep saying which is
   * which. This test is what stops a future "make the group read better"
   * change from adding one.
   */
  test('never names a module colour', () => {
    const html = renderToString(
      <GroupFrame label="Accompaniment"><span>x</span></GroupFrame>,
    );
    expect(html).not.toContain('module-chord');
    expect(html).not.toContain('module-bass');
    expect(html).not.toContain('module-pad');
    expect(html).not.toContain('text-primary');
    expect(html).not.toContain('text-accent');
  });

  test('renders the label in caps when given one', () => {
    const html = renderToString(<GroupFrame label="Accompaniment"><span>x</span></GroupFrame>);
    expect(html).toContain('uppercase');
    expect(html).toContain('Accompaniment');
  });

  test('renders no label element at all when given none', () => {
    const html = renderToString(<GroupFrame><span id="c">x</span></GroupFrame>);
    expect(html).not.toContain('uppercase');
    expect(html).toContain('id="c"');
  });
});
