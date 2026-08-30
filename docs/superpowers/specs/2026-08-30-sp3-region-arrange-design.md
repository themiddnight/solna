# Region + Arrange Model (SP3) — Design

## Goal

Add a region/arrange model that evolves Solna from a single-snapshot looper into a linear
arranger: multiple full musical snapshots ("regions") arranged in a fixed linear order, with a
dedicated Arrange tab to manage them, a region selector on the editing tabs, and a dual play
mode (song mode on the Arrange tab, loop mode on every other tab).

## Terminology

- **Region** — a full musical snapshot: the complete per-voice music content of one section of
  a song (scales, the three synth voices, chords, bass, lead melody, drum grid, kit, and the
  per-voice mix/mute state). Regions are the units of an arrangement.
- **Active region** — the region currently being edited. Its content lives in the existing flat
  slices (the editing surface); the region selector and the Arrange tab both change it.
- **Song mode** — playback while the Arrange tab is active: regions play in their list order.
- **Loop mode** — playback while any other tab is active: the active region loops.

## Context

- Solna is a looper today: one persisted flat musical snapshot (`partializeAppState` in
  `store.ts` — the exact per-voice field list), a shared clock/transport
  (`transportSlice.ts`), and four tab views (Synth / Sequencer / Chords / Effects) that stay
  mounted so audio never stops on a tab switch. SP2 added the lead as a third transport player.
- SP3 (DEV-367) adds the region/arrange layer on top. It is explicitly a separate sub-project
  from the chord/bass custom 1-row pattern work.
- The existing "atomic snapshot load" machinery to reuse is `applyInstantVibeToStore`
  (`instantVibes.ts`): resolve → capture who was active → `hardStopAll()` →
  `audioEngine.stopSource('chord'|'bass', VIBE_SWAP_RELEASE)` → write state → restart whoever
  was playing. Region switching is the same shape, minus the preset resolution (a region is
  already in the store).

## Scope

**In scope (SP3):**

- New `regionSlice` holding `regions: Region[]` + `activeRegionId`.
- Region switching = atomic swap into the flat slices, reusing the `applyInstantVibeToStore`
  pattern.
- A region selector (small control) on the four non-Arrange tabs.
- A new 5th tab **Arrange**: linear list of regions with add / reorder / duplicate / delete,
  name + bar count, and a highlight on the currently-playing region.
- Dual play mode: song mode (Arrange tab) vs loop mode (any other tab), including the
  tab-switch **detach** rule.
- Region length (bars) derived from the chord progression: `Σ chord.bars`.
- Persistence: persist-version bump with a single-region wrap migration (see Persistence).

**Out of scope (tracked as follow-ups or deliberate non-goals — see Non-goals):**

- Per-track loop-length generalization.
- Per-region effects (effects stay global).
- Chord/bass custom 1-row pattern editor.
- Free-form timeline (the arrangement is a linear list only).

## Data model

### regionSlice

New slice `regionSlice.ts`, interface `RegionSlice` (extends the composed `AppStore`):

| Field | Type | Persisted | Notes |
|---|---|---|---|
| `regions` | `Region[]` | yes | The arrangement, in list (playback) order. Always ≥ 1 element. |
| `activeRegionId` | `string` | yes | Id of the region currently being edited (see Editing model). |

Setters: `addRegion`, `duplicateRegion`, `deleteRegion`, `reorderRegions`, `setActiveRegion`,
and the atomic `loadRegion(id)` (the region-switch core — see Playback model).

### Region

`Region` is the per-region persisted shape. It carries an identity (`id`, `name`) plus every
**per-region** field of the current flat persisted state — nothing more, nothing less:

```ts
interface Region {
  id: string;
  name: string; // auto-named "Region N"; see UI defaults
  // -- Music content (per-region) --
  scaleRoot: string;
  scaleType: string;
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  chords: ChordItem[];
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  chordFeel: number;
  chordOctave: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  bassFeel: number;
  bassOctave: number;
  leadMelodySteps: string[][];
  leadLoopLength: number;
  sequencerTracks: SequencerTrack[];
  soundKit: string;
  drumFilterCutoff: number;
  drumFilterResonance: number;
  drumFilterType: FilterType;
  synthVolume: number;
  synthMuted: boolean;
  chordVolume: number;
  chordMuted: boolean;
  bassVolume: number;
  bassMuted: boolean;
  masterSequencerVolume: number;
  drumMuted: boolean;
}
```

