import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Sliders } from 'lucide-react';
import { Modal } from './Modal';

const noop = () => {};

describe('Modal', () => {
  /**
   * The bug this primitive fixes: `modal-open` shows the dialog without making
   * it modal, so there is no focus trap and Escape does nothing. Openness is a
   * DOM property set by showModal(), never a class.
   */
  test('never renders modal-open', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('<dialog class="modal"');
    expect(html).not.toContain('modal-open');
  });

  test('renders the standard box chrome and the default width', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('class="modal-box bg-base-100 border border-base-300 shadow-2xl max-w-md"');
  });

  test('size and boxClassName compose onto the box', () => {
    const html = renderToString(
      <Modal open onClose={noop} title="MIDI" size="lg" boxClassName="space-y-6">body</Modal>,
    );
    expect(html).toContain(
      'class="modal-box bg-base-100 border border-base-300 shadow-2xl max-w-2xl space-y-6"',
    );
  });

  test('the header carries the title and a labelled close button', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('class="flex items-center justify-between"');
    expect(html).toContain('<h3 class="font-bold text-lg flex items-center gap-2">Projects</h3>');
    expect(html).toContain('aria-label="Close"');
  });

  test('headerDivider rules the header off from the body', () => {
    const html = renderToString(
      <Modal open onClose={noop} headerDivider title={<><Sliders className="w-5 h-5 text-primary" />MIDI</>}>
        body
      </Modal>,
    );
    expect(html).toContain('class="flex items-center justify-between border-b border-base-300 pb-4"');
  });

  test('renders the backdrop form the platform closes on', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('<form class="modal-backdrop" method="dialog">');
  });

  test('a bottom sheet: modal-bottom, full width, inset-padded, 44px close, content after the box', () => {
    const html = renderToString(
      <Modal open onClose={noop} title="Menu" placement="bottom" afterBox={<i id="after" />}>body</Modal>,
    );
    expect(html).toContain('<dialog class="modal modal-bottom"');
    expect(html).not.toContain('max-w-md');
    expect(html).toContain('pb-[calc(1.5rem+env(safe-area-inset-bottom))]');
    expect(html).toContain('min-h-11 min-w-11');
    expect(html.indexOf('id="after"')).toBeGreaterThan(html.indexOf('body'));
    expect(html.indexOf('id="after"')).toBeLessThan(html.indexOf('modal-backdrop'));
  });

  /**
   * Openness lives in the DOM, so the two prop values must produce identical
   * markup — the effect, not the render, is what opens the dialog. If this ever
   * diverges, a server-rendered modal would flash.
   */
  test('markup does not depend on the open prop', () => {
    const opened = renderToString(<Modal open onClose={noop} title="X">body</Modal>);
    const closed = renderToString(<Modal open={false} onClose={noop} title="X">body</Modal>);
    expect(opened).toBe(closed);
  });
});
