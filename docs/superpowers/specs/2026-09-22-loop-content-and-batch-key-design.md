# Loop content and batch key change — design

**Issues:** DEV-424 (PR 1, loop content + key change as a store operation) and DEV-427 (PR 2,
batch key change from Arrange). Epic DEV-433.
**Status:** Approved design (2026-09-22). This document records it, the facts it was checked
against, and the few places where the code differed from the brief.

Two PRs, stacked:

| PR | Branch | Issue | User-visible change |
|---|---|---|---|
| 1 | `refactor/dev-424-loop-content` | DEV-424 | None intended; two small, deliberate badge/copy differences listed in §1.7 |
| 2 | `feat/dev-427-batch-key-change` (stacked on PR 1) | DEV-427 | "Change key…" on Arrange |

---

## 0. Verified facts (checked against the code on `refactor/dev-424-loop-content`)

| # | Claim in the brief | Verdict | Evidence |
|---|---|---|---|
| F1 | `LOOP_FLAT_KEYS` is the one per-loop key list; `loopSync.ts` mirrors flat writes into `loops[active]` in the same `set()` | True | `src/store/loop.ts` `LOOP_FLAT_KEYS`; `src/store/loopSync.ts` `loopMirrorPartial` builds on `partial.loops ?? state.loops` |
| F2 | A type for "loop minus identity" is needed | Already exists as `LoopStatePatch = Omit<Loop, 'id' \| 'name' \| 'repeatCount' \| 'tempName'>` (`src/store/types.ts`), used by `loop.ts`, `loopCopy.ts`, `projectFormat.ts`. It is **not** bound to `LOOP_FLAT_KEYS` at compile time — `loopStatePatch` casts; only `loopCopy.test.ts` ties them. PR 1 renames it `LoopContent` and binds it. |
| F3 | `createDefaultLoop()` duplicates slice defaults (S7) | True | `loopSlice.ts` `createDefaultLoop` repeats `musicContextSlice` (`'A'`/`'Natural Minor'`), `chordsSlice`, `bassSlice`, `synthSlice`, the melody factory in `leadSlice.ts` (`createMelodySlice`), `padSlice` (via `defaultPadState`), `beatSlice` (via `defaultBeatState`), `fxSlice` (via `defaultFxState`) |
| F4 | Melodies follow a key change via `keyChangePatch` (root transpose under old type, then scale remap under new root) | True | `src/store/musicContextSlice.ts` `keyChangePatch`; vibes fold it in (`src/store/vibes.ts` `putVibeContext`) |
| F5 | Chords follow via a component effect → `applyKeyScaleChange`, gated by local `useState(true)` | True | `src/components/loop/chord/useChordView.ts` `useProgressionHarmonize`; rules in `src/components/loop/chord/progressionHarmonize.ts`; re-exported from `ChordView.tsx` |
| F6 | Chord transpose/snap never changes a chord's `bars` | True | `transposeProgression` and `snapProgressionToScale` (`src/utils/musicTheory.ts`) spread `...chord` and change only `root`/`quality`/`bassNote` (transpose moves `bassNote`; snap keeps it). So chord boundaries do not move and the custom chord/bass lanes need no re-clamp (today's `setChords` re-clamp is a no-op on this path) |
| F7 | Bass is chord-relative | True | `customBassPattern: BassStepChoice[]` where `BassStepChoice` ∈ `rest\|root\|third\|fifth\|seventh\|octave` (`src/data/bassPatterns.ts`); preset patterns are chord-relative tokens too. Nothing to move on a key change |
| F8 | Pad drone is a scale degree | True | `padDroneDegree: number` + `padDroneIntervals` (semitone set); resolved at play time by `resolveDroneNotes` → `getDiatonicChordForDegree(degree, scaleRoot, scaleType)` (`src/audio/playback/padPlayback.ts`). Pad chord mode follows `chords` |
| F9 | Custom chord rhythm is key-free | True | `customChordRhythm: boolean[]`, `customChordHoldSteps: number[]` |
| F10 | Drums are key-free | True | `beatParams`/`beatPattern`/`beatMix` carry no pitch class |
| F11 | Song advance reads `loops[]` at the boundary | True, and the write is synchronous | `songMode.ts` calls `loadLoop(id, { atBoundary })`; `loadLoop` reads `loops.find(id)` and `crossLoopSeam` → `withSourceTransitionTime(atBoundary, write)` runs the write immediately; only the *audio* boundary is in the future (≤ one lookahead) |
| F12 | Undo-toast precedent | True | `useLoopDeleteUndo` in `src/components/song/ArrangeView.tsx`: `useTimedToast`, `LOOP_UNDO_MS`, dismiss on `projectInstallCount` |
| **F13** | **"No user-visible change" when the effect is deleted** | **False in one path** | `applyLoopCopy` into the **active** loop with the `key` group but **not** `chord-progression` writes the new key through `loadLoop`, and the chords keep their array reference (`loops[active].chords` *is* the flat `chords` — the mirror stores the same reference). The effect sees "key changed, chords not replaced" and **harmonizes the chords** (when the toggle is on) and shows the badge. The same copy into a *non-active* loop harmonizes nothing. See §1.7 |
| **F14** | **Badge-clear semantics** | **Partly moot** | `shouldClearReharmonizeIndicator` needs a key delta only because an effect cannot see *who* replaced the chords. With explicit writers the cause is known; see §1.5 |
| F15 | The toggle also feeds `ChordPresetLibrary` (custom presets are snapped on apply only when it is on) | True — an extra consumer the brief did not list | `ChordPresetLibrary.tsx` `resolveCustomChords(entry.chords, spellingKey, autoReharmonize)`; ChordView passes `harmonize.autoReharmonize` through. Unchanged by this design; it now reads the store flag |
| F16 | `setScaleRoot`/`setScaleType` have one UI caller | True | `Header.tsx` only |

