# Prisma Migrations

This directory contains all Prisma migrations for the `app/backend` project. It is the
**single guide** for running migrations in development and production (the former standalone
`PRODUCTION_MIGRATION_GUIDE.md` was folded in here — see the **Production deployment** and
**Rollback strategy** sections).

> ⛔ **`prisma migrate reset` is forbidden (TR-25).** Never reset, drop, or recreate any
> database — **including dev**. If a migration fails, **stop and consult the owner**. The
> command is documented below only so it is recognizable as the thing not to run.

## 📁 Migration History

| Date | Migration | Description |
|------|-----------|-------------|
| 2025-11-06 | `20251106083920_init_analytics_feedback` | Initial analytics and feedback tables |
| 2025-11-30 | `20251130221046_init_auth` | Authentication system tables |
| 2025-12-01 | `20251201154857_add_saved_projects` | Add saved projects feature |
| 2025-12-02 | `20251202113437_add_refresh_tokens` | Add refresh tokens for auth |
| 2025-12-02 | `20251202144827_add_feedback_fields` | Add feedback fields to User model |
| 2025-12-07 | `20251207080820_add_ai_settings` | Add AI settings for users |
| 2025-12-08 | `20251208070520` | (Add description) |

---

## 🎯 Quick Reference

| Task | Command |
|------|---------|
| Create migration (dev) | `bunx prisma migrate dev --name <name>` |
| Deploy to prod (safe) | `bunx prisma migrate deploy` |
| Check status | `bunx prisma migrate status` |
| Generate client | `bunx prisma generate` |
| Open Studio | `bunx prisma studio` |
| Pull schema | `bunx prisma db pull` |
| Format schema | `bunx prisma format` |
| ⛔ Reset DB | `bunx prisma migrate reset` — **forbidden (TR-25), never run** |

---

## 📖 Development Workflow

```bash
# 1. Edit prisma/schema.prisma
# 2. Create the migration (creates SQL, applies to dev DB, regenerates the client)
bunx prisma migrate dev --name add_new_feature

# 3. Test your changes
bun run dev

# 4. Commit the migration files
git add prisma/migrations/
git commit -m "Add migration: add_new_feature"
```

After schema changes or migrations, regenerate the client if needed: `bunx prisma generate`.

---

## 🚀 Production Deployment

`prisma migrate deploy` is the **safe** production path: it applies only pending migrations,
never creates new ones, and is idempotent (safe to re-run).

### Step-by-step

```bash
# 1. Backup the database FIRST (always)
railway run pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
#    or with a direct connection:
#    pg_dump "postgresql://user:pass@host:port/db" > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Pull latest code + check what's pending
git pull
bunx prisma migrate status

# 3. Deploy pending migrations
bunx prisma migrate deploy

# 4. Verify + regenerate client if needed
bunx prisma migrate status
bunx prisma generate

# 5. Restart the app (Railway auto-restarts; otherwise restart manually)
```

### Deploy options

```bash
# Via Railway CLI (recommended)
railway run bunx prisma migrate deploy

# Via explicit DATABASE_URL
DATABASE_URL="postgresql://user:pass@host:port/database" bunx prisma migrate deploy
```

---

## 🔍 Checking Migration Status

```bash
# Helper script (checks current or a specified database)
cd app/backend
./prisma/check-migrations.sh
./prisma/check-migrations.sh "postgresql://user:pass@host:port/db"

# Prisma CLI
bunx prisma migrate status

# Directly in the database
psql "$DATABASE_URL" -c "SELECT migration_name, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 10;"
```

**States:** `✅ up to date` (all applied) · `⚠️ pending` (run `migrate deploy`) ·
`❌ failed` (see Rollback strategy / Troubleshooting below).

---

## 🔄 Rollback Strategy

Prisma has **no built-in rollback**. When a migration fails or must be undone:

```bash
# Option 1 — restore from the backup taken before deploy (preferred)
psql "$DATABASE_URL" < backup_YYYYMMDD_HHMMSS.sql

# Option 2 — mark a failed migration as rolled back (then fix + redeploy)
bunx prisma migrate resolve --rolled-back "20251216070000_migration_name"

# Option 3 — forward-fix: create a new migration that reverses the change
#   edit schema.prisma to reverse, then in DEV:
bunx prisma migrate dev --name rollback_previous_migration
```

⛔ Do **not** `migrate reset` to recover (TR-25) — restore from backup or forward-fix, and
consult the owner on any failed production migration.

---

## 🧭 Common Scenarios

```bash
# Fresh production database — deploy everything, then generate the client
bunx prisma migrate deploy && bunx prisma generate

# Production is behind — check, then deploy
bunx prisma migrate status
bunx prisma migrate deploy

# Migration marked failed/conflicting — resolve its recorded state
bunx prisma migrate resolve --applied     "20251216070000_migration_name"   # it did apply
bunx prisma migrate resolve --rolled-back "20251216070000_migration_name"   # it did not
```

---

## ⚠️ DO's & DON'Ts

**DO ✅** — always `migrate deploy` (never `migrate dev`) in production · backup before
deploying · test migrations in dev first · keep migration files in version control · use
descriptive names · review generated SQL before committing.

**DON'T ❌** — never `migrate dev` against production · never `migrate reset` anywhere
(TR-25) · don't modify or delete existing migration files · don't deploy without a backup ·
don't skip migration testing.

---

## 🛠️ Troubleshooting

```bash
# Migration failed to apply
bunx prisma migrate status
cat prisma/migrations/[migration-name]/migration.sql   # inspect the SQL
#   fix in the DB if needed, then record the true state:
bunx prisma migrate resolve --applied "[migration-name]"

# Schema out of sync
bunx prisma db pull                       # introspect actual DB
bunx prisma migrate dev --name sync_schema  # (dev) create a reconciling migration

# Connection issues
echo $DATABASE_URL
psql "$DATABASE_URL" -c "SELECT 1;"       # test connectivity
```

---

## 🔐 Security Best Practices

1. Never commit `.env` files with production credentials.
2. Use environment variables for `DATABASE_URL`.
3. Limit the database user's permissions to only what's needed.
4. Audit migration SQL before deploying.
5. Use SSL connections for production databases.

---

## 📚 Migration Files Structure

Each migration folder under `prisma/migrations/` contains a `migration.sql` (the actual SQL),
a timestamp prefix (guarantees ordering), and a descriptive name. `migration_lock.toml`
records the provider. Never edit an applied migration's SQL — create a new migration instead.

---

## 📖 Additional Resources

- [Prisma Migrate Docs](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Deploy database changes with Prisma Migrate](https://www.prisma.io/docs/guides/deployment/deploy-database-changes-with-prisma-migrate)
- [Railway Prisma Guide](https://docs.railway.app/guides/prisma)
- [Prisma Discord](https://pris.ly/discord) · [Prisma GitHub Issues](https://github.com/prisma/prisma/issues)
