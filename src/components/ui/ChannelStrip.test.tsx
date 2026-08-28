import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ChannelStrip } from './ChannelStrip';

describe('ChannelStrip tokens', () => {
  const html = renderToString(
    <ChannelStrip
      idPrefix="chord"
      label="Chord Level"
      volume={0.8}
      max={1.5}
      accentClass="text-primary"
      onVolumeChange={() => {}}
    />,
  );

  test('uses base tokens for the label, shell and readout', () => {
    // The label now comes from the shared FIELD_LABEL token (see
    // ui/fieldClasses.ts), which settled on /60 for contrast; the point of this
    // assertion — a theme token, never a raw colour — is unchanged.
    expect(html).toContain('text-base-content/60');
    expect(html).toContain('bg-base-200');
    expect(html).toContain('border-base-300');
    // The readout inherits its colour rather than carrying a tint of its own
    // (a1b4ac2 dropped the hard-coded text-accent), so what is asserted here is
    // its base-token geometry, not a colour.
    expect(html).toContain('font-mono min-w-8 text-right');
    // The icon is the one tinted element, and it wears whatever accentClass
    // the caller passed — text-primary above, never a hard-coded accent.
    expect(html).toContain('text-primary');
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
        max={1.5}
        accentClass="text-accent"
        onVolumeChange={() => {}}
        showReadout={false}
      />,
    );
    expect(bass).not.toContain('min-w-8 text-right');
  });
});
