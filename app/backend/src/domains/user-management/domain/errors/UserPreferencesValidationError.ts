/**
 * Thrown by `UserPreferencesService` when a caller-supplied value fails validation
 * (an invalid `settings` patch against `userPreferencesPatchSchema`, or an empty `theme`).
 * Always thrown before any repository call — never as a result of a DB failure.
 *
 * Controllers `instanceof`-check this type to map it to 400, distinguishing it from a
 * generic `Error` raised by a repository read/write failure (mapped to 500). Matching on
 * the error's `message` string is deliberately avoided (DEV-333 Task 4 review finding):
 * a future change to a validation message must not silently break the status-code split.
 */
export class UserPreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserPreferencesValidationError';
  }
}