The 31 fields above are exactly the **per-region** subset of today's
`partializeAppState` allow-list. The remaining persisted fields stay **global** (see below), so
the per-region ∪ global split reconstructs today's single persisted snapshot exactly.

### Global fields

These stay at the top level of the persisted state and are shared by every region:

```
bpm, meterId, masterVolume, metronomeActive,
effects,
customSynthPresets, customChordProgressions,
selectedVibeId, controlTarget
```

- `bpm` / `meterId` are transport context, not music content — a region is authored at the
  project's tempo and time signature. Consequently applying an Instant Vibe (which writes both)
  retunes the project tempo/meter for every region; only its per-region fields land in the
  active region. This is a direct consequence of the split, not a bug.
- `effects` are master-bus processing, global by design (see Non-goals).
- `customSynthPresets` / `customChordProgressions` are shared libraries — a preset or
  progression saved in one region is available in every region.
- `selectedVibeId` is project-level state (which vibe last touched the project).
- `controlTarget` is an editing concern (which voice the knob panel targets), not music content.

### Editing model

The existing flat slices (all current slice fields except the transient playing/playhead ones)
remain the source of truth for the **active region**. `regions[activeRegionId]` holds the
persisted copy; the flat slices hold the live editable copy.

- **Switching region** = an atomic swap that loads `regions[targetId]` into the flat slices and
  sets `activeRegionId = targetId` (the swap mechanics are in Playback model).
- **The active region's edits always sync back into `regions[activeRegionId]`.** The exact sync
  strategy is finalized in the implementation plan, not this spec; the two candidates:
  - *Live-write subscription*: one `subscribeWithSelector` subscription over the 31 per-region
    fields writes `regions[activeRegionId]` on every change. `regions[]` is always authoritative
    and persist always sees the latest edits; the cost is a `regions`-array write (and persist
    serialize) on every knob move — comparable to today, where every one of those fields already
    triggers a persist write.
  - *Snapshot-on-switch*: edits live only in the flat slices; every path that changes
    `activeRegionId` (selector pick, Arrange-tab selection, duplicate/delete, song-mode advance)
    first snapshots the outgoing region's flat fields back into `regions[outgoingId]`. Fewer
    writes, and the flat slices are the single live copy while editing, but `regions[]` is stale
    between switches, so every switch path must go through the one snapshot choke point.
  - Either way, `partializeAppState` must emit `regions[]` with the active region reflecting the
    latest flat state at persist time (a live-write subscription guarantees this; the
    snapshot-on-switch path must snapshot as part of partialize too, or rely on every
    flat→region write happening before any switch that could be followed by a persist).

### Region length

A region's length in bars is the sum of its chord progression's bar counts:

```
regionBars(region) = Σ region.chords.map(c => c.bars || 1)
```