---

## PR 1 — DEV-424: `LoopContent`, one default source, key change as a store operation

### 1.1 `LoopContent`

In `src/store/loop.ts`, next to `LOOP_FLAT_KEYS`:

```ts
export type LoopFlatKey = (typeof LOOP_FLAT_KEYS)[number];
/** A loop's musical content: everything a loop holds except its slot identity. */
export type LoopContent = Pick<Loop, LoopFlatKey>;
```

- A compile-time exhaustiveness check in `loop.test.ts` (tests are type-checked by `bun run lint`) fails if a `Loop` field is
  neither identity (`id`, `name`, `tempName`, `repeatCount`) nor listed in `LOOP_FLAT_KEYS`:
  `Exclude<keyof Loop, LoopFlatKey | 'id' | 'name' | 'tempName' | 'repeatCount'>` must be `never`.
  `LOOP_FLAT_KEYS` also gets `satisfies readonly (keyof Loop)[]`. The two directions together
  make the list and the type one fact.
- `LoopStatePatch` is deleted from `types.ts`; its three users (`loop.ts`, `loopCopy.ts`,
  `projectFormat.ts`) switch to `LoopContent`. `loopStatePatch()` keeps its name and now returns
  `LoopContent`.
- The flat active fields and the `loopSync` mirror stay exactly as they are. Nothing moves into
  `loops[]`-only. The persisted payload and the `.solna` body are byte-identical (no version bump,
  R035).

### 1.2 One default source

- New leaf module `src/store/loopDefaults.ts` exports `createDefaultLoopContent(): LoopContent`,
  holding the literals that today sit in `createDefaultLoop`. It imports only leaf modules
  (`initialState`, `beatPresets`, `levelUnits`, `data/`, `utils/`, `audio/leadMelody`) — never a
  slice — so it cannot join the `loopSlice`/`store` import cycle that `loopCopySlice.ts`'s
  docblock warns about.
- `createDefaultLoop()` becomes `{ id: DEFAULT_LOOP_ID, name: '', tempName: 'untitled-1',
  repeatCount: 1, ...createDefaultLoopContent() }`.
