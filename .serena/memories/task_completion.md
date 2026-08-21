# Task Completion Checklist

> Thin pointer — source of truth: CLAUDE.md §10 (Monorepo Workflow — test tiers + pre-push hook)

Minimum gate:
1. `bun run type` + `bun run lint` (root, repo-wide)
2. Relevant test tier
3. Before merge to `develop`: `bun run test:full`
4. Shared changes: `bun run --cwd shared build`
5. i18n changes: extract → translate th → compile
6. TR-22: after features → update matching doc

⚠️ Gotcha (undocumented elsewhere): `bun run type` fails mysteriously on a fresh checkout/DB change until `bunx prisma generate` has run once — not a code error.
