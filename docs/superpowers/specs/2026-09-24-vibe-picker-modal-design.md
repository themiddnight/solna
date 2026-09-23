# Vibe picker modal — design

**Issue:** none.
**Branch:** `feat/vibe-picker-modal`.
**Status:** Design, every decision approved by the user (2026-09-24); this spec makes them concrete.

**User-visible change:** the Instant Vibes strip above the transport is gone. Vibes open from a
**Vibes** button (desktop Header; ☰ menu sheet on a phone) into a centred modal where a vibe is
auditioned on the current loop and only kept on **Use**; **Cancel** puts the loop back exactly.

---

## 0. Verified facts (this branch, @aa838989)

| # | Claim | Evidence |
|---|---|---|
| F1 | The strip is `{!isSongLayer(activeTab) && <InstantVibesBar />}`, in the body both frames share | `shell/ShellBody.tsx`; used by `DesktopShell`, `MobileShell` |
| F2 | A chip click runs `applyVibeToStore`: `hardStopAll` → `audioEngine.stopSource(s, VIBE_SWAP_RELEASE)` for each of `ACCOMPANIMENT_SOURCES` (chord, bass, pad) → one `setState(withMirror(vibeContentPatch(s, vibe, voices)))` → `commitRestartAfterStop`. No undo | `store/vibes.ts`, `audio/playback/playbackEngine.ts` |
| F3 | `vibeContentPatch(state, vibe: ResolvedVibe, voices: VibeVoices)` needs the resolved vibe **and** the five resolved voices; `applyVibeToStore` builds `voices` inline | `store/vibes.ts` |
| F4 | The patch writes `selectedVibeId` and the active loop's temp name through `loopTempNamePatch`; `withMirror` folds in the `loops[]` mirror | `store/vibes.ts` (`putVibeContext`, `withMirror`) |
| F5 | `playAll()` sets the **`song`** scope. The loop layer's Play is `soloLoop(activeLoopId)` (`loop` scope) | `store/transportSlice.ts`, `components/useTransportBar.ts` |
| F6 | `commitRestartAfterStop` has one other caller, `loadLoop.ts`, so it stays | `git grep commitRestartAfterStop` |
| F7 | `components/vibeActions.ts` (`selectVibe`, `rerollVibe`) is reached only through the strip's cached dynamic `import()`, prefetched on hover/focus and after idle; `rerollVibe` is the feature's one `Math.random` call | `InstantVibesBar.tsx`, `vibeActions.ts` |
| F8 | `resolveVibeVariation(vibe, { scaleRoot, chordRhythmId, bassPatternId }, draw)` → `{ spec, summary }`; `formatVariationSummary(summary)` → `{ headline, detail }` | `store/vibeVariation.ts` |
| F9 | `HEADER_TOOLS` rows are `{ id, Component, layers }`; `HeaderToolId` is a closed union; `MOBILE_BAR_TOOL_IDS` = loop-selector, scale, project-name, so any other tool reaches the menu sheet as `variant="row"` | `header/headerTools.ts`, `shell/useMobileTopBar.ts` |
| F10 | `Modal` has no footer prop; its children follow the header inside one `modal-box` (`overflow-y: auto`), and `boxClassName` adds classes to that box (`LoopDetailSheet` already passes `flex flex-col`) | `ui/Modal.tsx`, `song/LoopDetailSheet.tsx` |
| F11 | Nested modal dialogs close top-first on Escape natively; every modal `Modal` holds feedback timers while open (R329) | `ui/useNativeDialog.ts` |
| F12 | `persistStorage` is module-private in `store.ts` (only `flushPersistedWrites` is exported); `projectAutosave` is exported; `flushBeforeHide()` flushes both | `store/store.ts` |
| F13 | `CoalescedStorage` = `StateStorage` + `flush`/`discard`/`pendingNames`; `ProjectAutosave` = `arm`/`disarm`/`flush`/`isScheduled`, `armed` gating `schedule` and `write` | `utils/coalescedStorage.ts`, `store/projectAutosave.ts` |
| F14 | `partializeAppState` is an allowlist, so a ui-slice key it does not list is session-only | `store/store.ts` |
| F15 | QWERTY input has two `window` keydown listeners in `useInputDeck.ts`: the note listener (`useQwertyNoteListeners`, `isTypingTarget` guard) and the drum-pad listener; blur/`visibilitychange` release held notes via `releaseAllHeldNotes` (R202) | `components/useInputDeck.ts` |
| F16 | MIDI note-on/off plays the synth live; CC runs `applyCcMapping`, which writes mapped parameters | `store/midiInput.ts` (`handleMessage`) |
| F17 | 8 vibes | `data/vibes.ts` |
| F18 | Other live references to the strip: R095 and the `paths:` of `vibes-and-grids.md`, `.claude/skills/instant-vibes/SKILL.md` ("chips in the top bar"), ADR-0009, `docs/design.md` §items 2/13, `docs/architecture/feature-overview.md`, `docs/architecture/structure/{README,01-ui}.md`, CLAUDE.md's skills line | `git grep InstantVibesBar vibeActions` |
| F19 | `ui/useTimedToast.ts`'s exported `scheduleTimeout` has no non-test caller besides the strip | `git grep scheduleTimeout` |
| F20 | Latest rule R332, latest ADR 0044 | grep, ADR index |