- Every slice factory that writes per-loop literals takes a `defaults: LoopContent` parameter and
  reads its initial values from it: `createMusicContextSlice`, `createSynthSlice`,
  `createChordsSlice`, `createBassSlice`, `createMelodySlice` (Lead and FX via
  `createLeadSlice`/`createFxSlice`). `store.ts` calls `createDefaultLoopContent()` once and
  passes it to each. `createPadSlice`, `createBeatSlice` and `createFxSlice`'s synth fields
  already spread the shared factories (`defaultPadState`, `defaultBeatState`, `defaultFxState`)
  that `createDefaultLoopContent` spreads too — one source already, so they stay as they are.
  Non-content fields (cursors, clipboards, `soloTracks`, …) keep their literals.
- Pin: `loopStatePatch(useAppStore.getInitialState())` deep-equals
  `createDefaultLoopContent()`.
- The direct test callers of slice factories (`createChordsSlice`/`createBassSlice` in
  `store.test.ts`) pass `createDefaultLoopContent()`.

### 1.3 `changeKey` — pure, in the store layer

New file `src/store/keyChange.ts` (store, because the active loop and PR 2's batch both use it —
R276):

```ts
export type KeyChangeSource = Pick<LoopContent,
  'scaleRoot' | 'scaleType' | 'chords' | 'leadMelodySteps' | 'fxMelodySteps'>;
export interface KeyChangeTarget { root?: string; scaleType?: string }
export interface KeyChangeOptions { harmonizeChords: boolean }

export function changeKey(
  content: KeyChangeSource,
  target: KeyChangeTarget,
  opts: KeyChangeOptions,
): Partial<LoopContent>;
```

Behaviour:

- **Key fields:** `scaleRoot`/`scaleType` appear in the result iff the target names them (today's
  `keyChangePatch` contract).
- **Melodies:** exactly today's `keyChangePatch` — for every `MELODY_TRACKS` row, transpose by
  root under the OLD type, then remap by scale under the NEW root. The melody keys are always in
  the result (same as today).
- **Chords:** only when `opts.harmonizeChords`, the chord list is non-empty and the key actually
  changed: transpose (root changed) then snap (type changed) — `applyKeyScaleChange`'s order, which
  moves here as `harmonizeChordsToKey(chords, from, to): ChordItem[] | null` minus its
  `chordsReplaced` parameter (the caller now knows whether the chords are its own). `chords` is
  absent from the result otherwise.
- **Untouched, by construction:** bass (chord-relative, F7), pad drone (scale degree, F8), custom
  chord rhythm (F9), drums (F10), every synth/mix field. The result never contains them; a test
  asserts the result's key set.
- Input may be the flat `AppStore` or any `Loop` in `loops[]` — both satisfy `KeyChangeSource`.
- Roots are `ROOTS`-spelled on the way in and out (R064); `changeKey` never spells.
- `keyChangePatch` is deleted; its one other caller (vibes) moves to `changeKey`.

### 1.4 Setters and the session-only toggle

In `musicContextSlice.ts`, three new session-only fields beside the key (not in
`partializeAppState`'s allowlist, `PROJECT_CONTENT_KEYS` or `LOOP_FLAT_KEYS`, so never persisted
and never in a `.solna`):

