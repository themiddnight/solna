---
name: understanding-project
description: Comprehensive guide to understanding the murva project structure, architecture, and tech stack.
---
# Understanding the murva Project

Follow these steps to quickly gain a deep understanding of the project's vision, architecture, and codebase.

## 1. Product Context & Vision
Start by understanding *what* we are building. The frontend README contains the product vision and feature overview.

1. Read **`app/frontend/README.md`** to understand:
   - The core mission (Real-time collaborative music making).
   - The distinction between **Perform Rooms** (Live Jamming) and **Arrange Rooms** (Collaborative DAW).
   - Key features like Music Theory Assistance and Audio/MIDI capabilities.

## 2. Backend Architecture (The Foundation)
Understand how the system handles real-time data and persistence.

1. Read **`app/backend/README.md`** for a high-level overview of the stack (Node/Express, Prisma, Socket.IO, WebRTC).
2. Read **`app/backend/docs/ARCHITECTURE.md`** for:
   - Domain-Driven Design (DDD) structure.
   - Dual-room architecture details.
   - Real-time Sync Architecture (per-room mutex, ephemeral/commit pattern, collaborative locking, rate limiting).
   - Service organization.

## 3. Frontend Architecture (The Experience)
Understand how the UI and client-side logic are organized.

1. Read **`app/frontend/docs/ARCHITECTURE.md`** + `app/frontend/README.md` to understand the **three architecture axes that stack** (this is the standard all new code follows):
   - **Feature-based structure (TR-37)** — domain logic in `src/features/<feature>/`; `src/pages/` are route shells only; cross-feature imports go through a feature's public barrel. Room code nests under `src/features/rooms/{perform,arrange,shared}/`.
   - **Unidirectional Data Flow / UDF (TR-36)** — `event → store action → Zustand store → selector → UI` (side-effects via `subscribe`). One store per state; components write via named actions only (no `getState`/`setState` in components — ESLint error). [ADR](../../../docs/adr/2026-07-05-frontend-unidirectional-data-flow.md)
   - **Capability layers (TR-38)** — a **lint-enforced one-way dependency direction** `shell (pages) → feature → driver → engine → shared`. `src/engine/` = room-agnostic capability core (audio, instruments, effects DSP, the `NoteEvent` seam — no perform/arrange awareness); `src/drivers/` = translate a room's control model → engine `NoteEvent`s. **Migration complete (2026-07-06)**: engine capabilities (audio, instruments, effects) now physically live in `src/engine/` (importing 0 features, full matrix lint-enforced). `src/drivers/` is **reserved** — the thin live/scheduled seams are deliberately deferred until the perform/arrange input paths are decomposed; a few `shared → feature` edges remain as permanent grandfathers (voice/recording/sequencer/companion + effect-catalog UI intentionally stay feature-layer). Status + rationale: [`docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md`](../../../docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md). [ADR](../../../docs/adr/2026-07-05-room-engine-relayering.md)
   - Store design (Zustand), Audio Engine routing (Web Audio API + Tone.js in `src/engine/`), Ephemeral/Commit sync, lock management, reconnection reconciliation.

## 4. Rules & Constraints
Before diving into code, understand the enforced rules that govern the system.

1. Read **`docs/RULES_AND_CONSTRAINTS.md`** for:
   - **Foundational Concepts (FC)**: Basic domain models such as Perform Room vs Arrange Room (FC-1), User Type Hierarchy (FC-2: REGISTERED/ARTIST/PRO + unauthenticated guests), Room Owner vs Project Owner (FC-3: Clearly separated), and Room Role Hierarchy (FC-4: room_owner/band_member/audience) — concepts that define the entire system structure.
   - **Business Rules (BR)**: Product-level constraints that affect user experience (e.g., 1 project = 1 active Arrange Room, Project Owner auto room_owner, Project Lock, Project Tool Availability).
   - **Technical Rules (TR)**: Architectural patterns enforced internally (e.g., ephemeral/commit event pattern, per-room mutex, broadcasting strategy).

## 5. Key Integration Contracts
Review the contracts between Frontend and Backend. These docs are kept up-to-date with recent architectural changes.

