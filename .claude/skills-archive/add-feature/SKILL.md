---
name: add-feature
description: How to create a new feature module following project conventions — FE feature-based structure and BE Domain-Driven Design (DDD) structure.
---

# Adding a New Feature Module

This skill covers creating new feature modules in both Frontend and Backend following project conventions.

> **i18n (TR-35):** any user-facing string in a new frontend component must use a Lingui macro (`<Trans>` for JSX, `` t`...` `` for attrs/toasts) — bare literals fail lint. After adding strings, run `bun run i18n:extract` → translate `th` → `bun run i18n:compile`. See [`app/frontend/docs/I18N.md`](../../../app/frontend/docs/I18N.md).

## Frontend: Feature-Based Structure

All features live under `app/frontend/src/features/<feature-name>/`.

### Standard Feature Folder Structure

```
app/frontend/src/features/<feature-name>/
├── components/          # React components (UI)
│   ├── MyComponent.tsx
│   └── index.ts         # Barrel export
├── hooks/               # Custom React hooks
│   └── useMyFeature.ts
├── stores/              # Zustand stores
│   └── myFeatureStore.ts
├── services/            # Business logic, API calls, audio services
│   └── myFeatureService.ts
├── types/               # TypeScript types/interfaces
│   └── index.ts
├── constants/           # Feature-specific constants
│   └── index.ts
├── utils/               # Utility functions
│   └── helpers.ts
├── __tests__/           # Tests
│   └── myFeature.test.ts
└── index.ts             # Public barrel export for the feature
```

### Barrel Export Pattern

Every feature must have an `index.ts` that exports its public API:

```typescript
// app/frontend/src/features/<feature-name>/index.ts
export { MyComponent } from './components/MyComponent';
export { useMyFeature } from './hooks/useMyFeature';
export { useMyFeatureStore } from './stores/myFeatureStore';
export type { MyFeatureType } from './types';
```

### Existing Feature Modules (FE)

- `audio/` — Audio engine, Web Audio API, Tone.js integration
- `effects/` — Audio effects chain (reverb, delay, distortion, etc.)
- `instruments/` — Virtual instruments (keyboard, guitar, bass, drum pad, synth)
- `sequencer/` — Step sequencer
- `metronome/` — Metronome sync
- `rooms/` — Room management (shared/, perform/, arrange/)
  - `rooms/shared/` — Shared room logic (socket, hooks, contexts)
  - `rooms/perform/` — Perform room specific
  - `rooms/arrange/` — Arrange room (DAW) with stores/, hooks/, components/, services/
- `auth/` — Authentication
- `lobby/` — Lobby page
- `ai/` — AI generation features
- `band/` — Band management
- `projects/` — Project management
- `feedback/` — User feedback
- `ui/` — Shared UI components

### Import Conventions (FE)

Use path aliases defined in `tsconfig.json`:

```typescript
import { useRoomStore } from '@/features/rooms';
import { useUserStore } from '@/shared/stores/userStore';
import { AUDIO_CONFIG } from '@/features/audio/constants/audioConfig';
import type { Track } from '@/features/rooms/arrange/types/arrange';
```

### Layer placement (TR-38) — which folder does new code belong in?

On top of the feature axis there is a **lint-enforced one-way dependency direction**
`shell (pages) → feature → driver → engine → shared` (same-tier `feature → feature` allowed).
Additionally, inside `src/features/rooms/` the silos `rooms/perform` and `rooms/arrange` **must
never import each other** (lint-enforced, FC-1) — code needed by both rooms goes in
`rooms/shared` (the only element allowed to reach both), an ordinary feature, or the engine.
Put new code in the **lowest layer that fits**, and never import "upward":

| New code is… | Goes in | May import |
|---|---|---|
| room-agnostic capability core (instrument/synth/effect DSP, AudioContext, the `NoteEvent` seam) — **no `if perform/arrange`** | `src/engine/` | engine, shared |
| translation of a room's control model → engine `NoteEvent`s (perform=live@now, arrange=scheduled@t) | `src/drivers/` | engine, shared |
| UI + state + wiring of a product capability | `src/features/<feature>/` | feature, driver, engine, shared |
| generic leaf utility/type | `src/shared/` | shared only |

Enforced by `eslint-plugin-boundaries` + a **shrink-only** `eslint-suppressions.json` baseline —
a new upward/cross-layer edge **fails lint**. Engine capabilities already live in `src/engine/`
(migration complete 2026-07-06); a few `shared → feature` grandfathered edges remain, so new code
must respect the direction even where those neighbours don't yet. `src/drivers/` is reserved (thin
seams deferred by design).
See [TR-38 ADR](../../../docs/adr/2026-07-05-room-engine-relayering.md) + [backlog](../../../docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md).

---

## Backend: Domain-Driven Design (DDD) Structure

All domains live under `app/backend/src/domains/<domain-name>/`.

### Standard Domain Folder Structure

