---
name: arrange-room
description: Arrange Room (Collaborative DAW) — tracks, regions, MIDI/audio recording, collaborative locks, project save/load, BR-11/BR-12. Read before any Arrange Room work.
---

# Arrange Room Skill

Read every time before working on Arrange Room features — DAW features, tracks, regions, locks, project persistence.

**Full event doc:** `docs/WS_CONTRACT.md` → Section 8 (Arrange), Section 14 (Element Occupancy — collaborative editing/locking)
**Architecture:** `app/backend/docs/ARCHITECTURE.md` → Arrange Room section
**Rules:** `docs/RULES_AND_CONSTRAINTS.md` (BR-1, BR-2, BR-11, BR-12, TR-1, TR-2, TR-4)

---

## Core Concepts

### State Model

```typescript
// ArrangeRoomState (Redis key: arrange:state:{roomId})
{
  roomId, roomType: "arrange", bpm, timeSignature, lastUpdated,  // BaseRoomState
  projectId: string | null,       // Linked 1:1 with a project (BR-1)
  projectOwnerId: string | null,  // Project owner (distinct from room owner — FC-3)
  hasBeenSaved: boolean,          // false = No owner yet → everyone can use tools
  tracks: Track[],
  regions: Region[],              // MIDI regions + Audio regions
  occupancy: Map<elementId, ElementOccupancy>,  // Element occupancy queue (DEV-350) — the ONLY conflict-guard source. The old primitive-lock map (`locks`) was deleted from this state model (DEV-350 Round 2, Task 1); the wire payload still sends an always-empty `locks: []` for FE backward-compat only — see "Collaborative Editing (Element Occupancy)" below
  synthStates: SynthState[],      // per-track synth params
  effectChains: EffectChain[],    // per-track effect chain
  markers: Marker[],
}
```

### Key Files

| Layer | File |
|---|---|
| BE Domain | `app/backend/src/domains/arrange-room/` |
| BE State Service | `domains/arrange-room/application/ArrangeRoomStateService.ts` |
| BE Handler | `domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler.ts` |
| BE Event Handler | `domains/arrange-room/infrastructure/handlers/ArrangeEventHandler.ts` |
| FE Feature | `app/frontend/src/features/rooms/arrange/` |
| FE Sync Service | `features/rooms/arrange/services/arrangeSyncService.ts` |
| FE Controller | `features/rooms/arrange/hooks/ui/useArrangeRoomController.ts` |
| FE Store | `features/rooms/arrange/stores/` — new stores MUST use `createArrangeStore` from `arrangeStoreRegistry.ts` (auto-registers `reset()`; a completeness test fails otherwise — see archived `zustand-store` skill) |

---

## Shared Room UI Notes

- Arrange Room uses the shared `RoomChatRoot` floating chat FAB/panel.
- Do not add a fixed chat section to the Arrange sidebar unless the product direction changes.
- Keep the room-level voice runtime (`VoiceRuntimeProvider`) mounted once when voice is enabled. Collapse/tab visibility must switch `VoiceInputView` variants, not unmount or duplicate the runtime.

## Current Arrange Room UI Layout

- Tablet and desktop-sized viewports use the shared split-tab workspace shell after `TransportToolbar`.
- Top tabs are `Multitrack`, `Region Editor`, and `Instrument Settings`.
- Bottom tabs are `Region Editor`, `Instrument Input`, and `Instrument Settings`.
- Duplicate tabs are active in only one section at a time. If `Region Editor` or `Instrument Settings` is active on top and the user selects it on the bottom, the top section falls back to `Multitrack`.
- `Region Editor` chooses `PianoRoll` or `AudioEditor` from the active region.
- `Instrument Settings` is `InstrumentControlsPanel`; `Instrument Input` is `VirtualInstrumentPanel`.
- `Instrument Settings` shows a shared centered placeholder when the selected track has no editable settings.
- The shared shell renders each panel id once and moves it between top/bottom grid areas, so `RegionEditor`, `InstrumentControlsPanel`, `VirtualInstrumentPanel`, `Sidebar`, and effects surfaces are not duplicated.
- The bottom section height is persisted; active tabs are not persisted.
- The `Sidebar` renders on all non-mobile screens: inline (≥1280px, default expanded) and as an overlay drawer (720–1279px, default collapsed strip) — there is no bottom-tab `Tools` entry.
- The `xl` sidebar collapses into a persistent strip instead of using a separate right section selector. Full order is track effects, instrument monitor, horizontal master meter, voice input, and members.
- Collapsed sidebar shows track effect counts at the top and compact voice mute, instrument monitor, master volume, member count, and expand controls at the bottom.
- Runtime/action sidebar components use `variant="full" | "compact"`; list-heavy content uses separate lightweight summary components.

