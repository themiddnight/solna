# Loop / Song Layers (SP4) — Design

## Goal

Restructure Solna's UI from a flat five-tab workspace into two explicit layers — a **loop
layer** (edit the active loop: synth / chords / drums) and a **song layer** (arrange the loop
sequence + master FX) — and, in the same change, settle the terminology: the SP3 "region"
becomes "loop", and the arrangement layer is "song" (never "main"). The data model is
unchanged apart from the rename; the logic already *is* two-layer (SP3 introduced
`isSongTab` and song mode). This is a UI/terminology/navigation restructure, not a new
music model.

## Terminology

- **Loop** — the SP3 *region*, renamed. A full musical snapshot (scales, three synth voices,
  chords, bass, lead melody, drum grid, kit, per-voice mix/mute) that is the unit of an
  arrangement. A loop is selected to edit via a dropdown, or referenced by `loopId`.
- **Active loop** — the loop currently being edited; its content lives in the existing flat
  slices (the editing surface).
- **Loop layer** — the `/loop` page: the three editing tabs (Synth / Chords / Drums) plus the
  loop-selector dropdown.
- **Song layer** — the `/song` page: the Arrange tab plus the master FX (Effects) tab.
- **Loop mode** — playback while the active loop is the subject: the active loop repeats.
- **Song mode** — playback while the song layer is active (Arrange or Effects tab): loops play in list order.
- **Layer** — a navigation grouping (loop vs song). The word "main" is banned: the song layer
  is called *song* (song page, song mode, song layer) in code, copy, docs, and URLs.

## Context

- SP3 added the region/arrange model: `regionSlice` (`regions: Region[]` + `activeRegionId`),
  a 5th Arrange tab, a region selector in the chrome, and dual play mode keyed on
  `tab === 'arrange'`. The five tabs are still rendered flat in `App.tsx` (block/hidden
  mounting, audio never unmounts).
