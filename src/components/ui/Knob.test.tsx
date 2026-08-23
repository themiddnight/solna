import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Knob } from './Knob';

// Static-render structure checks: where the label/value sit relative to the
// role="slider" svg pins each layout variant without a DOM.
const renderKnob = (layout: 'vertical' | 'horizontal') =>
  renderToString(
    <Knob
      layout={layout}
      value={500}
      onChange={() => {}}
      label="Cutoff"
      format={(v) => `${v} Hz`}
    />,
  );

describe('Knob layout variants', () => {
  const positions = (html: string) => ({
    label: html.indexOf('Cutoff'),
    slider: html.indexOf('role="slider"'),
    value: html.indexOf('500 Hz'),
  });

  test('vertical layout keeps label above and value below the knob', () => {
    const { label, slider, value } = positions(renderKnob('vertical'));
    expect(label > -1).toBe(true);
    expect(slider > -1).toBe(true);
    expect(value > -1).toBe(true);
    expect(label < slider).toBe(true);
    expect(slider < value).toBe(true);
  });

  test('horizontal layout puts the label/value column before the knob', () => {
    const html = renderKnob('horizontal');
    const { label, slider, value } = positions(html);
    expect(label > -1).toBe(true);
    expect(slider > -1).toBe(true);
    expect(value > -1).toBe(true);
    expect(label < slider).toBe(true);
    expect(value < slider).toBe(true);
    expect(html).toContain('flex-row');
  });
});
