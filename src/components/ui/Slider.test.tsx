import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Slider } from './Slider';

describe('Slider tokens', () => {
  test('defaults to a daisyUI primary range', () => {
    const html = renderToString(
      <Slider min={0} max={1} step={0.01} value={0.5} onChange={() => {}} />,
    );

    expect(html).toContain('type="range"');
    expect(html).toContain('range');
    expect(html).toContain('range-primary');
    expect(html).toContain('range-xs');
    // The legacy murva palette must be gone.
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('accent-indigo-500');
  });

  test('a caller-supplied className fully replaces the default', () => {
    const html = renderToString(
      <Slider
        id="slider-test"
        min={0}
        max={1}
        step={0.01}
        value={0.25}
        onChange={() => {}}
        className="range range-accent range-xs w-16"
        title="Bass Level"
      />,
    );

    expect(html).toContain('range-accent');
    expect(html).toContain('w-16');
    expect(html).not.toContain('range-primary');
    expect(html).toContain('id="slider-test"');
    expect(html).toContain('title="Bass Level"');
  });
});
