---
name: perform-room
description: Perform Room (Live Jamming) — instruments, synth/effects sync, step sequencer, session recording, shadow capture, HLS broadcast, metronome. Read before any Perform Room work.
---

# Perform Room Skill

Read every time before working on Perform Room features — live jam, instruments, sequencer, recording, HLS.

**Full event doc:** `docs/WS_CONTRACT.md` → Section 2, 7, 9, 14 (Element Occupancy — companion volume/settings/progression collaborative locking)
**Architecture:** `app/backend/docs/ARCHITECTURE.md` → Perform Room section
**Rules:** `docs/RULES_AND_CONSTRAINTS.md` (FC-1, TR-1, TR-6, BR-14)

---

## Core Concepts

A Perform Room is an **ephemeral live jamming session** — it is not tied to a project, and its state is lost when the room closes (except for session recordings → BR-14).

### State Model

```typescript
// PerformRoomState (Redis key: perform:state:{roomId})
{
  roomId, roomType: "perform", bpm, timeSignature, lastUpdated,  // BaseRoomState
  userStates: Map<userId, UserPerformState>,  // per-user instrument + synth + effects
  recordingStates: RecordingState,
  broadcastStates: BroadcastState,           // HLS broadcast
  voiceStates: VoiceState,
  roomScale: { rootNote, scale },            // room's shared scale (sync to members)
}
```

### Key Files

| Layer | File |
|---|---|
| BE Domain | `app/backend/src/domains/perform-room/` |
| BE State Service | `domains/perform-room/application/PerformRoomStateService.ts` |
| BE Handler | `domains/perform-room/infrastructure/handlers/PerformRoomHandler.ts` |
| BE Event Handler | `domains/perform-room/infrastructure/handlers/PerformEventHandler.ts` |
| FE Feature | `app/frontend/src/features/rooms/perform/` |
| FE Sync Service | `features/rooms/perform/services/performSyncService.ts` |
| FE Controller | `features/rooms/perform/hooks/usePerformRoomController.ts` |

---

## Ephemeral / Commit Pattern (TR-1)

Perform Room uses a **1-second debounced commit** (unlike Arrange Room, which uses `mouseup`).

| Event | Redis Write? | Broadcast | Throttle |
|---|---|---|---|
| `perform:update_synth_params` | ❌ NO | `socket.to()` — exclude sender | `PERFORM_SYNTH_THROTTLE_MS` (10ms) |
| `perform:synth_params_commit` | ✅ YES | `namespace.to()` — include sender | debounce 1s |
| `perform:update_effects_chain` | ❌ NO | `socket.to()` | `PERFORM_EFFECTS_THROTTLE_MS` (33ms — receivers rebuild the effect graph per message) |
| `perform:effects_chain_commit` | ✅ YES | `namespace.to()` | debounce 1s |

**Auto-commit safety net (TR-10):** If an ephemeral event is not followed by a commit within 10s → auto-commit.

---

## Instrument Events

```typescript
// Instrument change
perform:instrument_changed → { userId, instrument, category }
// Response: Broadcast to all (namespace.to)

// Note playing (real-time)
perform:note_played    → { userId, note, velocity }   // Ephemeral, no Redis storage
perform:stop_all_notes → { userId }                   // Stop all notes for a user

// Instrument swap (requires approval — §4 Instrument Swap Events)
perform:request_instrument_swap → { targetUserId, synthParams?, sequencerState? }
perform:approve_instrument_swap → { ... }
perform:reject_instrument_swap  → { ... }
perform:cancel_instrument_swap  → { ... }
perform:swap_error              → { message, code? }  // validation failure (socket.emit)
```

Perform Room uses **Eager loading** — loading instrument engines for all users immediately upon joining.
(Unlike Arrange Room, which uses **Deferred loading** until the first user interaction.)

---

## Step Sequencer

