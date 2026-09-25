import { describe, expect, test } from 'bun:test';
import type { Rgb } from './themeColor';
import {
  createThemePalette,
  parseRgbString,
  resolveColorStringToRgb,
  resolveThemeRgb,
  rgbToCss,
  subscribeToThemeChange,
} from './themeColor';

describe('parseRgbString', () => {
  test('parses legacy comma rgb()', () => {
    expect(parseRgbString('rgb(245, 158, 11)')).toEqual({ r: 245, g: 158, b: 11 });
  });

  test('parses legacy comma rgba() and ignores the alpha channel', () => {
    expect(parseRgbString('rgba(245, 158, 11, 0.5)')).toEqual({ r: 245, g: 158, b: 11 });
  });

  test('parses modern space-separated syntax with a slash alpha', () => {
    expect(parseRgbString('rgb(245 158 11 / 0.5)')).toEqual({ r: 245, g: 158, b: 11 });
  });

  test('parses space-separated syntax without alpha', () => {
    expect(parseRgbString('rgb(13 148 136)')).toEqual({ r: 13, g: 148, b: 136 });
  });

  test('clamps out-of-range channels into 0-255', () => {
    expect(parseRgbString('rgb(300, -20, 11)')).toEqual({ r: 255, g: 0, b: 11 });
  });

  test('rounds fractional channels', () => {
    expect(parseRgbString('rgb(244.6 157.5 10.4)')).toEqual({ r: 245, g: 158, b: 10 });
  });

  test('returns null for anything it cannot parse', () => {
    expect(parseRgbString('oklch(0.75 0.18 70)')).toBeNull();
    expect(parseRgbString('')).toBeNull();
    expect(parseRgbString('#F59E0B')).toBeNull();
  });
});