This is the same total the chord player already advances through (each chord occupies
`chord.bars × stepsPerBar` steps; see `useChordPlayback`'s `nextBarStep`), so the region
boundary is exactly where today's progression wraps.

## Transport

### Play mode is coupled to the active tab

- Arrange tab active + playing → **song mode**: regions play in their list order.
- Any other tab active + playing → **loop mode**: the active region loops.
- The existing `play`/`softStop`/`hardStop`/`playAll`/`softStopAll`/`hardStopAll` transport
  actions are unchanged; pressing play enters the mode implied by the active tab. The
  TransportBar's play/stop controls keep their current behaviour.

### Song position

Song mode needs a "song position" = **regionIndex + position-within-region**:

- Transient `songRegionIndex: number | null` on the transport slice (`null` = loop mode). It is
  the index into `regions[]` currently sounding, and drives the Arrange tab's playing-region
  highlight.
- Position-within-region is derived from the existing transient playhead (`playheadBeat` /
  `playheadChordIndex`), which already measure from the shared clock's reset origin. No new
  absolute-position bookkeeping is needed beyond the region index.

### Advancing to the next region

When the current region's bars complete (its `Σ chord.bars`), song mode advances to the next
region in list order; after the last region it wraps to the first (the arrangement loops, like
every other loop in Solna). The advance is a region switch (see Playback model), which resets
the per-player arming state via the existing `'stopped'`-transition resets, so the new region
re-enters on its bar 1 by construction — the same alignment guarantee the Instant Vibe swap
already relies on.

### Detach rule

Switching tabs mid-play **detaches**: the transport drops song mode (and with it the song
position) and loops the active region. The song position is **not** preserved across tabs —
leaving the Arrange tab and coming back does not resume where the song left off; re-entering
song mode (pressing play on Arrange) restarts the song from the top of the list. Audio never
stops on a tab switch (the tab views stay mounted); only the mode and the advance cursor change.
In song mode the flat slices already hold the region that was sounding (each advance loads the
next region), so at the moment of detach "loop the active region" is exactly "keep looping what
was playing".

## Playback model

### Loop mode (any non-Arrange tab)

- Drums/bass/chords loop the **full region length** (`Σ chord.bars`). This is what the current
  players already do: the chord player wraps `arming.chordIndex % chords.length` and steps each
  chord for `chord.bars × stepsPerBar`; the drum grid is authored/adapted to the progression
  length at apply time. No loop-length change for these voices.
- Only the lead has a sub-loop length: `leadLoopLength` (a divisor of the region length, exactly
  as it works today — `loopLengthDivisors`/`clampLeadLoopLength` in `audio/leadMelody.ts`,
  driven by the region's own `chords`). Per-track loop length is **not** generalized (Non-goals).

### Song mode (Arrange tab)

A song-mode coordinator (a store-level action, not a component) subscribes to the shared clock
alongside the existing playback hooks and watches the region boundary. When the current region's
`Σ chord.bars × stepsPerBar` steps complete, it calls the region switch for
`regions[songRegionIndex + 1]` (wrapping to 0), which updates `songRegionIndex` and reloads the
flat slices. The per-voice hooks are unchanged: they play whatever is in the flat slices, which
the switch replaces on the boundary bar line.

### Region switch = atomic swap (the reuse)

`loadRegion(id)` reuses the `applyInstantVibeToStore` pattern verbatim:

1. **Capture who was active** — `sequencerPlayer` / `chordsPlayer` / `leadPlayer` ≠ `'stopped'`
   (a mid-soft-stop player counts as active and comes back).
2. **`hardStopAll()`** — cut the transport transitions.
3. **Cut the sources synchronously** — `audioEngine.stopSource('chord', VIBE_SWAP_RELEASE)` and
   `audioEngine.stopSource('bass', VIBE_SWAP_RELEASE)` (the same `0.02` release constant the
   vibe swap uses), because a state-only swap would leave queued chord/bass voices ringing on
   over the new region (the exact React-batching reason documented in `instantVibes.ts`).
4. **Load the region's fields** — write every per-region field of `regions[id]` into the flat
   slices, and set `activeRegionId = id`. This is the single choke point through which every
   switch (selector, Arrange-tab click, duplicate/delete, song advance) must pass, so it is also
   the natural home of the outgoing-region snapshot if the plan chooses snapshot-on-switch.
5. **Restart whatever was playing** — `play('sequencer')` / `play('chords')` / `play('lead')`
   for each captured-as-active module. The hooks arm on the next bar line for the active meter,
   so the restart lands on beat 1 with no alignment code.

Instant Vibe application continues to write the flat slices; because the flat slices *are* the
active region, the sync-back mechanism persists the vibe's per-region fields into the active
region automatically, and its global fields (bpm, meter, effects, vibe id) stay global.

## UI model

### New 5th tab: Arrange

`ViewMode` gains `'arrange'` (five tabs total; `App.tsx` keeps the block/hidden mounting
pattern so audio never stops when switching to Arrange). The tab renders a **linear list** of
regions, top to bottom = playback order:

- Each row shows the region's **name** and **bar count** (`regionBars`).
- The **currently-playing region** is highlighted: in song mode that is `regions[songRegionIndex]`;
  in loop mode it is the active region (the one looping).
- Actions per row / at list level:
  - **Add** — append a new region; a new region is a **copy of the active region** (default).
  - **Reorder** — move a region up/down in the list (the list order is the song order).
  - **Duplicate** — clone the region and **insert the clone immediately after the original**.
  - **Delete** — remove a region; the last remaining region cannot be deleted (a project always
    has ≥ 1 region).
- Clicking a region **selects it as active** (default), i.e. calls `loadRegion(id)`; while
  playing, this has the natural effect of jumping the song/loop to that region.

### Region selector (non-Arrange tabs)

A small control visible on the four editing tabs (Synth / Sequencer / Chords / Effects) showing
the active region's name and letting the user pick another. Picking calls the same
`loadRegion(id)` swap. It lives in shared chrome (e.g. the Header, next to the tab bar) so it is
consistent across tabs.

### Editing content stays where it is

Music content is edited in the existing Synth / Sequencer / Chords tabs exactly as today; the
region selector just changes *which* region those tabs edit. Effects (Effects tab) and the
transport (TransportBar) remain global.

## Persistence

- **Version bump to 6.** The persisted shape changes: the top-level per-region fields are
  replaced by `regions: Region[]` + `activeRegionId: string`; the global fields stay top-level.
  `partializeAppState` emits `regions`, `activeRegionId`, and the global fields.
- **Migration v5→v6: the single-region wrap (recommended default).** The existing flat persisted
  state is wrapped into the first region: `regions = [{ id, name: "Region 1", ...flatPerRegionFields }]`,
  `activeRegionId = that id`, and the per-region keys are dropped from the top level. This is a
  mechanical nesting of fields the user already has — the cheapest possible migration, and it
  preserves the user's current loop as a working single-region project. It runs at the end of
  the existing `migrate` chain in `store.ts` for every `version < 6` (after the v1→v5 chain has
  normalised older payloads to the v5 flat shape), and is added to `migrate.ts` as
  `wrapFlatStateIntoRegion`.
- **DEV-367 "starts fresh" is read as "no complex migration"**: the wrap is the default because
  it needs no data transform and keeps the user's work. The alternative — a true fresh start
  (discard the old flat state, seed one empty region) — is simpler still (no wrap at all) but
  destroys the user's current song with no recovery, so it is the fallback only if the wrap
  proves fragile in implementation.
- **Sanitize / merge / hydration.** `sanitizePersistedState` learns to validate the `regions`
  array (each region is a well-typed object; per-field sanitization reuses the existing
  per-field guards/clamps, e.g. `sanitizeSynthParams`, the finite-number clamps, the array
  checks) and `activeRegionId` (a string that exists in `regions`, else the first region). The
  `merge` path, after adopting a v6 payload, must load `regions[activeRegionId]` into the flat
  slices (a store-level copy — the engine is not live at hydration, and `applyEngineSnapshot`
  re-applies the flat audio state on first gesture exactly as it does today). The wrapped
  top-level per-region keys are dropped by the wrap itself and by v6 `partializeAppState`
  (which no longer emits them); the existing `removeLegacyKeys` only strips the pre-Zustand
  `murva_*` storage keys.
- **Region identity.** Region ids are new and unique per project (created at add/duplicate/wrap
  time; the wrap generates one). Names are presentation-level ("Region 1/2/3…") and may collide
  after deletes; ids are the stable handle.

## Testing

Pure-logic first (bun:test), same style as SP1/SP2 — no DOM/testing-library; components tested
via `renderToString`.

- `regionBars` computation (Σ `chord.bars`, with the `|| 1` default for bar-less chords).
- Migration v5→v6 wrap: flat state → single region + `activeRegionId`; per-region keys removed
  from the top level; global fields preserved; runs only for `version < 6` and after the
  v1→v5 chain.
- regionSlice actions: add (copy of active, appended, next auto-name), duplicate (deep clone,
  inserted after the original), delete (last-region guard), reorder (list-order semantics),
  `setActiveRegion`.
- The atomic `loadRegion`: captures was-active per player, calls `hardStopAll`, stops chord/bass
  sources, writes all 31 per-region fields, restarts the captured players (tested as a pure
  "state patch" helper so no audio context is needed).
- Song-advance boundary: `Σ chord.bars × stepsPerBar` → advance index (with wrap to 0); and the
  detach rule: mode derived from `activeTab`, song position dropped on tab change.
- Persist round-trip: `regions` + `activeRegionId` persist; per-region fields no longer
  top-level; sanitize of a corrupt `regions` array falls back to a valid single region; the
  invariant "≥ 1 region" holds after any action.
- Sync-back (whichever strategy the plan picks): edits to a flat per-region field reach
  `regions[activeRegionId]` (via subscription or via the switch choke point).

## Non-goals

- **Per-track loop-length generalization** — only the lead has a sub-loop (`leadLoopLength`,
  a divisor of the region length); drums/bass/chords loop the full region length.
- **Per-region effects** — `effects` stay global.
- **Chord/bass custom 1-row pattern editor** — a separate work item, not part of SP3.
- **Free-form timeline** — the arrangement is a linear list only (add / reorder / duplicate /
  delete); no overlapping regions, no drag-on-a-timeline.
- Per-region `bpm`/`meterId` are likewise out (both are global by the data-model split).
