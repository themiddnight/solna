import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { MeterBar } from './MeterBar';

describe('MeterBar', () => {
  test('lights nothing at silence', () => {
    const html = renderToString(<MeterBar peakDbfs={-Infinity} />);
    expect(html).not.toContain('bg-success');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('bg-error');
  });

  test('lights the low segments in success green at -24 dBFS', () => {
    const html = renderToString(<MeterBar peakDbfs={-24} />);
    expect(html).toContain('bg-success');
    expect(html).not.toContain('bg-error');
  });

  test('lights the top segments in error red once the reading is over', () => {
    const html = renderToString(<MeterBar peakDbfs={3} />);
    expect(html).toContain('bg-error');
  });

  test('draws the held-peak marker only when it is above the live peak', () => {
    const withHold = renderToString(<MeterBar peakDbfs={-40} heldPeakDbfs={-6} />);
    expect(withHold).toContain('data-meter-hold');

    const withoutHold = renderToString(<MeterBar peakDbfs={-6} heldPeakDbfs={-6} />);
    expect(withoutHold).not.toContain('data-meter-hold');
  });

  test('passes a title through for the tooltip', () => {
    const html = renderToString(<MeterBar peakDbfs={-12} title="Synth: -12.0 dB" />);
    expect(html).toContain('title="Synth: -12.0 dB"');
  });

  // Regression for the bug the header comment warns about: murva's gradient fill rescales with
  // the element it is painted on, so it always reaches its own last stop and puts a red tip on
  // the bar even at silence. The fill must stay a per-zone class, never a gradient.
  test('never paints the fill as a gradient, even at full scale', () => {
    const html = renderToString(<MeterBar peakDbfs={3} heldPeakDbfs={3} />);
    expect(html).not.toContain('gradient');
  });
});
