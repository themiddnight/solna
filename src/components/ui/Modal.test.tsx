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
    expect(html).toContain('class="modal-box bg-base-100 border border-base-300 shadow-2xl max-w-md flex flex-col gap-4 overflow-hidden"');
  });

  test('size composes onto the box, bodyClassName onto the scrolling body', () => {
    const html = renderToString(
      <Modal open onClose={noop} title="MIDI" size="lg" bodyClassName="space-y-6">body</Modal>,
    );
    expect(html).toContain('modal-box bg-base-100 border border-base-300 shadow-2xl max-w-2xl');
    expect(html).toContain('<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain -m-1 p-1 space-y-6">body</div>');
  });

  test('the header is pinned above the body and the footer below it', () => {
    const html = renderToString(
      <Modal open onClose={noop} title="Vibes" footer={<p id="foot">foot</p>}>body</Modal>,
    );
    expect(html).toContain('<div class="flex shrink-0 items-center justify-between"><h3');
    expect(html).toContain('<div class="shrink-0 [&amp;&gt;.modal-action]:mt-0"><p id="foot">foot</p></div>');
    expect(html.indexOf('>body<')).toBeLessThan(html.indexOf('id="foot"'));
  });

  test('renders no footer slot without a footer', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).not.toContain('<div class="shrink-0 ');
  });

  test('the header carries the title and a labelled close button', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('class="flex shrink-0 items-center justify-between"');
    expect(html).toContain('<h3 class="font-bold text-lg flex items-center gap-2">Projects</h3>');
    expect(html).toContain('aria-label="Close"');
  });

  test('headerDivider rules the header off from the body', () => {
    const html = renderToString(
      <Modal open onClose={noop} headerDivider title={<><Sliders className="w-5 h-5 text-primary" />MIDI</>}>
        body
      </Modal>,
    );
    expect(html).toContain('class="flex shrink-0 items-center justify-between border-b border-base-300 pb-4"');
  });

  test('renders the backdrop form the platform closes on', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).toContain('<form class="modal-backdrop" method="dialog">');
  });

  /** `Modal` is always centered (R326) — the bottom sheet is `BottomSheet` now. */
  test('never renders a bottom sheet', () => {
    const html = renderToString(<Modal open onClose={noop} title="Projects">body</Modal>);
    expect(html).not.toContain('modal-bottom');
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