```
app/backend/src/domains/<domain-name>/
├── domain/              # Core business logic (no framework dependencies)
│   ├── models/          # Domain models / entities
│   │   └── MyModel.ts
│   ├── services/        # Domain services (pure business logic)
│   │   └── MyDomainService.ts
│   └── interfaces/      # Repository interfaces / ports
│       └── IMyRepository.ts
├── application/         # Application services (orchestration layer)
│   └── MyAppService.ts
├── infrastructure/      # External concerns (DB, HTTP, Socket handlers)
│   ├── handlers/        # Socket.IO event handlers
│   │   └── MyHandler.ts
│   ├── controllers/     # HTTP controllers (Express)
│   │   └── MyController.ts
│   ├── repositories/    # Database repositories (Prisma)
│   │   └── MyRepository.ts
│   ├── services/        # Infrastructure services (Redis, external APIs)
│   │   └── MyInfraService.ts
│   └── routes/          # Express route definitions (if domain has own routes)
│       └── myRoutes.ts
└── __tests__/           # Tests
    └── myDomain.test.ts
```

### Existing Domains (BE)

- `room-management/` — Room lifecycle, membership, broadcasting, instrument swap
- `perform-room/` — Perform room state (Redis), event handling
- `arrange-room/` — Arrange room state (Redis), tracks, regions, MIDI, locking
- `auth/` — Authentication (JWT, OAuth, email verification)
- `user-management/` — User profiles, settings
- `lobby-management/` — Lobby state, room listing
- `real-time-communication/` — WebRTC signaling, voice chat
- `media-encoding/` — Audio routing, note playing, HLS broadcast
- `ai-generation/` — AI music generation (OpenAI, Gemini)

### Registering a New Domain

1. **Socket handlers**: Wire up in `app/backend/src/index.ts` where namespaces are created
2. **HTTP routes**: Add to `app/backend/src/routes/index.ts` via `router.use('/path', myRoutes)`
3. **Domain routes**: If the domain has its own route file, import and mount it

### Shared Infrastructure (BE)

Located at `app/backend/src/shared/`:

- `constants/` — EventNames, SyncConfig
- `domain/room-state/` — BaseRoomState, BaseRoomStateService (Redis + mutex)
- `infrastructure/handlers/` — BaseSocketHandler, BaseRoomHandler
- `infrastructure/caching/` — RedisStateService
- `infrastructure/logging/` — LoggingService
- `infrastructure/resilience/` — Error recovery, connection health

## Checklist for New Feature

### Frontend
- [ ] Create feature folder under `src/features/`
- [ ] Add `index.ts` barrel export
- [ ] Create Zustand store if stateful (see `zustand-store` skill)
- [ ] Add socket event listeners if real-time (see `socket-events` skill)
- [ ] Add types in `types/` folder
- [ ] Wire up in parent component or route

### Backend
- [ ] Create domain folder under `src/domains/`
- [ ] Define domain models in `domain/models/`
- [ ] Create application service in `application/`
- [ ] Create handler/controller in `infrastructure/`
- [ ] Register routes in `src/routes/index.ts` or socket events in `src/index.ts`
- [ ] Add event names to `shared/constants/EventNames.ts` if real-time
- [ ] Add rate limits if needed

### Docs — Global contracts (only if the feature touches them)
- [ ] New REST endpoints → update `docs/API_CONTRACT.md`
- [ ] New/changed Socket.IO events → update `docs/WS_CONTRACT.md`
- [ ] New/changed Prisma models or enums → update `app/backend/docs/DATABASE.md`
- [ ] New business rule or technical constraint → update `docs/RULES_AND_CONSTRAINTS.md`
- [ ] New shared constant (EventNames, SyncConfig, NamespacePaths) → update `docs/CONSTANTS.md`

If none of the above apply, no global-contract update is needed. Do not update docs speculatively.

### Docs — Feature codebase reference (for any non-trivial feature)

A feature complex enough to need explaining gets exactly **one** codebase
reference — the evergreen "what exists / how it works now" map. This is what
makes the feature **self-describing**, so `doc-sync` and other agents discover it
without anyone editing a skill. Follow
[`docs/DOCUMENTATION_STRUCTURE.md`](../../../docs/DOCUMENTATION_STRUCTURE.md).

- [ ] Create the reference where the convention says:
  - cross-cutting (shared + BE + FE) → `docs/<feature>/README.md`
  - frontend-local → `app/frontend/src/features/<feature>/README.md`
  - backend-local domain → `app/backend/src/domains/<domain>/README.md`
- [ ] Line 1 is the marker `<!-- doc-sync: codebase-reference -->` (this is how it's discovered)
- [ ] Include a `## Code map` table (real file paths → responsibility)
- [ ] Include an `## Invariants & gotchas` section (the per-feature sync points)
- [ ] Put any genre studies / pattern surveys / "options considered" in `docs/<feature>/research/`, **not** in the reference
- [ ] Link the reference from `CLAUDE.md` §5 (Feature & Domain READMEs)

See [`docs/companion/README.md`](../../../docs/companion/README.md) as the
reference implementation.

### Codify invariants — don't rely on prose (strongly preferred)

Per `docs/DOCUMENTATION_STRUCTURE.md` §3, prefer a guard the build/CI enforces
over a sentence a future auditor must re-read:

- two lists that must match → a **parity test**
- several things derived from one set → a **single source-of-truth constant** they all import
- a closed set of variants → an **exhaustive `switch`** ending in `const _x: never = …`
- a field that must propagate (cache key, serialized state) → a **test asserting it**

List codified invariants in the reference's "Invariants & gotchas" *marked as
codified*, so readers know the guard exists and `doc-sync` can skip re-checking it.
