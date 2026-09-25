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
- Scope: new components, and an existing component when it is substantially edited. No mass refactor. Known debt, the largest files by `wc -l`: `song/SortableLoopCard.tsx`, `ui/PresetLibrary.tsx`, `loop/ChordPresetLibrary.tsx`, `song/EffectsRackView.tsx`, `loop/SoundSynthSection.tsx` — DEV-426 weighed splitting them and waived it: each is cohesive and under the cap, so a split rides the next feature that touches one. <!-- R273 -->

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

## Layout shell

- The layout mode is `useLayoutMode()` (`components/shell/useLayoutMode.ts`): viewport width at `md`, which `index.css` sets to 46.5rem (744px, iPad mini portrait) rather than Tailwind's 48rem, and `LAYOUT_MODE_QUERY` names the same width; never persisted, never a slice, no user override; nothing else reads the viewport to pick a frame. <!-- R315 -->
- `Workspace` owns everything that must survive a layout switch — the coordinators, `PlaybackHost` and the app-level dialogs; a shell (`DesktopShell`, `MobileShell`) owns only the visible frame and never mounts one of those. <!-- R316 -->
- A Header tool is a `HEADER_TOOLS` row (`components/header/headerTools.ts`) whose `layers` is its only availability gate; a new tool is a row, never JSX in `Header.tsx`, and never gates itself on the layer. <!-- R317 -->
- The wordmark (`ui/Wordmark.tsx`, rendered through `settings/AppWordmark.tsx`) is a `<button>` that opens the app modal (the theme picker, a divider, then the About lines — no tabs; `settings/AppModal.tsx`, open flag `isAppModalOpen`) on both frames; on desktop the project menu's trigger is the chevron `<span role="button">` right after it. The theme is chosen only in the app modal — it is not a `HEADER_TOOLS` row. <!-- R348 --> ([ADR-0051](../../docs/decisions/0051-theme-picker.md))
- Mobile navigation is `MobileTabBar` (`components/shell/MobileTabBar.tsx`): the `VIEW_ORDER` tabs, each calling `setActiveTab`; the tab implies the layer (`layerForTab`); the mobile frame has no layer switch, no second navigation state and no route logic of its own. <!-- R318 -->
- The mobile top bar splits `HEADER_TOOLS` by id (`MOBILE_BAR_TOOL_IDS`, `components/shell/useMobileTopBar.ts`): field tools inline, every other available tool in the menu sheet as `variant="row"`; a tool that can reach the menu renders a `MenuRowButton` for `row`; the descriptor gains no placement or label field. <!-- R319 -->
- The mobile menu sheet is a `BottomSheet`, always rendered and closed only by dismissal; what a row opens renders inside the sheet's dialog — a nested dialog, or `afterBox` for a fixed overlay — never inside a daisyUI `menu` item. <!-- R320 --> ([ADR-0044](../../docs/decisions/0044-secondary-canvas-taxonomy.md))
- Desktop navigation is `ViewNav` in the Header's left group, beside `ProjectMenu`: every view as a `LOOP_TABS` join and a `SONG_TABS` join, each tab calling `setActiveTab`; the tab implies the layer, as on the phone. No frame renders a layer switch, and the tab nav never sits after a layer-gated tool run, where it would shift as the layer changes. <!-- R322 -->
- Descriptive prose (a card's subtitle or description, a how-to line) wears `HINT_TEXT` (`ui/fieldClasses.ts`) and so shows on the desktop frame only; empty states, loading, errors, warnings and confirmations never wear it. A phone surface must read from its headings and controls alone. <!-- R323 -->
- Exactly one element per frame consumes `env(safe-area-inset-bottom)`: `TransportBar` on desktop, `MobileTabBar` on mobile (`TransportBar bottomInset={false}`). <!-- R321 -->
- Below `md` the transport bar is one row: the frame asks for it (`MobileShell` passes
  `transportVariant="mobile"` through `ShellBody` to `TransportBar variant`), never a media query
  in the bar. The row holds the play/stop join, the play-target label (the only flexible,
  truncating item), `IncidentWarning`, a read-only `BPM · meter` readout with a dot while the
  metronome is on, and a chevron with `aria-expanded`/`aria-controls`; the readout and the chevron
  both toggle the transport sheet. The sheet is a non-modal `BottomSheet` (R326) rendered inside
  the bar, holding the BPM stepper, the meter select, the metronome, the MIDI entry, the level
  meter and the master fader with its dB readout; its open state is local `useState` (R016); it
  closes on its toggles, its close button and Escape, and stays open while playing. The desktop
  bar keeps every control inline and does not change for the phone. <!-- R332 --> ([ADR-0044](../../docs/decisions/0044-secondary-canvas-taxonomy.md))
- Vibes are reached only through the `vibes` `HEADER_TOOLS` row (`components/vibes/VibesButton.tsx`), which leads the list, so it is the first tool in the Header and in the menu sheet; no frame renders an always-visible vibe strip. <!-- R333 --> ([ADR-0045](../../docs/decisions/0045-vibe-picker-preview.md))
- The vibe picker is a centred `Modal` on both frames: the vibes stack one per row, each a card then its own dice, and the list scrolls between Modal's pinned header and a pinned footer; a row's dice previews a variant of that row's vibe whether or not it was being previewed; **Use** (and Play) stay disabled until a vibe has been previewed; the card of the vibe the active loop was loaded from (`selectedVibeId`, as captured at open) carries a "Current" label, never the pressed state, which belongs to the previewed card; boot keeps `selectedVibeId` when it resumes the loop it was set for, so the label survives a reload. <!-- R334 --> ([ADR-0045](../../docs/decisions/0045-vibe-picker-preview.md))
- Below `md` the input dock's keyboard fits the width and never scrolls: the frame asks for it
  (`MobileShell` passes `keyboardVariant="mobile"` through `ShellBody` to `BottomInputDock`),
  never a media query in the keyboard. Chromatic shows one octave, C to C; scale shows one octave
  of the scale per row, tonic's octave on top (`getScaleLockedTouchRows`), each key keeping its
  shortcut; chord shows the chords only. The range moves by the octave buttons. The desktop
  surface keeps its QWERTY layout and scrolls, centred with `justify-center-safe`. <!-- R340 --> ([ADR-0046](../../docs/decisions/0046-mobile-keyboard-fits-the-width.md))
- Each frame's one vertical scroll container is `ViewScrollArea` (`components/shell/`, rendered
  by `ShellBody`), and it remembers the scroll position per visible view: the key is the active
  tab, plus the Pattern segment on Pattern (`viewScrollKey`: `sound`, `pattern:lead`, …). A view
  seen for the first time starts at the top; a return restores its position in a layout effect,
  before paint. Positions come from the container's passive scroll listener, never from the
  switch, and the events of the switch's own clamp and restore are recorded against neither view
  (`createViewScrollMemory`, `useViewScrollMemory.ts`). The memory lives in the hook — never a
  slice, never persisted — and a layout switch may drop it. <!-- R342 --> ([ADR-0049](../../docs/decisions/0049-per-view-scroll-memory.md))

