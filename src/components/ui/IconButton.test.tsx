import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  /**
   * The whole reason this primitive exists: 32 icon-only buttons rendered no
   * accessible name at all. `label` is required, and it is emitted twice — as
   * `aria-label` for assistive tech and as `title` for the sighted hover hint
   * the hand-written copies already had.
   */
  test('emits the label as both aria-label and title', () => {
    const html = renderToString(<IconButton label="Close" icon={<X className="w-4 h-4" />} />);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('title="Close"');
  });

  test('defaults to a small ghost square button', () => {
    const html = renderToString(<IconButton label="Close" icon={<X className="w-4 h-4" />} />);
    expect(html).toContain('class="btn btn-square btn-sm btn-ghost"');
  });

  test('size, variant, active and className land in one class attribute', () => {
    const html = renderToString(
      <IconButton
        label="Mute"
        icon={<X className="w-3 h-3" />}
        size="xs"
        variant="outline"
        active
        className="text-module-bass select-none"
      />,
    );
    expect(html).toContain(
      'class="btn btn-square btn-xs btn-ghost border border-base-300 btn-active text-module-bass select-none"',
    );
  });

  test('renders type="button" so an icon inside a form never submits it', () => {
    expect(renderToString(<IconButton label="Delete" icon={<X />} />)).toContain('type="button"');
  });

  test('passes native button props through', () => {
    const html = renderToString(
      <IconButton id="btn-x" label="Delete" icon={<X />} disabled variant="error" />,
    );
    expect(html).toContain('id="btn-x"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('btn-error');
  });
});
