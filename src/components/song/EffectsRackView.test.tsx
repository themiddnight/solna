import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { EffectsRackView } from './EffectsRackView';

describe('EffectsRackView theming', () => {
  const html = renderToString(<EffectsRackView />);

  /** The rack's dimmed-unit class, shared by all six cards. */
  const DIMMED = 'border-base-300 opacity-60';

  /**
   * One rack unit's markup. Every card opens with `card bg-panel` and they are siblings, never
   * nested, so splitting on that marker cuts the html into per-card chunks; the chunk holding a
   * card's own control is that card's markup, class attribute included.
   */
  function cardMarkup(testId: string): string {
    const card = html.split('card bg-panel').find((chunk) => chunk.includes(testId));
    if (!card) throw new Error(`no rack card contains ${testId}`);
    return card;
  }

  test('rack units are daisyUI cards on semantic tokens', () => {
    expect(html).toContain('card bg-panel');
    expect(html).toContain('card-body');
    expect(html).toContain('text-primary');
    expect(html).toContain('text-accent');
    expect(html).toContain('text-secondary');
  });

  test('bypass switches are daisyUI buttons', () => {
    expect(html).toContain('btn btn-xs');
    expect(html).toContain('btn-active');
    expect(html).toContain('btn-bypass-reverb');
    expect(html).toContain('btn-bypass-delay');
    expect(html).toContain('btn-bypass-distortion');
    expect(html).toContain('btn-bypass-eq');
  });

  test('no dark: variants and no raw palette colours survive', () => {
    expect(html).not.toContain('dark:');
    for (const legacy of ['purple-', 'cyan-', 'indigo-', 'amber-', 'emerald-']) {
      expect(html).not.toContain(legacy);
    }
  });

  test('the master dynamics modules render, with a power toggle each', () => {
    expect(html).toContain('Master Dynamics');
    expect(html).toContain('Master Compressor');
    expect(html).toContain('Brickwall Limiter');
    expect(html).toContain('btn-enable-compressor');
    expect(html).toContain('btn-enable-limiter');
  });

  test('the compressor defaults OFF and renders dimmed; the limiter defaults ON and does not', () => {
    // The rack's own idiom for a disengaged unit — but all six cards share the class, so a
    // bare count says only HOW MANY are dimmed, never WHICH. Name the two dynamics cards by
    // their own markup, then pin the total so a dimmed reverb could not stand in for one.
    // DEV-383: the limiter now defaults ON, so only the compressor card is dimmed.
    expect(cardMarkup('btn-enable-compressor')).toContain(DIMMED);
    expect(cardMarkup('btn-enable-limiter')).not.toContain(DIMMED);
    expect(html.split(DIMMED).length - 1).toBe(1);
  });

  test('every dynamics parameter has a knob', () => {
    for (const id of [
      'slider-comp-threshold',
      'slider-comp-ratio',
      'slider-comp-attack',
      'slider-comp-release',
      'slider-limiter-threshold',
      'slider-limiter-ratio',
      'slider-limiter-attack',
      'slider-limiter-release',
    ]) {
      expect(html).toContain(id);
    }
  });

  test('each stage carries a gain-reduction readout', () => {
    expect(html.split('Gain Reduction').length - 1).toBe(2);
    expect(html).toContain('0.0 dB');
  });
});