---

## Ephemeral / Commit Pattern (TR-1)

| Event | Redis Write? | Broadcast |
|---|---|---|
| `arrange:region_drag` | ❌ NO | `socket.to()` — exclude sender |
| `arrange:region_drag_commit` | ✅ YES | `namespace.to()` — include sender |
| `arrange:note_realtime_update` | ❌ NO | `socket.to()` |
| `arrange:synth_params_update` | ❌ NO | `socket.to()` |
| `arrange:synth_params_commit` | ✅ YES | `namespace.to()` |
| `arrange:effect_chain_update` | ❌ NO | `socket.to()` |
| `arrange:effect_chain_commit` | ✅ YES | `namespace.to()` |
| `arrange:track_property_commit` | ✅ YES | `namespace.to()` |
| `arrange:track_add` | ✅ YES (immediate) | `namespace.to()` |
| `arrange:region_add` | ✅ YES (immediate) | `namespace.to()` |

**Auto-commit safety net (TR-10):** If an ephemeral event is not followed by a commit within 10s → auto-commit.

---

## Collaborative Editing (Element Occupancy — DEV-350, replaces the old lock system)

Track/region/chord-block/companion-region editing is no longer gated by a dedicated acquire/release lock pair. Every editable element (a `Region`, chord block, or companion-region control) is addressed by its `elementId` in a shared, room-agnostic **occupancy queue** (`RoomOccupancyService`, `OCCUPANCY_EVENTS`, `shared/src/types/occupancy.ts` — same system Perform Room uses for companion controls, see the `perform-room` skill).

- **Join/select** an element via `occupancy:join` (`{ roomId, elementId }`) — a `container`-kind element (regions/chord-blocks) always succeeds and appends to the queue; there is no exclusive lock at selection time.
- **`holders[0]` is the owner** — only the owner may mutate the element. CRUD guards (`ArrangeRegionHandler`, `ArrangeChordTrackHandler`, `ArrangeCompanionHandler`) read `RoomOccupancyService.getOccupancy(elementId).holders[0]` directly; a non-owner mutation attempt gets `arrange:lock_conflict` (event name kept for FE compat — see `docs/WS_CONTRACT.md` §8.14.6/§14).
- **Leave** via `occupancy:leave` on deselect; occupancy is also released automatically on disconnect/room-leave (`releaseAllOccupancyForUser`).
- Later joiners (queue position > 0) are **read-only viewers** — shown as an avatar-stack badge (`PresenceBadge`, `useRoomOccupancyStore.canEdit`/`canInteractNested`) but cannot mutate.
- **Note-level CRUD** (`arrange:note_add`/`_update`/`_delete`, and the ephemeral `arrange:note_realtime_update`) is migrated too (DEV-350 Round 2, Task 1/2) — `addNoteAtomic`/`updateNoteAtomic`/`deleteNoteAtomic` read the region's occupancy `holders[0]` the same way region/chord-block CRUD does, and the ephemeral drag path carries the same guard, emitting `arrange:lock_conflict` when a non-owner drags. Before this fix these methods read the retired primitive-lock map (already permanently empty) and never rejected anything — see `docs/FAILURE_PATTERNS.md` Pattern 13.
- `arrange:save_lock_*` (project save lock, §8.8) is a **separate, unrelated** system — untouched by DEV-350, still a dedicated acquire/release pair.

