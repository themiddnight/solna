import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { SILENCE_DB } from '@/utils/gainUnits';
import { VolumeFader, faderPositionToDb } from './VolumeFader';

// Two styles here, and the reason is the environment: there is no DOM and no
// testing-library, so markup goes through renderToString and the handlers are
// reached by calling the component function directly. VolumeFader is a pure
// function of its props with no hooks, so that is a legal call, not a trick.
function sliderPropsOf(element: React.ReactElement): Record<string, unknown> {
  const children = React.Children.toArray(
    (element.props as { children?: React.ReactNode }).children,
  );
  const slider = children.find((child): child is React.ReactElement =>
    React.isValidElement(child),
  );
  if (!slider) throw new Error('VolumeFader rendered no Slider');
  return slider.props as Record<string, unknown>;
}

describe('faderPositionToDb', () => {
  test('the bottom detent is EXACTLY the silence sentinel', () => {
    // Not "about -60": the store->engine boundary tests `db <= SILENCE_DB`, so
    // a -59.99999999 from the taper's float arithmetic would be not-silent.
    expect(faderPositionToDb(0)).toBe(SILENCE_DB);
  });

  test('the detent is one detent wide, not a dead zone', () => {
    expect(faderPositionToDb(0.005)).toBeGreaterThan(SILENCE_DB);
    expect(faderPositionToDb(0.005)).toBeLessThan(-50);
  });

  test('a position strictly inside the half-step is pinned to silence too, not just pos===0', () => {
    // Without the widening this taper-interpolates to -59.92 dB — audible in
    // principle, not silence. A native step-quantised <input> never emits
    // this value today, but the function is exported and called directly
    // here, and a future pointer-driven fader (DEV-389) need not quantise.
    expect(faderPositionToDb(0.001)).toBe(SILENCE_DB);
  });

  test('unity still lands at three-quarters of travel', () => {
    expect(faderPositionToDb(0.75)).toBeCloseTo(0, 6);
    expect(faderPositionToDb(1)).toBeCloseTo(12, 6);
  });
});

describe('VolumeFader markup', () => {
  test('unity renders at 0.75 of travel, on a position step', () => {
    const html = renderToString(
      <VolumeFader id="slider-x" label="Master" valueDb={0} onChangeDb={() => undefined} />,
    );
    expect(html).toContain('value="0.75"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="1"');
    expect(html).toContain('step="0.005"');
    expect(html).toContain('title="Master: 0.0 dB"');
    expect(html).toContain('aria-label="Master"');
    expect(html).toContain('0.0 dB');
  });

  test('the bottom of travel reads as -inf, not as a number', () => {
    const html = renderToString(
      <VolumeFader id="slider-x" label="Beat" valueDb={SILENCE_DB} onChangeDb={() => undefined} />,
    );
    expect(html).toContain('value="0"');
    expect(html).toContain('title="Beat: -∞ dB"');
    expect(html).not.toContain('-60.0 dB');
  });

  test('showReadout=false keeps the tooltip and drops the readout span', () => {
    const html = renderToString(
      <VolumeFader
        id="slider-x"
        label="Bass Layer Gain"
        valueDb={3}
        showReadout={false}
        onChangeDb={() => undefined}
      />,
    );
    expect(html).toContain('title="Bass Layer Gain: 3.0 dB"');
    expect(html).not.toContain('<span');
  });
});

describe('VolumeFader behaviour', () => {
  test('dragging reports dB, not position', () => {
    const seen: number[] = [];
    const props = sliderPropsOf(
      VolumeFader({ id: 'f', label: 'Master', valueDb: -18, onChangeDb: (db) => seen.push(db) }),
    );
    (props.onChange as (pos: number) => void)(0.75);
    (props.onChange as (pos: number) => void)(0);
    expect(seen[0]).toBeCloseTo(0, 6);
    expect(seen[1]).toBe(SILENCE_DB);
  });

  test('double-click returns the fader to unity', () => {
    const seen: number[] = [];
    const props = sliderPropsOf(
      VolumeFader({ id: 'f', label: 'Master', valueDb: -18, onChangeDb: (db) => seen.push(db) }),
    );
    (props.onDoubleClick as () => void)();
    expect(seen).toEqual([0]);
  });
});
