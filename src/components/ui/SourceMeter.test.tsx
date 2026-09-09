import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SourceMeter } from './SourceMeter';

// No DOM, so effects never run: what a render proves here is the SILENT initial
// state and the markup around it. The level path itself is covered by
// src/utils/meterAttach.test.ts, which drives the real scheduler, and the
// tap point by the getSourceLevelAnalyser suite in src/audio/engine.test.ts.
describe('SourceMeter', () => {
  test('renders silent while stopped — no segment is lit', () => {
    const html = renderToString(<SourceMeter source="synth" label="Lead" isPlaying={false} />);
    expect(html).not.toContain('bg-success');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('bg-error');
  });

  test('renders silent on the first frame of playback too', () => {
    const html = renderToString(<SourceMeter source="synth" label="Lead" isPlaying />);
    expect(html).not.toContain('bg-error');
  });

  // The title is what names the row's meter for a screen reader and on hover,
  // and it must read in dB like every other level readout in the app — not as
  // a bare percentage, which has no meaning on the piecewise scale.
  test('titles itself with the layer name and a dB readout', () => {
    const html = renderToString(<SourceMeter source="chord" label="Chord" isPlaying={false} />);
    expect(html).toContain('title="Chord peak: -∞ dB"');
  });

  // Five of these sit in one column, so the bar has to span its row rather
  // than take a fixed width the way the transport's master meter does.
  test('spans the width it is given', () => {
    const html = renderToString(<SourceMeter source="bass" label="Bass" isPlaying={false} />);
    expect(html).toContain('w-full');
  });
});
