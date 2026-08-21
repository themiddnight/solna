# CLAUDE.md — murva Project Context

> Entry point for all AI agents working with this project.
> Always read this file first, then read the documentation relevant to the task at hand.
> **Tooling:** Serena runs as a globally-registered local MCP — prefer its symbolic tools (find_symbol, find_referencing_symbols, replace_in_files, etc.) for code exploration and cross-file refactors.

---

## 1. Project Overview

**murva** is a real-time collaborative music making app — multiple people create music together simultaneously.

**Stack:** Frontend (`app/frontend/`): React + TypeScript + Zustand + Tone.js + WebRTC · Backend (`app/backend/`): Node.js + Express + Prisma + Socket.IO + Redis · PostgreSQL + Redis (Railway) · File Storage: Backblaze B2

**Room Types — Core Concepts:**
- **Perform Room** (`/perform/:roomId`) — Live jamming, virtual instruments, step sequencer, voice chat
- **Arrange Room** (`/arrange/:roomId`) — Collaborative production workspace, multi-track timeline, piano roll, recording

---

## 2. Product & Brand Context

Before any product/design/marketing task:

→ **`~/Documents/Claude/Projects/[App] Collab/CLAUDE.md`** — product & brand workspace index (links to all Notion sections)

---

## 3. How to Start

Task-triggered reading (read the matching doc before starting that kind of work):

