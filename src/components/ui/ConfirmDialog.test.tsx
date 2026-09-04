import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ConfirmDialog } from './ConfirmDialog';

const noop = () => {};

describe('ConfirmDialog', () => {
  test('renders the title, the message and the confirm label', () => {
    const html = renderToString(
      <ConfirmDialog
        title="Delete preset"
        message="Are you sure?"
        confirmLabel="Delete"
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('<h3 class="font-bold text-lg flex items-center gap-2">Delete preset</h3>');
    expect(html).toContain('<p class="text-sm">Are you sure?</p>');
    expect(html).toContain('>Delete</button>');
  });

  test('is a Modal — never a modal-open div', () => {
    const html = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="OK" onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain('<dialog class="modal"');
    expect(html).not.toContain('modal-open');
  });

  test('danger paints the confirm button with the error role, not a colour', () => {
    const plain = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="OK" onConfirm={noop} onCancel={noop} />,
    );
    const danger = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="OK" danger onConfirm={noop} onCancel={noop} />,
    );
    expect(plain).toContain('class="btn btn-primary"');
    expect(danger).toContain('class="btn btn-error"');
  });

  /**
   * A dialog raised BY a destructive action must not open with the destructive
   * button focused, or a stray Enter deletes the thing. Cancel is the initial
   * focus target; jsx-a11y/no-autofocus is disabled on that line with the same
   * reason.
   */
  test('the cancel button is the autofocus target', () => {
    const html = renderToString(
      <ConfirmDialog title="T" message="M" confirmLabel="Delete" danger onConfirm={noop} onCancel={noop} />,
    );
    const cancel = html.slice(html.indexOf('modal-action'));
    expect(cancel.indexOf('autofocus')).toBeLessThan(cancel.indexOf('btn-error'));
  });

  test('a ReactNode message renders its markup', () => {
    const html = renderToString(
      <ConfirmDialog
        title="Delete project"
        message={<>Delete <strong>Demo</strong>? This cannot be undone.</>}
        confirmLabel="Delete"
        danger
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('<strong>Demo</strong>');
  });
});
