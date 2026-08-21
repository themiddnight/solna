# README.md — murva Monorepo

> Unified repository for the murva collaborative music platform.
> Source of Truth: [`docs/RULES_AND_CONSTRAINTS.md`](docs/RULES_AND_CONSTRAINTS.md)

---

## Vision

murva is built around the idea that making music together shouldn't require expensive gear, deep theory knowledge, or being in the same room. The goal is to bridge the gap between casual jamming and serious production — a space where:

- **Beginners** can play without hitting wrong notes (Music Theory Assist handles the theory)
- **Musicians** can jam live with friends across the world in real-time
- **Creatives** can collaborate on full arrangements together, like Google Docs but for music

Two room types support the full creative arc: **Perform Room** for live jamming sessions, and **Arrange Room** for multi-track collaborative production.

---

## What It Does

murva lets you create music together with friends in real-time using **virtual instruments with music theory assistance** for low-mid level musicians, and **physical instrument support** for high-level players who want to plug in their real instruments.

**Perform Room** — Live jamming sessions with synchronized instruments, step sequencers, and ultra-low latency voice chat. Ideal for remote jam sessions, music lessons, or just having fun making music together.

**Arrange Room** — Collaborative production workspace where multiple users can simultaneously create tracks, record audio/MIDI regions, edit notes in a piano roll, and work on production projects in real-time. Multi-track timeline, region recording, MIDI editing, collaborative mixing — think Google Docs but for music production.

---

## Key Features

**User Profile & Band Management**
- Profile dashboard, band creation, member management
- Invite system with shareable links and email invitations
- Project organization (owned/contributed)

**Community & Projects**
- Browse and search public projects
- Active session detection and one-click join
- Smart save/fork system with contributor tracking
- Project visibility controls (public/private/hidden)

**Music Theory Assistance**
- Room-wide scale synchronization across all users
- Virtual keyboard modes: Basic, Melody (scale-only), Chord
- Hum-to-find scale (automatic key detection)
- Scale-aware sequencer and piano roll views
- 19 scales across 6 categories (powered by Tonal.js)

**Perform Room**
- Virtual instruments with real-time collaboration
- Ultra-low latency WebRTC voice chat
- Step sequencer with General MIDI percussion
- MIDI controller support (Chrome/Edge/Brave)
- Shadow capture (retroactive 30-second recording)
- Audio effects chains and PWA support

**Arrange Room**
- Multi-track timeline with audio/MIDI recording
- Piano roll editor with real-time collaboration
- Voice-to-MIDI (hum-to-MIDI) conversion
- Idea Capture (tap tempo + voice-to-MIDI with auto key detection)
- Tempo-synced audio with pitch correction
- Collaborative locking and presence tracking
- Stem export (audio stems + MIDI for Logic/Ableton/FL Studio)

---

## Structure

- **`app/backend`**: Node.js + Express + Socket.IO + Prisma + Redis. Handles real-time synchronization, database management, and WebRTC signaling.
- **`app/frontend`**: React + TypeScript + Zustand + Tone.js. The user interface and client-side audio engine.
- **`shared`**: Shared constants (EventNames, NamespacePaths, SyncConfig) and TypeScript interfaces used by both app packages.
- **`docs`**: Global project documentation, business rules, and technical constraints.

## Getting Started

This project uses **Bun** as the package manager and runtime.

### Prerequisites

