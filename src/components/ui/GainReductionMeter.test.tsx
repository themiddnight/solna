import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { GainReductionMeter } from './GainReductionMeter';

/**
 * renderToString runs no effects, so every render here is the pre-tick state:
 * the label, a 0.0 dB reading and an empty bar. That is the correct thing to
 * pin — the per-frame path is the scheduler's contract, not this component's.
 */
describe('GainReductionMeter', () => {
  test('renders the label, a zero reading and an empty bar', () => {
    const html = renderToString(<GainReductionMeter stage="compressor" active={false} />);
    expect(html).toContain('Gain Reduction');
    expect(html).toContain('0.0 dB');
    expect(html).toContain('h-full rounded-full bg-success');
    expect(html).toContain('width:0%');
  });

  test('an engaged stage tints the reading, a bypassed one dims it', () => {
    const on = renderToString(<GainReductionMeter stage="limiter" active />);
    const off = renderToString(<GainReductionMeter stage="limiter" active={false} />);
    expect(on).toContain('font-mono text-success');
    expect(off).toContain('font-mono text-base-content/40');
  });

  test('names roles, never colours', () => {
    const html = renderToString(<GainReductionMeter stage="compressor" active />);
    expect(html).not.toContain('dark:');
    for (const legacy of ['emerald-', 'green-', 'amber-', 'slate-', '#']) {
      expect(html).not.toContain(legacy);
    }
  });
});
