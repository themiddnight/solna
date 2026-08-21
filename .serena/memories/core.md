# murva-app — Core

> Thin pointer — source of truth: `CLAUDE.md` (repo root, always in context)

Monorepo: Bun workspaces (`app/*`, `shared`). Root `package.json` orchestrates all scripts.

Two room architectures — do not conflate:
- Perform Room (`/perform/:roomId`) — live jam, ephemeral state, WebRTC voice
- Arrange Room (`/arrange/:roomId`) — persistent DAW-style project, multi-track timeline

**Primary reference:** `CLAUDE.md` §1 (Overview), §3 (How to Start), §4 (Rules & Constraints summary), §9 (Codebase Structure)

**Further navigation:**
- Rules/constraints: `mem:conventions` → CLAUDE.md §4 + `docs/RULES_AND_CONSTRAINTS.md`
- Stack details: `mem:tech_stack`
- Commands: `mem:suggested_commands`
- FE architecture: `mem:frontend/core`
- BE architecture: `mem:backend/core`
- Task gates: `mem:task_completion`
