import { isFutureProjectSchemaVersion } from '@jam-band/shared';

/**
 * Refuse a project.json whose `version` is from a NEWER build than this one (DEV-295) — we
 * cannot know what its fields mean, so accepting it risks silently misinterpreting them.
 * Everything else (older integers, the pre-epic `'1.0.0'` string, a missing/unrecognised
 * version) is accepted; the backend carries no loudness-reset logic (that's FE-only, see
 * `projectSerializer.ts`'s `resetLegacyLoudnessFields`), it merely stops refusing to store or
 * forward it. Throws the `BAD_REQUEST:`-prefixed Error convention that routes/projects.ts's
 * catch blocks already pattern-match on via `error.message.startsWith('BAD_REQUEST')`.
 */
export function assertSupportedProjectVersion(version: unknown, message: string): void {
  if (isFutureProjectSchemaVersion(version)) throw new Error(`BAD_REQUEST: ${message}`);
}
