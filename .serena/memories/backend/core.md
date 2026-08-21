# Backend — Core

> Thin pointer — source of truth: CLAUDE.md §4 (TR-31, TR-33), §5 (architecture docs table)

Location: `app/backend/src/`. Node.js + Express + Prisma + Socket.IO + Redis, DDD under `src/domains/`.

**Key docs (read in order):**
1. `app/backend/docs/ARCHITECTURE.md` — DDD structure, real-time sync, service layer
2. `app/backend/docs/DATABASE.md` — Prisma schema, migrations
3. `app/backend/docs/PROJECT_SAVE_SYSTEM.md` — save/load workflow
4. Domain READMEs — `src/domains/<domain>/README.md`

**Critical security rules:**
- TR-33 (NOT lint-enforced): identity from token (`session.userId` / `socket.data.user` / `req.user`), never from payload
- TR-31: validate REST input at boundary, never `req.body as Cmd`
- TR-25: never `prisma migrate reset` — stop and ask owner

Test runner: **Jest** (not `bun test` — false failures).
