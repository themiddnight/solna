/**
 * The theme roster (R344): the two Solna themes, then every daisyUI built-in
 * in the installed major, alphabetically. `src/index.css` repeats this list
 * twice — the daisyUI plugin's `themes:` and the light palette selectors —
 * and `themes.test.ts` binds both to it, plus each built-in's `scheme` to the
 * `color-scheme` its daisyUI theme file declares, so an upgrade that adds,
 * drops or re-schemes a theme fails a test instead of silently mis-painting.
 */
export type ThemeScheme = 'dark' | 'light';

/** daisyUI's built-ins and their `color-scheme`, written by hand; the sync test checks every one. */
const DAISYUI_THEME_SCHEMES = {
  abyss: 'dark',
  acid: 'light',
  aqua: 'dark',
  autumn: 'light',
  black: 'dark',
  bumblebee: 'light',
  business: 'dark',
  caramellatte: 'light',
  cmyk: 'light',
  coffee: 'dark',
  corporate: 'light',
  cupcake: 'light',
  cyberpunk: 'light',
  dark: 'dark', // theme-guard-ignore: daisyUI's theme id "dark", not the Tailwind dark: variant
  dim: 'dark',
  dracula: 'dark',
  emerald: 'light',
  fantasy: 'light',
  forest: 'dark',
  garden: 'light',
  halloween: 'dark',
  lemonade: 'light',
  light: 'light',
  lofi: 'light',
  luxury: 'dark',
  night: 'dark',
  nord: 'light',
  pastel: 'light',
  retro: 'light',
  silk: 'light',
  sunset: 'dark',
  synthwave: 'dark',
  valentine: 'light',
  winter: 'light',
  wireframe: 'light',
} as const satisfies Record<string, ThemeScheme>;

type DaisyThemeId = keyof typeof DAISYUI_THEME_SCHEMES;

export type ThemeId = 'solna-dark' | 'solna-light' | DaisyThemeId;

export interface ThemeEntry {
  readonly id: ThemeId;
  readonly label: string;
  readonly scheme: ThemeScheme;
}

/** What `solna_theme` holds: a theme id, or `system` (follow the OS between the two Solna themes). */
export type ThemeChoice = ThemeId | 'system';

export const THEME_STORAGE_KEY = 'solna_theme';

const titleCase = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

export const THEMES: readonly ThemeEntry[] = [
  { id: 'solna-dark', label: 'Solna Dark', scheme: 'dark' },
  { id: 'solna-light', label: 'Solna Light', scheme: 'light' },
  ...(Object.keys(DAISYUI_THEME_SCHEMES) as DaisyThemeId[])
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: titleCase(id), scheme: DAISYUI_THEME_SCHEMES[id] })),
];

const THEME_BY_ID = Object.fromEntries(THEMES.map((entry) => [entry.id, entry])) as Record<ThemeId, ThemeEntry>;
const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((entry) => entry.id));

/**
 * Validates a stored value on read (R214, R345): a registry id is kept as-is —
 * which covers the legacy `solna-dark` / `solna-light` — and anything else,
 * absence included, is `system`, today's first-visit behaviour.
 */
export function parseThemeChoice(stored: string | null): ThemeChoice {
  return stored !== null && THEME_IDS.has(stored) ? (stored as ThemeId) : 'system';
}

/** The theme to paint. `system` picks a Solna theme by `prefers-color-scheme`; `index.html` mirrors this. */
export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): ThemeId {
  if (choice !== 'system') return choice;
  return prefersLight ? 'solna-light' : 'solna-dark';
}

export function themeEntry(id: ThemeId): ThemeEntry {
  return THEME_BY_ID[id];
}

/** One scheme's themes in registry order: its Solna theme first, then daisyUI's alphabetically. */
export function themesOfScheme(scheme: ThemeScheme): readonly ThemeEntry[] {
  return THEMES.filter((entry) => entry.scheme === scheme);
}

export function themeChoiceLabel(choice: ThemeChoice): string {
  return choice === 'system' ? 'System' : themeEntry(choice).label;
}