Full wire protocol: `docs/WS_CONTRACT.md` §14 (Element Occupancy Events, canonical FE↔BE payload shapes) and §8.14.6 (Arrange-specific retirement/compat notes). Design rationale: `docs/superpowers/plans/2026-08-18-lock-presence-occupancy-queue.md`.

**DO NOT** mutate a region/chord-block/companion-region you don't own in the occupancy queue — check `canEdit`/`holders[0]` first.

**How occupied elements LOOK and BEHAVE (DEV-350 Rounds 6–9):**
- **Occupied** (someone else holds it) is a soft state — the region stays selectable and readable: dim ~10%, dashed warning border, normal pointer cursor. A whole surface (the region editors — piano roll / audio / companion) is wrapped in `ReadOnlySurface` instead: dimmed, still scrolls/hovers/selects, only the gestures that could change something are swallowed. Never `pointer-events: none` — it takes the scrollbars with the edits.
- **Restricted** (project-owner-locked track, audience) is a hard state — heavy dim, `not-allowed`, genuinely `disabled`. `BaseRegion` takes both flags separately (`isLockedByRemote` vs `isTrackRestricted`); don't merge them.
- **Region ↔ chord-block selection is mutually exclusive** — both lanes answer the same Delete key, so selecting in one clears the other (`clearChordBlockSelection` / the region store's `clearSelection`). Leaving the other lane's selection behind deleted things the user never targeted.
- **Releasing a primitive lock** must cover every way an interaction ends — `interactionEndHandlers` (pointerup + **lostpointercapture** + pointercancel + keyup + blur) plus a release on unmount. A range input takes implicit pointer capture, so a drag released outside the window never delivers `pointerup`, and keyboard adjustment delivers no pointer event at all.
- **Presence is always the floating `PresenceBadge`** — never an inline chip in the control's own layout (`Knob`'s `lockedLabel` was deleted repo-wide, DEV-350 Round 10). The badge joins its ANCHOR's layer (portalled into the nearest non-clipping stacking context) so an overlay covering the anchor covers the badge too; see WS_CONTRACT §14 "Badge layering".
- **Select lock** — a dropdown holds a `primitive` for as long as it is open (`onActiveChange`), e.g. the time signature. A control that changes discretely with nothing to hold in between takes NO lock — attribution answers it instead.
- **Per-user occupancy state never lives in a per-instance `useRef`** — if the hook has more than one call site, the instance that releases is not the one that joined (FAILURE_PATTERNS Pattern 17).

### Occupancy vs Attribution (TR-43)

Two separate systems, do not conflate them:
- **Occupancy** (above) — server-authoritative, gates permission. The only thing `canEdit`/`canInteractNested`/`isOwner` may read.
- **Attribution** — a client-local, ~1.5s fading "who just touched this" badge, fed by the `userId` already present on state-change broadcasts (e.g. `arrange:region_updated`). Display only — never read by a gate, never written into the occupancy store.

**Badge placement:** a container anchored beside its own trigger relies on the trigger's badge; a free-floating container (a centred modal, the region-editor/piano-roll panel) carries its own badge.

**TTL split:** `primitive` occupancy expires after 30s (live); `container` occupancy is designed for 5min but **not enforced yet** — the heartbeat works (fixed DEV-350 Round 9), nothing expires a container (DEV-361). See TR-4.

---

## Track Management (TR-7: Max 64 tracks)

```typescript
arrange:track_add    → { track: Track }
arrange:track_remove → { trackId }
arrange:track_reorder → { trackIds: string[] }  // full ordered array
arrange:track_property_commit → { trackId, property, value }
```

If track count ≥ 64 → reject `arrange:track_add` with an error.

Mute/solo are FE-local per-user session state (`arrangeTrackMixStore`) — not synced, not saved, reset on reload/leave. Do not add them back to `Track` or `track_update`.

