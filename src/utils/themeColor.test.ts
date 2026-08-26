import { describe, expect, test } from 'bun:test';
import {
  createThemePalette,
  parseRgbString,
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
