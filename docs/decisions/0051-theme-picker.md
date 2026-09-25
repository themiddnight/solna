# ADR-0051: Theme picker — every daisyUI theme, System default, preview then apply

**Status:** Accepted — 2026-09-25. No issue.

## Context

Solna shipped two themes and a header toggle between them (`ThemeToggle`, `header/useTheme.ts`).
The wordmark was the project menu's trigger. Users asked for more themes; murva already offers
daisyUI's built-ins through a preview-then-apply picker. The `--drum-*`/`--module-*` and piano-key
palettes exist only for the two Solna themes, and `<meta name="theme-color">` was a static dark hex.

## Decision

- The wordmark is a `<button>` that opens an app modal, on both frames: the theme picker, a
  divider, then the About lines (description, author, repo link) — one page, no tabs; the
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
- **The theme panel is a `popover="auto"` element** (R328), not a daisyUI `dropdown`: `AppModal`'s
  `Modal` is a native `<dialog>` opened with `showModal()`, so it lives in the browser top layer,
  and only another top-layer element can stack above it. The trigger is a real
  `<button popoverTarget="...">`, keeping the same id and visible content (dots, label,
  "Previewing" tag, chevron). Positioning is `position: fixed`, computed by the pure
  `placePopover` (`settings/placePopover.ts`) from the trigger's `getBoundingClientRect()` on the
  popover's `toggle` event and on `resize`/`scroll` while open — the DOM wiring lives in
  `useThemePicker`, per R265/R266. `placePopover` opens below the trigger whenever the panel fits
  below; only when it does not fit below does it choose whichever side (above or below) has more
  room, and it caps the panel's height to that side, so it never renders off-screen when neither
  side has room for the whole list: the panel is a flex column, and the list — `min-h-0`, its own
  `max-h-90` staying as the content-driven upper bound — is what actually shrinks and scrolls. No
  CSS anchor positioning: Firefox support is incomplete.
- **The modal body holds no `min-h`**: the panel escapes the dialog in the top layer, so nothing
  needs to reserve room for the list, and the dialog is only as tall as its content.

Rejected:

- **A runtime `data-palette` attribute** chosen by scheme: the bootstrap would need the roster's
  schemes too, duplicating the registry inside `index.html`, and a second attribute to keep in step.
- **Persist on select** (murva's behaviour is preview-first; a stray click would otherwise stick).
- **Keeping the header toggle** beside the modal: two controls for one choice, and a two-state
  toggle cannot express every daisyUI built-in theme plus the two Solna themes and System.
- **`themes: all`** in the daisyUI plugin: the roster would not be a list a test can compare.
- **A React portal of the theme panel to `document.body`**: a portal still renders in the normal
  DOM tree, under `AppModal`'s native top layer, so it would still be clipped by the dialog.
- **CSS anchor positioning** for the panel: Firefox support is incomplete.
- **Settings | About tabs**: tried first; two short panels behind tabs cost a click and a
  stable-height workaround (both panels stacked in one grid cell) for no gain, so the About lines
  sit under the theme picker, after a divider.

## Consequences

- The stylesheet grows by every built-in theme's CSS variables; the build measures the exact
  size.
- A daisyUI upgrade that changes the built-in roster fails `themes.test.ts` until the registry,
  `index.css` and the light selectors are updated together.
- `check-contrast` measures only the two Solna palettes; a light daisyUI theme shows the light
  palette on its own base colours, which the gate does not measure.
- An unknown stored id paints with daisyUI's default until React mounts and corrects it.
- The theme panel requires the Popover API: a browser lacking it (e.g. Safari before the version
  that shipped `popover`) cannot open the panel from the trigger button — accepted, since the
  panel is the only reason for the requirement and the app has no other theme control.

## Rules this implies

- **R344** — the theme roster is `THEMES`; `index.css`'s list and light selectors are bound to it by test (`theming.md`).
- **R345** — `solna_theme` holds a validated `ThemeChoice`; the bootstrap mirrors `resolveTheme` (`theming.md`).
- **R346** — select previews, Apply persists, close reverts; theme state never in a slice (`theming.md`).
- **R347** — `theme-color` follows the painted theme as `rgb()` (`theming.md`).
- **R348** — the wordmark opens the app modal; the theme is chosen only there (`components.md`).

## Sources

Spec `docs/superpowers/specs/2026-09-25-theme-picker-modal-design.md`; plan
`docs/superpowers/plans/2026-09-25-theme-picker-modal.md`.