describe('rgbToCss', () => {
  test('emits rgb() when no alpha is given', () => {
    expect(rgbToCss({ r: 245, g: 158, b: 11 })).toBe('rgb(245, 158, 11)');
  });

  test('emits rgba() when an alpha is given', () => {
    expect(rgbToCss({ r: 245, g: 158, b: 11 }, 0.45)).toBe('rgba(245, 158, 11, 0.45)');
  });

  test('emits rgba() for a zero alpha rather than falling back to rgb()', () => {
    expect(rgbToCss({ r: 4, g: 120, b: 87 }, 0)).toBe('rgba(4, 120, 87, 0)');
  });

  test('clamps alpha into 0-1', () => {
    expect(rgbToCss({ r: 0, g: 0, b: 0 }, 1.7)).toBe('rgba(0, 0, 0, 1)');
    expect(rgbToCss({ r: 0, g: 0, b: 0 }, -3)).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('resolveColorStringToRgb', () => {
  test('fast path: an rgb-family string resolves without consulting the rasterizer', () => {
    const rasterize = (): Rgb | null => {
      throw new Error('should not be called for an already-parseable colour');
    };
    expect(resolveColorStringToRgb('rgb(13 148 136)', rasterize)).toEqual({
      r: 13,
      g: 148,
      b: 136,
    });
  });

  test('an oklch() string is handed to the rasterizer and returns its result, not null', () => {
    const rasterized: Rgb = { r: 10, g: 20, b: 30 };
    const rasterize = (colorString: string): Rgb | null =>
      colorString.startsWith('oklch(') ? rasterized : null;
    expect(resolveColorStringToRgb('oklch(0.75 0.18 70)', rasterize)).toEqual(rasterized);
  });

  test('an oklab()/color() string is also handed to the rasterizer', () => {
    const rasterized: Rgb = { r: 1, g: 2, b: 3 };
    const rasterize = (): Rgb | null => rasterized;
    expect(resolveColorStringToRgb('oklab(0.6 0.05 -0.1)', rasterize)).toEqual(rasterized);
    expect(resolveColorStringToRgb('color(display-p3 1 0 0)', rasterize)).toEqual(rasterized);
  });

  test('returns null, not a guess, when the rasterizer cannot resolve the colour either', () => {
    const rasterize = (): Rgb | null => null;
    expect(resolveColorStringToRgb('oklch(0.75 0.18 70)', rasterize)).toBeNull();
  });

  test('defaults to a real canvas rasterizer when none is injected, and degrades to null without a document', () => {
    // bun:test has no DOM, so the default rasterizer has nothing to draw with
    // and must degrade to null rather than throw.
    expect(resolveColorStringToRgb('oklch(0.75 0.18 70)')).toBeNull();
  });

  test('the default rasterizer opens a willReadFrequently 2D context, clears the pixel before every paint, and returns null (not the previous paint) for a colour that fails to set fillStyle', () => {
    // No DOM here (`testing.md`): a minimal fake `document`/canvas/context,
    // in the same spirit as `src/audio/testFakes.ts`'s fake `AudioContext`,
    // just to observe the arguments the default rasterizer passes — not a
    // DOM or testing-library addition. The rasterizer caches its canvas
    // module-wide, so both scenarios are exercised through the one fake
    // canvas in this one test rather than two separate `test()` blocks.
    const contextCalls: unknown[] = [];
    const callOrder: string[] = [];
    let fillStyleValue = '';
    const fakeCtx = {
      get fillStyle() {
        return fillStyleValue;
      },
      set fillStyle(v: string) {
        // Mimics an engine where assigning an unrecognised CSS colour is a
        // silent no-op rather than a throw: 'garbage' never sticks.
        if (v !== 'garbage') fillStyleValue = v;
      },
      clearRect: (...args: unknown[]) => callOrder.push(`clearRect(${args.join(',')})`),
      fillRect: (...args: unknown[]) => callOrder.push(`fillRect(${args.join(',')})`),
      getImageData: () => ({ data: Uint8ClampedArray.from([9, 8, 7, 255]) }),
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: (contextId: string, options?: unknown) => {
        contextCalls.push({ contextId, options });
        return fakeCtx;
      },
    };
    const originalDocument = globalThis.document;
    // @ts-expect-error test-only stub of `document.createElement`, not a DOM
    globalThis.document = { createElement: () => fakeCanvas };

    try {
      expect(resolveColorStringToRgb('oklch(0.75 0.18 70)')).toEqual({ r: 9, g: 8, b: 7 });
      // The previous paint's pixel (9, 8, 7) must not leak through as this call's result.
      expect(resolveColorStringToRgb('garbage')).toBeNull();
    } finally {
      globalThis.document = originalDocument;
    }

    expect(contextCalls).toEqual([
      { contextId: '2d', options: { willReadFrequently: true } },
      { contextId: '2d', options: { willReadFrequently: true } },
    ]);
    // clearRect must run before fillRect, or a translucent colour could blend with a stale
    // pixel; the second call's fillRect/getImageData never run at all — fillStyle never left
    // the sentinel, so there is nothing valid to paint or read.
    expect(callOrder).toEqual(['clearRect(0,0,1,1)', 'fillRect(0,0,1,1)', 'clearRect(0,0,1,1)']);
  });
});

describe('SSR / no-DOM safety', () => {
  test('resolveThemeRgb falls back to the built-in default without a document', () => {
    expect(resolveThemeRgb('--color-primary')).toEqual({ r: 255, g: 179, b: 71 });
  });

  test('createThemePalette returns every token even without a document', () => {
    const palette = createThemePalette();
    expect(palette['--color-primary']).toEqual({ r: 255, g: 179, b: 71 });
    expect(palette['--color-base-content']).toBeDefined();
    expect(palette['--color-error']).toBeDefined();
  });

  test('state-token fallbacks mirror the solna-dark palette in src/index.css', () => {
    // #5FD08B, #F0C244, #F0604B, #7C9EE8 — value-specific so a wrong hex fails.
    expect(resolveThemeRgb('--color-success')).toEqual({ r: 95, g: 208, b: 139 });
    expect(resolveThemeRgb('--color-warning')).toEqual({ r: 240, g: 194, b: 68 });
    expect(resolveThemeRgb('--color-error')).toEqual({ r: 240, g: 96, b: 75 });
    expect(resolveThemeRgb('--color-info')).toEqual({ r: 124, g: 158, b: 232 });
  });

  test('subscribeToThemeChange returns a no-op unsubscribe without a document', () => {
    const unsubscribe = subscribeToThemeChange(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
