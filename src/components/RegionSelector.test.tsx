import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { RegionSelector } from './RegionSelector';

describe('RegionSelector', () => {
  test('renders the default active region as an option', () => {
    const html = renderToString(<RegionSelector />);
    expect(html).toContain('id="select-region"');
    expect(html).toContain('Region 1');
    expect(html).toContain('value="region-default-1"');
  });
});
