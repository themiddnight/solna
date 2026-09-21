---
paths:
  - "src/components/**/*"
  - "src/utils/themeColor.ts"
  - "src/**/*.css"
  - "scripts/themeTokenGuard.ts"
  - "scripts/check-contrast.ts"
---

# Theming — the hard rule

Two daisyUI themes (`solna-dark`, `solna-light`) declared CSS-first in `src/index.css` via
`@plugin "daisyui/theme"`. **There is no `tailwind.config.*` and none may be added.**
`index.html` sets `data-theme` in a blocking head script; it persists to `localStorage` under
`solna_theme`.

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
  `-content` in both themes and fails below AA 4.5:1; it is a gate a palette can fail, not a
  report. <!-- R011 -->
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
