import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChannelStrip } from './ChannelStrip';

describe('ChannelStrip tokens', () => {
  const html = renderToString(
    <ChannelStrip
      idPrefix="chord"
      label="Chord Level"
      volume={0.8}
      accentClass="text-primary"
      onVolumeChange={() => {}}
    />,
  );

  test('uses base tokens for the label, shell and readout', () => {
    expect(html).toContain('text-base-content/50');
    expect(html).toContain('bg-base-200');
    expect(html).toContain('border-base-300');
    expect(html).toContain('text-accent');
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('#171B36');
    expect(html).not.toContain('#2D355A');
    expect(html).not.toContain('text-slate-500');
    expect(html).not.toContain('indigo');
  });

  test('renders a daisyUI range for the fader', () => {
    expect(html).toContain('range');
    expect(html).toContain('range-xs');
    expect(html).toContain('id="slider-chord-layer-volume"');
  });

  test('the percentage in the label is monospaced', () => {
    // The numeric readout must live in its own font-mono span (design.md §
    // numeric readouts), not inline in the prose label.
    expect(html).toContain('<span class="font-mono">(');
    expect(html).toContain('80');
    expect(html).toContain('%)</span>');
  });

  test('showReadout=false hides the trailing percentage', () => {
    const bass = renderToString(
      <ChannelStrip
        idPrefix="bass"
        label="Bass Level"
        volume={0.5}
        accentClass="text-accent"
        onVolumeChange={() => {}}
        showReadout={false}
      />,
    );
    expect(bass).not.toContain('min-w-8 text-right');
  });
});
