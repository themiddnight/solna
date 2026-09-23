import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { BottomSheet } from './BottomSheet';

const noop = () => {};

describe('BottomSheet', () => {
  test('modal-bottom, full width, safe-area padded, 44px close', () => {
    const html = renderToString(<BottomSheet open onClose={noop} title="Menu">body</BottomSheet>);
    expect(html).toContain('<dialog class="modal modal-bottom"');
    expect(html).not.toContain('max-w-md');
    expect(html).toContain('pb-[calc(1.5rem+env(safe-area-inset-bottom))]');
    expect(html).toContain('min-h-11 min-w-11');
  });

  test('the header carries the title and a labelled close button', () => {
    const html = renderToString(<BottomSheet open onClose={noop} title="Menu">body</BottomSheet>);
    expect(html).toContain('<h3 class="font-bold text-lg flex items-center gap-2">Menu</h3>');
    expect(html).toContain('aria-label="Close"');
  });

  test('boxClassName composes onto the box', () => {
    const html = renderToString(
      <BottomSheet open onClose={noop} title="Menu" boxClassName="space-y-3">body</BottomSheet>,
    );
    expect(html).toContain(
      'class="modal-box bg-base-100 border border-base-300 shadow-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-3"',
    );
  });

  test('afterBox renders inside the dialog, after the box, before the backdrop form', () => {
    const html = renderToString(
      <BottomSheet open onClose={noop} title="Menu" afterBox={<i id="after" />}>body</BottomSheet>,
    );
    expect(html.indexOf('id="after"')).toBeGreaterThan(html.indexOf('body'));
    expect(html.indexOf('id="after"')).toBeLessThan(html.indexOf('modal-backdrop'));
  });

  test('renders the backdrop form the platform closes on', () => {
    const html = renderToString(<BottomSheet open onClose={noop} title="Menu">body</BottomSheet>);
    expect(html).toContain('<form class="modal-backdrop" method="dialog">');
  });

  /**
   * Openness lives in the DOM, so the two prop values must produce identical
   * markup — the effect, not the render, is what opens the dialog.
   */
  test('markup does not depend on the open prop', () => {
    const opened = renderToString(<BottomSheet open onClose={noop} title="Menu">body</BottomSheet>);
    const closed = renderToString(<BottomSheet open={false} onClose={noop} title="Menu">body</BottomSheet>);
    expect(opened).toBe(closed);
  });
});