The 41 px reclaimed is the user's measurement of the strip; not re-measured here.

## 1. Goal

Reclaim the strip's vertical space on both frames and make applying a vibe deliberate: audition
first, commit on **Use**, and leave the loop byte-identical on **Cancel**. Vibes are used rarely,
mostly at project start, so one tap more to reach them is the right trade.

## 2. Non-goals

- No Undo for a used vibe, no "apply to a new loop", no change to what a vibe writes.
- No change to vibe data, dice pools or resolvers (R095–R119 untouched in substance).
- No change to `Modal`, `BottomSheet`, R325/R326 or the feedback host.

## 3. Entry point

- New row `{ id: 'vibes', Component: VibesButton, layers: LOOP }` in `HEADER_TOOLS`, directly after
  `loop-selector`; `'vibes'` joins `HeaderToolId`. Not added to `MOBILE_BAR_TOOL_IDS`.
- `VibesButton` (`ToolVariantProps`): `bar` = icon (`Sparkles`) + "Vibes" button in the Header;
  `row` = `MenuRowButton` in the menu sheet (R317, R319).
- `VibesButton` owns `open` in `useState` and renders `VibePickerModal` as its child — on mobile
  a nested dialog inside the menu sheet's dialog (R320).
- Hover/focus on the button prefetches the lazy preview module (§5.4).
- On mobile, **Use**'s toast is held until the menu sheet is dismissed (R329) — accepted.

## 4. Surface

`Modal`, centred on both frames, `size="lg"`, title "Vibes".

