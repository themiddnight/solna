# Frontend — Core

> Thin pointer — source of truth: CLAUDE.md §4 (TR-35 through TR-38), §5 (architecture docs table), §9 (structure)

Location: `app/frontend/src/`. React + TypeScript + Zustand + Tone.js + WebRTC + TanStack Query + Tailwind v4/daisyUI v5.

**Key docs (read in order):**
1. `app/frontend/docs/ARCHITECTURE.md` — Zustand stores, audio engine, component tree
2. `app/frontend/docs/I18N.md` — Lingui macros (TR-35)
3. Feature READMEs — co-located with each feature; read before working in that feature

**Layering (TR-38):** `pages → feature → driver → engine → shared` (lint-enforced). Room silos: `rooms/perform` ↛ `rooms/arrange`.

**State (TR-36 UDF):** `event → store action → store → selector → UI`. Never `getState`/`setState` in components.