```typescript
// Pattern sync (per-user patterns — §2.8.1)
perform:sequencer_update → { sequencerState: { beats, selectedBeat?, editMode? } }  // persists to sender's user state in Redis, then rebroadcasts
perform:sequencer_updated → { userId, sequencerState }                              // namespace.to (incl. sender)

// Late-joiner snapshot sync (§4.5/4.6)
perform:request_sequencer_state → { targetUserId }                        // new user asks one existing user (BE forwards sequencer_state_requested { requesterId })
perform:send_sequencer_state   → { targetUserId, snapshot: { banks, settings, currentBank } } // full snapshot to that user
// Snapshot arrives on: perform:sequencer_state → { fromUserId, snapshot }
```

BPM changes inside the sequencer go through `perform:bpm_changed` (same as transport).

- Patterns are per-user (each user has their own pattern).
- For scale view in the sequencer → see the `music-theory` skill.
- Drum mode: GM percussion, unaffected by scale settings.
- Pattern length/bar snapping must use `@jam-band/shared` time-signature helpers (`quarterBeatsToNearestSequencerBars`, `sequencerBarsToLength`, `getSequencerSafeBarOptions`) so compound meters such as 9/8 keep integer step counts.

---

## Collaborative Locking — Companion Controls (Element Occupancy, DEV-350)

A companion's volume fader, each settings-panel control (`controlKey`), and the manual chord-progression editor are gated by the same room-agnostic **element occupancy** queue Arrange Room uses for regions/tracks/chord-blocks (`RoomOccupancyService`, `OCCUPANCY_EVENTS` — see the `arrange-room` skill's "Collaborative Editing" section for the shared mechanics). This **replaced** three dedicated lock event pairs that no longer have a live backend handler:

- `perform:companion_volume_lock`/`_unlock` (companion volume fader)
- `perform:companion_settings_lock`/`_unlock` (each companion settings control, keyed by `controlKey`)
- `perform:companion_progression_lock`/`_unlock` (the Manual Setup chord-progression editor)

Each of the above is now one `elementId` in the shared occupancy keyspace (`kind: 'primitive'` — at most one holder). `PerformEventHandler` registers `occupancy:join`/`occupancy:leave`/`occupancy:heartbeat` in their place (same Zod schemas as Arrange). Per-user cleanup on leave/disconnect emits `occupancy:left` once per held element (`releaseAllOccupancyForUser`) instead of the old blanket `perform:companion_release_user_locks` broadcast.

**Partly cleaned (DEV-350 Round 9):** `performSyncService.ts`'s `socket.on` listeners and `sync*Lock`/`Unlock` emitters for those retired events are **gone** — nothing had consumed their callbacks since the migration. The `PERFORM_EVENTS.COMPANION_*_LOCK`/`_UNLOCK`/`_RELEASE_USER_LOCKS` constants and their `rateLimit.ts` entries are still present but dead; removing those is still deferred.

Full wire protocol + payload shapes: `docs/WS_CONTRACT.md` §14 (canonical, shared with Arrange) and §2.3.12/§2.3.15 (Perform-specific retirement notes). Design rationale: `docs/superpowers/plans/2026-08-18-lock-presence-occupancy-queue.md`.

### Companions Panel Container & Perform Synth Params (DEV-350 Round 2, Task 20)

