# ADR-0031: Component hooks, narrow store selectors, topic-grouped utils and placement

## Status

Accepted — 2026-09-22. Known debt tracked in DEV-426 and DEV-430.

## Context

Solna's rules said a great deal about layers, audio and persistence and nothing about what the
inside of a component file looks like, how a component reads the store, or where a new file goes.
The result shows in the structure audit (`docs/superpowers/plans/2026-09-21-structure-audit-fixes.md`):
several components run to many hundreds of lines with state, effects and handlers inline;
`utils/musicTheory.ts` mixes pitch theory with timing; music logic and library lookups sit in the
`src/audio/` root; and preset lookups are spread across `store/`, `utils/` and `audio/` (audit
A6, D5).

The e-form repos (`e-form-cms/.claude/rules/`: `component-conventions.md`,
`store-conventions.md`, `shared-kernel-conventions.md`, `feature-conventions.md`) already carry
conventions for exactly these questions. Solna has good local precedent for some of them —
`useChordView.ts` splits `ChordView`'s state out by concern, and the `useXxxDraft` hooks keep a
knob's mid-drag value in a hook with a named return type — but nothing stated it as the rule.

Solna differs from e-form in three ways that shape what can be adopted:

- **Every view stays mounted** ([ADR-0001](0001-always-mounted-views.md)). A wide store selector
  or an over-lifted piece of state re-renders every mounted view, not just the visible one, so
  narrow selection is a correctness-of-cost rule here, not a nicety.
- **There is no DOM and no testing-library**, and none may be added (`testing.md`). e-form tests a
  hook with `renderHook`; solna cannot.
- **`src/utils/` is not a pure, domain-agnostic kernel.** It sits outside the layer chain above
  `data/`, may import `@/musicCore`, and legitimately holds music-domain helpers
  ([ADR-0004](0004-utils-placement-and-store-constant-inversion.md)).

## Decision

Adopt five conventions, adapted:

1. **Components are UI; logic lives in a colocated hook.** A component's state, memos, callbacks,
   effects and handlers live in a `useXxx` hook beside it with a named, exported return type
   (`UseXxx`). Children are defined above the root. Anti-patterns: calling the state hook in each
   child, an unmemoized context value, spreading one props bag across children, pre-splitting a
   small component. Context, if used, goes through one typed accessor that throws outside its
   provider. *Adapted:* the test seam is the pure logic the hook wraps (the
   `createBeatParamDraftMachine` precedent) or a `renderToString` harness, not `renderHook`; and a
   hook is extracted in place — it never lifts high-frequency state into a slice or a higher
   context, which keeps ADR-0001 intact. It applies to new components and to a component when it is
   substantially edited; there is no mass refactor.
2. **Select the store narrowly.** One value per `useAppStore((s) => s.x)`; several values through
   `useShallow` from `zustand/react/shallow` (exported by the installed zustand, verified by
   import); never the whole store and never a fresh object from a plain selector.
3. **`src/utils/` is grouped by topic, one theme per file.** No junk-drawer names; a file spanning
   two themes is split when it is next substantially edited. *Adapted:* music-domain helpers are
   allowed (the e-form "domain-agnostic" requirement is dropped), and the existing layering rules
   are restated rather than replaced.
4. **Placement.** Code used by one feature or area stays with it; code used by two or more is
   lifted to the shared location its layer already has (`src/components/ui/`, the
   `src/components/` root, `src/utils/`, `src/musicCore/`). *Adapted:* solna has no `features/`
   folder; its areas are `components/loop/<lane>/`, `components/song/`, `components/project/`.
5. **A `## Prohibited` checklist ends every rules file**, each bullet derived from a rule already
   in that file and ending with its `R###`. It adds no rule; it makes review scannable.

**Deliberately not adopted:**

- **kebab-case filenames** — solna names components in PascalCase and modules in camelCase
  throughout; renaming for a convention would churn every import for no behavioural gain.
- **barrels everywhere** — solna imports files directly; a barrel per folder would widen Knip's
  graph, hide which file an import really needs, and pull extra modules into eager chunks
  (`InstantVibesBar` is kept import-light on purpose). `src/musicCore/index.ts` stays the one
  public-API barrel because it is an enforced boundary.
- **`features/` folders** — the layer map ([ADR-0002](0002-four-layer-import-architecture.md)) is
  the organising axis; the placement rule works within it.
- **TypeScript enums** — solna uses literal unions and `as const` tables (`BEAT_VOICE_IDS`,
  `MELODY_TRACKS`), which the data layer's purity rules and exhaustive `switch` checks rely on.
- **frontmatter `description`** — solna rules files load by `paths:` alone and open with a one-line
  summary under the heading; a second description field would drift from it.

## Consequences

- New and substantially edited components read the same way, and their logic is testable without a
  DOM. Large existing components remain as known debt until their own issue (DEV-426 / DEV-430).
- A reviewer can reject a wide selector or an inline-state component by pointing at a rule id.
- The `## Prohibited` sections duplicate their file's rules in a shorter form; a rule change must
  update both halves, or the id check (every Prohibited id also appears above it) catches the drift
  only for removed ids, not for changed meaning.
- `useShallow` is not yet used anywhere; the first user sets the import precedent.

## Rules this implies

- **R265** — A component's hooks and handlers live in a colocated `useXxx` hook; the body is layout.
- **R266** — The hook's return type is named and exported (`UseXxx` for new hooks); test it via
  pure logic or `renderToString`, never testing-library.
- **R267** — Child components are defined above the root.
- **R268** — Call the state hook once at the root, never in each child.
- **R269** — Context: hook once at the root, memoized value, one typed accessor that throws outside
  its provider.
- **R270** — Never spread one props bag across several children.
- **R271** — Do not pre-split a small component.
- **R272** — Hook extraction never lifts high-frequency state into a slice or a higher context.
- **R273** — Applies to new and substantially edited components; no mass refactor; named debt.
- **R274** — Select one value per `useAppStore` selector; never the whole store.
- **R275** — Several values via `useShallow`; a plain selector never returns a fresh object.
- **R276** — One-area code stays with the area; two-or-more-area code lifts to its layer's shared
  location.
- **R277** — A `utils/` file is named for one theme; no junk-drawer names.
- **R278** — A `utils/` file spanning two themes is split when next substantially edited.

## Sources

- `e-form-cms/.claude/rules/component-conventions.md`, `store-conventions.md`,
  `shared-kernel-conventions.md`, `feature-conventions.md` (read 2026-09-22).
- `docs/superpowers/plans/2026-09-21-structure-audit-fixes.md`, Deferred section (A6, D5, large
  files).
- Precedent: `src/components/loop/chord/useChordView.ts`,
  `src/components/loop/beat/useBeatParamDraft.ts`.
