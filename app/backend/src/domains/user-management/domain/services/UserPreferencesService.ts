import {
  USER_PREFERENCES_SCHEMA_VERSION,
  parsePreferencesLenient,
  userPreferencesPatchSchema,
  type UserPreferencesPatch,
  type UserPreferencesSettings,
} from '@jam-band/shared';
import { UserPreferencesRepository } from '../../infrastructure/repositories/UserPreferencesRepository';
import { UserPreferencesValidationError } from '../errors/UserPreferencesValidationError';

export interface PreferencesResult {
  theme: string;
  settings: UserPreferencesSettings;
}

const DEFAULT_THEME = 'murva-dark';
const emptySettings = (): UserPreferencesSettings => ({ version: USER_PREFERENCES_SCHEMA_VERSION });

export class UserPreferencesService {
  private readonly repo: UserPreferencesRepository;

  constructor() {
    this.repo = new UserPreferencesRepository();
  }

  async getPreferences(userId: string): Promise<PreferencesResult> {
    try {
      const preferences = await this.repo.findByUserId(userId);
      if (preferences === null) {
        return { theme: DEFAULT_THEME, settings: emptySettings() };
      }
      return {
        theme: preferences.theme,
        settings: parsePreferencesLenient(preferences.settings),
      };
    } catch (error) {
      console.error(`Failed to fetch preferences for user ${userId}:`, error);
      // Defaults keep the app usable if the table is not migrated yet.
      return { theme: DEFAULT_THEME, settings: emptySettings() };
    }
  }

  async updateTheme(userId: string, theme: string): Promise<PreferencesResult> {
    if (theme.length === 0) {
      throw new UserPreferencesValidationError('Theme is required');
    }
    try {
      const updated = await this.repo.updateTheme(userId, theme);
      return { theme: updated.theme, settings: parsePreferencesLenient(updated.settings) };
    } catch (error) {
      console.error(`Failed to update theme for user ${userId}:`, error);
      throw new Error('Failed to update theme preference. Please try again later.');
    }
  }

  /**
   * Merges the supplied namespaces into the stored document. Merging is per namespace, not
   * per field: two tabs editing different namespaces never clobber each other, while within
   * one namespace the last write wins (acceptable for single-user data).
   *
   * The merge itself is performed by the repository in a single statement, so that promise
   * holds even for requests that are genuinely simultaneous. The read below stays because
   * it is what turns a broken database into the normalized error the client expects, and
   * because it supplies the complete document used if the row still has to be created — the
   * write no longer depends on it for correctness.
   */
  async updateSettings(userId: string, patch: UserPreferencesPatch): Promise<PreferencesResult> {
    const parsed = userPreferencesPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new UserPreferencesValidationError('Invalid preferences payload');
    }

    try {
      const existing = await this.repo.findByUserId(userId);
      const current = parsePreferencesLenient(existing?.settings ?? null);

      const merged: UserPreferencesSettings = {
        ...current,
        ...parsed.data,
        version: USER_PREFERENCES_SCHEMA_VERSION,
      };
      // Only the namespaces this request owns are written; everything else in the stored
      // document is left exactly as the database has it.
      const owned: UserPreferencesPatch & { version: number } = {
        ...parsed.data,
        version: USER_PREFERENCES_SCHEMA_VERSION,
      };

      const updated = await this.repo.updateSettings(userId, merged, owned);
      return { theme: updated.theme, settings: parsePreferencesLenient(updated.settings) };
    } catch (error) {
      console.error(`Failed to update settings for user ${userId}:`, error);
      throw new Error('Failed to update preferences. Please try again later.');
    }
  }
}

// Export singleton
export const userPreferencesService = new UserPreferencesService();
