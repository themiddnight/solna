import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { VuMeter } from './VuMeter';

// No DOM, so effects never run: what a render proves here is the SILENT initial
// state and the markup around it. The level path itself is covered by
// src/utils/meterAttach.test.ts, which drives the real scheduler.
describe('VuMeter', () => {
  test('renders silent while stopped — no segment is lit', () => {
    const html = renderToString(<VuMeter isPlaying={false} />);
    expect(html).not.toContain('bg-success');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('bg-error');
  });

  test('renders silent on the first frame of playback too', () => {
    const html = renderToString(<VuMeter isPlaying />);
    expect(html).not.toContain('bg-error');
  });

  test('keeps the transport chrome it had: hidden on narrow screens, boxed', () => {
    const html = renderToString(<VuMeter isPlaying={false} />);
    expect(html).toContain('hidden sm:flex items-center gap-1 bg-base-200 border border-base-300 p-1.5 rounded-box');
  });

  test('titles itself with a dB readout rather than a bare percentage', () => {
    const html = renderToString(<VuMeter isPlaying={false} />);
    // formatDb's silence rendering (see src/utils/gainUnits.ts) is '-∞ dB', not a bare
    // percentage — that is the property under test, not the exact glyph.
    expect(html).toContain('title="Master peak: -∞ dB"');
  });
});
