# Secondary-canvas taxonomy — design

**Issue:** none.
**Branch:** `refactor/secondary-canvas-taxonomy`.
**Status:** Design, decisions fixed by the user (2026-09-24); this spec makes them concrete.

**User-visible change:** Quick Save opens under its button; transient messages appear in one place
(above the dock on desktop, below the top bar on a phone); Beat gains a library drawer and a save
confirmation. Nothing else moves.

---

## 0. Verified facts (this branch, @d3f8e179)

| # | Claim | Evidence |
|---|---|---|
| F1 | `Modal` takes `placement: 'middle' \| 'bottom'` and `afterBox`; only the two sheets pass either | `ui/Modal.tsx`; `git grep "placement=\|afterBox"` → `shell/MobileTopBar.tsx`, `song/LoopDetailSheet.tsx` |
| F2 | R320 codifies "the mobile menu sheet is a `Modal` with `placement="bottom"`" | `components.md` R320, ADR-0041 |
| F3 | **`scale` is a mobile *bar* tool**: `MOBILE_BAR_TOOL_IDS` = loop-selector, scale, project-name, pinned by `mobileShell.test.tsx`. `ScaleMenu` never renders in the sheet today; its `<details class="dropdown">` sits in the top bar | `shell/useMobileTopBar.ts` |
| F4 | `QuickSavePopover` is an in-flow card rendered by the parent, not beside its trigger; three triggers: `btn-quick-save-preset`, `btn-beat-quick-save`, the Chord segment's Save | `ui/QuickSavePopover.tsx` and call sites |
| F5 | Beat has a user library: `customBeatPresets`, `saveCustomBeatPreset`, and `deleteCustomBeatPreset` in the store — **with no UI caller** (store tests only). No categories, no audition, no search | `store/presetsSlice.ts`, `git grep deleteCustomBeatPreset` |
| F6 | The chord/bass/pad module `PresetSelect` picks from the synth preset library, whose manager is the Sound view's `SynthPresetLibrary` drawer | `loop/chord/moduleFields.tsx`, `loop/chord/PresetSelect.tsx` |
| F7 | `projectNotice` is written by the **store** (`projectSlice`, `driveSlice`, the export runner via `exportSlice`'s `setNotice`) and by `ProjectMenu.report`; it carries successes (`Exported <file>.`) as well as errors | `store/*.ts`, `project/ProjectMenu.tsx` |
| F8 | daisyUI `.toast` is `position: fixed`; `dropdown-open`/`-end`/`-bottom`, `modal-bottom`, `drawer-end`, `alert-soft` exist | `node_modules/daisyui/components/{toast,dropdown}.css` |
| F9 | The app's floor is Tailwind v4's browser floor (Safari 16.4) and the iPhone Home-Screen PWA is a target; the HTML popover API needs Safari 17, CSS anchor positioning Safari 26 | `docs/dependency-upgrade-research.md`, `docs/testing/audio-runtime-acceptance.md` |
| F10 | No `overflow-*` clipping on `ViewHeader`, `SegmentHeader`, `SectionCard`, `PanelCard`, `GroupFrame` (the three Save buttons' ancestors) | `grep overflow` |
| F11 | Chord's toast also fires for Re-harmonize; the synth's also for a preset *load* | `loop/chord/useChordView.ts`, `loop/synth/synthPresetBrowser.ts` |
| F12 | Latest rule R324, latest ADR 0043 | grep, ADR index |

## 1. Goal

Every overlay or secondary surface is exactly one kind with one primitive, and every transient
message goes through one host — so a new surface picks a row of §3 instead of inventing a position,
a z-index and a timer.

## 2. Non-goals

- No desktop layout change beyond §5's fixes. No new breakpoint.
- The mobile transport sheet (a **non-modal** sheet: the transport stays tappable) is out of scope.
  §5.1 only keeps it possible: `useNativeDialog` is the one place a `show()`-vs-`showModal()` mode
  would later be added.
- No Beat preset audition, categories or JSON import/export (see Q2).
- `projectNotice`'s clear points are not redesigned (§5.6).

## 3. Taxonomy

| Kind | Purpose | Layout | Primitive | Mechanism |
|---|---|---|---|---|
| **Dock** | The virtual keyboard / drum pad | both | `ui/BottomInputDock` | In-flow, collapsible. daisyUI's `dock` *class* styles `MobileTabBar`; that is navigation, not this kind |
| **Drawer** | A preset **library**: search, categories, delete, audition, save, import — management | both, same side drawer | `ui/PresetLibrary` | `drawer drawer-end`, fixed; never a bottom sheet on a phone |
| **Bottom sheet** | What sits inline on desktop but does not fit a phone | mobile only | `ui/BottomSheet` (new) | `<dialog>` `modal modal-bottom`, `showModal()` |
| **Modal / dialog** | A task or confirmation that blocks | both, centered | `ui/Modal` | `<dialog>` `modal`, `showModal()` |
| **Popup** | A small panel tied to its trigger | both | daisyUI `dropdown`; `QuickSavePopover` for a controlled one | `dropdown-content` absolute under the trigger |
| **Quick pick** | Choosing a preset in place | both | native `<select>` | not an overlay |
| **Toast** | Transient, no action, auto-dismiss | both | `ui/FeedbackHost` via `showFeedback` | one host per frame |
| **Snackbar** | Transient, at most one action (Undo) | both | same host | same |
| **Banner** | Persistent until handled; in layout flow, never floats | both | `ui/UpdateBanner`, `project/ProjectNotice` | in `ShellBody` above `TransportBar` |

An `alert` inside a modal, drawer or card body is content, not feedback (PresetLibrary's
save/import lines stay inline — §5.5).

**Nesting.** A modal may open from a sheet, drawer or modal (top layer). A popup never renders
inside a bottom sheet: a tool that reaches the sheet renders inline controls for `variant="row"`.

**Z-scale** (one scale; the rule states it):

| z | Members |
|---|---|
| 10 | in-content overlays (sticky row labels, keys, search icons) |
| 20 | pinned view headers (`ViewHeader`) |
| 30 | the input dock body |
| 40 | frame bars: `Header`, `MobileTopBar`, `TransportBar`, `MobileTabBar`, the dock's header |
| 50 | drawer, popup panels (`dropdown-content`), full-screen overlays (`ProjectLoading`, Suspense fallbacks) |
| 55 | the feedback slot (§5.5) — above drawers, because a drawer action (synth preset load) fires a toast |
| top layer | `Modal`, `BottomSheet` — above every z-index |

A toast cannot rise above a modal or sheet backdrop — only another top-layer element could, and the
popover API is below the floor (F9). So feedback **waits**: while any `Modal`/`BottomSheet` is open,
entries queue in the host and their timers do not run; the timers start when the last dialog closes
(§5.5). An error raised inside a Drive or export dialog is therefore seen, not expired unseen. The
one off-scale popup (`BottomInputDock`'s `dropdown-content z-40`) moves to 50.

## 4. Inventory and verdicts

| Surface | Today | Verdict |
|---|---|---|
| `ui/BottomInputDock` | dock | Dock ✓ |
| `shell/MobileTabBar` | daisyUI `dock` class | navigation; not the Dock kind |
| `ui/PresetLibrary` (chord, synth) | `drawer drawer-end` | Drawer ✓ |
| `shell/MobileTopBar` `MobileMenuSheet` | `Modal placement="bottom"` | → `BottomSheet` (§5.1) |
| `song/LoopDetailSheet` | same | → `BottomSheet` |
| every other `<Modal>` call site | centered | Modal ✓ |
| `ScaleMenu`, `ProjectMenu`, the dock's focus chip | `dropdown` | Popup ✓; the menu sheet gets a no-popup guard (§5.2) |
| `ui/QuickSavePopover` | in-flow card | → anchored Popup (§5.3) |
| Beat Kit select + arrows | `<select>` | Quick pick ✓, **but** Beat is a library (F5) → add a drawer (§5.4) |
| Module sound-preset `PresetSelect`, synth preset select | `<select>` | Quick pick ✓; library already a drawer (F6) |
| Vibe toast (`InstantVibesBar`) | `toast toast-top toast-end` | → host, toast |
| Synth save/load toast (`SoundSynthSection`) | absolute under the band, z-20 | → host, toast |
| Chord save / re-harmonize toast (`ChordView`) | absolute alert, z-20 | → host, toast |
| Loop Undo (`ArrangeView` + `LoopUndoToast`) | fixed `toast-bottom` z-30, under the z-40 bars | → host, snackbar |
| `project/ProjectNotice` | fixed `bottom-24 z-50`, never auto-dismisses | → split, §5.6 |
| `ui/UpdateBanner` | in flow | Banner ✓ |
| Beat save | no confirmation | add toast |

## 5. Changes

### 5.1 `BottomSheet` split from `Modal`

`Modal` loses `placement` and `afterBox` (F1) and always renders centered. The two effects it holds
(open sync, native `close` listener with the `openRef` guard) move into one hook both use — two
consumers of identical platform glue, so a hook, not a base component; the headers and box classes
differ and stay in each file.

```ts
// ui/useNativeDialog.ts
export function useNativeDialog(open: boolean, onClose: () => void): RefObject<HTMLDialogElement | null>;
// ui/BottomSheet.tsx — mobile frame only
export interface BottomSheetProps {
  open: boolean; onClose: () => void; title: ReactNode;
  boxClassName?: string;
  /** Inside the dialog, after the box: fixed overlays the box's translate would clip. */
  afterBox?: ReactNode;
  children: ReactNode;
}
```

`BottomSheet` renders `modal modal-bottom`, `MODAL_BOX` (imported from `Modal`, so the
`fieldClasses` chrome guard still finds the literal only in `Modal.tsx`), the safe-area bottom
padding and the 44px close button that `Modal` carried for `sheet`. Migrate `MobileMenuSheet`,
`LoopDetailSheet`; update comments that name `Modal` (`useMobileTopBar`, `useLoopDetailSheet`).

Tests: `Modal.test.tsx` drops the bottom case and asserts no `modal-bottom`; new
`BottomSheet.test.tsx` (renderToString: `modal-bottom`, safe-area class, `min-h-11` close,
`afterBox` inside the `<dialog>` after the box); `mobileShell.test.tsx` unchanged in intent; guard
in `fieldClasses.test.ts`: `modal-bottom` appears only in `BottomSheet.tsx`.

### 5.2 No popup inside the menu sheet — a guard only

F3: `scale` is a mobile bar tool, so no popup sits in the sheet today, and `scale` stays in the bar
(Q1 resolved: key/scale must stay visible while editing a loop). `ScaleMenu` is **not** changed — a
`row` variant nobody renders would be dead code. Instead, a guard test pins R328 for whatever reaches
the sheet: every tool `useMobileTopBar` routes to `menu`, rendered as `row`, contains no `dropdown`
class and no `<details`. Lands with §5.1.

### 5.3 `QuickSavePopover` as an anchored popup

Mechanism: daisyUI `dropdown dropdown-end` around the trigger, forced by `dropdown-open`, panel
rendered only when open — what the three existing popups use; absolute, so it scrolls with its
trigger without listeners; works below the floor. Rejected: popover API and CSS anchor positioning
(F9); a `fixed` panel from `getBoundingClientRect` (scroll/resize tracking in a scrolling `<main>`).

Edges and 375px: the panel is `w-80 max-w-[calc(100vw-1rem)]`, the form stacks (name, optional
category, Save/Cancel row). One layout effect on open measures the panel and applies a horizontal
shift from a pure helper, re-run on `resize`; vertically it opens downward and the input's `focus()`
scrolls it into view inside `<main>`. F10 confirms no ancestor clips it; being out of flow it no
longer reflows the band (the reason Beat's comment gives for parking it in the body).

```ts
export function popupShift(panel: { left: number; right: number }, viewportWidth: number, margin?: number): number;
interface QuickSavePopoverProps {
  open: boolean; onOpen: () => void; onClose: () => void;
  trigger: { id: string; label: string; icon: ReactNode; className: string; title: string };
  heading: string; placeholder: string; saveLabel: string;
  name: string; onNameChange(name: string): void; onSubmit(e: React.FormEvent): void;
  categories?: { id: string; label: string }[]; category?: string; onCategoryChange?(c: string): void;
}
```

The component renders the trigger button (`aria-haspopup="dialog"`, `aria-expanded`), so the three
call sites move their Save button into it; `formClassName`/`inputClassName`/`selectClassName`/
`buttonClassName` go (the panel owns layout). Escape and focus return stay; a `pointerdown` outside
the wrapper closes. `SynthQuickSaveOverlay` and Beat's body-level popover disappear.

Tests: `popupShift` (fits → 0, left/right overflow, panel wider than viewport pins to margin);
renderToString closed = trigger only, open = `dropdown-open` + input + category select when given;
`isDismissKey` kept; ChordView/BeatSoundSection tests find the trigger ids unchanged.

### 5.4 Preset rule applied; Beat library drawer

Rule: library = drawer, quick pick = `<select>`; a surface may have both (synth does). Module
`PresetSelect` and the synth select: quick picks, unchanged. Beat: a user library whose delete has
no UI (F5) → it is a library and gets `loop/beat/BeatPresetLibrary.tsx` over `PresetLibrary`
(lazy-loaded like the other two), opened by `btn-open-beat-library` ("Kits" + count) in
`BeatSectionActions`. Entries: user first, then factory (PresetLibrary's order); categories are
derived from `origin` (All / My Kits / Factory); search by name; select → `setBeatPreset`; delete on
user entries only → `deleteCustomBeatPreset` behind the confirm step the synth drawer uses; save →
inline form, name only. The Kit select, arrows and Edited badge stay as the quick pick.

Tests: `BeatPresetLibrary.test.tsx` (grouping, origin counts, delete only on user rows, select
calls through); `BeatSoundSection.test.tsx` renders the library button.

### 5.5 Feedback host

State is a **session-only store slice**: the store writes messages itself (F7) and must not import
`components/`, so a context or component module cannot be the source. Low-frequency, so R016 allows
a slice; absent from `partializeAppState` (the `exportJob` precedent). The host reads it through
`useLiveStore`, so renderToString tests see `setState` (R257).

```ts
// store/feedback.ts (pure)
export type FeedbackTone = 'info' | 'success' | 'warning' | 'error';
export interface FeedbackAction { id: string; label: string; run: () => void }
export interface FeedbackRequest {
  key: string;          // same key replaces (vibe load vs reroll; one pending Undo per kind)
  message: string; detail?: string; tone: FeedbackTone;
  action?: FeedbackAction;  // present ⇒ snackbar
  durationMs?: number;
}
export interface FeedbackEntry extends FeedbackRequest { seq: number }
export function enqueueFeedback(list: readonly FeedbackEntry[], entry: FeedbackEntry, limit?: number): readonly FeedbackEntry[];
export function removeFeedback(list: readonly FeedbackEntry[], key: string, seq?: number): readonly FeedbackEntry[];
export function feedbackDurationMs(req: FeedbackRequest): number; // toast 3000, error toast 8000, snackbar 5000
// store/feedbackSlice.ts
feedback: readonly FeedbackEntry[];
showFeedback(req: FeedbackRequest): void;
dismissFeedback(key: string): void;
```

The slice owns one timer per key through an injected `schedule` dep; expiry removes by `(key, seq)`,
so a replaced entry's old timer cannot remove the new one (today's `useTimedToast` invariant).
Limit 3 visible; the oldest drops.

**Hold while a dialog is open.** The slice keeps `feedbackHolds: number` with
`holdFeedback(): () => void` (returns its release). `useNativeDialog` takes a hold while its dialog
is open and releases it on close/unmount. While `feedbackHolds > 0` no timer is scheduled; when it
returns to 0 every queued entry gets a fresh full-duration timer. Entries stay rendered in the host
meanwhile (under the backdrop), so nothing is lost; a snackbar's action stays valid.

Host: `ui/FeedbackHost.tsx` — `FeedbackHost({ edge }: { edge: 'top' | 'bottom' })`, always rendered
as `role="status" aria-live="polite"` so announcements work; an error entry adds `role="alert"`.
Entries are `alert alert-soft alert-<tone>`; a snackbar adds `btn btn-xs` with the action's id and
runs then dismisses. Not the daisyUI `toast` class (F8: fixed, would ignore the slot). Newest sits
nearest the edge.

Placement without magic numbers: a zero-height `relative z-55` slot per frame — desktop in
`ShellBody` between `<main>` and `BottomInputDock` (host `absolute bottom-10`, centered, clearing
the dock toggle strip `pb-9` reserves); mobile in `MobileShell` directly after `MobileTopBar` (host
`absolute top-2`). `ShellBody` takes `feedbackSlot: boolean` beside `bottomInset`. The slot is frame
(R316); the state is in the store, so a layout switch keeps pending messages.

Migrations: vibe load/reroll (key `vibe`), synth save/load (`synth-preset`), chord save and
re-harmonize (`chord-progression`), Beat save (`beat-preset`, new: `Saved Beat preset "<name>"`).
`useTimedToast`/`useLibraryToast` remain only for the in-drawer save/import lines: they report on
the drawer's own form, so they are content (R329), not feedback.

Tests: `store/feedback.test.ts` (replace by key, limit, stale seq, durations); `feedbackSlice.test.ts`
(fake scheduler: expiry, replacement cancels, action runs then dismisses, no timer while held,
fresh timers on last release, double release is a no-op); `FeedbackHost.test.tsx`
(empty live region, tones, snackbar button id); `shells.test.tsx` (one slot per frame); the
vibe/chord/Beat tests read `feedback` from the store; `fieldClasses.test.ts` guard: no daisyUI
`toast` class anywhere, `fixed` + `alert` only in `FeedbackHost.tsx`.

### 5.6 Loop Undo and `projectNotice`

**Undo.** `useLoopUndo(restore, key, messageOf)`: `offer(payload)` calls `showFeedback` with an
`Undo` action whose `run` restores that payload (ids `btn-undo-loop-delete`, `btn-undo-key-change`
kept); the project-install subscription calls `dismissFeedback(key)`. `pending` had no other reader,
so `LoopUndoToast.tsx`(+test) and ArrangeView's `toast` block go. Snackbars now sit above the bars.

**`projectNotice` split by what the message is:**

| Message (source) | Kind |
|---|---|
| Storage unavailable / failed / quota from boot load or autosave (`projectSlice`) | Banner |
| `Opened with unrecognised references…` (boot, open; may join a save failure) | Banner |
| `Exported <file>.` (export runner) | Toast, success |
| Export failure messages; `DOWNLOAD_FAILED_MESSAGE`; `UNREADABLE_FILE_MESSAGE`; malformed / newer-version file; explicit save failure / handle denied | Toast, error |
| Drive not configured / denied / failed / other Drive errors (`driveSlice`) | Toast, error |

`projectNotice` keeps its name and becomes banner-only; every existing `projectNotice: null` write
and `ProjectMenu`'s `report(null)` stay as banner clears (no behaviour drift). One-shot writers call
`showFeedback` (`exportJob`'s `setNotice` dep becomes `notify(message, tone)`). `ProjectNotice`
leaves `Workspace` for `ShellBody` beside `UpdateBanner`, restyled in flow with its dismiss button.

Tests: `ProjectNotice.test.tsx` (in flow, no `fixed`); `exportSlice.test.ts`, `projectSlice`/
`driveSlice` tests move one-shot assertions from `projectNotice` to `feedback`; `ArrangeView.test`
asserts the snackbar entry; `App.test` if it pins `<ProjectNotice />` in `App.tsx`.

## 6. Rules and ADR

`components.md` gains **"Secondary surfaces and feedback"** (ADR-0044), plus Prohibited lines:

- **R325** — Every overlay is exactly one kind: Dock (`BottomInputDock` only; daisyUI `dock` on
  `MobileTabBar` is navigation), Drawer, Bottom sheet, Modal, Popup; a new one picks a kind and its
  primitive.
- **R326** — `Modal` is always centered; `BottomSheet` is the only bottom-sheet primitive, used only
  by the mobile frame for what sits inline on desktop.
- **R327** — A preset library is a `PresetLibrary` side drawer on both frames, never a sheet; a quick
  in-place pick is a native `<select>`; a surface with a user library that can be deleted from has
  a drawer.
- **R328** — A popup is a daisyUI `dropdown` anchored to its trigger (`dropdown-open` when
  controlled), kept inside the viewport horizontally; no popover API or CSS anchor positioning while
  the floor lacks them; never inside a bottom sheet.
- **R329** — Feedback is toast, snackbar (one action) or banner (in flow, persistent); an alert
  inside a modal, drawer or card is content.
- **R330** — Toasts and snackbars go only through `showFeedback` (session-only slice, read via
  `useLiveStore`) into the one `FeedbackHost` per frame; no component renders the daisyUI `toast`
  class or a fixed alert.
- **R331** — The z-scale of §3; a new layer takes a listed step.

R320 is reworded to "a `BottomSheet`" and tagged ADR-0044; ADR-0041's Status line gains "R320
amended by 0044". `docs/decisions/0044-secondary-canvas-taxonomy.md` (template, Sources = this
spec) and its index row. CLAUDE.md, cross-cutting invariants:
`- Every overlay is one kind (dock, drawer, bottom sheet, modal, popup) and every transient message
goes through the one feedback host. <!-- R325 --> <!-- R330 --> → components.md, [0044](…)`

## 7. Commit plan

Each commit ends with `bun run verify` green and `bun run eslint` at zero warnings.

1. `docs(decisions): ADR-0044 secondary-canvas taxonomy` — ADR, index row, R325–R331, R320
   rewording, ADR-0041 status line, CLAUDE.md line.
2. `refactor(ui): BottomSheet out of Modal` — §5.1 and the §5.2 guard test.
3. `refactor(ui): QuickSavePopover anchored to its trigger` — §5.3; the dock popup to z-50.
4. `feat(ui): one feedback host for toasts` — slice (incl. dialog holds wired into
   `useNativeDialog`), host, slots, vibe/synth/chord migrations, Beat save toast, guards.
5. `refactor(song): loop Undo as a host snackbar` — §5.6 Undo.
6. `refactor(project): project notices as toasts and an in-flow banner` — §5.6 split.
7. `feat(beat): Beat preset library drawer` — §5.4.
8. `docs: sync design notes` — `docs/design.md` (the QuickSavePopover component line, the overlay
   paragraph), any doc naming `placement="bottom"` or `LoopUndoToast`.

## 8. Resolved questions

- **Q1** — `scale` stays in the mobile top bar (key/scale must stay visible while editing a loop);
  no `ScaleMenu` change (§5.2).
- **Q2** — The Beat drawer does not audition kits: no drum preset preview path exists.