- **Before writing any code/tests (Source of Truth)** → [`docs/RULES_AND_CONSTRAINTS.md`](docs/RULES_AND_CONSTRAINTS.md)
- **Understand the whole project** → [`understanding-project`](.claude/skills/understanding-project/SKILL.md)
- **E2E** → selectors: [`docs/E2E_SELECTOR_POLICY.md`](docs/E2E_SELECTOR_POLICY.md) · run: backend at `http://localhost:3001` (preflight/auto-start in [`e2e-test`](.claude/skills/e2e-test/SKILL.md)), then `cd app/frontend && bun run test:e2e`
- **How to use the app (narrative)** → [`.claude/workflows/app-instruction.md`](.claude/workflows/app-instruction.md)
- **Found a bug/issue** → [`linear-workflow`](.claude/skills/linear-workflow/SKILL.md)
- **Cleanup logic / Redis error handlers / code gating deletion or state reset** → [`docs/FAILURE_PATTERNS.md`](docs/FAILURE_PATTERNS.md) first
- **Renaming / aligning naming FE↔BE** → [`docs/RULES_AND_CONSTRAINTS.md`](docs/RULES_AND_CONSTRAINTS.md#appendix-naming-policy)
- **Creating/moving TS types** → [`docs/TYPE_PLACEMENT_POLICY.md`](docs/TYPE_PLACEMENT_POLICY.md); strictness → [`docs/TYPESCRIPT_STRICTNESS_POLICY.md`](docs/TYPESCRIPT_STRICTNESS_POLICY.md); patterns → [`docs/TYPESCRIPT_BEST_PRACTICES.md`](docs/TYPESCRIPT_BEST_PRACTICES.md)
- **Any user-facing UI text** → [`app/frontend/docs/I18N.md`](app/frontend/docs/I18N.md) (Lingui macros; bare literals fail lint — TR-35)
- **WebRTC voice / latency / cross-browser audio** → [`webrtc-voice`](.claude/skills/webrtc-voice/SKILL.md) + [`docs/WEBRTC_BROWSER_COMPAT.md`](docs/WEBRTC_BROWSER_COMPAT.md) + [`docs/WEBRTC_CAPABILITY_PROFILE.md`](docs/WEBRTC_CAPABILITY_PROFILE.md)

---

## 4. Rules & Constraints (Summary)

Full version: [`docs/RULES_AND_CONSTRAINTS.md`](docs/RULES_AND_CONSTRAINTS.md). **Source of Truth Policy:** if any other doc conflicts with these rules, follow Rules & Constraints.

**Foundational Concepts (FC):**
- **FC-1**: Perform Room (live jam) vs Arrange Room (collaborative production) — different architectures
- **FC-2**: User types: REGISTERED / ARTIST / PRO + unauthenticated guests
- **FC-3**: Room Owner vs Project Owner — different roles in Arrange Room
- **FC-4**: Room Role Hierarchy — room_owner / band_member / audience

**Key Business Rules (BR):**
- **BR-1**: 1 project = 1 active Arrange Room only
- **BR-2**: Project owner auto-becomes room_owner when joining
- **BR-5**: Project limit by user type (REGISTERED < ARTIST < PRO)
- **BR-12**: Project tools (import/export/stems/mixdown) → owner-only after first save

**Technical Rules (TR):**
- **TR-1**: Ephemeral/Commit — high-freq events (drag/knob) broadcast temporarily, commit at interaction end
- **TR-2**: Per-room mutex for Redis read-modify-write
- **TR-3**: Broadcasting — `socket.to()` excludes sender vs `namespace.to()` includes sender
- **TR-4**: Collaborative lock TTL = 5 minutes
- **TR-14**: Shared constants (EventNames, NamespacePaths, SyncConfig) must sync FE ↔ BE — change one side, update the other immediately
- **TR-15**: Use **bun** for everything — `bun run` / `bun add` / `bunx`, never `npm` / `yarn` / `pnpm` / `npx`
- **TR-20**: Monolithic Code Prevention — lint-enforced `max-lines` (logic 800 / data 2000, tests exempt); pre-existing violations grandfathered via shrink-only `eslint-suppressions.json` — split the file, never suppress a new violation
- **TR-22**: After a feature — update the matching doc (Socket → WS_CONTRACT, endpoint → API_CONTRACT, new system → docs/, room behavior → relevant Skill). Not for bug fixes/internal refactors
- **TR-23**: Use `shared/src/music/timeSignature.ts` for BPM/quarter-note duration, time-sig conversion, bar length, sequencer snapping — don't duplicate timing formulas in FE/BE
- **TR-25**: ❌ **Database reset strictly forbidden** — never `prisma migrate reset` or any drop/recreate. If a migration fails, stop and consult the owner
- **TR-26**: Naming Convergence — one canonical term for a concept across FE/BE/shared/docs; FE converges toward backend vocabulary unless non-canonical/layer-specific
- **TR-27**: Strict TypeScript Everywhere — `any` forbidden in every form: no `any` annotations, no `as any` / `as unknown as T`, no inline `eslint-disable` of `no-explicit-any` / `no-unsafe-*`; import the real lib type instead of casting (FAILURE_PATTERNS Pattern 7)
- **TR-28**: Prefer named types over complex inline shapes — small local-only inline types are fine
- **TR-31**: Validate REST input at the boundary — never pass `req.body` to services via bare `as Cmd`; don't delete "impossible" runtime guards without tracing call paths to trust boundaries (FAILURE_PATTERNS Pattern 5)
- **TR-32**: No `TODO(DEV-XX)` placeholders — create the Linear issue first, reference its real key
- **TR-33**: Trust the verified token, not the client payload — acting identity from `session.userId` (room sockets) / `socket.data.user` (lobby) / `req.user` (REST), **never** `data.userId` / `req.body`. New socket events go through `secureSocketEvent`. Not lint-enforced — the easiest high-severity regression (FAILURE_PATTERNS Pattern 8 + AUTHENTICATION_FLOW.md)
- **TR-34**: Prefer a maintained library over reinventing (uuid, lodash, lru-cache, zod, tonal, axios-retry, Intl, @tonejs/midi, …) — use it, or **ask first** for a real trade-off; verify behavior and lock with tests
- **TR-35**: User-facing strings localized — Lingui macros only (bare literals = lint **error**); after changes: `bun run i18n:extract` → translate `th` → `i18n:compile`. Guide: [`I18N.md`](app/frontend/docs/I18N.md)
- **TR-36**: Frontend UDF — state flows one way `event → store action → store → selector → UI` (side-effects via `subscribe`); components write via named actions only (no `getState`/`setState` — lint **error**); derived values via selector/`useMemo`, never stored. [ADR](docs/adr/2026-07-05-frontend-unidirectional-data-flow.md)
- **TR-37**: Frontend Feature Module Structure — domain logic in `src/features/<feature>/`; `src/pages/` = route shells only; cross-feature imports via the feature's barrel public API; shared code in `src/shared/`
- **TR-38**: Frontend Engine/Driver Layering — lint-enforced one-way `shell (pages) → feature → driver → engine → shared` (same-tier `feature → feature` allowed); `src/engine/` = room-agnostic capability core (no `if perform/arrange`); `src/drivers/` **reserved** (thin live/scheduled seams deliberately deferred). **Room silos:** `rooms/perform` ↛ `rooms/arrange` (both directions) lint-forbidden — only `rooms/shared` may import from both silos; zero suppressions. Status: [`ROOM_ENGINE_RELAYERING_BACKLOG.md`](docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md)
- **TR-39**: Documentation lifecycle — search [`docs/INDEX.md`](docs/INDEX.md) + existing docs before creating one (**extend, don't duplicate**; 1 concept = 1 doc); place new docs by [`DOCUMENTATION_STRUCTURE.md`](docs/DOCUMENTATION_STRUCTURE.md) tiers; update the matching doc after a feature (TR-22). `INDEX.md` is **generated** — `bun run docs:index` after add/move/rename (never hand-edit; `docs:index:check` fails if stale)
- **TR-42**: Dependency Version Freshness — verify lib knowledge against current docs/changelog before trusting memory. Minor/patch bump that's meaningfully better → update + run the affected tier. **Major bump → never auto-apply** — file a Linear (DEV) issue and leave the migration decision to the owner

---

## 5. Architecture Docs (fast-path)

> **Doc placement:** Technical (plans, architecture, contracts) → this repo's `docs/` only. Product/non-tech → Notion ([Evolution Plan](https://app.notion.com/p/37c35e4f83d281a5847fcac6acf74e8a)). Linear = tasks only (cards link to docs; docs are source of truth). Conventions → [`docs/DOCUMENTATION_STRUCTURE.md`](docs/DOCUMENTATION_STRUCTURE.md).

| Topic | Doc |
|-------|-----|
| REST API contract | [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) |
| WebSocket events contract | [`docs/WS_CONTRACT.md`](docs/WS_CONTRACT.md) |
| Database schema (Prisma) | [`app/backend/docs/DATABASE.md`](app/backend/docs/DATABASE.md) |
| Constants & Redis keys | [`docs/CONSTANTS.md`](docs/CONSTANTS.md) |
| Authentication flow | [`docs/AUTHENTICATION_FLOW.md`](docs/AUTHENTICATION_FLOW.md) |
| Known failure patterns | [`docs/FAILURE_PATTERNS.md`](docs/FAILURE_PATTERNS.md) |
| Backend / Frontend architecture | [`app/backend/docs/ARCHITECTURE.md`](app/backend/docs/ARCHITECTURE.md) · [`app/frontend/docs/ARCHITECTURE.md`](app/frontend/docs/ARCHITECTURE.md) |
| Metronome system | [`docs/METRONOME_SYSTEM.md`](docs/METRONOME_SYSTEM.md) |
| Data fetching (axios-retry + react-query) | [`docs/DATA_FETCHING_POLICY.md`](docs/DATA_FETCHING_POLICY.md) |
| WebRTC compat / capability profile | [`docs/WEBRTC_BROWSER_COMPAT.md`](docs/WEBRTC_BROWSER_COMPAT.md) · [`docs/WEBRTC_CAPABILITY_PROFILE.md`](docs/WEBRTC_CAPABILITY_PROFILE.md) |
| **Companion feature (start here)** | [`docs/companion/README.md`](docs/companion/README.md) |
| Internationalization (Lingui i18n) | [`app/frontend/docs/I18N.md`](app/frontend/docs/I18N.md) |
| Music theory (scales, modes) | [`app/frontend/docs/MUSIC_THEORY.md`](app/frontend/docs/MUSIC_THEORY.md) |
| **Design tokens (brand source of truth)** | **`../murva-brand/tokens.css`** + `../murva-brand/design.md` |

**Every maintained doc is in [`docs/INDEX.md`](docs/INDEX.md)** — the generated map; search it before creating a new doc (TR-39).

**Feature READMEs:** before working on (or discussing) any feature, look for its co-located `README.md` — read it before starting, update it when the area changes (TR-22). `INDEX.md` and `doc-sync` discover feature references via the `<!-- doc-sync: codebase-reference -->` marker — enumerate the raw list with:

```bash
grep -rl "doc-sync: codebase-reference" app docs
```

**Design Token Note:** `murva-brand/` เป็น sibling repo ที่เก็บ primitive values + semantic mapping ของ murva family — ก่อนแก้ brand colors / semantic palette / theme values ในแอปนี้ อ่าน `murva-brand/design.md` ก่อนเสมอ และ sync กลับไปที่ `murva-brand/tokens.css` เมื่อมีการเปลี่ยนแปลง

---

## 6. Skills (Work methods)

Skills live in [`.claude/skills/`](.claude/skills/) — **the full name+description listing is auto-provided by the harness every session**, so only routing guidance lives here. Not sure which → [`orchestrator`](.claude/skills/orchestrator/SKILL.md) (start here).

Nine rarely-used skills are **archived** to `.claude/skills-archive/` (out of the auto-listing; guidance still valid — read on demand; the orchestrator routes to seven of them with `↦ archive` markers — `backend-performance` and `music-theory-companion` have no routing rows, read them directly): `add-feature`, `api-endpoint`, `backend-performance`, `bug-fixing`, `database-migration`, `debugging-realtime`, `music-theory-companion`, `socket-events`, `zustand-store`.

---

## 7. Key Patterns (Frequently Used)

```
# Ephemeral/Commit
- High-freq events: ephemeral broadcast to others (not stored in Redis)
- Interaction end: commit event → store in Redis
- Perform synth/effects: debounced commit after 1s

# Broadcasting
- socket.to(room)      → everyone except sender (mutation events)
- namespace.to(room)   → everyone incl. sender (commit/lock events)

# Navigation
- Leave room: navigateAfterLeave(navigate) → recorded origin (useTrackRoomReturnOrigin), else lobby
- Room switch: navigate(path, { replace: true, state: { loadProjectId } })

# Stale Room Validation
- Always checkRoomExists(roomId) after getActiveRoomInfo(projectId)
- If exists:false → create new room instead of navigate

# React Query Cache
- Must queryClient.clear() during logout and leave room
```

---

## 8. Issue & Card Reporting (Linear)

Every IDE here has Linear MCP connected (read + write directly). Use these IDs (display names may change):
- **Technical team** (code, infra, bugs): `011781ef-bb08-444a-9e56-70b9d2ffbca9` (key: `DEV`)
- **Business team** (product, marketing, design): `56586a2d-7fa3-4a1f-a514-b2f4c29a0f2e` (key: `BIZ`)
- **COLLAB project**: `a32df946-46c7-4f14-a945-6e70da5f8481`

Full workflow (required labels, fields, status flow; creating issues; implementing cards on a branch; single-issue fix-and-review cycle) → [`linear-workflow`](.claude/skills/linear-workflow/SKILL.md).

---

## 9. Codebase Structure

```
murva-app/
├── app/
│   ├── frontend/         # React frontend (src/features/, src/shared/)
│   └── backend/          # Node.js backend (src/domains/ DDD, src/shared/)
├── shared/               # MONOREPO SHARED PACKAGE (@jam-band/shared)
│   ├── src/constants/    # Shared constants (EventNames, etc.)
│   └── src/types/        # Shared TS interfaces/DTOs
├── docs/                 # Global documentation (Source of Truth)
└── package.json          # Root (Bun Workspaces)
```

---

## 10. Monorepo Workflow

- **Shared changes**: after editing `shared/`, run `bun run --cwd shared build` (FE/BE use the built files)
- **Deps**: `bun install` at root installs for all packages
- **Run apps**: `bun run dev` at root starts FE + BE
- **Test tiers** (repo root): `test:static` (type + lint + knip + build) · `test:unit` · `test:integration` (needs Redis+PG) · `test:regression` · `test:e2e:all` · `test:full` (everything). Hooks: pre-commit `lint-staged`; pre-push `gate:prepush` (Tier 1 + unit). No CI → **`bun run test:full` once before merging to `develop`** — not a per-rebase/per-squash ritual; iterate with `test:static` + `test:unit` (or the affected package). Model: [`docs/TESTING.md`](docs/TESTING.md)
- **Type gate**: `bun run type` + `bun run lint` at root are mandatory repo-wide (inside `test:static`) — cover app, shared, tests, E2E, scripts
- **Dead-code gate (FE)**: `bun run knip:fe` at root (in `test:static` + pre-push)
- **Branch retention**: ❌ **Never delete issue/fix/feature branches after merging** — the owner keeps them as milestone markers. Merge into `develop` (fast-forward / rebase, linear history), **leave the branch ref in place**. If one was deleted, recreate it at its tip commit (`git branch <name> <sha>`)
- **Re-check before merge**: the owner commits to `develop` in parallel while you work — before merging, `git rev-parse develop`; if it moved, **rebase** your branch onto it, then fast-forward. Don't assume `--ff-only` still applies

---

## 11. Environment & Infrastructure

- **Local dev URL**: `http://localhost:5173`
- **DB / Cache**: PostgreSQL (`DATABASE_URL`) + Redis (`REDIS_URL`) in `.env` (Railway) · **Email**: Resend · **AI**: OpenAI + Gemini (job queue)
- **⚠️ Never commit `.env`** — use `.env.example` as reference
- **URL config**: both `app/frontend/.env` and `app/backend/.env` hold two URL sets (`localhost:<port>` vs `<ip>:<port>` for `bun run dev --host` from other devices); comment out the unused set
- **SSL/HTTPS**: `SSL_ENABLED` in `app/backend/.env` — `false` = plain HTTP local; `true` = HTTPS via local cert (required for WebRTC on real devices; also switch `BACKEND_URL`/`FRONTEND_URL` to `https://`, expect self-signed warnings). Keep `false` unless testing WebRTC
- **Dev credentials**: all creds in `app/backend/.env` point to the **dev environment** (Railway dev + Backblaze `collab-jam-band-dev`) — read `.env` directly to inspect PostgreSQL / Redis / Backblaze B2 freely for debugging

---

## 12. Railway Monitoring (MCP-first)

Railway status/logs/deployments/inspect go through the **Railway MCP** (`mcp__plugin_railway_railway__*` — OAuth-connected via the `railway@claude-plugins-official` plugin). It reads prod/dev directly; Railway MCP work stays in the **main session** (subagents don't carry these tools).

**Project/env/service IDs, tool mapping, CLI, and rules → [`docs/RAILWAY_REFERENCE.md`](docs/RAILWAY_REFERENCE.md)**. Destructive actions (redeploy, accept-deploy, set-variables) — confirm with the user first. Full routing guide: skill `railway:use-railway` (namespaced plugin skill).

> **Tip:** use [`doc-sync`](.claude/skills/doc-sync/SKILL.md) for periodic doc/code cross-checks before releases.