1. **API**: Read **`docs/API_CONTRACT.md`** for REST endpoints.
2. **Real-time**: Read **`docs/WS_CONTRACT.md`** for Socket.IO event schemas (includes ephemeral/commit sync pattern, commit events, rate limiting tiers, project owner auto-join behavior, and `room:state_updated` broadcast changes).
3. **Database**: Read **`app/backend/docs/DATABASE.md`** for the Prisma schema, ER diagrams, and core model descriptions.
4. **Redis Keys**: Read **`app/backend/src/shared/constants/RedisKeys.ts`** for all centralized Redis key patterns (room metadata, room users, room state, project mapping, sessions, rate limiting). All keys are automatically namespaced with `collab:` by `RedisStateService`.
5. **Cache Keys**: Read **`app/backend/src/shared/constants/CacheKeys.ts`** for all centralized NodeCache (in-memory L1) key patterns (room cache, room list cache). Separate from Redis keys — per-instance only, not shared across server instances.
6. **Sync Config**: Read **`shared/src/constants/SyncConfig.ts`** for shared throttle/lock constants used by both FE and BE.

## 6. Deep-Dive Docs

### Backend

| Doc | Content |
|-----|---------|
| `app/backend/docs/ARCHITECTURE.md` | High-level architecture (including diagrams), DDD layer flow, room lifecycle, auth flow, ERD |
| `app/backend/docs/DEVELOPMENT.md` | Definition of Done, comprehensive Jest suite (~180 test files), WebRTC config, debug tips |
| `app/backend/docs/DEPLOYMENT.md` | Env vars reference, Docker, Railway, SSL/TLS, health checks |
| `app/backend/docs/PERFORMANCE.md` | Worker threads, AI job queue, clustering, memory pressure, graceful degradation |
| `app/backend/docs/PROJECT_SAVE_SYSTEM.md` | Smart save behavior, save lock, permission matrix, troubleshooting |
| `app/backend/src/domains/room-management/application/ROOM_LIFECYCLE.md` | Ghost cleanup layers, deletion triggers, room lifecycle details |
| `app/backend/src/domains/room-management/application/PROJECT_OPENING_FLOW.md` | Owner vs member join flows, modal UX, error scenarios |

### Frontend

| Doc | Content |
|-----|---------|
| `app/frontend/docs/ARCHITECTURE.md` | App architecture (including diagrams), state management, audio signal routing, DAW data flow |
| `app/frontend/docs/DEVELOPMENT.md` | Getting started, HTTPS setup, REST/WebSocket patterns, Vitest, code style |
| `docs/AUTHENTICATION_FLOW.md` | OAuth flows, token management, auth architecture |

## 7. Key Patterns & Architectural Decisions
Understand key refactors and design decisions that shaped the current codebase.