- SP4 does **not** add music capability. It (1) renames region → loop throughout, (2) groups
  the five tabs into two layers with a hand-rolled two-path route, (3) makes the layer boundary
  a hard stop (replacing SP3's detach-but-keep-looping rule), (4) re-keys play mode on the
  layer so Effects joins Arrange in song mode, and (5) restructures `src/components/` to mirror
  the layers.
- Routing is hand-rolled today (`src/routing/useTabRouting.ts` + `tabRouting.ts`, two-way
  `?tab=` sync via the History API). No router library exists and none may be added: the
  block/hidden mount model (audio continuity within a layer) must survive, which a
  route-mounted router would break.

## Scope

**In scope (SP4):**

- Terminology rename region → loop across `src/` (types, slices, store, audio, components,
  tests) — see Rename map.
- Two-path routing: `/loop?tab=…&loopId=…` and `/song?tab=…`, hand-rolled, preserving the
  mounted-tabs model.
- Layer-boundary hard stop: crossing `/loop` ↔ `/song` stops playback and resets song position.
- Two page wrappers `LoopPage` / `SongPage` and a `src/components/{loop,song}/` directory split.
- Loop-selector dropdown inside the loop layer (replaces SP3's chrome selector).
- An "Edit" action on Arrange rows that deep-links into the loop editor for that loop.
- Persist version bump v6 → v7 with a two-key rename migration (not a discard).

**Out of scope (non-goals — see Non-goals):**

- Clip-library / reuse-a-loop-multiple-times (loops are 1:1 with regions; arrangement is a
  linear list).
- Per-instrument tabs (the loop editor keeps SP3's three-tab grouping).
- Per-loop effects (effects stay global).
- Free-form timeline.

## Rename map

Every "region" identifier becomes "loop"; the `'arrange'`/`'effects'`/`'synth'`/`'sequencer'`/
`'chords'` `ViewMode` values, the `ArrangeView` component, and the "arrange" tab name are
**kept unchanged** (the arrange tab is a song-layer tab, not a layer name).

| Kind | Old | New |
|---|---|---|
| Type | `Region` | `Loop` |
| Type | `RegionStatePatch` | `LoopStatePatch` |
| Type | `RegionMixPatch` | `LoopMixPatch` |
| Slice | `RegionSlice` | `LoopSlice` |
| Slice field | `regions` | `loops` |
| Slice field | `activeRegionId` | `activeLoopId` |
| Slice field | `songRegionIndex` | `songLoopIndex` |
| File | `store/region.ts` | `store/loop.ts` |
| File | `store/regionSlice.ts` | `store/loopSlice.ts` |
| File | `store/loadRegion.ts` | `store/loadLoop.ts` |
| File | `store/regionSync.ts` | `store/loopSync.ts` |
| Fn | `loadRegion` | `loadLoop` |
| Fn | `regionBars` | `loopBars` |
| Fn | `newRegionId` | `newLoopId` |
| Fn | `nextRegionName` | `nextLoopName` |
| Fn | `cloneRegion` | `cloneLoop` |
| Fn | `regionStatePatch` | `loopStatePatch` |
| Fn | `regionLengthSteps` | `loopLengthSteps` |
| Fn | `nextRegionIndex` | `nextLoopIndex` |
| Fn | `fallbackActiveId` | `fallbackActiveLoopId` |
| Action | `addRegion` / `duplicateRegion` / `deleteRegion` / `reorderRegions` / `setActiveRegion` / `setRegionMix` | `addLoop` / `duplicateLoop` / `deleteLoop` / `reorderLoops` / `setActiveLoop` / `setLoopMix` |
| Component | `RegionSelector` | `LoopSelector` |
| Auto-name | `"Region N"` | `"Loop N"` |
| Const | `REGION_FLAT_KEYS` | `LOOP_FLAT_KEYS` |

The rename is mechanical; the persisted-key rename is the only part that requires a migration
(see Persistence). Existing saved `name: "Region N"` strings are left as-is (labels, not
migrated).

## Data model

No structural change from SP3. `Loop` is `Region` renamed, and `loopSlice` is `regionSlice`
renamed:

```ts
interface Loop { id: string; name: string; /* the same 31 per-region fields */ }
interface LoopSlice {
  loops: Loop[];              // the arrangement, list (playback) order, always ≥ 1
  activeLoopId: string;       // the loop being edited
  // addLoop, duplicateLoop, deleteLoop, reorderLoops, setActiveLoop, setLoopMix
}
```

- `loadLoop(id)` is `loadRegion` renamed — the atomic swap into the flat slices.
- The flat slices remain the live editable copy of the active loop; the sync-back strategy
  (live-write subscription vs snapshot-on-switch) is unchanged from SP3.
- The `'arrange'` `ViewMode` value stays; the play-mode derivation is re-keyed on the *layer*:
  `isSongLayer(tab) = tab === 'arrange' || tab === 'effects'` (the song layer plays in song
  mode — see Transport).

## Routing

### Two paths

```
/loop?tab=synth|sequencer|chords&loopId=<id>    → loop layer
/song?tab=arrange|effects                        → song layer
```

- The layer is the URL **pathname** (`/loop` vs `/song`); the sub-tab is `?tab=`; the edited
  loop is `?loopId=`.
- No router library. Extend the existing `tabRouting.ts`/`useTabRouting.ts` into a single
  route-sync that reads `pathname` + `search` and keeps three pieces of store state in two-way
  sync with the URL: **layer** (derived), **tab**, and **active loop id**.
- Default/normalization rules (mirroring today's `needsNormalize`):
  - `/` or unknown path → `/loop?tab=synth`.
  - `/loop` with missing/invalid tab → `/loop?tab=synth`.
  - `/song` with missing/invalid tab → `/song?tab=arrange`.
  - A tab that does not belong to its layer (`/loop?tab=arrange`, `/song?tab=chords`) →
    normalized to the layer's default tab.
  - `loopId` missing → the store's `activeLoopId` (adopted); `loopId` naming an absent loop →
    the first loop.
- `loopId` is a two-way sync like `activeTab` is today: the URL wins on mount, `popstate`
  mirrors into the store, store-driven loop switches push only when the URL doesn't already
  carry the id.

### Persistent mounts

The layer *path* change does **not** unmount any view. `App.tsx` keeps every tab mounted and
toggles visibility; the new `LoopPage`/`SongPage` wrappers each toggle their own sub-tabs
internally. The path is pure state (like `?tab=` today), not a mount boundary.

## Transport

### Play mode is keyed on the layer

- Song layer (Arrange or Effects tab) + playing → **song mode** (loops in list order).
- Loop layer (Synth / Chords / Drums tab) + playing → **loop mode** (the active loop repeats).
- `isSongTab(tab) = tab === 'arrange'` becomes `isSongLayer(tab) = tab === 'arrange' ||
  tab === 'effects'`. The Effects tab is in the song layer for navigation **and** playback:
  master FX are auditioned against the full loop sequence (mixing workflow).

### Layer-boundary hard stop (replaces SP3's detach rule)

SP3's rule was *detach*: leaving the Arrange tab dropped song position but **kept looping** the
sounding loop (audio never stopped). SP4 replaces that with a **hard stop at the layer
boundary**:

- Crossing `/loop` ↔ `/song` — in either direction — calls the existing `hardStopAll()` and
  resets `songLoopIndex = null`. Audio stops; the transport sits ready to play the new layer.
- Within a layer, tab switches (synth ↔ chords ↔ drums, or arrange ↔ effects) remain
  **continuous** — no stop, no unmount.
- Play on the TransportBar is context-free to the user: **play = play the current layer**.
  In the loop layer that is loop mode for the active loop; in the song layer (Arrange or
  Effects tab) it is song mode restarting from the active loop (the loop last being edited).

### Song-mode simplification

Because the boundary is now a hard stop, `src/store/songMode.ts` sheds the SP3 detach logic:
the "leaving Arrange detaches but keeps looping" branch and its supporting guards
(the `'stopping' vs 'stopped'` distinction, the `queueMicrotask` double-fire guard) exist only
to preserve continuous audio across the boundary and can be removed. Entering the song layer
no longer auto-starts the song — playback starts only on an explicit play press.

## UI model

### Two pages

`App.tsx` renders `<LoopPage/>` and `<SongPage/>`, toggled by the active layer (all views stay
mounted):

```
<App> → Header / InstantVibesBar / <LoopPage|SongPage> / TransportBar / MidiSettingsModal
```

- `LoopPage` — the three editing tabs, each toggled (the loop selector lives in the header).
- `SongPage` — the Arrange tab and the Effects tab, toggled.

### Header (layer-aware)

The header is layer-aware instead of showing all five tabs at once:

- A **layer toggle** — a two-button segmented control ("Loop | Song") next to the wordmark — is
  the single, always-visible bidirectional switch between layers. Clicking it calls
  `setActiveTab(defaultTabForLayer(target))` (a no-op when already on `target`, so it never resets
  the layer's current sub-tab). The existing route sync moves the path and the existing song-mode
  hard-stop stops playback at the boundary — no new URL or audio wiring.
- **Sub-tabs are scoped to the layer**: `/loop` shows the three editing tabs (Synth / Beat Step /
  Chords, each with its own transport), `/song` shows Arrange / Master FX.
- **Key/scale and the loop selector appear on `/loop` only**; `/song` shows neither (the arrange
  list is the entry point back into a specific loop).

### Loop selector (loop layer)

The dropdown (renamed `LoopSelector`) shows the active loop's name and lets the user switch which
loop is being edited; picking calls `loadLoop(id)` and writes `loopId` to the URL. It lives in the
**header** (visible only on the `/loop` layer), not in the page body, so the loop being edited is
always visible in the top chrome across the three editing tabs.

### Arrange "Edit" action

Each Arrange row gains an **Edit** action that navigates to
`/loop?tab=<last-edited tab>&loopId=<id>` — the deep link from "this loop in the arrangement"
to "edit this loop". It is a navigation, so crossing into the loop layer stops playback
(per the hard-stop rule).

### Directory restructure

Components move into layer directories so the tree mirrors the model:

```
src/components/
  loop/
    LoopPage.tsx          # the 3 editing tabs, toggled
    SynthView.tsx         # voices (synth/chord/bass) + lead piano roll
    ChordView.tsx         # chord progression + rhythm + bass pattern
    SequencerView.tsx     # drums
    lead/                 # LeadPianoRoll, pianoRoll, useLeadPlayback
    LoopSelector.tsx      # renamed from RegionSelector; rendered by Header
  song/
    SongPage.tsx          # arrange + effects, toggled
    ArrangeView.tsx
    EffectsRackView.tsx
  ui/                     # primitives (Knob, …) — unchanged
  Header.tsx              # top chrome → two-level nav
  TransportBar.tsx        # bottom → plays the current layer
  InstantVibesBar.tsx     # shared
  AudioVisualizer.tsx     # shared
  PlayheadReadout.tsx     # shared
  …                        # preset libraries, DrumPads, SimpleSynthPanel, helpers
```

Content components that belong to a single tab (preset libraries, `DrumPads`,
`SimpleSynthPanel`, `chord/`, `sequencer/` helpers) follow their parent view into `loop/`.
Shared chrome and the `ui/` primitives stay at `src/components/` root. Import-layering rules
(`components/` never imports `audio/engine`, etc.) are unchanged; the moves are mechanical
relocations with import-path updates.

## Persistence

- **Version bump to 7.** The only persisted-shape change is the rename: `regions` →
  `loops` and `activeRegionId` → `activeLoopId` at the top level of the persisted payload. No
  per-loop field changes (the 31 content fields are music params, none named "region").
- **Migration v6→v7 (transform, not discard).** Add `renameRegionKeysToLoop` to `migrate.ts`
  and chain it last (runs for every `version < 7`), after the v1→v6 chain has normalised
  payloads. It renames the two keys and is otherwise the identity:

  ```
  renameRegionKeysToLoop(state) = { ...state, loops: state.regions, activeLoopId: state.activeRegionId,
                                    delete regions, delete activeRegionId }
  ```

  (~4 lines, pure, non-mutating — same shape as its five siblings.) Existing saved
  `name: "Region N"` strings are deliberately **not** rewritten (cosmetic labels).
- **Sanitize / merge.** `sanitizePersistedState` and the persisted-loop validator in
  `store.ts` (the SP3 `regions`-array guard and the `Region N` fallback name) are renamed in
  lockstep (`loops`, `Loop N`). The `merge`/hydration path continues to load
  `loops[activeLoopId]` into the flat slices after adopting a v7 payload, exactly as SP3 does.
- Note: `CLAUDE.md`'s "version 5" for the persist key is stale — the current version is **6**
  (SP3's wrap migration); SP4 makes it 7.

## Testing

Pure-logic first (bun:test), same style as SP1–SP3.

- Rename is compile-checked (type-check + the full suite); no behavior test needed for a
  mechanical rename beyond the migration test below.
- Migration v6→v7: `regions`/`activeRegionId` → `loops`/`activeLoopId`; old keys removed; all
  other fields (and `name` strings) untouched; runs only for `version < 7` and after the v1→v6
  chain.
- Routing/normalization (pure, on the `tabRouting` helpers): `/` → `/loop?tab=synth`;
  `/song` → `/song?tab=arrange`; a tab not belonging to its layer normalizes to the layer
  default; missing `loopId` adopts `activeLoopId`; an absent `loopId` falls back to the first
  loop.
- Transport: crossing the layer boundary sets `songLoopIndex = null` and calls `hardStopAll`;
  within-layer tab changes do not; `isSongLayer` covers `arrange` and `effects` (both song mode).
- `songMode.ts` simplification: the detach branch is gone — leaving Arrange stops (no
  keep-looping path) and entering Arrange does not auto-start playback.
- Persist round-trip: `loops` + `activeLoopId` persist; `regions`/`activeRegionId` no longer
  appear; the `≥ 1 loop` invariant holds.

## Non-goals

- **Clip library / loop reuse** — a loop appears in the arrangement exactly once; reuse is
  duplication, not reference.
- **Per-instrument tabs** — the loop editor keeps the three-tab grouping (lead and bass stay
  where they are: lead in SynthView, bass pattern in ChordView).
- **Per-loop effects** — `effects` stay global.
- **Free-form timeline** — linear list only.
- **Per-loop bpm/meter** — global, unchanged from SP3.