([ADR-0040](../../docs/decisions/0040-layout-shell.md), [ADR-0041](../../docs/decisions/0041-mobile-frame.md), [ADR-0042](../../docs/decisions/0042-flat-view-nav.md), [ADR-0043](../../docs/decisions/0043-hint-text-on-desktop-only.md))

## Secondary surfaces and feedback

- Every overlay is exactly one kind: Dock (`BottomInputDock` only; daisyUI's `dock` class on
  `MobileTabBar` is navigation, not this kind), Drawer, Bottom sheet, Modal or Popup; a new
  overlay picks one of these kinds and its named primitive rather than inventing a position. <!-- R325 -->
- `Modal` is always centered; `BottomSheet` is the only bottom-sheet primitive, used only by the
  mobile frame for what sits inline on desktop. It is modal by default (`showModal()`, backdrop,
  top layer, a feedback hold); `modal={false}` is for a sheet whose frame must stay interactive
  while it is open — the transport sheet, whose Play/Stop sit on the bar below it. A non-modal
  sheet opens with `show()`, has no backdrop and takes no feedback hold, renders inside the bar it
  opens from and anchors to that bar's top edge (no offset, no safe-area padding), sits at the
  frame-bar step (40), and closes on its trigger, its close button and Escape. <!-- R326 -->
