---
paths:
  - "src/components/**/*.tsx"
  - "src/components/**/*.ts"
---

# Components

What the inside of a component file looks like, how it reads the store, and where a new file goes.
Adopted from the e-form repos' conventions and adapted to solna's always-mounted tree.

## Components are UI; logic lives in a colocated hook

- A component's body is layout: its `useState`, `useMemo`, `useCallback`, `useEffect` and event handlers live in a `useXxx` hook in the same folder, and the component renders what the hook returns. <!-- R265 -->
- The hook's return type is **named and exported** — `UseXxx` for a new hook; an existing name (`SynthPatchDraft`) stands. The hook is the test seam: the repo has no DOM and no testing-library (`testing.md`), so put the logic in pure functions or a machine the hook wraps and test those (`createBeatParamDraftMachine` beside `useBeatParamDraft`), or render the hook's output through `renderToString`. <!-- R266 -->
- Child components are defined above the root in the same file, so the file reads top-down, leaf → root. <!-- R267 -->
- Call the state hook **once**, at the root; never in each child — every call is an independent copy of the state, which is a bug, not a performance issue. <!-- R268 -->
- If state must reach many descendants through context: the root calls the hook once, the context value is memoized (`useMemo`), and children read it through one typed accessor (`useXxxContext()`) that throws outside its provider — never `useContext(XxxContext)` directly. <!-- R269 -->
- Never spread one props bag across several children; destructure and pass explicit props. A `ui/` primitive forwarding the rest of its native attributes to its one DOM element, or a thin wrapper forwarding its whole props to the one component it wraps, is not this. <!-- R270 -->
- Do not pre-split a small component into hook + context + parts; extract when it grows. <!-- R271 -->
- A colocated hook is extracted **in place**: it never lifts high-frequency state (the playback step, the playhead beat, a value mid-drag) above the subtree that shows it — not into a slice, not into a context provided higher up. That state stays local, or in the module pub/subs (`playbackStep.ts`, `playheadBeat.ts`), because every view stays mounted (R016). The `useXxxDraft` hooks and `useChordView.ts` are the precedent. <!-- R272 -->
- Scope: new components, and an existing component when it is substantially edited. No mass refactor. Known debt, the largest files by `wc -l`: `song/SortableLoopCard.tsx`, `ui/PresetLibrary.tsx`, `loop/ChordPresetLibrary.tsx`, `song/EffectsRackView.tsx`, `Header.tsx`, `loop/SoundSynthSection.tsx` — tracked in DEV-426 / DEV-430. <!-- R273 -->

```tsx
// ✅ useLoopCard.ts beside it: export interface UseLoopCard { label; isActive; onSelect }
// LoopCard.tsx: layout only, child above root
function LoopCardTitle({ label }: { label: string }) { return <h3>{label}</h3>; }
export function LoopCard(props: LoopCardProps) {
  const { label, isActive, onSelect } = useLoopCard(props);
  return <button aria-pressed={isActive} onClick={onSelect}><LoopCardTitle label={label} /></button>;
}

// ❌ state and handlers inline; each child calling useLoopCard() again
```

([ADR-0031](../../docs/decisions/0031-component-hook-store-selector-and-placement-conventions.md), [ADR-0001](../../docs/decisions/0001-always-mounted-views.md))

## Select the store narrowly

- Select one value per selector: `useAppStore((s) => s.x)`. Never `useAppStore()` or `useAppStore((s) => s)` — every view stays mounted, so a wide selector re-renders every mounted view on every `set()`, visible or not. <!-- R274 -->
- Several values in one selector go through `useShallow` (`import { useShallow } from 'zustand/react/shallow'`); a plain selector never returns a fresh object or array — it is a new reference on every call, which the installed zustand reads as a changed snapshot — a re-render loop. <!-- R275 -->

```ts
const bpm = useAppStore((s) => s.bpm);                                            // ✅
const { bpm, meterId } = useAppStore(useShallow((s) => ({ bpm: s.bpm, meterId: s.meterId }))); // ✅
const { bpm, meterId } = useAppStore((s) => ({ bpm: s.bpm, meterId: s.meterId })); // ❌ fresh object
const store = useAppStore();                                                     // ❌ whole store
```

Neither form changes the `renderToString` trap (R257): the server snapshot is still creation-time state.

([ADR-0031](../../docs/decisions/0031-component-hook-store-selector-and-placement-conventions.md))

## Placement

- Code used by one feature or area stays with it (a hook for `loop/chord/` lives in `loop/chord/`); code used by two or more is lifted to the shared location its layer already has — `src/components/ui/` for shared view pieces, `src/components/` root for shared hooks and controllers, `src/utils/` for cross-layer helpers, `src/musicCore/` for music theory. <!-- R276 -->
- A transport controller is not a view's colocated hook: it lives in `components/playback/` and is mounted by `PlaybackHost` (R312, `playback.md`).

([ADR-0031](../../docs/decisions/0031-component-hook-store-selector-and-placement-conventions.md))

## Prohibited

- `useState`/`useMemo`/`useCallback`/`useEffect`/handlers inline in a new or substantially edited component instead of a colocated hook <!-- R265 -->
- A component hook with an anonymous (inferred-only) return type <!-- R266 -->
- Adding testing-library or a DOM to test a hook <!-- R266 -->
- Child components defined below the root <!-- R267 -->
- Calling the root state hook inside each child <!-- R268 -->
- An unmemoized context value, or `useContext(XxxContext)` outside the one throwing accessor <!-- R269 -->
- Spreading one props bag across several children <!-- R270 -->
- Pre-splitting a small component into hook + context + parts <!-- R271 -->
- Lifting high-frequency state into a slice or a higher context while extracting a hook <!-- R272 -->
- A mass refactor of untouched components to this shape <!-- R273 -->
- `useAppStore()` or `useAppStore((s) => s)` <!-- R274 -->
- A plain selector returning a fresh object or array (use `useShallow`) <!-- R275 -->
- One-area code in a shared folder, or shared code left inside one area <!-- R276 -->
