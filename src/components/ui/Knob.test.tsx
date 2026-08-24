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

describe('Knob theme tokens', () => {
  const html = renderToString(
    <Knob
      value={0.5}
      onChange={() => {}}
      label="Cutoff"
      detent={0.5}
      format={(v) => `${v}`}
    />,
  );

  test('uses primary as the default needle tint', () => {
    expect(html).toContain('text-primary');
    expect(html).not.toContain('#877dca');
  });

  test('paints the ring and detent tick with token stroke utilities', () => {
    expect(html).toContain('stroke-base-300');
    expect(html).toContain('stroke-base-content/50');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('#94a3b8');
  });

  test('labels and the focus ring use semantic tokens', () => {
    expect(html).toContain('text-base-content/60');
    expect(html).toContain('focus-visible:outline-primary/70');
    expect(html).not.toContain('text-slate-400');
    expect(html).not.toContain('outline-indigo-400');
  });

  test('an explicit token color overrides the default', () => {
    const accent = renderToString(
      <Knob value={0.5} onChange={() => {}} color="text-accent" label="LFO" />,
    );
    expect(accent).toContain('text-accent');
    expect(accent).not.toContain('text-primary');
  });
});