- Every titled overlay (`Modal`, both `BottomSheet` forms, the `PresetLibrary` drawer) is a column:
  the title and close button pinned at the top, the body the only scroll container, a footer (if
  any) pinned at the bottom. `Modal` and `BottomSheet` own that layout through `SURFACE_COLUMN`,
  `SURFACE_HEADER` and `SURFACE_BODY` (`ui/Modal.tsx`); a consumer passes only `bodyClassName` and,
  for `Modal`, `footer`. A dialog's `modal-action` row is always its `footer`, never the last child
  of the body; a submit button pinned there names its form through `form`. The non-modal sheet takes `open:flex`, never `flex`, which would show it
  closed. <!-- R339 --> ([ADR-0044](../../docs/decisions/0044-secondary-canvas-taxonomy.md))
- A preset library is a `PresetLibrary` side drawer on both frames, never a sheet; a quick
  in-place pick is a native `<select>` or a `ui/Listbox` — a `Listbox` when the options need a
  description or more than one line of text, a native `<select>` for any pick inside a `Modal`;
  a surface with a user library that can be deleted from gets a drawer, even where a quick pick
  also exists. <!-- R327 -->
- A popup is built on `ui/Popup` (its hook `ui/usePopup.ts`): a daisyUI `dropdown` anchored to
  its trigger (`dropdown-open` while open), kept inside the viewport horizontally by `popupShift`
  (`ui/popupGeometry.ts`), closed by Escape, a pointerdown outside it or focus leaving it, and
  handing focus back on close. No hand-rolled dismissal or placement, no `<details>` as a popup,
  and no popover API or CSS anchor positioning while the browser floor lacks them. Not yet on
  `ui/Popup` (sub-project 3 of ADR-0055): the two `DockMenu`s in `ui/BottomInputDock.tsx`,
  `project/ProjectMenu.tsx` and `ui/QuickSavePopover.tsx`. The one exception is a popup that must sit above an open
  `Modal`: a React portal still renders under the dialog's native top layer, so it is a
  `popover="auto"` element instead, positioned by a pure geometry helper the colocated hook wires
  up on the popover's `toggle` event and on `resize`/`scroll` while open — never CSS anchor
  positioning, for the same Firefox-support reason (the theme picker panel,
  `settings/ThemePicker.tsx` + `settings/placePopover.ts`). That helper opens below the trigger
  whenever the panel fits below; only when it does not fit below does it choose whichever side has
  more room. A popup never renders inside a bottom sheet — a tool that reaches the sheet renders
  inline controls for its `row` variant instead. <!-- R328 -->
- A custom listbox is `ui/Listbox` only: DOM focus stays on its `role="listbox"` root, which
  names the highlighted option through `aria-activedescendant`; option ids come from the flat
  index, never the value; keys go through `listboxKey` (`ui/listboxKeys.ts`) — arrows, Home, End,
  type-ahead and hover move only the highlight, and a value commits only on Enter, Space or a
  click. <!-- R357 -->
- Feedback is a toast, a snackbar (at most one action) or a banner (in flow, persistent until
  handled); an alert rendered inside a modal, drawer or card body is content, not feedback. While
  any `Modal` or modal `BottomSheet` is open, entries queue in the host with their timers held, so a
  message raised inside a dialog is seen rather than expiring unseen; every held timer restarts at
  full duration once the last dialog closes. <!-- R329 -->
- Toasts and snackbars go only through `showFeedback` (the session-only feedback slice, read via
  `useLiveStore`) into the one `FeedbackHost` per frame; no component renders the daisyUI `toast`
  class or a fixed alert of its own. `useNativeDialog` is the only place that takes and releases a
  feedback hold — while its modal dialog is open and until close or unmount. <!-- R330 -->
- The z-scale is fixed end to end and a new layer takes one of its listed steps: 10 in-content
  overlays, 20 pinned view headers, 30 the input dock body, 40 frame bars, 50 drawer and popup
  panels plus full-screen overlays, 55 the feedback slot (above drawers, because a drawer action
  can fire a toast), and the top layer for `Modal` and a modal `BottomSheet`, above every z-index (a non-modal sheet
  is not in the top layer: it takes the frame-bar step of the bar it opens from). A popup that
  opens from inside a frame bar or the dock is capped by that parent's own stacking context, so the
  feedback host can cover an open bar popup (the mobile Scale dropdown under a toast, say) even
  though the popup's own step nominally outranks it — an accepted trade-off, not a bug to chase
  with a one-off z-index. <!-- R331 -->