- `boxClassName="flex flex-col overflow-hidden"` makes the box a column: header (Modal's own),
  then a grid region `min-h-0 flex-1 overflow-y-auto`, then a footer region `shrink-0`. The header
  and footer stay pinned while the list scrolls. **No `footer` prop is added** — F10 shows the box
  already accepts the layout.
- Grid: one card per `VIBES` entry — emoji, name, `BPM · key` (`formatKeyLabel`); `grid-cols-2`,
  `md:grid-cols-4`. The previewing card is marked (`aria-pressed`) and alone shows the 🎲 reroll
  button (`Dices`).
- Footer: a preview summary line — `name · key · BPM`, plus `headline`/`detail` from
  `formatVariationSummary` after a reroll — then **[Play/Stop]** on the left, **[Cancel] [Use]** on
  the right. **Use** is disabled until something has been previewed. Before any preview the summary
  reads "Pick a vibe to hear it on this loop."
- The reroll summary lives in the footer, never a toast (a toast would be held under the modal).

## 5. Preview

### 5.1 Commands — `src/store/vibePreview.ts`

| Command | Effect, in order |
|---|---|
| `beginVibePreview()` | `flushBeforeHide()` (disk = pre-preview) → hold both writers (§6) → `setNoteInputSuspended(true)` (§7) → `hardStopAll()` → cut `ACCOMPANIMENT_SOURCES` → return `captureVibeTargets(state)` |
| `previewVibe(spec)` | `resolveVibe(spec)` + `resolveVibeVoices(vibe)` **before** touching state → `hardStopAll()` → cut → one `setState(withMirror(vibeContentPatch(…)))` → `soloLoop(activeLoopId)`. Always plays |
| `rerollPreview(base)` | `resolveVibeVariation(base, live { scaleRoot, chordRhythmId, bassPatternId }, createDraw(Math.random))` → `previewVibe(spec)`; returns `{ spec, summary }`. The feature's one `Math.random` moves here |
| `playPreview()` / `stopPreview()` | `soloLoop(activeLoopId)` / `hardStopAll()` + cut, on what is in the store now; never re-applies, so a rerolled variant survives |
| `commitVibePreview()` (not `useVibe`: a `use` prefix reads as a hook to `react-hooks`) | `hardStopAll()` + cut → release both holds → `setNoteInputSuspended(false)` |
| `cancelVibePreview(snapshot)` | `hardStopAll()` + cut → one `setState(withMirror(snapshot))` → release both holds → `setNoteInputSuspended(false)` |

- Preview starts with `soloLoop(activeLoopId)`, the loop layer's own starter (F5), **not**
  `playAll()`, which would put the transport under the `song` scope from a loop-layer surface.
- Opening always stops the main transport; closing always stops preview. The user presses Play
  afterwards.
- `applyVibeToStore` and its restart-what-was-running exist only for the chip click and are
  deleted. The inline voice resolution becomes an exported `resolveVibeVoices(vibe)` in
  `vibes.ts`; `withMirror` is exported for `vibePreview.ts`. Comments citing `applyVibeToStore` or
  its restart are rewritten in `loadLoop.ts`, `playbackScope.ts`, `stopAndRestart.ts`,
  `vibeVariation.ts`, `musicContextSlice.ts`, `audio/drumGrids.ts`,
  `data/effectChains.ts` and `vibes.ts`'s header.

### 5.2 Snapshot — `captureVibeTargets(state)` in `store/vibes.ts`

Returns, as a `Partial<AppStore>`, the current value of every key any vibe patch may write, plus
`loops` (the temp name and mirror) and `selectedVibeId`. Values are captured by reference; the
restore relies on R210 (persisted values are replaced, never mutated). **Invariant test:**
`keys(withMirror(s, vibeContentPatch(s, v, voices))) ⊆ keys(captureVibeTargets(s))` for all 8
`VIBES` and a seeded sample of rerolls per vibe — a new key written by a vibe fails the test
before it can escape Cancel.

### 5.3 Component — `useVibePicker.ts`

Holds in component state: `snapshot` (from `beginVibePreview`, taken when `open` turns true),
`previewed: { base: VibeSpec; spec: VibeSpec; summary?: VariationSummary } | null`, `playing`
(mirrors the transport aggregate via a narrow selector), `rolling` (dice spin). Exposes
`pick(vibe)`, `reroll()`, `togglePlay()`, `use()`, `cancel()`. **Use** additionally shows
`showFeedback({ key: 'vibe', message: 'Loaded <name> (<bpm> BPM · Key <key>)', tone: 'success' })`
(and the reroll headline as its detail when the previewed spec came from the dice). Cancel, Esc,
✕ and the backdrop all route through `Modal`'s `onClose` → `cancel()`. Unmount while open cancels.

### 5.4 Lazy boundary

`VibePickerModal` imports `VIBES` eagerly (`data/vibes.ts` has no runtime imports — R095 holds).
`vibePreview.ts` (which reaches the engine and the four resolvers) is loaded by a cached
`import('@/store/vibePreview')` in `useVibePicker.ts`, prefetched on the button's hover/focus
and awaited once on open. `components/vibeActions.ts` is deleted — its two actions are the table
above.

## 6. Persistence hold

Separate from `projectAutosave`'s boot `arm`/`disarm`.

- `CoalescedStorage` gains `hold()` / `release()`. While held, `setItem` records the pending value
  but schedules nothing, and `flush()` is a no-op (so `pagehide`/`visibilitychange` write nothing).
  `release()` schedules one flush if anything is pending.
- `ProjectAutosave` gains `hold()` / `release()`. While held, `schedule` marks pending without
  scheduling and `flush()` is a no-op; `release()` schedules one write if a change was marked.
- `store.ts` exports `holdPersistedWrites()` / `releasePersistedWrites()` next to
  `flushPersistedWrites` (holding `persistStorage` and `projectAutosave` together); `persistStorage`
  stays private.
- Tab closed mid-preview → localStorage and IndexedDB still hold the pre-preview state — the same
  outcome as Cancel. After Cancel the release writes state equal to the pre-preview one (harmless).

## 7. Note input suspended

- ui slice: `noteInputSuspended: boolean` + `setNoteInputSuspended`, session-only (absent from
  `partializeAppState`), written only on open/close, so R016 holds.
- Gates at each source's entry, beside the existing guards: the QWERTY note keydown in
  `useQwertyNoteListeners` and the drum-pad keydown listener (both in `useInputDeck.ts`, read via
  `useAppStore.getState()` in the handler), and `handleMessage` in `store/midiInput.ts`: note-on
  **and CC** are dropped while suspended (a CC would edit the previewed state that Cancel wipes);
  note-off passes, which is harmless.
- On open, every held note is released the way the blur/`visibilitychange` backstop does
  (`releaseAllHeldNotes`, R202): `useInputDeck.ts` subscribes to the flag's rising edge. Record-arm
  therefore cannot record during preview.

## 8. Files

- **New** `src/components/vibes/`: `VibesButton.tsx`, `VibePickerModal.tsx`, `useVibePicker.ts`
  (+ tests) — one feature, colocated (R276). **New** `src/store/vibePreview.ts` (+ test).
- **Changed:** `header/headerTools.ts`, `shell/ShellBody.tsx` (strip removed), `store/vibes.ts`,
  `store/uiSlice.ts`, `store/store.ts`, `store/midiInput.ts`, `components/useInputDeck.ts`,
  `utils/coalescedStorage.ts`, `store/projectAutosave.ts`, and the comment-only files of §5.1.
- **Deleted:** `components/InstantVibesBar.tsx`, `InstantVibesBar.test.tsx`, `vibeActions.ts`.
  `scheduleTimeout` is reused for the dice spin; if Knip still flags it, it is un-exported.
- **Tests updated:** `shell/shells.test.tsx`, `store/vibes.test.ts`, `store/vibes.atomic.test.ts`
  (rewritten against `previewVibe` instead of `applyVibeToStore`).

## 9. Rules, ADR, docs

`docs/decisions/0045-vibe-picker-preview.md` (template; Sources = this spec): strip removal, the
Modal choice, snapshot/restore + persistence hold, note-input suspension; rejected alternatives in
§11. Index row in `docs/decisions/README.md`. New rules, each with a Prohibited line and ADR-0045:

- **R333** `components.md` — Vibes are reached only through the `vibes` `HEADER_TOOLS` row; no
  always-visible vibe strip.
- **R334** `components.md` — The vibe picker is a centred `Modal` on both frames: scrollable card
  grid between a pinned header and a pinned footer; **Use** disabled until a preview.
- **R335** `persistence.md` — Only the vibe preview holds persisted writes; opening flushes first;
  nothing is written while held, `pagehide`/hidden included; release writes once.
- **R336** `note-input.md` — `noteInputSuspended` gates QWERTY notes, QWERTY drum pads and MIDI
  note-on/CC at their entry; setting it releases every held note.
- **R337** `playback.md` — Vibe preview is stop → cut → one write → `soloLoop(activeLoopId)`;
  opening and closing the picker stop the transport; no restart-after-stop for vibes.
- **R338** `vibes-and-grids.md` — Cancel restores `captureVibeTargets` in one write; every key a
  vibe patch writes is in the snapshot (invariant test).

Also: R095's text and the `paths:` of `vibes-and-grids.md` move from `InstantVibesBar`/
`vibeActions` to `components/vibes/*` and `store/vibePreview.ts`; ADR-0009 gains an "amended by
0045" status note. The `instant-vibes` skill (description, intro, the chip-styling and eager-import
paragraphs) describes the picker. CLAUDE.md's skills line reads "the vibe picker and the dice".
`docs/design.md`, `docs/architecture/feature-overview.md` and `docs/architecture/structure/
{README,01-ui}.md` drop the strip. Historical plans are left as written. No version numbers.