### Key Patterns to Know
- **`useRoomSocket`** (`features/audio/hooks/useRoomSocket.ts` + `roomSocket/useRoomJoinFlow.ts`) emits `join_room` after socket connect — prevents race conditions
- **Project owner auto-join**: Project owner automatically becomes `room_owner` and bypasses private room approval (handled in `RoomLifecycleHandler.handleJoinRoom`)
- **Dual room architecture**: Perform Rooms for live jamming, Arrange Rooms for collaborative DAW production
- **Ephemeral/Commit pattern**: High-frequency events (drag, knob, slider) broadcast only during interaction; final state committed to Redis on interaction end. In Perform rooms, synth params and effects chain use debounced commit (1s after last change) to persist to Redis.
- **Per-room mutex**: `BaseRoomStateService` uses a **Redis distributed lock** (key pattern `room-state-mutex:${roomId}`) to prevent race conditions in Redis read-modify-write across server instances
- **Lock TTL**: Collaborative locks auto-expire after 5 minutes (`LOCK_TTL_MS` in `shared/src/constants/SyncConfig.ts`)
- **Reconnection reconciliation**: On socket reconnect, FE clears local locks and requests fresh state
- **Broadcasting strategy**: Mutation events use `socket.to()` (exclude sender), commit/lock events use `namespace.to()` (include sender)
- **Email service**: Uses Resend (not SendGrid) for email notifications
- **AI Generation**: Supports OpenAI and Gemini providers with job queue system for concurrency control
- **State management**: Redis-only persistence strategy for room state (24-hour TTL)
- **Room restart survival**: Rooms persist in Redis and survive server restarts. A 2-minute reconnection window allows users to rejoin before ghost user cleanup runs (`RoomRepository.isInReconnectionWindow()`, `RoomLifecycleService.cleanupGhostUsers()`)
- **Private room join flow**: Room owners bypass approval, approved members (in `bandMembers`) rejoin directly, grace period users rejoin directly. Only new users are redirected to `/approval/{roomId}` namespace. Key file: `RoomLifecycleHandler.handleJoinRoom`
- **Dynamic namespace middleware safety**: Won't delete rooms younger than 30 seconds (owner hasn't connected yet) or during the reconnection window after restart
- **Room Owner vs Project Owner separation (FC-3)**: In Arrange Rooms, room owner (room management) and project owner (project permissions) are distinct entities. Project owner gets auto-transferred to room_owner role when joining (BR-2). Project tools (import/export/DAW/mixdown) are available only to project owner or in new rooms without owner (BR-12).
- **Project save flow**: Uses FormData for multipart file uploads (replaced base64 JSON). Audio files compressed to opus 192kbps .ogg via ffmpeg. Old file versions deleted from Backblaze before saving to prevent accumulation.
- **Save button behavior**: Shows "New Save" for first-time save in new rooms, "Save" for subsequent saves or existing projects. After first save, `roomProjectOwnerId` is set and project tools become restricted to owner only.
- **Contributor auto-tracking (BR-13)**: Non-owner users who save projects with access (BAND/PUBLIC) are automatically tracked as contributors via `ProjectContributor` table. Displayed as "Top 3 + Tooltip" on Profile/Band/Community pages. Tracked with `lastContributedAt`.
- **Fork workflow (BR-7)**: Public projects with `allowFork = true` can be forked. Fork checks project limit → shows replace modal if needed → creates copy with `${name} (Fork)`, `allowFork = false`, `forkedFromId` reference. Cannot fork own projects or fork a fork.
- **Navigation pattern**: Leave room uses `navigateAfterLeave(navigate)` — returns to a recorded origin (the last returnable page, captured app-wide by `useTrackRoomReturnOrigin` in sessionStorage), else the lobby; not `navigate(-1)` (fragile against invite-link entry and room swaps). Room switching uses `navigate(path, { replace: true })` to replace the history entry and prevent returning to the old room. Never use `window.location.href` for in-app navigation — it tears down the page and destroys the AudioContext.
- **Error recovery**: `ROOM_NOT_AVAILABLE` error type stops retry immediately (NO_ACTION) and disconnects socket to prevent infinite loop. Ghost room modal is non-dismissible and forces user to click "Go Back".
- **Cache Clearing**: React Query cache (`queryClient`) must be cleared on logout and when leaving a room/session to prevent stale data (especially for user-specific data like "Owned Projects"). Use `useAuth` hook or `queryClient.clear()` method.
- **Stale Room Validation**: Important pattern to prevent "Room not found" errors when navigating to a project's `activeRoomId`. Always call `checkRoomExists(roomId)` after `getActiveRoomInfo(projectId)` to ensure the room ID in the database still exists in Redis. If `exists: false`, fallback to creating a new room instead of navigating. Applied in `features/rooms/shared/hooks/useJoinRoom.ts` and `useLobby.ts` (called from the lobby/page layer).
- **Band Companion (AI Companions)**: Server-scheduled virtual musicians in Perform Rooms. `CompanionScheduler.processTick()` runs on every metronome beat and emits `COMPANION_NOTE_EVENTS` to clients for local audio rendering — notes are never sent through the network stream. Companion config (instrument, style, role, playback params) is stored as part of `PerformRoomState.companions[]` in Redis and synced via `companion_state_sync`. Max 5 companions per room; accessible to `room_owner` and `band_member` only (audience is read-only). **Harmony is room-global, voicing is per-companion**: which chord plays (chord progression, chord length, and `companionProgressionFlavor`) lives on room state and is shared by all companions; how each companion voices/embellishes that chord (complexity, voicing, bass passing, swing, etc.) stays per-companion. Chord progression has an **Auto** (deterministic Markov) and a **Manual** mode (degree-based Roman-numeral editor with borrowed chords + per-step tension modifiers, edited in a modal behind a room-global advisory lock). Both modes resolve through the shared chord-symbol layer. Key files: `CompanionScheduler.ts`; `ChordProgressionEngine.ts` (shared, used by BE); shared `music/chordSymbol.ts` + `music/chordModifiers.ts`; `useCompanionAudio.ts` (`features/rooms/perform/hooks/`), `CompanionSettingsPopup.tsx` + `stage/CompanionStageControls.tsx` + `stage/ManualProgressionEditor.tsx` / `ManualProgressionEditorModal.tsx` + `stage/StageCompanionCard.tsx` (`features/rooms/perform/components/`), `stores/performCompanionProgressionLockStore.ts` (FE).
- **Shared Time Signature Helpers**: `shared/src/music/timeSignature.ts` is the source of truth for quarter-note BPM duration, native beat scaling, quarter-note beats per bar, bar snapping, and sequencer-safe integer lengths. Use these helpers across Perform Room, Arrange Room, Sequencer, Metronome, and Companion code instead of local formulas.

> **Tip**: For skill routing (which skill to read for which task), see `orchestrator` skill or `CLAUDE.md` §6.