([ADR-0044](../../docs/decisions/0044-secondary-canvas-taxonomy.md); R328's top-layer-escape
case: [ADR-0051](../../docs/decisions/0051-theme-picker.md); `ui/Popup`, `ui/Listbox` and R357:
[ADR-0055](../../docs/decisions/0055-shared-popup-and-listbox.md))

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
- A viewport read that picks a frame outside `useLayoutMode`, or the layout mode in a slice or storage <!-- R315 -->
- A coordinator, `PlaybackHost` or an app-level dialog mounted inside a shell <!-- R316 -->
- A Header tool written as JSX in `Header.tsx`, or a tool gating itself on the layer <!-- R317 -->
- A layer switch, a second navigation state or route logic in the mobile frame <!-- R318 -->
- A placement or label field on a `HEADER_TOOLS` row, or a menu tool without a `row` rendering <!-- R319 -->
- Closing the mobile menu sheet on a row tap, or a dialog rendered inside a daisyUI `menu` item <!-- R320 -->
- Two elements of one frame both consuming the bottom safe-area inset <!-- R321 -->
- A tempo, meter, metronome, MIDI, level-meter or master-fader control on the mobile transport
  row; a media query choosing the transport variant; the transport sheet's open state in a slice;
  a modal transport sheet; or a phone-driven change to the desktop bar <!-- R332 -->
- A Loop/Song layer switch in either frame, or the desktop tab nav placed after a layer-gated tool run <!-- R322 -->
- A mobile keyboard surface that scrolls, a media query choosing the keyboard variant, or a
  plain `justify-center` on a keyboard row that can overflow <!-- R340 -->
- A second scroll container per frame for the views, scroll positions in a slice or storage, or a
  restore read from `scrollTop` after the switch <!-- R342 -->
- A theme control outside the app modal, or a wordmark that is not the app modal's button <!-- R348 -->
- A description or how-to line shown on the phone frame, a hand-written viewport hide on one, or `HINT_TEXT` on state, feedback or a warning <!-- R323 -->
- An always-visible vibe strip, or a vibe entry point outside the `vibes` HEADER_TOOLS row <!-- R333 -->
- A vibe picker that is a BottomSheet, a drawer or non-modal, or a Use enabled before a preview <!-- R334 -->
- A new overlay built without picking one of the five kinds and its named primitive <!-- R325 -->
- A non-centered `Modal`, or a bottom sheet built from anything but `BottomSheet` <!-- R326 -->
- A non-modal `BottomSheet` with a backdrop, a feedback hold, its own offset or safe-area padding,
  a z-index off the frame-bar step, or used where the frame need not stay interactive <!-- R326 -->
- A titled overlay whose header scrolls away with its content, a consumer that lays out its own
  scroll region inside `Modal`/`BottomSheet`, a `modal-action` row inside a `Modal`'s scrolling body,
  or a bare `flex` on a non-modal sheet's `<dialog>` <!-- R339 -->
- A preset library rendered as a sheet, or a deletable user library left as a quick pick with no drawer <!-- R327 -->
- A quick pick that is neither a native `<select>` nor `ui/Listbox`, or a `Listbox` inside a `Modal` <!-- R327 -->
- A popup rendered inside a bottom sheet; a popup positioned via the popover API or CSS anchor
  positioning anywhere but the top-layer-escape case above; that case positioned via CSS anchor
  positioning <!-- R328 -->
- A new popup not built on `ui/Popup` — its own dismissal listeners or placement math — or a
  `<details>` used as a popup <!-- R328 -->
- A custom listbox other than `ui/Listbox`, DOM focus moved onto its options, an option id built
  from its value, or a value committed by an arrow key, Home/End, type-ahead or hover <!-- R357 -->
- A toast or snackbar about anything other than a modal/drawer/card body's own form, rendered as an
  inline alert there instead of going through `showFeedback` <!-- R329 -->
- A daisyUI `toast` class, a fixed alert outside `FeedbackHost`, or a toast/snackbar bypassing `showFeedback` <!-- R330 -->
- A new z-index outside the listed scale <!-- R331 -->
