import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { LoopCopyButton } from './LoopCopyButton';

describe('LoopCopyButton', () => {
  test('renders a copy button', () => {
    const html = renderToString(<LoopCopyButton />);
    expect(html).toContain('id="btn-copy-loop"');
    expect(html).toContain('Copy');
  });
});