| Field / action | Meaning |
|---|---|
| `autoReharmonize: boolean` (default `true`) | Whether a Header key change harmonizes the active loop's chords |
| `reharmonizedIndicator: boolean` (default `false`) | Drives the "Auto-Reharmonized to …" badge |
| `setAutoReharmonize(on)` | Writes the flag; turning it OFF also clears the indicator. Turning it ON rewrites nothing (today's rule) |
| `setReharmonizedIndicator(on)` | Used by Re-harmonize (true) and library apply (false) |

`setScaleRoot(root)` / `setScaleType(type)`:

```ts
set((s) => {
  const patch = changeKey(s, { root }, { harmonizeChords: s.autoReharmonize });
  return 'chords' in patch ? { ...patch, reharmonizedIndicator: true } : patch;
})
```

One `set()` now carries key, melodies and chords together (today the chords land in a second
write after a render). The mirror carries them into `loops[active]` in the same write.

`useProgressionHarmonize` (useChordView.ts) keeps its return shape (`autoReharmonize`,
`isAutoReharmonizedIndicator`, `toggleAutoReharmonize`, `reharmonizeNow`,
`clearReharmonizeBadge`) so `ChordView`/`ProgressionCard`/`ChordPresetLibrary` do not change, but:

- reads the two flags with one narrow selector each (R274);
- the auto-harmonize effect, its three refs and both `useState`s are deleted;
- `reharmonizeNow` is unchanged in behaviour: snap via `setChords`, `setReharmonizedIndicator(true)`,
  toast.

`progressionHarmonize.ts` and `ChordView.tsx`'s re-export are deleted.

### 1.5 When the badge clears

Today (`shouldClearReharmonizeIndicator`): cleared when the chords array was replaced AND the key
changed; also on toggle OFF and on library apply. The key-delta condition existed only because the
effect could not tell a vibe/loop switch (clear) from Re-harmonize or a manual edit (keep) — both
replace the array. With explicit writers the rule becomes "the badge clears when the active loop's
chords are replaced by something that is not a harmonization":

| Event | Today | PR 1 | Where |
|---|---|---|---|
| Header key change, toggle on, chords non-empty | set | set | setter (§1.4) |
| Header key change, toggle off | unchanged (already false) | unchanged | — |
| Toggle OFF | clear | clear | `setAutoReharmonize` |
| Re-harmonize button | set | set | `reharmonizeNow` |
| Manual add/delete/reorder/edit | keep | keep | nothing writes it |
| Library preset apply | clear | clear | `clearReharmonizeBadge` → store |
| Instant Vibe / dice | clear iff key differs | **clear always** | `putVibeContext` in the vibe's single `set()` |
| Loop switch (select, song advance, delete fallback, undo delete) | clear iff key differs | **clear always** | one subscription, below |
| Project install | clear iff key differs | **clear always** | same subscription |
| Loop copy into active loop with `chord-progression` | clear iff key differs | **clear always** | `applyLoopCopy` active branch |

The "iff key differs" residual is the one `shouldClearReharmonizeIndicator`'s own docblock lists
as a known residual (a same-key vibe leaves a stale badge). It disappears rather than being
preserved: nothing can observe the old condition any more, and a badge claiming chords were
harmonized after they were wholesale replaced is wrong in both keys.

The loop-switch/install clear is one subscription, `src/store/reharmonizeNav.ts`
(`useReharmonizeNavClear`, mounted in `App.tsx` beside `useSoloNavClear`), over `activeLoopId` and
`projectInstallCount` built with `createNavSignature`, writing only when the indicator is true —
the `soloNav.ts` pattern, for the same reason (`activeLoopId` has several writers, and song advance reaches it through `loadLoop`).

### 1.6 Vibes

`putVibeContext` replaces `keyChangePatch(...)` with
`changeKey(d.state, { root: vibe.scaleRoot, scaleType: vibe.scaleType }, { harmonizeChords: false })`
and adds `reharmonizedIndicator: false`. Vibe chords are built in the vibe's key and are written
by the vibe's own chord step, so harmonizing them would be the bug the `chordsReplaced` guard
prevented. Still one `set()` (`vibes.atomic.test.ts` keeps passing).

### 1.7 The two deliberate differences (flag for review)

1. **Key-only loop copy into the active loop (F13).** Today it harmonizes the active loop's chords
   as a side effect of the effect; PR 1 copies the key and leaves chords and melodies alone —
   the same result as the same copy into a non-active loop, and what R144 and `impliesKeyCopy`'s
   docblock say the `key` group means ("copies the key and transposes neither melody"; chords are
   derived content, the key is metadata). A test pins the new behaviour. If the user wants the old
   behaviour, `applyLoopCopy`'s active branch can call `changeKey` instead — a one-line follow-up,
   not a redesign.
2. **Badge clears on every wholesale replacement (§1.5)**, closing the documented residual.
3. **Toggle-off session shared-chord transpose.**
   - Old corner case: a fresh session, then toggle off, change the key, toggle on, then New
     Project. The old effect transposed the new project's shared `INITIAL_CHORDS` from the old
     key.
   - The new code does not do this. It is a bug fix.

### 1.8 Data flow after PR 1

```
Header select ─► setScaleRoot/Type ─► changeKey(flat, target, {harmonizeChords: autoReharmonize})
                                   └─► one set(): key + melodies [+ chords + indicator]
                                        └─► loopSync mirror → loops[active] (same set)
                                        └─► engineSync / grids (subscriptions, unchanged)
applyVibe ─► draft.put(changeKey(..., {harmonizeChords:false}), indicator:false) ─► one set()
```

### 1.9 Tests (PR 1)

- `src/store/keyChange.test.ts` (new):
  - root-only: melodies transposed as today; chords transposed, not snapped (existing case:
    `Amin,Fmaj,Cmaj,Gmaj` → `Cmin,G#maj,D#maj,A#maj`);
  - type-only: remapped/snapped (existing `Amaj,Emaj,Bmin,F#min` case);
  - both: transpose then snap, order pinned (existing `Cmaj,Gmaj,Dmin,Amin` case, and not the
    snap-first result);
  - `harmonizeChords: false` → no `chords` key; empty chords → no `chords` key; unchanged key →
    no `chords` key;
  - result key set ⊆ key + melody + chords (bass/pad/drums/synth untouched);
  - `bars` and `bassNote` preserved; roots are members of `ROOTS`;
  - **`changeKey` on a non-active `Loop` from `loops[]`** gives the same result as on flat state
    holding the same content, and does not read `activeLoopId`.
- `musicContextSlice.test.ts`: existing melody cases re-pointed at `changeKey`; new cases —
  toggle on: chords harmonized + indicator true + `loops[active]` mirrored in the same
  notification (count with `subscribe`); toggle off: chords identical by reference, indicator
  false; `setAutoReharmonize(false)` clears the indicator; `setAutoReharmonize(true)` leaves chords
  untouched; `setScaleRoot('C')` then `setScaleType('Major')` equals the combined `changeKey`.
- `vibes.test.ts`: applying a vibe whose key differs leaves the vibe's chords exactly as resolved
  and clears the indicator.
- `reharmonizeNav.test.ts` (new): clears on `activeLoopId` change and on `projectInstallCount`
  change; no write when already false.
- `loopCopySlice.test.ts`: key-only copy into the active loop leaves chords and melodies unchanged
  (F13); chord-progression copy into the active loop clears the indicator.
- `store.test.ts`: initial flat content equals `createDefaultLoopContent()`; the session flags are
  absent from `partializeAppState`.
- `ChordView.test.tsx`: the `applyKeyScaleChange`/`shouldClearReharmonizeIndicator` blocks move to
  `keyChange.test.ts` (as above) or are deleted with their function; the "label reflects the live
  flag" render test stays.

### 1.10 Doc sync (PR 1)

- **New ADR-0032** "Key change is a pure loop-content operation; chord harmonize lives in the
  store" — context (effect-only chord follow, F5; blocker for batch), decision (§1.3–1.6), the
  rejected alternatives (keep the effect and add a second store path; move the active loop into
  `loops[]` only; persist the toggle), consequences (F13, §1.5), rules. Index row in
  `docs/decisions/README.md`.
- **`.claude/rules/music-domain.md`**: add `src/store/keyChange.ts`, `src/store/reharmonizeNav.ts`
  and `src/store/musicContextSlice.ts` to `paths`; new rules (next free ids, currently R279+):
  chord harmonize on a key change runs only in `changeKey` (never in a component effect);
  `autoReharmonize`/`reharmonizedIndicator` are session-only; the badge-clear table's writers.
  `## Prohibited` entries for each.
- **`.claude/rules/melody-tracks.md`**: R143 reworded — `changeKey` (`store/keyChange.ts`) is the
  whole write; a vibe folds it into its single `set()` with `harmonizeChords: false`; tag
  ADR-0032 beside ADR-0013. ADR-0013 itself is not rewritten (README rule); its `keyChangePatch`
  mention is a renamed-symbol factual correction and may be edited in place.
- **`.claude/rules/loops-and-solo.md`**: add `src/store/loop.ts`, `src/store/loopDefaults.ts`,
  `src/store/loopSync.ts` to `paths`; new "Loop content" section: `LoopContent` is bound to
  `LOOP_FLAT_KEYS` both ways; identity is `id`/`name`/`tempName`/`repeatCount`;
  `createDefaultLoopContent()` is the only place a per-loop default is written; slices receive it.
- **`CLAUDE.md`**: the rules-table "Covers" cells for `loops-and-solo.md` (add "loop content and
  defaults") and `music-domain.md` (add "key change"). No other line changes.
- **`.claude/skills/music-theory/SKILL.md`**: the `applyKeyScaleChange` / `autoReharmonize` effect
  paragraph → `changeKey` + store flag.
- **`docs/architecture/structure/02-store.md`**: key-list paragraph (now compile-time bound),
  §4 item 2 (S7) updated; **`structure/README.md`**: S7 marked fixed on
  `refactor/dev-424-loop-content`, noting `sanitizeLoops` still validates field by field on
  purpose and `LOOP_COPY_GROUPS` stays a test-pinned partition; **`01-ui.md`**: drop the
  `ChordView` re-export line; **`docs/design.md`** chord-view paragraph if it names the effect.
- No version numbers, file counts or line numbers (R001).

---

## PR 2 — DEV-427: batch key change from Arrange

Branch `feat/dev-427-batch-key-change`, created from PR 1's tip.

### 2.1 Pure operation

New file `src/store/loopKeyChange.ts`:

```ts
export type BatchKeyTarget =
  | { mode: 'set'; root: string; scaleType: string }
  | { mode: 'transpose'; semitones: number };

export type KeyChangeField = 'scaleRoot' | 'scaleType' | 'chords' | 'leadMelodySteps' | 'fxMelodySteps';
export interface LoopKeySnapshot { loopId: string; content: Pick<LoopContent, KeyChangeField> }

export function transposeRoot(root: string, semitones: number): string | null; // ROOTS index shift, mod 12
export function targetKeyFor(loop: Pick<Loop, 'scaleRoot' | 'scaleType'>, target: BatchKeyTarget):
  { root: string; scaleType: string } | null;
export function changeKeyAcrossLoops(
  loops: readonly Loop[],
  ids: readonly string[],
  target: BatchKeyTarget,
  opts: KeyChangeOptions,
): { loops: Loop[]; changed: LoopKeySnapshot[] };
```

- **Set:** every selected loop → `target.root` + `target.scaleType`.
- **Transpose:** root shifted by `semitones` (any integer, normalised mod 12), each loop keeps its
  own `scaleType`. `transposeRoot` indexes `ROOTS` from `@/musicCore`; an unknown root returns
  `null` and that loop is skipped (sanitize guarantees `ROOTS` spelling, so this is defensive).
- A loop whose target equals its current key, or whose id is absent, is left untouched and not
  in `changed`. Untouched loops keep their object reference.
- For each changed loop: `{ ...loop, ...changeKey(loop, target, opts) }`.
- `changed` holds each changed loop's PRE-change key fields — the undo snapshot.

**Snapshot scope (narrower than the brief's "affected loops' LoopContent"):** only the fields
`changeKey` can write. Restoring the whole content would also revert unrelated edits made between
the batch and Undo (a knob, a drum step). Same intent, no collateral.

### 2.2 Store actions (`src/store/loopKeyChangeSlice.ts`, part of `LoopSlice`)

```ts
applyLoopKeyChange(ids, target, opts): LoopKeyChangeUndo | null
undoLoopKeyChange(undo: LoopKeyChangeUndo): void
// LoopKeyChangeUndo = { snapshots: LoopKeySnapshot[] }
```

`applyLoopKeyChange` — ONE `set()`:

- `changeKeyAcrossLoops(state.loops, ids, target, opts)`;
- non-active changed loops land in `loops`;
- if the active loop changed, the partial also carries its new key fields as flat values (so
  engineSync and the grids follow immediately — no `crossLoopSeam`, same as a Header change), plus
  `reharmonizedIndicator: true` when its chords were harmonized. The mirror (`loopMirrorPartial`)
  builds on `partial.loops` and rewrites the active entry from the post-write flat state —
  identical values, so the two cannot disagree;
- returns `null` when nothing changed (no write, no toast).

`undoLoopKeyChange` — ONE `set()`: for every snapshot whose loop still exists, write its fields
back (active loop via flat fields, others via `loops`); loops deleted in between are skipped;
if the active loop was restored, `reharmonizedIndicator: false`.

Both are session-only: nothing about the undo is persisted.

### 2.3 Song playback near a boundary

F11 shows the switch write is synchronous at `loadLoop` call time. So:

- batch applied **before** the song-mode `loadLoop(next, { atBoundary })` call → the next loop's
  new key is in `loops[]` and is installed at the boundary;
- batch applied **after** that call → the next loop is already active and receives the change
  through the flat path, like a Header change. Voices already scheduled inside the lookahead
  window sound in the old key, as they do for a Header change today.

No extra coordination is needed; a test pins both orders.

### 2.4 UI

- **Button:** `ArrangeHeader` gains a second action, `btn-arrange-change-key` ("Change key…",
  `btn btn-sm btn-ghost gap-1.5` beside Add Loop), opening the dialog.
- **Dialog:** `src/components/song/KeyChangeDialog.tsx` (layout only, children above root —
  R265/R267) + `src/components/song/useKeyChangeDialog.ts` (named `UseKeyChangeDialog` return type
  — R266), on the shared `ui/Modal`. Contents:
  - mode: two radio inputs styled as a button group — `join` > `input.join-item.btn.btn-sm`
    (`type="radio"`, `aria-label` "Set key" / "Transpose"), verified in daisyUI v5 docs;
  - Set: root `select select-sm` over `KEY_OPTIONS` (spelled label, `ROOTS` value — R065/R066) and
    scale `select select-sm` over `SCALES`; defaults to the active loop's key;
  - Transpose: semitone `select select-sm` from −11 to +11 (0 excluded), default +2;
  - "Harmonize chords" `checkbox checkbox-sm checkbox-primary`, default on;
  - loop checklist in a `fieldset` (`fieldset-legend` "Loops"): one `checkbox checkbox-sm` per
    loop, all ticked, label = `loopLabel(loop)` and a preview `Am → Cm` (`formatKeyLabel`, display
    spelling), or "unchanged" when the target equals the loop's key;
  - `modal-action`: Cancel, Apply (disabled when no selected loop would change).
- **Pure helpers** exported from `useKeyChangeDialog.ts` and tested directly:
  `keyChangePreview(loops, selectedIds, target)` → rows `{ id, label, from, to, changes }`;
  `canApplyKeyChange(rows)`.
- **Store reads** (R274/R275): the dialog mounts only while open (as `LoopCopyDialog` does) and
  takes `loops` and `activeLoopId` as props from `ArrangeView`, which already selects each with
  its own narrow selector — so the dialog renders under `renderToString` with test data (R257).
- **Undo:** `src/components/song/useLoopKeyChangeUndo.ts` mirrors `useLoopDeleteUndo`:
  `useTimedToast<LoopKeyChangeUndo>()`, `LOOP_UNDO_MS`, dismissed on `projectInstallCount`
  (loop ids collide across projects — R155's reason), single level (a new batch replaces the
  pending undo). Toast text: "Key changed on N loop(s)". Undo calls `undoLoopKeyChange` then
  dismisses.
- **Toast rendering:** `LoopUndoToast` becomes the alert only, with props
  `{ message, buttonId, onUndo }`; `ArrangeView` wraps whichever alerts are pending in one
  `toast toast-bottom toast-center` container so a delete-undo and a key-undo stack instead of
  overlapping. Delete keeps `btn-undo-loop-delete` and "… deleted"; key change uses
  `btn-undo-key-change`.

### 2.5 Edge cases

| Case | Behaviour |
|---|---|
| No loop selected, or every selected loop already in its target key | Apply disabled; action returns `null` if called anyway |
| Transpose by a multiple of 12 | Normalised to 0 → nothing changes |
| Loop deleted while dialog open | Its id is absent → skipped |
| Loop deleted between apply and Undo | Its snapshot is skipped |
| Project install while toast pending | Toast dismissed; undo impossible |
| Active loop in the batch while recording armed | Same as a Header key change (arm untouched) |
| Harmonize off | Chords untouched in every loop; melodies still follow (R143) |
| Empty chord list | No chord change (as `changeKey`) |
| Second batch before Undo | Replaces the pending undo (single level) |

### 2.6 Tests (PR 2)

- `loopKeyChange.test.ts`: `transposeRoot` wrap both ways and `ROOTS` spelling; `targetKeyFor`
  both modes; `changeKeyAcrossLoops` changes only selected ids, keeps others by reference, skips
  unknown ids and no-op targets, respects `harmonizeChords`, snapshots pre-change fields.
- `loopKeyChangeSlice.test.ts`: one notification per apply and per undo;
  non-active loops updated in `loops[]`, flat untouched; active loop updated flat and
  `loops[active]` equal to flat; indicator set only when the active loop's chords changed; undo
  restores, skips deleted loops, clears the indicator for the active loop.
- `loadLoop.test.ts`: batch on a non-active loop then `loadLoop(id, { atBoundary })` installs the
  new key; `loadLoop` at boundary then batch lands through the flat path.
- `useKeyChangeDialog.test.ts`: preview rows and labels, "unchanged", `canApplyKeyChange`.
- `KeyChangeDialog.test.tsx` / `ArrangeView.test.tsx` (`renderToString`, remembering R257): button
  id present; dialog markup (`join`, radio `join-item btn`, checkbox classes, one row per loop).
- `LoopUndoToast.test.tsx`: message and button id props.

### 2.7 Doc sync (PR 2)

- **New ADR-0033** "Batch key change across loops" — set-in-one-write with the active loop on the
  flat path, Set vs Transpose, snapshot narrowed to key fields, session-only single-level undo,
  rejected alternatives (seam the active loop; persist undo; whole-content snapshot). Index row.
- **`.claude/rules/loops-and-solo.md`**: rules for the batch (one `set()`; active via flat path,
  never `crossLoopSeam`; undo snapshot = key fields; skip deleted; dismiss on project install);
  Prohibited entries.
- **`CLAUDE.md`**: `loops-and-solo.md` "Covers" cell adds "batch key change".
- **`docs/architecture/feature-overview.md`**: Arrange row adds "change key of several loops
  (Set/Transpose) with Undo"; **`structure/01-ui.md`**: song folder entries for the dialog, hook
  and undo hook; **`structure/02-store.md`**: `loopKeyChange.ts` and the two actions.

---

## Out of scope

- Moving the active loop into `loops[]` only / removing the flat fields.
- Persisting `autoReharmonize` or any undo.
- Multi-level undo or redo.
- Spelling-aware roots (flats) anywhere in stored data.
- Harmonizing chords on a key-only loop copy (F13 follow-up only if the user asks).
- `sanitizeLoops` field-by-field validation and `LOOP_COPY_GROUPS` (remain as they are; S7 notes
  why).
- Changing tempo, meter or anything besides the key in the batch dialog.