## 10. Testing

- `store/vibePreview.test.ts`: open → preview every vibe and one reroll → Cancel deep-equals the
  pre-open state; Use keeps the last preview; transport state and scope after each command (open
  stopped/`none`, preview playing/`loop`, Stop stopped, Use and Cancel stopped); Play after a reroll
  does not re-apply.
- Snapshot coverage invariant (§5.2).
- `coalescedStorage` / `projectAutosave`: no write while held; `flush()` (pagehide) is a no-op while
  held; release writes once; a write pending before open is flushed by `beginVibePreview`.
- Note input: MIDI note-on and CC dropped while suspended, note-off passes; QWERTY note and drum
  keys silent; held notes released at open.
- `renderToString`: `VibesButton` `bar` and `row`; `VibePickerModal` with **Use** disabled before a
  preview. Seed state the way R257 (`testing.md`) requires.
- Manual browser check: desktop and 375 px mobile — open from Header and from the menu sheet,
  preview, reroll, Stop/Play, Cancel restores, Use toast (held on mobile until the sheet closes),
  list scrolls with header/footer pinned, Esc closes only the picker.
- Gate: `bun run verify`; `bun run eslint` zero errors and zero warnings; both Knip scans zero.

## 11. Rejected alternatives

- **Modal `BottomSheet` on mobile** — R326 reserves it for what sits inline on desktop.
- **Non-modal surface beside the real `TransportBar`** — the user could edit the loop mid-preview
  and Cancel's restore would wipe it; would also need R326 widened.
- **Side drawer without overlay** — invents a position outside R325.
- **Always apply to a new loop** — clutters `loops[]` for an action mostly used on an empty project.
- **Overwrite + Undo** — keeps the accidental apply and adds a snapshot anyway; no audition.
- **Overwrite only when the loop is empty** — silently does nothing, or needs a second path, once
  content exists.

## 12. Commit plan

Each commit ends with `bun run verify` green and `bun run eslint` at zero warnings.

1. `docs(decisions): ADR-0045 vibe picker preview` — ADR, index row, R333–R338, R095, skill,
   CLAUDE.md line.
2. `feat(store): persistence hold` — §6 and its tests.
3. `feat(input): note-input suspension` — §7 and its tests.
4. `feat(vibes): preview commands and snapshot` — §5.1–5.2, `vibes.ts` changes, comment updates.
5. `feat(vibes): vibe picker modal replaces the strip` — §3–4, §5.3–5.4, deletions, shell tests.
6. `docs: sync architecture notes` — `design.md`, `docs/architecture/*`.
