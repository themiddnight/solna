---
name: database-migration
description: How to modify the Prisma database schema, create migrations, and seed data in the murva backend.
---

# Database Schema & Migrations

> ❌ **TR-25 — Database reset is strictly forbidden.**
> Never run `prisma migrate reset`, `prisma db push --force-reset`, or any command that drops and recreates the schema.
> If a migration fails, **stop immediately and consult the owner** — do not attempt a reset as a shortcut.

This skill covers modifying the PostgreSQL database via Prisma ORM.

## Key Files

- **Schema**: `app/backend/prisma/schema.prisma`
- **Migrations**: `app/backend/prisma/migrations/`
- **Database docs**: `app/backend/docs/DATABASE.md`
- **Business rules**: `docs/RULES_AND_CONSTRAINTS.md` (check for BR/TR related to schema changes)

## Existing Models

| Model | Table | Description |
|-------|-------|-------------|
| `User` | `users` | User accounts (guest, registered, artist, pro) |
| `UserAiSettings` | `user_ai_settings` | AI provider config per user |
| `EmailVerification` | `email_verifications` | Email verification tokens |
| `PasswordReset` | `password_resets` | Password reset tokens |
| `OAuthAccount` | `oauth_accounts` | Google OAuth linked accounts |
| `UserPreset` | `user_presets` | Synth/effect/sequencer/instrument presets |
| `UserSettings` | `user_settings` | User preferences |
| `SavedProject` | `saved_projects` | DAW projects (with fork support) |
| `RefreshToken` | `refresh_tokens` | JWT refresh tokens |
| `Band` | `bands` | Music bands/groups |
| `BandMember` | `band_members` | Band membership (owner/member) |
| `ProjectContributor` | `project_contributors` | Project collaboration tracking |

## Existing Enums

- `UserType`: GUEST, REGISTERED, ARTIST, PRO
- `PresetType`: SYNTH, EFFECT, SEQUENCER, INSTRUMENT
- `BandRole`: OWNER, MEMBER
- `ProjectVisibility`: PRIVATE, BAND, PUBLIC
- `UserRole`: USER, ADMIN, SUPER_ADMIN

## Step-by-Step: Adding a New Model

### 1. Edit Schema

File: `app/backend/prisma/schema.prisma`

```prisma
model MyNewModel {
  id        String   @id @default(uuid())
  userId    String
  name      String
  data      Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("my_new_models")   // Always use snake_case table name
}
```

**Don't forget** to add the reverse relation on the `User` model:

```prisma
model User {
  // ... existing fields
  myNewModels  MyNewModel[]
}
```

### 2. Create Migration

```bash
cd app/backend
bunx prisma migrate dev --name add_my_new_model
```

This will:
1. Generate a SQL migration file in `prisma/migrations/`
2. Apply the migration to your local database
3. Regenerate the Prisma client

### 3. Generate Client (if migration already exists)

```bash
cd app/backend
bunx prisma generate
```

### 4. Create Repository

```typescript
// app/backend/src/domains/<domain>/infrastructure/repositories/MyNewModelRepository.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class MyNewModelRepository {
  async findById(id: string) {
    return prisma.myNewModel.findUnique({ where: { id } });
  }

  async findByUserId(userId: string) {
    return prisma.myNewModel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: { userId: string; name: string; data?: any }) {
    return prisma.myNewModel.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; data: any }>) {
    return prisma.myNewModel.update({ where: { id }, data });
  }

  async delete(id: string) {
    return prisma.myNewModel.delete({ where: { id } });
  }
}
```

## Schema Conventions

- **IDs**: Always use `String @id @default(uuid())`
- **Table names**: Use `@@map("snake_case_plural")` — e.g., `@@map("saved_projects")`
- **Timestamps**: Include `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`
- **Indexes**: Add `@@index([fieldName])` for frequently queried fields
- **Cascade delete**: Use `onDelete: Cascade` for child relations that should be deleted with parent
- **Unique constraints**: Use `@@unique([field1, field2])` for composite uniqueness

## Modifying Existing Models

### Adding a Field

```prisma
model SavedProject {
  // ... existing fields
  newField  String?   // Nullable for backward compatibility
}
```

Then run migration:
```bash
cd app/backend
bunx prisma migrate dev --name add_new_field_to_saved_project
```

### Adding an Enum Value

```prisma
enum PresetType {
  SYNTH
  EFFECT
  SEQUENCER
  INSTRUMENT
  MY_NEW_TYPE    // Add new value
}
```

## Common Commands

```bash
# Create and apply migration
bunx prisma migrate dev --name <migration_name>

# Apply pending migrations (production)
bunx prisma migrate deploy

# Reset database (WARNING: deletes all data)
bunx prisma migrate reset

# Generate Prisma client without migration
bunx prisma generate

# Open Prisma Studio (GUI database browser)
bunx prisma studio

# Format schema file
bunx prisma format

# Check migration status
bunx prisma migrate status
```

## Doc Update (Mandatory)

After any schema change, update `app/backend/docs/DATABASE.md` before closing the task.

| Change | What to update in DATABASE.md |
|---|---|
| New model | Add to ER Diagram (mermaid) and Core Models table |
| New field on existing model | Update the entity block in the ER Diagram |
| New enum or enum value | Update the Enums table |
| Removed field or model | Remove from ER Diagram and tables |
| Relationship change | Update the ER Diagram relationship lines |

The ER Diagram in DATABASE.md must reflect the actual Prisma schema at all times.

---

## Important Notes

- **Redis vs Postgres**: Room state (tracks, regions, notes, effects) is stored in **Redis only** (24-hour TTL). Prisma/Postgres is for persistent user data, projects, bands, auth.
- **Project save**: When a user saves a project, the full state is serialized from Redis and stored as JSON in `SavedProject.metadata`.
- **Always nullable for new fields**: When adding fields to existing models, make them nullable (`String?`) or provide a default to avoid breaking existing data.
