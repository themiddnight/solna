import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { PanelCard } from './PanelCard';

describe('PanelCard', () => {
  test('renders the shell as one class string', () => {
    const html = renderToString(<PanelCard>body</PanelCard>);
    expect(html).toContain('<div class="card bg-panel border border-base-300 shadow-md">body</div>');
  });

  test('tint follows the shell', () => {
    const html = renderToString(<PanelCard tint="ring-1 ring-module-chord/40 tint-chord">body</PanelCard>);
    expect(html).toContain('class="card bg-panel border border-base-300 shadow-md ring-1 ring-module-chord/40 tint-chord"');
  });

  test('className follows the tint', () => {
    const html = renderToString(<PanelCard tint="tint-bass" className="flex-1">body</PanelCard>);
    expect(html).toContain('class="card bg-panel border border-base-300 shadow-md tint-bass flex-1"');
  });

  /**
   * An absent tint must not leave the double space that template interpolation
   * produced — every call-site test asserts on a literal class string.
   */
  test('an absent tint leaves no gap in the attribute', () => {
    const html = renderToString(<PanelCard className="relative">body</PanelCard>);
    expect(html).toContain('class="card bg-panel border border-base-300 shadow-md relative"');
    expect(html).not.toContain('  ');
  });
});
