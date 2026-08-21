# Suggested Commands

> Thin pointer — source of truth: CLAUDE.md §10 (Monorepo Workflow)

All commands run from repo root unless noted. Key groups:

- **Dev:** `bun run dev` (BE+FE), `dev:fe` / `dev:be` / `dev:shared`
- **Type/Lint:** `bun run type`, `bun run lint`, `bun run knip:fe`
- **Tests:** `test:static` → `test:unit` → `test:integration` → `test:regression` → `test:e2e:all` → `test:full`
- **Shared:** `bun run --cwd shared build` after editing shared/
- **i18n:** extract → translate th → compile
- **Docs index:** `bun run docs:index` (generated, never hand-edit)

⚠️ Machine-specific: 8GB RAM → serialize heavy jobs; never broad `pkill -f`; use `${PIPESTATUS[0]}` after `| tail`.