- [Bun](https://bun.sh/) installed on your machine.
- PostgreSQL and Redis instances (or use the provided environment configuration).

### Installation

```bash
bun install
```

### Development

Run both frontend and backend in development mode:

```bash
bun run dev
```

Or run them individually:

```bash
bun run dev:be
bun run dev:fe
```

### Building

Build the shared package and then the applications:

```bash
bun run --cwd shared build
bun run build:be
bun run build:fe
```

## E2E Testing

Before running frontend E2E tests, make sure the backend is healthy at `http://localhost:3001`:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
curl -fsS http://localhost:3001/api/health/simple | grep '"status":"ok"'
```

> **Note:** This assumes `SSL_ENABLED=false` (the default). If SSL is enabled for WebRTC testing on real devices, use `https://` instead.

### E2E Seed Data

Several E2E tests (covering BR-2, BR-11, BR-12, BR-17) require E2E_USER1 to have at least one existing arrange project with a corresponding file in B2 storage. Without it, those tests call `test.skip()` silently.

**Run the seed script once after a DB reset or on a fresh environment:**

```bash
cd app/frontend
bun run e2e:seed
```

The script is idempotent — it checks for the fixture project (`[E2E] Arrange Base`) before creating it, so running it multiple times is safe. If the project already exists, it exits immediately without creating duplicates.

> **Note:** The backend must be running and `BUCKET_*` env vars must be configured (same credentials used by the backend). The script calls `POST /api/projects` which writes `project.json` to B2.

Then run commands from `app/frontend`:

```bash
cd app/frontend
```

### Test tiers

Tests are layered into four cost/infra tiers, run from the **repo root**. Full
model + which gate runs where: **[`docs/TESTING.md`](docs/TESTING.md)**.

```bash
bun run test:static        # Tier 1 — type + lint (incl. boundaries) + knip + build
bun run test:unit          # Tier 2a — all unit tests (no infra)
bun run test:integration   # Tier 2b — integration (needs Redis + Postgres)
bun run test:regression    # Tier 2c — regression-category tests
bun run test:e2e:all       # Tier 3 — e2e sequential + webrtc
bun run test:full          # Tier 4 — everything; run before merging to develop
bun run gate:prepush       # Tier 1 + unit — what the pre-push hook runs
```

> **Solo repo, no CI yet:** Tier 3–4 are manual. Run `bun run test:full` once
> before merging to `develop`. (When CI lands it will just call `test:full`.)

Fast local loop / optimized E2E:

```bash
bun run test:local:gate       # static + unit + e2e:fast — quick pre-work check
bun run test:e2e:fast         # auth parallel, room serial, realtime parallel, project serial (safe suite)
bun run test:e2e              # all E2E across chromium/firefox/webkit incl. webrtc; default 1 worker
bun run test:e2e:room:w1      # room lifecycle serial; ownership/approval/reconnect/switching
bun run test:e2e:parallel     # all chromium E2E (excludes webrtc), E2E_FULLY_PARALLEL=true
bun run test:e2e:sequential   # all chromium groups serial (excludes webrtc)
bun run test:e2e:webrtc       # all WebRTC cross-browser and interop tests
```

Important: `bun run test:e2e:parallel` attempts to run every Chromium E2E group in parallel, including `room-lifecycle`. It is useful as a stress validation, but it is not the default workflow because room lifecycle specs mutate ownership, approval state, reconnect/grace-period timers, socket namespaces, and Redis room state.

Current E2E scripts:

```bash
bun run test:e2e:ui
bun run test:e2e:headed

bun run test:e2e:auth
bun run test:e2e:room
bun run test:e2e:realtime
bun run test:e2e:project
bun run test:e2e:webrtc

bun run test:e2e:auth:w1
bun run test:e2e:room:w1
bun run test:e2e:realtime:w1
bun run test:e2e:project:w1
bun run test:e2e:webrtc        # WebRTC serial

bun run test:e2e:parallel:auth
bun run test:e2e:parallel:room
bun run test:e2e:parallel:realtime
bun run test:e2e:parallel:project

bun run test:e2e:auth:repeat
bun run test:e2e:room:repeat
bun run test:e2e:realtime:repeat
bun run test:e2e:project:repeat
bun run test:e2e:webrtc:repeat
```

E2E account pool behavior:

- `global-setup.ts` logs in every configured `E2E_USER{N}_*` account and writes `e2e/.auth/user{N}.json`.
- Multi-user fixtures use 3 accounts per worker: `page`, `user2Page`, and `user3Page`.
- `playwright.config.ts` caps workers to `floor(E2E_USER_COUNT / 3)` so parallel multi-user tests do not reuse accounts accidentally.
- For rules on where to place new E2E tests and whether they may run parallel, read [`.claude/skills/e2e-test/SKILL.md`](.claude/skills/e2e-test/SKILL.md).

## Git Hooks

Husky is enabled for local gating (see [`docs/TESTING.md`](docs/TESTING.md)):

- `pre-commit`: `lint-staged` — ESLint on **staged files only**, per workspace (fast).
- `pre-push`: `bun run gate:prepush` — Tier 1 (`test:static`: type + lint + knip + build) + Tier 2a (`test:unit`). Infra-free so pushes never block on Redis/Postgres.

Hooks do not run integration or E2E. Before merging to `develop`, run the full gate manually:

```bash
bun run test:full
```

## Deployment

The application is designed to be deployed using **Railway** with a containerized approach (Nixpacks/Docker).

### Hosting Provider
- **Infrastructure**: [Railway](https://railway.app)
- **Database**: PostgreSQL (Railway Managed)
- **Cache/State**: Redis (Railway Managed)
- **Object Storage**: Backblaze B2 (for audio files)

### Environment Configuration
Ensure all required environment variables are set in your hosting provider's dashboard. See `.env.example` in both `app/frontend` and `app/backend` for reference.

## Shared Elements

Shared constants and types are located in the `shared` package. When adding new events or shared logic, always update the `shared` package first:

1. Update `shared/src/constants/...` or `shared/src/types/...`
2. Run `bun run --cwd shared build`
3. Use the updated exports in `app/frontend` or `app/backend` via `@jam-band/shared`.

## Documentation (Continuous Documents)

Project documentation is located in the `docs` folder at the root.

- **Source of Truth**: [`docs/RULES_AND_CONSTRAINTS.md`](docs/RULES_AND_CONSTRAINTS.md)
- **API Contracts**: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) and [`docs/WS_CONTRACT.md`](docs/WS_CONTRACT.md)
- **Constants Reference**: [`docs/CONSTANTS.md`](docs/CONSTANTS.md)

---

*Last updated: June 17, 2026*
