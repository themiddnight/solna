/**
 * Runtime bridge between the daisyUI theme and <canvas>.
 *
 * Canvas drawing takes CSS colour strings, not Tailwind classes, so canvas
 * code cannot be fixed by swapping class names — it has to read the live
 * theme. daisyUI v5 emits its palette as `oklch(...)`; current Chrome's
 * `getComputedStyle` serialises that straight back as `oklch(...)` rather
 * than normalising it to `rgb()`, so a plain string parse is not enough. We
 * resolve every token through a probe element (to let the engine collapse
 * `currentcolor`/relative-colour syntax) and then, when the computed string
 * still isn't `rgb()`-family, rasterize it — draw it into a 1x1 canvas and
 * read the pixel back — because canvas `fillStyle` accepts any `<color>` the
 * browser understands, `oklch()`/`oklab()`/`color()` included.
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

const THEME_TOKENS: readonly ThemeToken[] = [
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
  '--color-primary': { r: 255, g: 179, b: 71 },
  '--color-secondary': { r: 242, g: 101, b: 126 },
  '--color-accent': { r: 140, g: 123, b: 224 },
  '--color-base-100': { r: 34, g: 25, b: 33 },
  '--color-base-200': { r: 23, g: 16, b: 15 },
  '--color-base-300': { r: 51, g: 35, b: 45 },
  '--color-base-content': { r: 246, g: 233, b: 228 },
  '--color-neutral': { r: 42, g: 31, b: 39 },
  '--color-success': { r: 95, g: 208, b: 139 },
  '--color-warning': { r: 240, g: 194, b: 68 },
  '--color-error': { r: 240, g: 96, b: 75 },
  '--color-info': { r: 124, g: 158, b: 232 },
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
/**
 * Lazily-created 1x1 canvas reused by {@link rasterizeColorToRgb}, so
 * resolving an entire palette (`createThemePalette`) only ever allocates one.
 */
let rasterCanvas: HTMLCanvasElement | null = null;

/**
 * Rasterizes an arbitrary CSS `<color>` string — `oklch()`, `oklab()`,
 * `color(...)`, anything the browser's 2D canvas can paint — to sRGB bytes
 * by drawing it into a 1x1 canvas and reading the pixel back. This is the
 * default rasterizer {@link resolveColorStringToRgb} falls back to; it is
 * DOM-dependent (unavailable under `bun test`/SSR) so it is kept separate
 * from the pure parsing/fallback logic, which stays unit-testable via
 * injection.
 */
function rasterizeColorToRgb(colorString: string): Rgb | null {
  if (typeof document === 'undefined') return null;
  if (!rasterCanvas) {
    rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = 1;
    rasterCanvas.height = 1;
  }
  const ctx = rasterCanvas.getContext('2d');
  if (!ctx) return null;

  try {
    ctx.fillStyle = colorString;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  } catch {
    // An unparseable colour leaves fillStyle unchanged / throws on some
    // engines; either way there is nothing usable to read back.
    return null;
  }
}

/**
 * Resolves any computed CSS colour string to sRGB: the `rgb()`/`rgba()` fast
 * path via {@link parseRgbString}, then `rasterize` (a real canvas by
 * default) for anything else — `oklch()`, `oklab()`, `color(...)`, which
 * Chrome's `getComputedStyle` can serialise back as of daisyUI v5's palette.
 * Returns null, never a guess, when neither resolves the colour (e.g. no
 * canvas in the test runtime); callers supply their own fallback.
 *
 * `rasterize` is injectable so this can be unit-tested without a DOM.
 */
export function resolveColorStringToRgb(
  colorString: string,
  rasterize: (colorString: string) => Rgb | null = rasterizeColorToRgb,
): Rgb | null {
  const direct = parseRgbString(colorString);
  if (direct) return direct;
  return rasterize(colorString);
}

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

  // Slow path: let the engine resolve currentcolor/relative-colour syntax
  // for us, via a probe element's computed `color`.
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  probe.style.color = raw;
  host.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  host.removeChild(probe);

  return resolveColorStringToRgb(computed) ?? FALLBACKS[token];
}

/**
 * The app's font stack, read from `--font-sans` rather than re-typed.
 *
 * Canvas cannot take a class, so canvas text has to name a family literally —
 * and a literal is a copy of index.css that nothing keeps in step. The theme
 * guard cannot help here either: it bans `font-mono`/`monospace`, so the
 * sans-stack copy it forced this code onto is unguarded. Reading the custom
 * property is the same move `resolveThemeRgb` makes for colour.
 */
export function resolveThemeFontFamily(root?: HTMLElement): string {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 'sans-serif';
  const host = root ?? document.documentElement;
  return window.getComputedStyle(host).getPropertyValue('--font-sans').trim() || 'sans-serif';
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
