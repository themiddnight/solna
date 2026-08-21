/**
 * Thrown when a saved project.json's version is NEWER than this server's PROJECT_SCHEMA_VERSION
 * understands (see `isFutureProjectSchemaVersion`). Older/legacy versions are accepted with a
 * loudness reset instead of being refused (DEV-295) — this error fires only for future-build
 * files this server can't safely interpret. ProjectController special-cases this error to
 * surface its message to the client even in production, bypassing clientErrorDetail's
 * prod-stripping — the message is client-safe and actionable by construction.
 */
export class ProjectVersionMismatchError extends Error {
  constructor(foundVersion: unknown) {
    super(
      `This project file was saved with a newer version of the app (version ${String(
        foundVersion,
      )}) than this server currently supports and can't be opened. Please update the app, or ` +
      `ask whoever saved it to re-export from an earlier version.`,
    );
    this.name = 'ProjectVersionMismatchError';
  }
}
