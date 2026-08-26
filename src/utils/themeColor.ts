/**
 * Runtime bridge between the daisyUI theme and <canvas>.
 *
 * Canvas drawing takes CSS colour strings, not Tailwind classes, so canvas
 * code cannot be fixed by swapping class names — it has to read the live
 * theme. daisyUI v5 emits its palette as `oklch(...)`, which some canvas
 * implementations refuse to parse, so we resolve every token through a probe
 * element and read back the computed `color`, which every engine normalises
 * to an `rgb()` / `rgba()` string.
 *
 * All DOM-touching functions degrade to the solna-dark defaults when there is
 * no document (Bun's test runner and any SSR render), so this module is safe
 * to import from anywhere.
 */

export type ThemeToken =
  | '--color-primary'
  | '--color-secondary'
  | '--color-accent'
  | '--color-base-100'
  | '--color-base-200'
  | '--color-base-300'
  | '--color-base-content'
  | '--color-neutral'
  | '--color-success'
  | '--color-warning'
  | '--color-error'
  | '--color-info';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const THEME_TOKENS: readonly ThemeToken[] = [
  '--color-primary',
  '--color-secondary',
  '--color-accent',
  '--color-base-100',
  '--color-base-200',
  '--color-base-300',
  '--color-base-content',
  '--color-neutral',
  '--color-success',
  '--color-warning',
  '--color-error',
  '--color-info',
];

/**
 * solna-dark values, mirroring src/index.css. Used when there is no document
 * (bun test / SSR) and when a token resolves to something unparseable.
 */
const FALLBACKS: Record<ThemeToken, Rgb> = {
  '--color-primary': { r: 255, g: 176, b: 0 },
  '--color-secondary': { r: 255, g: 107, b: 69 },
  '--color-accent': { r: 53, g: 201, b: 186 },
  '--color-base-100': { r: 27, g: 19, b: 12 },
  '--color-base-200': { r: 17, g: 11, b: 7 },
  '--color-base-300': { r: 44, g: 31, b: 20 },
  '--color-base-content': { r: 251, g: 240, b: 226 },
  '--color-neutral': { r: 35, g: 25, b: 16 },
  '--color-success': { r: 99, g: 206, b: 138 },
  '--color-warning': { r: 255, g: 210, b: 74 },
  '--color-error': { r: 245, g: 83, b: 58 },
  '--color-info': { r: 111, g: 162, b: 216 },
};

const clampChannel = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Parses both CSS Color 3 (`rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)`) and CSS
 * Color 4 (`rgb(1 2 3 / 0.5)`) syntaxes. Alpha is intentionally discarded —
 * callers compose their own alpha via `rgbToCss`. Returns null when the input
 * is not an rgb-family colour (e.g. a raw `oklch()` or a hex string).
 *
 * Pure: no DOM access, so it is unit-testable under `bun test`.
 */
export function parseRgbString(input: string): Rgb | null {
  if (!input) return null;
  const match = /^rgba?\(([^)]+)\)$/i.exec(input.trim());
  if (!match) return null;

  const parts = match[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((p) => p.length > 0);

  if (parts.length < 3) return null;

  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;

  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) };
}

/** Serialises an Rgb back to a canvas-safe CSS string. */
export function rgbToCss({ r, g, b }: Rgb, alpha?: number): string {
  // theme-guard-ignore: rgbToCss emits rgb() output by design — this module is the sanctioned emitter for canvas code
  if (alpha === undefined) return `rgb(${r}, ${g}, ${b})`;
  const a = Math.max(0, Math.min(1, alpha));
  // theme-guard-ignore: rgba() output string is this module's purpose
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Resolves a daisyUI theme token to concrete sRGB. daisyUI v5 emits oklch(),
 * which older canvas implementations reject, so resolve through a probe
 * element and read back the computed `color`, which every engine normalises
 * to rgb().
 */
export function resolveThemeRgb(token: ThemeToken, root?: HTMLElement): Rgb {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return FALLBACKS[token];
  }

  const host = root ?? document.documentElement;
  const raw = window.getComputedStyle(host).getPropertyValue(token).trim();
  if (!raw) return FALLBACKS[token];

  // Fast path: already an rgb-family string.
  const direct = parseRgbString(raw);
  if (direct) return direct;

  // Slow path: oklch()/lab()/color() — let the engine convert it for us.
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  probe.style.color = raw;
  host.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  host.removeChild(probe);

  return parseRgbString(computed) ?? FALLBACKS[token];
}

/** Resolves every theme token in one pass. Cache the result; re-run on theme change. */
export function createThemePalette(root?: HTMLElement): Record<ThemeToken, Rgb> {
  const palette = {} as Record<ThemeToken, Rgb>;
  for (const token of THEME_TOKENS) {
    palette[token] = resolveThemeRgb(token, root);
  }
  return palette;
}

/** Fires when documentElement's data-theme changes; returns an unsubscribe fn. */
export function subscribeToThemeChange(cb: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const observer = new MutationObserver(() => cb());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}
