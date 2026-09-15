import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  badgeColorFor,
  beginKnobGesture,
  finishKnobGesture,
  handleKnobKeyDown,
  KNOB_COLORS,
  Knob,
  updateKnobGesture,
  type KnobGestureState,
} from './Knob';

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

describe('Knob accessible name', () => {
  const render = (ariaLabel?: string) =>
    renderToString(
      <Knob value={500} onChange={() => {}} label="Oct" ariaLabel={ariaLabel} format={String} />,
    );

  test('defaults to the visible label', () => {
    expect(render()).toContain('aria-label="Oct"');
  });

  test('an explicit name replaces it while the caption stays short', () => {
    const html = render('OSC 1 Oct');
    expect(html).toContain('aria-label="OSC 1 Oct"');
    // The visible caption is untouched — that is the whole point of the prop,
    // and the name still CONTAINS it (WCAG 2.5.3).
    expect(html).toContain('>Oct<');
    expect(html).not.toContain('aria-label="Oct"');
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

/**
 * These exercise the exact functions the `<svg>` pointer/keyboard handlers
 * call (see `useKnobDrag`/`handleKeyDown` in `Knob.tsx`), not a
 * re-implementation of them — this repo has no DOM and no testing-library,
 * so a real `PointerEvent`/dispatch cannot be simulated. What is NOT covered
 * here, and must be checked by reading `Knob.tsx` instead: that
 * `onPointerDown`/`onPointerMove`/`onPointerUp`/`onPointerCancel`/
 * `onLostPointerCapture` on the `<svg>` are wired to exactly these functions
 * via `gestureRef`, and that `useKnobDrag` passes `onCommit`/`onCancel`
 * through unchanged.
 */
describe('Knob pointer gesture (commit-aware)', () => {
  const config = { min: 0, max: 100, scale: 'linear' as const, step: undefined };

  test('multiple pointer moves call onChange repeatedly, onCommit exactly once on pointerup', () => {
    const changes: number[] = [];
    const commits: number[] = [];
    const gestureRef: { current: KnobGestureState | null } = {
      current: beginKnobGesture(50, config.min, config.max, config.scale, 0, 0),
    };

    for (const dx of [10, 20, 30]) {
      const next = updateKnobGesture(
        gestureRef.current!,
        config.min,
        config.max,
        config.scale,
        config.step,
        dx,
        0,
        false,
      );
      if (next !== null) changes.push(next);
    }
    expect(changes.length).toBe(3);

    finishKnobGesture(gestureRef, 'commit', (v) => commits.push(v), () => {
      throw new Error('onCancel must not run on commit');
    });

    expect(commits).toEqual([changes[changes.length - 1]]);
    expect(gestureRef.current).toBeNull();
  });

  test('pointercancel calls onCancel exactly once and never commits', () => {
    const commits: number[] = [];
    let cancels = 0;
    const gestureRef: { current: KnobGestureState | null } = {
      current: beginKnobGesture(50, config.min, config.max, config.scale, 0, 0),
    };
    updateKnobGesture(gestureRef.current!, config.min, config.max, config.scale, config.step, 10, 0, false);

    finishKnobGesture(gestureRef, 'cancel', (v) => commits.push(v), () => { cancels += 1; });

    expect(cancels).toBe(1);
    expect(commits).toEqual([]);
    expect(gestureRef.current).toBeNull();
  });

  test('lost pointer capture calls onCancel exactly once and never commits', () => {
    const commits: number[] = [];
    let cancels = 0;
    const gestureRef: { current: KnobGestureState | null } = {
      current: beginKnobGesture(50, config.min, config.max, config.scale, 0, 0),
    };

    finishKnobGesture(gestureRef, 'cancel', (v) => commits.push(v), () => { cancels += 1; });

    expect(cancels).toBe(1);
    expect(commits).toEqual([]);
  });

  test('a pointerup followed by a lost-capture event does not emit a second terminal callback', () => {
    let commits = 0;
    let cancels = 0;
    const gestureRef: { current: KnobGestureState | null } = {
      current: beginKnobGesture(50, config.min, config.max, config.scale, 0, 0),
    };
    updateKnobGesture(gestureRef.current!, config.min, config.max, config.scale, config.step, 10, 0, false);

    // REENTRANT on purpose: the real-world race is a lostpointercapture event
    // arriving while the pointerup's onCommit callback is still on the
    // stack — not two calls run back-to-back, which any implementation
    // passes trivially because the ref is fully cleared by the time the
    // second call starts. Firing the second `finishKnobGesture` call FROM
    // INSIDE the first callback is what actually distinguishes "clear the
    // ref before calling back" from "clear it after": clear-before sees a
    // cleared ref on the reentrant call and does nothing; clear-after still
    // sees the live gesture and fires a second terminal callback.
    finishKnobGesture(
      gestureRef,
      'commit',
      () => {
        commits += 1;
        finishKnobGesture(gestureRef, 'cancel', () => { commits += 1; }, () => { cancels += 1; });
      },
      () => { cancels += 1; },
    );

    expect(commits).toBe(1);
    expect(cancels).toBe(0);
  });
});

describe('Knob keyboard gesture (commit-aware)', () => {
  test('an arrow key calls onChange then onCommit exactly once', () => {
    const calls: string[] = [];
    const handled = handleKnobKeyDown(
      'ArrowUp',
      { value: 10, min: 0, max: 100, step: undefined, disabled: false },
      (v) => calls.push(`change:${v}`),
      (v) => calls.push(`commit:${v}`),
    );

    expect(handled).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0].startsWith('change:')).toBe(true);
    expect(calls[1].startsWith('commit:')).toBe(true);
    expect(calls[0].split(':')[1]).toBe(calls[1].split(':')[1]);
  });

  test('a second keypress commits again, independently', () => {
    let commitCount = 0;
    let value = 10;
    for (const key of ['ArrowUp', 'ArrowUp']) {
      handleKnobKeyDown(
        key,
        { value, min: 0, max: 100, step: undefined, disabled: false },
        (v) => { value = v; },
        () => { commitCount += 1; },
      );
    }
    expect(commitCount).toBe(2);
  });

  test('an unbound key or a disabled knob calls neither callback', () => {
    let calls = 0;
    expect(
      handleKnobKeyDown('a', { value: 10, min: 0, max: 100, step: undefined, disabled: false }, () => { calls += 1; }, () => { calls += 1; }),
    ).toBe(false);
    expect(
      handleKnobKeyDown('ArrowUp', { value: 10, min: 0, max: 100, step: undefined, disabled: true }, () => { calls += 1; }, () => { calls += 1; }),
    ).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('Knob without onCommit/onCancel (existing callers)', () => {
  test('finishKnobGesture with no callbacks still clears the gesture and throws nothing', () => {
    const gestureRef: { current: KnobGestureState | null } = {
      current: beginKnobGesture(50, 0, 100, 'linear', 0, 0),
    };
    expect(() => finishKnobGesture(gestureRef, 'commit')).not.toThrow();
    expect(gestureRef.current).toBeNull();
  });

  test('a bare tap (no axis picked) commits nothing', () => {
    // pointerdown/pointerup with no movement: the gesture never cleared the
    // axis-pick threshold, so onChange never fired and latestValue is still
    // the knob's own value. Committing it re-installed the whole patch and
    // re-serialised the persist slice for a gesture that changed nothing.
    let commits = 0;
    let cancels = 0;
    const gestureRef = {
      current: beginKnobGesture(10, 0, 100, 'linear', 5, 5),
    };
    finishKnobGesture(gestureRef, 'commit', () => { commits += 1; }, () => { cancels += 1; });
    expect(commits).toBe(0);
    expect(cancels).toBe(0);
    expect(gestureRef.current).toBeNull();
  });

  test('a gesture that DID move still commits', () => {
    let committed: number | null = null;
    const gestureRef = {
      current: beginKnobGesture(10, 0, 100, 'linear', 5, 5),
    };
    // Far enough to pick an axis.
    updateKnobGesture(gestureRef.current, 0, 100, 'linear', undefined, 5, -60, false);
    finishKnobGesture(gestureRef, 'commit', (v) => { committed = v; });
    expect(committed).not.toBeNull();
  });

  test('an auto-repeated key PREVIEWS without committing', () => {
    // A held arrow key repeats ~30x/s. Committing each repeat made the
    // keyboard the one path still doing a persisted write per event — a whole
    // patch clone, a store write and an engine re-install every 33 ms.
    let changes = 0;
    let commits = 0;
    const handled = handleKnobKeyDown(
      'ArrowUp',
      { value: 10, min: 0, max: 100, step: undefined, disabled: false, repeat: true },
      () => { changes += 1; },
      () => { commits += 1; },
    );
    expect(handled).toBe(true);
    expect(changes).toBe(1);
    expect(commits).toBe(0);
  });

  test('a single (non-repeated) key press still commits on its own', () => {
    let commits = 0;
    handleKnobKeyDown(
      'ArrowUp',
      { value: 10, min: 0, max: 100, step: undefined, disabled: false, repeat: false },
      () => {},
      () => { commits += 1; },
    );
    expect(commits).toBe(1);
  });

  test('handleKnobKeyDown with no onCommit still calls onChange', () => {
    let changed: number | null = null;
    const handled = handleKnobKeyDown(
      'ArrowUp',
      { value: 10, min: 0, max: 100, step: undefined, disabled: false },
      (v) => { changed = v; },
    );
    expect(handled).toBe(true);
    expect(changed).not.toBeNull();
  });
});

describe('badgeColorFor', () => {
  test('every legal knob colour has a badge class', () => {
    for (const color of KNOB_COLORS) {
      expect(badgeColorFor(color)).toMatch(/^\[--badge-color:var\(--color-[a-z-]+\)\]$/);
    }
    expect(new Set(KNOB_COLORS.map(badgeColorFor)).size).toBe(KNOB_COLORS.length);
  });

  test('maps the colour role, not a palette name', () => {
    expect(badgeColorFor('text-module-filter')).toBe('[--badge-color:var(--color-module-filter)]');
    expect(badgeColorFor('text-primary')).toBe('[--badge-color:var(--color-primary)]');
  });
});
