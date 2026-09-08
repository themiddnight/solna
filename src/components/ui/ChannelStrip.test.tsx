import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ChannelStrip } from './ChannelStrip';

// Pure props in, markup out — no store, so the zustand/renderToString trap
// does not apply here.
describe('ChannelStrip', () => {
  test('unity renders at 0.75 of travel and reads out as 0.0 dB', () => {
    const html = renderToString(
      <ChannelStrip
        idPrefix="chord"
        label="Chord Level"
        volumeDb={0}
        accentClass="text-primary"
        onVolumeDbChange={() => undefined}
      />,
    );
    expect(html).toContain('value="0.75"');
    expect(html).toContain('0.0 dB');
    expect(html).toContain('title="Chord Layer Gain: 0.0 dB"');
  });

  test('the fader is a 0..1 position control with a position step', () => {
    const html = renderToString(
      <ChannelStrip
        idPrefix="bass"
        volumeDb={-6}
        accentClass="text-primary"
        onVolumeDbChange={() => undefined}
      />,
    );
    expect(html).toContain('min="0"');
    expect(html).toContain('max="1"');
    expect(html).toContain('step="0.005"');
  });

  test('the silence floor sits at the bottom of the travel and reads -inf', () => {
    const html = renderToString(
      <ChannelStrip
        idPrefix="pad"
        volumeDb={-60}
        accentClass="text-primary"
        onVolumeDbChange={() => undefined}
      />,
    );
    expect(html).toContain('value="0"');
    expect(html).toContain('-∞ dB');
    expect(html).not.toContain('-60.0 dB');
  });

  test('showReadout=false drops the numeric readout but keeps the tooltip', () => {
    const html = renderToString(
      <ChannelStrip
        idPrefix="synth"
        volumeDb={3}
        accentClass="text-primary"
        showReadout={false}
        onVolumeDbChange={() => undefined}
      />,
    );
    expect(html).not.toContain('min-w-14');
    expect(html).toContain('title="Synth Layer Gain: 3.0 dB"');
  });

  test('the accent class and the full slider class list land where they are passed', () => {
    const html = renderToString(
      <ChannelStrip
        idPrefix="drums"
        volumeDb={0}
        accentClass="text-primary"
        sliderClassName="range range-xs range-primary"
        onVolumeDbChange={() => undefined}
      />,
    );
    expect(html).toContain('w-3.5 h-3.5 text-primary shrink-0');
    expect(html).toContain('class="range range-xs range-primary"');
  });
});
