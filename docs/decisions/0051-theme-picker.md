# ADR-0051: Theme picker — every daisyUI theme, System default, preview then apply

**Status:** Accepted — 2026-09-25. No issue.

## Context

Solna shipped two themes and a header toggle between them (`ThemeToggle`, `header/useTheme.ts`).
The wordmark was the project menu's trigger. Users asked for more themes; murva already offers
daisyUI's built-ins through a preview-then-apply picker. The `--drum-*`/`--module-*` and piano-key
palettes exist only for the two Solna themes, and `<meta name="theme-color">` was a static dark hex.

## Decision

- The wordmark is a `<button>` that opens an app modal (Settings | About), on both frames; the
  project menu moves to a chevron trigger beside it (desktop) and stays in the ☰ sheet (mobile).
  `ThemeToggle` and the `theme` `HEADER_TOOLS` row are removed.
- The roster is `THEMES` in `components/settings/themes.ts`: Solna Dark, Solna Light, then every
  daisyUI built-in of the installed major. Sync tests bind `index.css` and the installed daisyUI
  theme files to it.
- `solna_theme` holds a `ThemeChoice`; `system` (the default) follows `prefers-color-scheme` live.
  Legacy values are valid choices, so there is no migration (ADR-0023).
- Picking a theme previews it; Apply persists; closing the modal reverts. The state is a small
  env-injected store (`createThemeChoiceStore`) wrapped by `useThemeChoice`, called by the
  always-mounted `AppModal`; never a zustand slice.
- The palettes follow the scheme through CSS: the light blocks' selectors list every light theme.
- `theme-color` is rewritten from the live `base-200`, as `rgb()`, on every repaint.

Rejected:

- **A runtime `data-palette` attribute** chosen by scheme: the bootstrap would need the roster's
  schemes too, duplicating the registry inside `index.html`, and a second attribute to keep in step.
- **Persist on select** (murva's behaviour is preview-first; a stray click would otherwise stick).
- **Keeping the header toggle** beside Settings: two controls for one choice, and a two-state
  toggle cannot express 37 themes plus System.
- **`themes: all`** in the daisyUI plugin: the roster would not be a list a test can compare.

## Consequences

- The stylesheet grows by every built-in theme's variables: 216.19 kB → 257.75 kB raw (+41.56 kB),
  32.88 kB → 39.89 kB gzip (+7.01 kB), for 34 additional daisyUI built-in themes.
- A daisyUI upgrade that changes the built-in roster fails `themes.test.ts` until the registry,
  `index.css` and the light selectors are updated together.
- `check-contrast` measures only the two Solna palettes; a light daisyUI theme shows the light
  palette on its own base colours, which the gate does not measure.
- An unknown stored id paints with daisyUI's default until React mounts and corrects it.

## Rules this implies

- **R344** — the theme roster is `THEMES`; `index.css`'s list and light selectors are bound to it by test (`theming.md`).
- **R345** — `solna_theme` holds a validated `ThemeChoice`; the bootstrap mirrors `resolveTheme` (`theming.md`).
- **R346** — select previews, Apply persists, close reverts; theme state never in a slice (`theming.md`).
- **R347** — `theme-color` follows the painted theme as `rgb()` (`theming.md`).
- **R348** — the wordmark opens the app modal; the theme is chosen only in Settings (`components.md`).

## Sources

Spec `docs/superpowers/specs/2026-09-25-theme-picker-modal-design.md`; plan
`docs/superpowers/plans/2026-09-25-theme-picker-modal.md`.
