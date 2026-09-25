---
paths:
  - "src/components/**/*"
  - "src/utils/themeColor.ts"
  - "src/**/*.css"
  - "scripts/themeTokenGuard.ts"
  - "scripts/check-contrast.ts"
  - "index.html"
---

# Theming — the hard rule

Two Solna themes (`solna-dark`, `solna-light`) are declared CSS-first in `src/index.css` via
`@plugin "daisyui/theme"`; every daisyUI built-in in the installed major is listed beside them.
**There is no `tailwind.config.*` and none may be added.**

## Theme roster and choice

- The roster is `THEMES` in `src/components/settings/themes.ts`: the two Solna themes, then the
  daisyUI built-ins alphabetically, each with a hand-written `scheme`. `index.css`'s `themes:` list
  and both light palette selectors (`--key-*`/`--roll-key-*` and `--module-*`/`--drum-*`) repeat
  it; `themes.test.ts` binds all three to the registry and each built-in's `scheme` to the
  `color-scheme` in `node_modules/daisyui/theme/<id>.css`. A daisyUI upgrade that adds, drops or
  re-schemes a theme fails there. Dark themes fall through to the `:root` / `solna-dark` blocks. <!-- R344 -->
- `solna_theme` holds a `ThemeChoice` — a roster id or `system` — validated on read by
  `parseThemeChoice` (absent/unknown → `system`); `system` resolves to `solna-light`/`solna-dark`
  by `prefers-color-scheme`, live. `index.html`'s blocking script mirrors `resolveTheme` and sets
  any other value verbatim; `themeBootstrap.test.ts` pins the two together. <!-- R345 -->
- Choosing a theme previews it (`data-theme` on `<html>` only); only **Apply** persists; closing
  the app modal by any path reverts an unapplied preview. Theme state lives in
  `useThemeChoice` (`createThemeChoiceStore`), called once by the always-mounted `AppModal`, and
  never enters a zustand slice. <!-- R346 -->
- `<meta name="theme-color">` follows the painted theme: the live `--color-base-200` resolved to
  `rgb()` through `utils/themeColor.ts`, rewritten on every repaint. <!-- R347 -->

([ADR-0051](../../docs/decisions/0051-theme-picker.md))

Components name **roles**, never colours. `scripts/themeTokenGuard.ts` scans
`src/**/*.{ts,tsx}` and fails the build on: raw hex, Tailwind palette classes (`indigo-*`,
`slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`/etc.,
the `dark:` variant, `rgb()`/`rgba()` literals, and silently-dead utilities (`py-0.2`,
`scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and the suite has hygiene + shrink tests
that make re-populating it fail — **fix the code, not the allowlist.**

Canvas code (which cannot use classes) resolves live theme colours at runtime through
`src/utils/themeColor.ts`.

Run `bun run check:theme` to check this suite alone.

## Palette contrast gate

`--drum-*` and `--module-*` carry their own namespaces and their own gate.

- `bun run check:contrast` measures every `--drum-*` and `--module-*` fill against its own
  `-content` in both Solna palettes (the light one also serves every light daisyUI theme) and
  fails below AA 4.5:1; it is a gate a palette can fail, not a report. <!-- R011 -->
- Rosters: Beat voices come from `BEAT_VOICE_IDS` (the CSS tokens stay `--drum-*`, with the same
  id strings); module names are parsed from `index.css`, because the CLI gate must not import a
  React component (`Knob`'s `KnobColor`). <!-- R012 -->
- The script asserts both themes declare the same, non-empty module set, so a module colour
  declared in one theme only fails rather than being skipped. <!-- R013 -->

([ADR-0030](../../docs/decisions/0030-palette-contrast-gate.md))

## Where the answers live

`docs/design.md` is the authoritative spec:

- **§6.1** — the legacy-colour → token map. Apply it verbatim, don't improvise.
- **§6.2** — the hand-rolled-markup → daisyUI-component map.
- **§4** — the per-component contract. E.g. `Knob`'s `color` prop is a closed union by design;
  `ui/` primitives own their daisyUI class defaults, so feature components pass no colour
  overrides.

Check the daisyUI major in `package.json` before reaching for a class — class names differ
across majors, so confirm against the docs for the version actually installed.

## Prohibited

- A palette below AA 4.5:1, or treating `check:contrast` as a report <!-- R011 -->
- The contrast CLI importing a React component for its roster <!-- R012 -->
- A module colour declared in one theme only <!-- R013 -->
- A theme in `index.css` or a light palette selector that is not in `THEMES`, or the reverse <!-- R344 -->
- A migration or version bump for `solna_theme`; a bootstrap that disagrees with `resolveTheme` <!-- R345 -->
- Persisting on select, or a theme value in a zustand slice <!-- R346 -->
- An `oklch()` or hard-coded `theme-color` written at runtime <!-- R347 -->
