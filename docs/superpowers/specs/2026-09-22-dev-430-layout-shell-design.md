# Layout shell and a single layout-mode switch — design

**Issue:** DEV-430 "Layout shell and a single layout-mode switch" (epic DEV-433).
**Branch:** `refactor/dev-430-layout-shell`.
**Status:** Approved design, made concrete (2026-09-22). §11 lists the decisions one per line.

**User-visible change:** none, on desktop or on a phone. Both shells render today's DOM and
classes; the golden WAV and `bun run verify` are unchanged. What changes is *where* the visible
frame is composed: in one of two shells picked by one width query, with everything that must
outlive a switch left in `Workspace`. DEV-431 then diverges `MobileShell` without touching
`Workspace`, `PlaybackHost` or the Header's tool list.

---

## 0. Verified facts (checked against the code on this branch, @ad154d90)

| # | Claim | Evidence |
|---|---|---|
| F1 | `Workspace` runs ten coordinator hooks/effects, selects `activeTab`, and renders the whole frame in one root `div` | `App.tsx:94-159`, root `div` `:162-170` |
| F2 | Frame order: `Header`, `InstantVibesBar` (loop layer only, conditional), `<main>` (`PlaybackHost`, then the gated `LoopPage`/`SongPage` wrappers), `BottomInputDock`, `UpdateBanner`, `TransportBar`, `IncidentDialog`, `MidiSettingsModal`, `ProjectNotice` | `App.tsx:172-222` |
| F3 | The layer gate (R014's first level) is the two wrappers `isSongLayer(activeTab) ? 'hidden' : 'block'` and the reverse | `App.tsx:194-199` |
| F4 | `keyboardProps`/`drumProps` come from `useInputDeck()` in `Workspace`; the update state from `useServiceWorkerUpdate()` | `App.tsx:129, 134` |
| F5 | No Tailwind config file; `src/index.css` has four `@theme` blocks and none sets `--breakpoint-*`, so `md` is Tailwind v4's default `48rem` | `grep -n "breakpoint" src/index.css` empty; `@theme` at `:99, :103, :201, :249`; `tailwindcss` ^4 in `package.json` |
| F6 | No viewport hook exists (`matchMedia` only ad hoc: theme, reduced motion); external stores are read as `useSyncExternalStore(subscribe, get, get)` | `Header.tsx:302, 321`; `ArrangeView.tsx:189`; `playheadBeat.ts:48` |
| F7 | Header right cluster, in order: `LoopCopyButton` + `LoopSelector` (loop, `layer === 'loop' &&`), `ProjectNameLabel`, `FollowPlayheadToggle`, `ExportButton` (song, each self-gates `layer !== 'song'`), `ScaleMenu` (loop, `layer === 'loop' &&`), the tab `nav`, the theme `IconButton` | `Header.tsx:448-506`; self-gates `:175, :238`, `export/ExportButton.tsx:37` |
| F8 | Header left group: `ProjectMenu` (the wordmark dropdown) and `LayerSwitcher` | `Header.tsx:428-435` |
| F9 | `Header.tsx` also holds the theme helpers and `useTheme`, `ProjectNameLabel`, `FollowPlayheadToggle`, `ScaleSelects`/`ScaleMenu`; it is listed as R273 debt "tracked in DEV-426 / DEV-430"; the audit's U7 says the theme still lives there | `Header.tsx:96-414`; `components.md` R273; `structure/README.md:129-132` |
| F10 | Header tests pin the cluster order by `indexOf` on `Header.tsx` source, and render the song-only tools with a `layer` prop | `Header.test.tsx:344-420, 265-342`; `export/ExportButton.test.tsx:12-39` |
| F11 | `Header`, `InstantVibesBar`, `TransportBar` render under `renderToString` with the default store (smoke-checked); `appChildMemo.test.tsx` compares memo wrapper vs inner markup | `appChildMemo.test.tsx:58-81` |
| F12 | Clock subscribers outside `PlaybackHost`: `usePlayheadSync` (a `Workspace` hook) and `ArrangeView`, which subscribes only while playing on Arrange | `usePlayheadSync.ts:41`; `song/ArrangeView.tsx:142-156` |
| F13 | Source-reading App tests: `startAudioRecoveryBridge()` and `<IncidentDialog />` exactly once in `App.tsx` | `App.test.tsx:160-170` |
| F14 | Latest rule id R314, latest ADR 0039 | `.claude/rules/`, `docs/decisions/README.md:56` |

---

## 1. Goal

One switch decides desktop vs mobile, one place composes each frame, and the Header's tools are
data — so DEV-431 can build a mobile frame (bottom nav, top bar + hamburger) as a rendering change
only, with audio, coordinators and dialogs untouched by a switch.

## 2. Non-goals

- No visible change in either mode (the mobile frame is DEV-431); no breakpoint class removed (§6).
- No user override, no persisted preference, no store slice for the mode (R016).
- No change to `PlaybackHost`, the coordinators, routing or any view's internals.

---

## 3. Target layout

```
src/components/shell/               (new: the frame, one area)
  useLayoutMode.ts(+ .test.ts)      LAYOUT_MODE_QUERY, createLayoutModeSource, useLayoutMode
  LayerPages.tsx                    the two gated page wrappers — R014's first level, once
  DesktopShell.tsx                  today's frame, memo'd
  MobileShell.tsx                   same composition today (stub), memo'd
  shellProps.ts                     ShellProps (both shells + Workspace)
  shells.test.tsx                   both shells render; identical markup today
src/components/header/              (new: the Header's tools, one area)
  headerTools.tsx(+ .test.ts)       HEADER_TOOLS descriptors
  ProjectNameLabel.tsx              moved out of Header.tsx, loses the `layer` prop
  FollowPlayheadToggle.tsx          moved out of Header.tsx, loses the `layer` prop
  ScaleMenu.tsx                     ScaleSelects + ScaleMenu (now selects root/type itself)
  ThemeToggle.tsx                   the theme IconButton, extracted
  useTheme.ts                       useTheme + resolveInitialTheme/readStoredTheme/persistTheme
src/components/Header.tsx           frame only: LAYER_META, layerToggleTarget, TabButton,
                                    LayerSwitcher, Header
```

**Placement (R276).** `useLayoutMode` has one consumer and lives with the shells it picks. The
tools leave `Header.tsx` because `headerTools.tsx` imports them and `Header.tsx` imports it — else
an import cycle; DEV-431's top bar is the second reader. `Header.tsx` itself stays put.

## 4. `useLayoutMode`

```ts
export type LayoutMode = 'desktop' | 'mobile';
/** Tailwind v4's default `md` (F5): desktop from 48rem up, the same edge as every `md:` class. */
export const LAYOUT_MODE_QUERY = '(min-width: 48rem)';
type MatchMedia = (query: string) => Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
export function createLayoutModeSource(matchMedia: MatchMedia | undefined): {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): LayoutMode;
};
export function useLayoutMode(): LayoutMode; // useSyncExternalStore(src.subscribe, src.getSnapshot, () => 'desktop')
```

- The `MediaQueryList` is created lazily (first `subscribe`/`getSnapshot`) from
  `window.matchMedia` if present, so importing under `bun test` touches nothing; absent, the
  snapshot is `'desktop'` and subscribe is a no-op.
- `getSnapshot` returns a string (an unchanged width never re-renders `Workspace`);
  `getServerSnapshot` is `'desktop'`, so every `renderToString` test renders the desktop shell.
- Width only (no pointer/hover query, no orientation): a landscape phone ≥ 48rem is desktop,
  exactly where today's `md:` classes already switch.
- A guard test pins F5: `src/index.css` sets no `--breakpoint-md`, so the constant and Tailwind's
  `md` cannot drift silently.

## 5. `Workspace` and the shells

```tsx
function Workspace() {
  /* every coordinator hook and effect exactly as today (F1), minus the `activeTab` selector */
  const mode = useLayoutMode();
  const Shell = mode === 'desktop' ? DesktopShell : MobileShell;
  return (
    <div className="…unchanged root classes…">
      <PlaybackHost />
      <Shell keyboardProps={keyboardProps} drumProps={drumProps}
        updateReady={updateReady} onApplyUpdate={applyPendingUpdate} onDismissUpdate={dismissUpdate} />
      <IncidentDialog />
      <MidiSettingsModal />
      <ProjectNotice />
    </div>
  );
}
```

**The split.** `Workspace` keeps what must survive a switch or is not frame: the coordinators
(incl. `useInputDeck`, whose held-note and arp state would otherwise reset), `PlaybackHost`, the
root `div` (height, safe-area insets, theme surface — mode-independent), and the three dialogs
(modal/overlay, not frame; `App.test.tsx` pins `<IncidentDialog />` there, F13). The shell owns
the visible frame: `Header`, `InstantVibesBar`, `<main>` + `LayerPages`, `BottomInputDock`,
`UpdateBanner`, `TransportBar`. `UpdateBanner` is frame because it is an in-flow bar placed above
the transport bar (`shrink-0`, `ui/UpdateBanner.tsx:35`), so DEV-431 may place it differently; its
state stays in `Workspace` via props.

**DOM identity and listener order.** `PlaybackHost` renders nothing, so moving it from inside
`<main>` to the root's first child changes no markup, and the shell returns a fragment. The host
still precedes every page (ADR-0039 §5.3); nothing in `Header`/`InstantVibesBar` subscribes the
clock (F12), so also preceding them changes no order.

**A mode switch** swaps the element type at one child slot: the shell subtree unmounts and
remounts; `PlaybackHost`, the coordinators and the dialogs do not. Audio never stops (R040: it does
not depend on mounting). UI state inside the frame — scroll, open dropdowns, a drag in progress,
meter history — resets. Acceptable: crossing 48rem means a rotation or a resize, both rare, and
nothing already committed to the store is lost. A playing `ArrangeView` re-subscribes after
`usePlayheadSync`, an order any mid-play tab change to Arrange already produces today (F12).

**`DesktopShell`** is today's frame, moved verbatim (comments included): it selects `activeTab`
for the `InstantVibesBar` gate, `<main className="flex-1 min-h-0 relative overflow-y-auto pb-9">`
wraps `<LayerPages />`. **`MobileShell`** is the same JSX — a deliberate duplicate, since its
purpose is to diverge in DEV-431. Both are `React.memo`, like every App-level child, and join
`appChildMemo.test.tsx`.

**`LayerPages`** (memo'd, no props) selects `activeTab` and renders F3's two wrappers verbatim —
shared because the layer gate is the one piece both frames must keep identical (R014).

`ShellProps`: `{ keyboardProps: InputDeckKeyboardProps; drumProps: InputDeckDrumProps; updateReady:
boolean; onApplyUpdate(): void; onDismissUpdate(): void }` — the types `BottomInputDock` already
takes, explicit props per child (R270).

## 6. Breakpoint classes

None removed. The `sm:`/`md:`/`xl:` classes in `Header`, `ScaleMenu`, `TabButton`,
`TransportBar` and the views still do all the responsive work, and both shells render them. Each
becomes redundant only when DEV-431 gives the mobile frame its own markup; that issue removes the
mobile halves it makes dead.

## 7. `HEADER_TOOLS`

```ts
type HeaderToolId = 'loop-copy' | 'loop-selector' | 'project-name' | 'follow-playhead' | 'export' | 'scale' | 'theme';
export type HeaderToolGroup = 'subject' | 'actions';
export interface HeaderTool {
  readonly id: HeaderToolId;
  readonly Component: ComponentType;     // no props: each tool reads the store itself
  readonly layers: readonly Layer[];     // where it is available — the only gate
  readonly group: HeaderToolGroup;       // which side of the tab nav on the desktop row
}
export const HEADER_TOOLS: readonly HeaderTool[];                 // today's order, F7
export function headerToolsFor(layer: Layer, group: HeaderToolGroup): readonly HeaderTool[];
```

| id | Component | layers | group |
|---|---|---|---|
| `loop-copy` | `LoopCopyButton` | loop | subject |
| `loop-selector` | `LoopSelector` | loop | subject |
| `project-name` | `ProjectNameLabel` | song | subject |
| `follow-playhead` | `FollowPlayheadToggle` | song | subject |
| `export` | `ExportButton` | song | subject |
| `scale` | `ScaleMenu` | loop | subject |
| `theme` | `ThemeToggle` | loop, song | actions |

`Header` renders `headerToolsFor(layer, 'subject')`, the tab `nav`, then
`headerToolsFor(layer, 'actions')`, each as `<Component key={id} />`, inside the unchanged
cluster `div`. Markup is identical: fragments and keys render nothing, and a filtered-out tool
rendered nothing before (F7).

**Structural, not tools:** `ProjectMenu`, `LayerSwitcher` and the tab `nav`. They are navigation
and identity, and DEV-431 replaces rather than relocates them: the bottom nav's four tabs imply the
layer (no switcher), and the hamburger's project entry needs `PROJECT_MENU_SECTIONS` rendered as
menu rows, not the wordmark dropdown `ProjectMenu` is. A descriptor would carry a component the
mobile frame cannot reuse.

**`group` is the one layout hint, and it is needed today:** the nav sits between the scale menu and
the theme toggle (F7), so a flat list cannot reproduce the desktop order with the nav structural.
No `placement`/`priority` field: DEV-431's split (loop picker and key inline; export, copy, follow,
theme in the hamburger) is a choice of ids in the mobile top bar — a rendering change, as required.

**One gate.** `layers` replaces both today's inline `layer === 'loop' &&` and the song-only
self-gates; `ProjectNameLabel`, `FollowPlayheadToggle` and `ExportButton` lose their `layer` prop
and their `return null`. `ScaleMenu` selects `scaleRoot`/`scaleType` itself (so `Header` stops
selecting them) and `ThemeToggle` owns `useTheme()` (colocated hook, R265; return type `UseTheme`).
Moving the theme into `header/useTheme.ts` closes U7's remaining half.

## 8. Tests

- **`shell/useLayoutMode.test.ts`** (pure, fake `matchMedia`): `matches` true → `'desktop'`,
  false → `'mobile'`; a `change` event notifies and the next snapshot flips; unsubscribe removes
  the listener; no `matchMedia` → `'desktop'`, subscribe no-op; the query is created once;
  `renderToString` of a probe using `useLayoutMode()` prints `desktop`; `src/index.css` has no
  `--breakpoint-md`.
- **`shell/shells.test.tsx`:** `DesktopShell` and `MobileShell` each render non-empty markup
  containing the Header, the vibes bar (default tab is on the loop layer), both page wrappers, the
  dock and the transport bar ids; the two strings are equal after DnD-id normalisation — the
  "zero visible change on mobile" proof for this issue. A source test: `App.tsx` renders
  `<PlaybackHost />` before the shell and no frame component (`Header`, `TransportBar`,
  `BottomInputDock`, `LoopPage`, `SongPage`, `InstantVibesBar`) — they survive a switch only if
  they are not in `Workspace`'s own JSX, and the host survives only if it is.
- **`header/headerTools.test.ts`:** ids unique; order equals F7; loop layer → `loop-copy`,
  `loop-selector`, `scale`, `theme`; song layer → `project-name`, `follow-playhead`, `export`,
  `theme`; every id is in exactly one group; `theme` alone is `actions`.
- **`appChildMemo.test.tsx`:** `DesktopShell`, `MobileShell` (with shell props) and `LayerPages`
  join `CASES`.
- **Rewritten, same intent:** `Header.test.tsx`'s source-order describes become data assertions on
  `HEADER_TOOLS` (subject before nav = group `subject`); "export lives in its own feature folder"
  reads `header/headerTools.tsx` for the `ExportButton` import and checks both files for export
  logic; the song-only render tests drop the `layer` prop, and the "loop layer renders nothing"
  cases move to availability; `ExportButton.test.tsx` likewise. Imports follow the moves.
- **Unchanged:** `App.test.tsx`, `PlaybackHost.test.tsx`, the golden files; `bun run verify` green.

## 9. Rules, ADR and doc sync (same change)

- **ADR-0040 "Layout shell"** (`docs/decisions/0040-layout-shell.md`): context (DEV-433 mobile
  epic; one frame hard-wired in `App.tsx`; Header tools as JSX); decision §4-§7; rejected: a store
  slice or persisted override for the mode (R016, no requirement), CSS-only responsive frames
  (two frames' markup in one tree, both mounted), `pointer: coarse` detection (a tablet with a
  keyboard is desktop), dialogs/host inside the shells (they would remount), a placement hint on
  the descriptor (YAGNI), `ProjectMenu`/`LayerSwitcher`/nav as tools. Index row after 0039.
- **New rules** (next free after R314):
  - **R315** — The layout mode is `useLayoutMode()` (`components/shell/`): width only, Tailwind's
    `md`, never persisted, never a slice; nothing else reads the viewport width to pick a frame.
  - **R316** — `Workspace` owns everything that must survive a mode switch (coordinators,
    `PlaybackHost`, dialogs); a shell owns only the visible frame and never mounts one of those.
  - **R317** — A Header tool is a `HEADER_TOOLS` descriptor; its `layers` is its only availability
    gate; a new tool is a row, not JSX in `Header.tsx`.
  Each with a `## Prohibited` line in `components.md` (new `## Layout shell` section).
- **R014 text:** the first level becomes `shell/LayerPages.tsx` (`isSongLayer(activeTab)`) — CLAUDE.md,
  ADR-0001, and wherever R014 is quoted.
- **R244 / testing.md:** "`Header.tsx` theme functions" → `header/useTheme.ts` (persistence.md,
  ADR-0022, testing.md); **R293 / R295:** `Header.tsx` → `Header.tsx`/`header/headerTools.tsx`
  (export.md, ADR-0035); `components.md` R273 drops `Header.tsx` from the debt list.
- **CLAUDE.md:** R014 line; one architecture sentence ("a layout shell picked by `useLayoutMode`
  frames the views; `Workspace` keeps what survives a switch"); rules table `components.md` row.
- **Architecture docs:** `feature-overview.md` UI node + `components/` row; `structure/01-ui.md` §1.1
  tree and mermaid, §1.2 Header, §2.1 rows 13-21, §4.2 gating, §5b Header smell; `structure/README.md`
  U7 smell → theme half **Fixed (DEV-430)**. `docs/design.md` Header item; `music-theory` skill's
  picker path. No line numbers (R001).

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | Desktop markup drifts during the move | Shell JSX moved verbatim; `shells.test.tsx` equality; `appChildMemo` byte-compare |
| K2 | A coordinator or the host lands in a shell and resets/silences on a switch | R316; the `App.tsx` source test |
| K3 | Mode flaps at exactly 48rem | One query, one boundary, same as `md:`; `useSyncExternalStore` bails on an equal string |
| K4 | Import cycle Header ↔ tools | Tools in `header/`, `Header.tsx` imports them one way |
| K5 | A song-only tool shows on the loop layer once its self-gate is gone | `headerTools.test.ts` availability; `Header` renders only `headerToolsFor(layer, …)` |

## 11. Decisions for review

1. `useLayoutMode` in `components/shell/`, `(min-width: 48rem)`, `getServerSnapshot` → `'desktop'`.
2. `Workspace` keeps coordinators, root `div`, `PlaybackHost` (moved to the root's first child) and the three dialogs.
3. Shells own `Header`, `InstantVibesBar`, `<main>`, `BottomInputDock`, `UpdateBanner`, `TransportBar`.
4. `MobileShell` duplicates `DesktopShell` on purpose; `LayerPages` is the shared R014 gate.
5. `HEADER_TOOLS` = seven tools with `layers` + `group`; `ProjectMenu`, `LayerSwitcher`, nav stay structural.
6. `layers` is the only gate: three song-only components lose `layer` and self-gates.
7. Tools move to `components/header/`; the theme leaves `Header.tsx` (U7 closed).
8. No breakpoint class removed.
9. ADR-0040; R315–R317 new; R014, R244, R293, R295, R273 texts updated.