---

## Region Management

### MIDI Regions
```typescript
arrange:region_add      → { region: MidiRegion }
arrange:region_remove   → { regionId }
arrange:region_drag     → { regionId, startTime }          // ephemeral
arrange:region_drag_commit → { regionId, startTime }       // commit
arrange:region_resize   → { regionId, startTime, duration } // commit
arrange:note_add        → { regionId, note: MidiNote }
arrange:note_remove     → { regionId, noteId }
arrange:note_realtime_update → { regionId, noteId, ...changes } // ephemeral
arrange:note_commit     → { regionId, noteId, ...changes }      // commit
```

### Audio Regions
```typescript
arrange:audio_region_add    → { region: AudioRegion }
arrange:audio_region_remove → { regionId }
arrange:audio_region_drag_commit → { regionId, startTime }
```

### Chord Track & Companion Regions (DEV-279)

- **Chord Track** — one per project, top-level `ArrangeRoomState.chordTrack` (not a `Region`). Chord blocks are positional (`start`/`duration` in beats) and degree-relative (`diatonic` degree 1–7 or `borrowed` semitone offset + quality), resolved against the project scale at generation time. Drives companion playback the same way the room-global chord progression drives Perform companions.
- **Companion Regions** — a `Region` with `type: 'companion'` on a track; notes are generated live from a `CompanionRegionConfig` + the chord track, by role (bass/chord/beat) derived from the track's instrument. Config edits use the ephemeral/commit pair `arrange:companion_config_update` / `arrange:companion_config_commit`.
- **Convert / Revert** (MIDI ↔ Companion, both ways) — a companion region can be **converted** into a plain `MidiRegion` (pre-rendered notes, for hand-editing) via `arrange:companion_region_convert`, and **any** `MidiRegion` can be turned into a companion via `arrange:companion_region_revert` (regenerates live against the CURRENT chord track, not the frozen snapshot). A converted region carries `companionMetadata` (config + chord-track snapshot + convert timestamp) so it restores its exact recipe (and survives save/reload); a plain MIDI region (never a companion) instead gets a fresh role-default config derived from the track's instrument. The FE switcher (`isConvertible`) offers the toggle for any companion or MIDI region (not audio); midi→companion is confirmed via a warning modal (notes are discarded). Reverting is rejected past the companion soft cap (`MAX_COMPANION_REGIONS_PER_PROJECT` = 10).
- **Chord track visibility** — the chord track lane is shown/hidden from the **timeline lane menu** (a hamburger popover in the timeline's top-left toolbar, next to Add Track), not an in-lane control; visibility is session-local view state (`arrangeChordTrackStore.isVisible`, not synced/persisted).
- **Extended-lane strip** — the chord track is a ruler-adjacent *lane*, not a track: it lives in the timeline grid's lane strip (row 2) which sticks below the time ruler (`top: RULER_HEIGHT`) while track rows scroll underneath. Future lanes (SMPTE timecode, BPM/time-sig automation) stack in the same strip — `getTimelineGridTemplateRows(laneHeights)` accepts multiple lane heights, so adding a lane needs no per-lane sticky-offset math. The lane's block editor (`ChordPaletteModal`) previews chord audio via the shared `useChordPreview` hook; chord blocks render a single uniform, theme-aware border.
- Full event contract: `docs/WS_CONTRACT.md` §8.14 (Chord Track) and §8.15 (Companion Region Convert/Revert). Companion generation internals (roles, styles, genres) shared with the Perform Room: `docs/companion/README.md`.

---

## Project Save/Load

**BR-1: 1 project = 1 active Arrange Room** — enforced across all layers.

**Save flow:**
```
1. FE: `arrange:save_lock_request` → Requests lock before saving.
2. BE: Broadcasts `arrange:save_lock_acquired` / `arrange:save_lock_denied`.
3. FE: `POST /api/projects/:id` (REST) — Saves project data.
4. FE: `arrange:save_lock_release` → BE broadcasts `arrange:save_lock_released`.
```

**Load flow:**
```
1. FE: Navigate to `/arrange/:roomId` (state: `{ loadProjectId, projectOwnerId }`).
2. FE: `arrange:request_state` ← Backend retrieves `ArrangeRoomState` from Redis and returns it.
3. BE: `arrange:state_sync` → Full state sync (tracks, regions, occupancy, synthStates, etc.).
```

**BR-12: Project tools (import/export/DAW/mixdown):**
- Available only to the project owner **after** the first save.
- Checked via `canUseProjectFeatures` in `ProjectMenu.tsx`.
- Logic: `hasBeenSaved = true` AND `currentUserId === projectOwnerId`.
- Exception: `hasBeenSaved = false` (new room, no owner yet) → everyone can use these tools.

**BR-11: Project Lock (Read-Only):**
- Project owner can lock the project → everyone else becomes read-only.
- Enforced in `routes/projects.ts` — check lock status before saving.

---

## Key Business Rules to Remember

**FC-3: Room Owner ≠ Project Owner**
- `room_owner` → Kick users, change settings (ephemeral, per-session).
- `project_owner` → Save, export, lock project (persistent, cross-session).
- BR-2: When the project owner enters the room → automatically becomes `room_owner` (demotes the previous owner).

**BR-1: 1 project = 1 active room**
- To create a new room → always check `getActiveRoomInfo(projectId)` first.
- 409 Conflict = Room already exists → redirect to the existing room.

**TR-2: Per-room mutex**
- Every Redis read-modify-write operation must go through a mutex.
- This is the responsibility of `ArrangeRoomStateService` (inherited from `BaseRoomStateService`).

---

## Stale State / Reconnection

```typescript
// On reconnection:
arrange:request_state → BE returns arrange:state_sync
// FE must replace the entire state (do not merge) because BE is the source of truth.
```

`arrange:state_sync` event includes: tracks, regions, occupancy, synthStates, effectChains, markers, projectId, projectOwnerId, hasBeenSaved, bpm, timeSignature

---

## BPM and Time Signature

- Arrange Room stores `bpm` and `timeSignature` in `BaseRoomState`, but it does not use the Perform Room `MetronomeService`.
- Timeline/ruler/loop/playhead math should derive quarter-note beats per bar through `beatsPerBar()` in `features/rooms/arrange/utils/timeUtils.ts`, which wraps `quarterNotesPerBar()` from `@jam-band/shared`.
- Native click/count-in behavior can read `timeSignature.numerator` for the number of native beats, but click interval must use `quarterNoteMs(bpm) * nativeBeatScale(timeSignature)`.
- BPM-to-seconds conversions should use `quarterNoteMs(bpm) / 1000`; do not add local `60 / bpm` formulas in Arrange feature code.
- Export/serializer code may read numerator/denominator directly when writing metadata.

### Audio region tempo mode

- Each `AudioRegion` carries `tempoMode?: 'follow' | 'fixed'` (absent = `follow`). Resolve it through `resolveAudioRegionTempoMode(region)` in `features/rooms/arrange/utils/audioRegionTempo.ts`; do not read the raw field.
- `follow` stretches the audio when project BPM changes (`playbackRate = bpm / recordedBpm` at schedule time). `fixed` instead holds the original playback rate and rescales the region's beat geometry so `recordedBpm` stays pinned to the project BPM — the rate collapses to 1. Imported clips default to `fixed` (their `recordedBpm` is fabricated at import time); in-room recordings default to `follow` (their `recordedBpm` is true).
- The `fixed` rescale is an idempotent invariant enforced in `arrangeStoreObservers.ts` (on BPM change and on region-store change), not per-load-path — never emit region updates for it, every client converges deterministically. All five beat-denominated fields (`length`, `originalLength`, `trimStart`, `fadeInDuration`, `fadeOutDuration`) scale together via `rescaleFixedAudioRegion`; `start` never moves.
- A `1:1` badge on the region marks `fixed`; `follow` is unbadged.
- Stem export (`audioTrackRenderer.ts`) resamples audio by `playbackRate` and reads trim in the `recordedBpm` frame. It still drops `pitchShift`, effects, pan, and mute/solo — tracked in DEV-275.

## Unified Scale Model (DEV-226)

- **Shared key:** `arrangeProjectStore.projectScale` — the project's scale. Events `arrange:project_scale_change(d)` are **unchanged** by DEV-226.
- **Personal:** `arrangeRoomStore` — each user's own scale.
- **Gate:** `followScale` — **client-local** (not broadcast, no wire event), default `true`.
- **Derived:** `resolveEffectiveScale(projectScale, personalScale, followScale)` (shared pure selector in `@jam-band/shared`) produces `effectiveScale`, exposed via the wrapper hook `useArrangeEffectiveScale()`.
- **Consumers:** every instrument/sequencer/pitch-effect reads `effectiveScale` — never the raw `projectScale` directly. Room-key DISPLAY consumers read the raw shared key instead.
- Contrast with Perform: Perform's `followScale` is server-authoritative (on `BandMember`); Arrange's is purely client-local UI state.

---

## Playback Performance Settings

- Arrange Room has an Audio / Performance Settings panel backed by `arrangePerformanceStore`.
- Default playback priority is `stable`: higher Tone lookahead, preload-before-playback, reduced waveform work during playback, and deferred full-region rescheduling while transport is active.
- MIDI playback should prewarm track engines before transport callbacks and use prepared engine methods where possible instead of async ensure/load work inside scheduled note callbacks.
- Audio region playback should prepare mixer/channel routing before scheduling loops, clean up native source/gain/pitch nodes on stop/end, and avoid per-loop mixer creation.
- Do not expose live AudioContext buffer size/sample-rate controls unless the implementation safely recreates and reconnects the audio graph.

---

## Input / Gesture Ownership

- Native scroll containers own one-finger pan where possible, so browser and OS inertia keep working.
- Konva is the hit/edit layer for selected item moves, handles, resize, trim, fade, marker, velocity, sustain, and marquee interactions.
- Custom gesture logic owns pinch zoom only.
- Two-finger touch means `pinch-zoom`; it must cancel item drag, marquee, trim, loop, fade, marker, velocity, sustain, and resize handlers.
- Do not add two-finger pan unless a product requirement explicitly asks for it.

### Implementation Rules

- Classify input through shared helpers instead of ad hoc `touches` checks.
- Let single-finger background/body touch bubble to the scroll container unless an edit gesture is confirmed.
- Call `preventDefault()` only after the user is on an explicit edit target or a gesture has crossed the edit threshold.
- Use movement thresholds to distinguish tap from drag.
- Use long-press timers only for surfaces that intentionally support touch marquee.
- Keep touch hit targets larger than visual handles when needed.

### Performance Rules

- Avoid calling React state setters on every raw `touchmove` or wheel event.
- Batch zoom and high-frequency gesture updates through `requestAnimationFrame`.
- For Konva layers that redraw during scroll or drag, prefer `batchDraw()` when the layer can update without a React render.

---

## Common Mistakes

1. **Incorrect Broadcasting** — Ephemeral events must use `socket.to()` (exclude sender), while commit events must use `namespace.to()` (include sender).
2. **Editing Without Checking Occupancy Ownership** — Must be `holders[0]` (the occupancy queue owner) before mutating a region/chord-block/companion-region; see "Collaborative Editing (Element Occupancy)".
3. **Saving Without Checking Project Owner** — BR-12 is enforced on both FE and BE.
4. **Not Using Mutex** — Every Redis write must pass through the per-room mutex (TR-2).
5. **Track Count > 64** — Must reject if the limit is exceeded (TR-7).
6. **Merging State Instead of Replacing** — On reconnection, must replace with the full state from the BE.
7. **Duplicating beat/time-signature formulas** — Use shared helpers for `quarterNoteMs`, `quarterNotesPerBar`, and native beat scaling; local formulas drift across compound meters.
