---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "src/audio/testFakes.ts"
  - "scripts/**/*"
---

# Testing conventions

Tests are `bun:test`. There is **no DOM and no testing-library** in this repo, and none may be
added. Two styles coexist:

**1. Pure-logic (the majority).** Components export their testable helpers — e.g.
`resolveInitialTheme`/`persistTheme` from `Header.tsx`, `KEYBOARD_NOTES` from `SynthView.tsx`,
`DEFAULT_PADS` from `DrumPads.tsx` — and the test imports those instead of rendering. Prefer
this: if a behaviour can be extracted into a pure function, extract it and test the function.

**2. Rendered markup (roughly a third of the suite).** `renderToString` from `react-dom/server`
returns an HTML **string**, so it needs no DOM. Assertions are substring checks against that
string — which is why they are written as single literal substrings covering several classes at
once (`expect(html).toContain('btn btn-sm join-item gap-1.5 font-bold text-xs btn-success')`),
proving the classes sit on the *same* element rather than on unrelated ones.

## The zustand + renderToString trap

zustand wires `useStore`'s `getServerSnapshot` to `selector(api.getInitialState())`, and
`getInitialState()` returns the object captured **once at store creation**. Under
`renderToString`, a plain `useAppStore((s) => ...)` therefore always renders creation-time
values — `useAppStore.setState(...)` before the render has **no effect**, silently.

Nothing in `bun run verify` catches this; the test just asserts against the wrong state.

If a component must reflect state set by a test, it has to serve `getState()` for *both*
snapshots — see the `useLiveStore` helper and its comment in `src/components/ui/BottomInputDock.tsx`,
and the note at the top of `src/components/TransportBar.test.tsx` explaining which cases cannot
be exercised through a rendered component at all.

## The audio engine harness

`src/audio/testFakes.ts` is a fake `AudioContext` and is what makes engine tests possible without
a browser. It exports `makeEngine()` / `freshEngine()` (a fresh engine instance off the
singleton's constructor), plus `fakeCtx()`, `fakeNode()`, `fakeBufferSource()` and `fakeParam()`.

`fakeParam` records `cancels`, `targets`, `ramps` and `events`, and its `valueAt(t)` evaluator
**refuses timelines containing `setTargetAtTime`** — an exponential approach has no exact closed
form here, so assert on the recorded events instead of on a computed value.

## Invariant scripts

Two scripts import straight from source and must keep passing:

- `check-key-bindings.ts` — drum and synth `KeyboardEvent.code` sets are unique,
  non-overlapping, and well-formed.
- `check-drum-kit-separation.ts` — every kit overrides every drum type, and parameters spread
  far enough apart to stay audibly distinct.