- **Companions panel takes NO lock (DEV-350 Round 9, replacing Task 20's container lock).** `CompanionStageControls` can be pinned open while the user works elsewhere, so "expanded" never meant "editing": one lock for the whole strip was held by anyone who merely left it open and renewed forever by the heartbeat, and nothing reaps a container hold. Expand/collapse is now local view state — no join, no leave, no header badge, no unmount-release net. `getCompanionsPanelLockId()` (`'popup:companions-panel'`) is retained but unused by this panel. Its controls are all discrete, so presence comes from **attribution** instead: `getCompanionsPanelControlLockId(controlKey)` → `companions-panel:{genrePreset|embellishmentIntensity|overrideInstruments}`, fed by `COMPANION_STATE_SYNC`'s `changedRoomControls` (WS_CONTRACT §2.3.8) and rendered per control by `ControlPresenceBadge`.
- **Vocabulary:** the panel's two dropdowns hold a **select lock** (`primitive`, held while open); its buttons/chips are discrete and carry **attribution** badges only. Presence is always the floating `PresenceBadge` — the inline amber chip that used to sit beside Auto/Manual is gone, and it now hangs off the Manual Setup button (the control that opens the editor). See WS_CONTRACT §14 for "select lock", "Badge layering" and the occupied-vs-restricted split.
- **The per-companion settings popover KEEPS its container lock** (`companion-settings:{id}`) — it is modal in spirit: opened to change something, closed when done. Round 9 changed only what a non-owner sees: a `ReadOnlySurface` (dimmed, still readable and scrollable, edit gestures swallowed) instead of a blanket `disabled` cascade. `isAudience` stays a hard `disabled` — a restriction, not a queue. Do not conflate this popover with the panel above; they are deliberately different shapes for deliberately different reasons (WS_CONTRACT §14, "Container-lock scope").
- **Perform synth params have NO lock at all** — deliberately, not an oversight. `getParamLockProps`/any per-knob occupancy wiring was tried and reverted. Reason: `PerformEphemeralParamsHandler.ts` persists synth params keyed by `userId` — each player has their own private set, broadcast with `userId` and applied only to that player's own audio nodes on remote clients. There is no shared value for a lock to protect: a room-global lock made one player's knob-drag disable a completely different player's own, unrelated knob and mislabel it as "locked by" the wrong person. **Contrast with Arrange**, where synth params ARE locked — Arrange's are shared per-track state, not per-user, so the same reasoning does not apply there. Do not add a Perform synth-param lock back without re-deriving this from `updateUserState(roomId, session.userId, { synthParams })` first.
- Attribution on **Perform synth params** stays rejected for the per-user-private-state reason above — there is no shared value whose "who touched it" is meaningful across users. The companions panel's own controls ARE shared room state, and they are attributed as of Round 9 (see the panel bullet above).
- Badge placement / TTL split: same rules as Arrange (see the `arrange-room` skill's "Occupancy vs Attribution" note, TR-43/TR-4). The only `primitive` element here is `getCompanionVolumeLockId` (`companion:{id}:volume`) — a stale one is taken over after `PRIMITIVE_LOCK_TTL_MS` (30s). `getCompanionSettingsLockId` produces `companion-settings:{id}`, which `elementKindRegistry` classifies as a **`container`** — containers have **no enforced expiry** today: nothing reads `CONTAINER_LOCK_TTL_MS`, though the heartbeat itself does work end to end since Round 9 (see DEV-361 for the missing expiry reader). A container hold ends only when its holder leaves it or leaves the room.

---

## Recording Systems (3 Types)

### 1. Audio Recording — Mixed Output → WAV
```typescript
perform:recording_state_change → { updates: { isAudioRecording: true } }  // toggle (§2.8.2)
perform:recording_state_changed → { userId, updates }                     // namespace.to
```
- Records audio from all instruments and mixes them into a single file.
- Output: WAV file for user download.

### 2. Shadow Capture — Rolling 30s Buffer
```typescript
perform:shadow_capture_state_change → per-user rolling-capture toggle (also flows through recording_state_change.shadowCaptureStates)
perform:shadow_capture_state_changed → { userId, ... }
```
- The system captures audio continuously in the background.
- User clicks "Save Last 30s" → Saves what was just played.
- Useful when you improvise a great moment but forgot to hit record.

### 3. Session Recording → Project Conversion (BR-14)
```typescript
perform:recording_state_change → { updates: { isSessionRecording: true } }  // same generic event (§2.8.2)
// Afterwards (FE-side, no dedicated REST route):
convertSessionToProject(snapshot)  // features/rooms/shared/utils/sessionToCollabConverter.ts
```
- Records MIDI events and audio tracks separately (unlike mixed recording).
- Can be converted into a project in the Arrange Room (BR-14).
- Only the Room Owner can start a session recording — it becomes a new Arrange project owned by the room owner (BR-19), so band members get "Record Project" disabled (they may still record mixed audio).
- See `app/backend/docs/PROJECT_SAVE_SYSTEM.md` for the conversion flow.

---

## HLS Broadcast (Audience Mode)

- Only the Room Owner can be the broadcaster.
- Audience listens via HLS stream (not WebRTC).
- See the `webrtc-voice` skill for voice chat (separate from HLS).

```typescript
// HLS streaming — full contract: WS_CONTRACT §9 (Perform Broadcast Events)
perform:toggle_broadcast        → Owner toggles HLS broadcast (§9.1)
perform:broadcast_audio_chunk   → { chunk } — HLS audio chunk, base64, ~1 MB cap (§9.2)
broadcast_state_changed         → { isBroadcasting, playlistUrl } — global room broadcast toggle (no perform: prefix; emitted on toggle success/stop)
broadcast_error                 → Broadcast failure notification
perform:request_broadcast_state → Late-joiner pull

// Member-status broadcast flag — WS_CONTRACT §2.1.6, NOT the HLS toggle
perform:member_broadcast_state_change  → Client → Server { isActive } (member broadcast vs practice/local-only)
perform:member_broadcast_state_changed → Server → Clients { userId, username, isActive } (incl. sender)

// Audience join (TR-13: Audience uses HLS only — no WebRTC)
// Audience enters room at /perform/:roomId/audience
// Retrieves HLS stream URL from room state
```

**TR-13:** Audience members do not have a WebRTC peer connection — they listen via HLS only.

---

## Metronome & Timing Controls

```typescript
// MetronomeService init on room creation (unlike Arrange Room, which has no metronome)
metronome_anchor → { bpm, beatZeroAt, effectiveAtBeat? }  // Anchor-based client scheduling
perform:bpm_changed    → { bpm }             // Commit to Redis + broadcast to all

// Time signature (room_owner only)
perform:room_time_signature_update  → { numerator, denominator }   // Client → Server
perform:room_time_signature_updated → { timeSignature: { numerator, denominator }, userId }  // Server → All (incl. sender)
```

- BPM and time signature controls live in **`StageControlBar`** (alongside `MetronomeControls`) — **not** in the Room Settings modal.
  - BPM: `<MetronomeControls>` (editable by room_owner and band_member)
  - Time signature: `<TimeSignatureControl>` in `transport/TimeSignatureControl.tsx` (editable by room_owner only)
- Metronome beat duration is quarter-note based via `quarterNoteMs(bpm)` from `@jam-band/shared`; the denominator does not change tick duration.
- Time-signature conversion and bar math must use `shared/src/music/timeSignature.ts` helpers (`quarterNotesPerBar`, `nativeBeatScale`, `beatInBar`, `barsToQuarterBeats`) instead of local formulas.
- `MetronomeService` initializes automatically when a Perform Room is created.
- Companion scheduling runs server-side in quarter-note beat space and uses the same helper contract.

---

## Current Perform Room UI Layout

- Desktop keeps the global room action bar for invite, recording, broadcast, pending requests, room switch, ping, and leave actions.
- Tablet and desktop-sized viewports use the shared split-tab workspace shell:
  - Top tabs are `Virtual Stage` and `Instrument Settings`.
  - Bottom tabs are `Instrument Settings`, `Instrument Input`, `Sequencer`, and tablet/non-xl `Tools`.
  - Duplicate tabs are visible in both sections but active in only one section at a time. If `Instrument Settings` is active on top and the user selects it on the bottom, the top section falls back to `Virtual Stage`.
  - The shared shell renders each panel id once and moves it between top/bottom grid areas, so synth controls, instrument input, sequencer, and tools are not duplicated.
  - The bottom section height is persisted; active tabs are not persisted.
  - On `xl` desktop, `Tools` stays in the right sidebar instead of the bottom tab.
  - `Instrument Settings` shows a shared centered placeholder when the current instrument has no editable settings.
  - `VirtualStage` shows performers, companions, capped audience avatars, and a read-only room status summary for key/scale, BPM, and time signature.
  - `CompanionStageControls` overlays `VirtualStage`; its header has play/stop and quick-add controls, while the expanded panel exposes global chord duration plus shared genre/intensity controls for all stage companions.
- The desktop right sidebar is the `PerformSidebar` — `EffectsChainSection` on top, personal tools (`VoiceInputView`, scale slots, instrument selection, instrument broadcast/practice mode, MIDI setup, metronome controls, time signature controls) below.
- Mobile tabs are `Stage`, `Sequencer`, and `Input`; tools live in the `MobileBottomSheet` drawer — there is no separate mobile `Effects` tab.
  - Voice runtime is mounted once at the room page through `VoiceRuntimeProvider`; mobile/tab/sidebar surfaces render `VoiceInputView` controls from that runtime.
  - Do not move microphone/WebRTC runtime ownership into tab panels or sidebars.
- Room chat is handled by shared `RoomChatRoot` as a FAB/panel, not by a fixed sidebar.

---

## Scale Sync (Owner → Members)

```typescript
perform:room_scale_change  → { rootNote, scale }    // Client → Server (Owner only)
perform:room_scale_changed → { rootNote, scale, ownerId }   // Server → All members (incl. sender)
perform:toggle_follow_scale → { followScale }       // Client → Server
perform:follow_scale_toggled → { followScale, roomScale }   // Server → toggling client only
```

- Only the Room Owner can broadcast scale changes.
- Members toggle `followScale` to decide whether to receive scale updates.
- See the `music-theory` skill for scale types and keyboard modes.

### Unified scale model (DEV-226)

- **Shared key:** `roomStore.roomScale` — the room's scale, set by the owner via `perform:room_scale_change(d)`.
- **Personal:** `performScaleStore` — each user's own scale (independent of the room, includes the 10 scale slots).
- **Gate:** `followScale` — server-authoritative, stored on `BandMember`. Defaults to `true` for joining band members; the room owner is always `false` (owner is the source, not a follower).
- **Derived:** `resolveEffectiveScale(roomScale, personalScale, followScale)` (shared pure selector in `@jam-band/shared`) produces `effectiveScale`, exposed via the wrapper hook `usePerformEffectiveScale()`.
- **Consumers:** every instrument/sequencer/pitch-effect reads `effectiveScale` — never the raw `roomScale` directly. Room-key DISPLAY consumers (e.g. the `VirtualStage` status summary) read the raw shared key instead.
- Toggling follow only flips the flag — it never imperatively copies into personal state or overwrites saved scale slots.

---

## Grace Period (TR-6)

- **Owner disconnect:** grace period of **10 seconds** (`GRACE_PERIOD_OWNER_MS = 10_000` in SyncConfig)
  - If rejoin within 10s → Regain room_owner status.
  - If exceeds 10s → Auto-transfer ownership to the next person.
- **Regular member disconnect:** grace period of **30 seconds** (`GRACE_PERIOD_MEMBER_MS = 30_000`)
- Grace period is isolated per room — no cross-room effect.
- Disconnected users stay visible with "Reconnecting" status for the grace window (TR-6).

---

## Max Users

Perform Room has **no hard band-member cap**. `MAX_PARTICIPANTS = 10` in `AppConstants.ts` is a voice-heartbeat cap only, not a membership limit.

---

## Common Mistakes

1. **Using Arrange-style commit pattern** — Perform uses 1s debounce, not `mouseup`.
2. **Forgetting instrument eager loading** — Perform loads engines immediately, unlike Arrange Room.
3. **Confusing HLS with WebRTC** — Audience uses HLS only (TR-13), while voice chat uses WebRTC (separate system).
4. **Forgetting scale broadcast is owner-only** — Validate role before emitting.
5. **Incorrect grace period timeout** — Owner = 10s, Regular member = 30s (`GRACE_PERIOD_OWNER_MS` / `GRACE_PERIOD_MEMBER_MS` in SyncConfig).
6. **Duplicating time-signature formulas** — Do not use local `numerator * 4 / denominator`, `4 / denominator`, `60000 / bpm`, or `bars * numerator` formulas in Perform/Sequencer code; use shared helpers.
