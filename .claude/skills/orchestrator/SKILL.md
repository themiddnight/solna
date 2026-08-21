---
name: orchestrator
description: Routing guide — maps task types to the correct skills and reading order. Read this first when unsure which skill to use.
---

# Orchestrator — Skill Routing Guide

Read this file when you receive a task and are unsure which skill to use, or when the task covers multiple domains.

## Before Every Task

1. Read `CLAUDE.md` at the project root (entry point).
2. Read `docs/RULES_AND_CONSTRAINTS.md` (MUST — BR/TR/FC rules).
3. Select the appropriate skill from the routing table below.

---

## Routing Table — Task → Skill

> **`↦ archive`** = skill moved to `.claude/skills-archive/<name>/SKILL.md` (removed from the
> auto-load listing to trim context; the guidance is still valid — read the file directly
> with the Read tool when that task type comes up).

### Feature / Code Tasks

| Task Type | Read This Skill First | Additional Skills to Read |
|---|---|---|
| Create new feature module (FE or BE) | `add-feature ↦ archive` | `zustand-store ↦ archive`, `api-endpoint ↦ archive` |
| Add REST API endpoint | `api-endpoint ↦ archive` | `database-migration ↦ archive` (if schema changes) |
| Add/Edit Socket.IO event | `socket-events ↦ archive` | `arrange-room` or `perform-room` (by room type) |
| State management (Zustand) | `zustand-store ↦ archive` | `socket-events ↦ archive` (if syncing with BE) |
| Prisma schema / migration | `database-migration ↦ archive` | — |
| Write tests | `test` | Domain-specific skill (e.g., `arrange-room`) |

### Audio / Music Tasks

| Task Type | Read This Skill First | Additional Skills to Read |
|---|---|---|
| Tone.js instrument, synthesis, oscillator | `audio-engine` | `dsp-audio` (if using effects) |
| Effect chain, signal routing, volume/pan stage | `dsp-audio` | `audio-engine` |
| Add new audio effect (EffectType, factory, wiring) | `dsp-audio` | `audio-engine`, `perform-room` |
| WebRTC voice chat, P2P, HLS streaming | `webrtc-voice` | `socket-events ↦ archive` (signaling events) |
| Scales, modes, MIDI notes, piano roll | `music-theory` | — |
| Drum machine, GM percussion mapping | `music-theory` | `audio-engine` |
| Audio recording, WAV export, Backblaze B2 | code: `app/backend/src/domains/audio-processing/` + `app/backend/src/shared/infrastructure/storage/BackblazeStorageAdapter.ts` (media-storage skill removed — was stale) | — |
| Mixdown, file upload/download | code: `app/backend/src/domains/audio-processing/` | — |

### Room-Specific Tasks

| Task Type | Read This Skill First | Additional Skills to Read |
|---|---|---|
| Arrange Room features (DAW, tracks, regions, locks) | `arrange-room` | `socket-events ↦ archive`, `music-theory` |
| Perform Room features (live jam, sequencer, recording) | `perform-room` | `socket-events ↦ archive`, `audio-engine` |
| Both room types simultaneously | `arrange-room` + `perform-room` | `socket-events ↦ archive` |

### Debugging Tasks

| Task Type | Read This Skill First | Additional Skills to Read |
|---|---|---|
| General bug | `bug-fixing ↦ archive` (or superpowers `systematic-debugging`) | Domain-specific skill where the bug resides |
| State sync issues, race conditions, Redis | `debugging-realtime ↦ archive` | `arrange-room` or `perform-room` |
| WebRTC failure, ICE error, voice | `webrtc-voice` | `debugging-realtime ↦ archive` |
| Audio glitch, latency, crackling | `dsp-audio` | `audio-engine` |

### Infrastructure / Other Tasks

| Task Type | Read This Skill |
|---|---|
| Implement one or more Linear issue cards on a local branch | `linear-workflow` |
| Clean up noisy/agent-generated commits before review or merge into develop | `squash-by-logical-change` |
| AI generation feature (OpenAI/Gemini) | `ai-feature` |
| Responsive design, mobile layouts, touch handling, breakpoints | `responsive-mobile` | `perform-room` or `arrange-room` (by room type), `tailwind-daisyui` |
| UI styling, components, daisyUI classes, Tailwind utilities, CSS customization | `tailwind-daisyui` | `responsive-mobile` (if responsive), RULES_AND_CONSTRAINTS FC/BR + CLAUDE.md §7 (if navigation/flow) |
| UX decisions, permissions, navigation patterns | RULES_AND_CONSTRAINTS (FC-2/BR-5/BR-6) + CLAUDE.md §7 + WS_CONTRACT §1.0.3/1.5 (ux-patterns skill removed — was duplicated) | |
| Railway deployment, logs, monitoring | [`docs/RAILWAY_REFERENCE.md`](../../../docs/RAILWAY_REFERENCE.md) + CLAUDE.md §12 |
| Docs feel stale / pre-release cross-check | `doc-sync` |
| Understanding project structure | `understanding-project` |

---

## Multi-Domain Tasks

Some tasks require reading multiple skills together. Examples:

**"Add chord voicing in Arrange Room piano roll"**
→ Read: `music-theory` → `arrange-room` → `socket-events ↦ archive`

**"Add new reverb effect in Perform Room"**
→ Read: `dsp-audio` → `perform-room` → `socket-events ↦ archive`

**"Debug why voice chat is silent after reconnection"**
→ Read: `webrtc-voice` → `debugging-realtime ↦ archive`

**"Add AI chord suggestion feature"**
→ Read: `ai-feature` → `music-theory` → `add-feature ↦ archive`

---

## Which Room Type?

If you're unsure whether a task relates to Perform or Arrange Room, check for:
- `perform:*` events or `PerformRoom` in the code → `perform-room` skill.
- `arrange:*` events or `ArrangeRoom` in the code → `arrange-room` skill.
- Both or unsure → Read `docs/RULES_AND_CONSTRAINTS.md` FC-1 first.
