import type { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/prisma';

export interface UserPreferencesData {
  userId: string;
  theme?: string;
}

export interface UserPreferencesRecord {
  userId: string;
  theme: string;
  settings: Prisma.JsonValue | null;
}

export class UserPreferencesRepository {
  async findByUserId(userId: string): Promise<UserPreferencesRecord | null> {
    return prisma.userPreferences.findUnique({
      where: { userId },
    }) as unknown as Promise<UserPreferencesRecord | null>;
  }

  async upsert(userId: string, data: Partial<UserPreferencesData>): Promise<void> {
    await prisma.userPreferences.upsert({
      where: { userId },
      // Prisma ignores `undefined` fields at runtime; omit the key entirely to
      // satisfy exactOptionalPropertyTypes with identical behavior.
      update: data.theme !== undefined ? { theme: data.theme } : {},
      create: {
        userId,
        theme: data.theme || 'murva-dark',
      },
    });
  }

  async updateTheme(userId: string, theme: string): Promise<UserPreferencesRecord> {
    return prisma.userPreferences.upsert({
      where: { userId },
      update: { theme },
      create: { userId, theme },
    }) as unknown as Promise<UserPreferencesRecord>;
  }

  /**
   * Writes settings in **one statement**, so two requests in flight at the same moment
   * cannot lose each other's namespace.
   *
   * `atomicPatch` (defaulting to the whole document) holds the top-level keys this call
   * owns. Postgres' `||` on jsonb replaces whole top-level keys and leaves the rest of the
   * stored document untouched — exactly per-namespace merge semantics, atomic by
   * construction, with no transaction or row lock. A read-modify-write in the service
   * could not offer that: between its read and its write another request can commit a
   * different namespace, and the write would put the stale copy back.
   *
   * `settings` is the caller's finished document; it is only used when the row has to be
   * created, where there is nothing to merge with.
   */
  async updateSettings(
    userId: string,
    settings: Prisma.InputJsonValue,
    atomicPatch?: Prisma.InputJsonValue
  ): Promise<UserPreferencesRecord> {
    const document = JSON.stringify(settings);
    const patch = JSON.stringify(atomicPatch ?? settings);

    const rows = await prisma.$queryRaw<UserPreferencesRecord[]>`
      INSERT INTO "user_preferences" ("id", "userId", "theme", "settings", "updatedAt")
      VALUES (gen_random_uuid()::text, ${userId}, 'murva-dark', ${document}::jsonb, NOW())
      ON CONFLICT ("userId") DO UPDATE
        SET "settings" = COALESCE("user_preferences"."settings", '{}'::jsonb) || ${patch}::jsonb,
            "updatedAt" = NOW()
      RETURNING "userId", "theme", "settings"
    `;

    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Failed to write preferences for user ${userId}`);
    }
    return row;
  }
}
