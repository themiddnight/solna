/* eslint-disable @typescript-eslint/strict-boolean-expressions -- mirrors the original check in AccountSettings (`!value` guards empty input) */
import { t } from "@lingui/core/macro";

/**
 * Validates a proposed username against the account rules:
 * - must not be empty (after trimming)
 * - 3–30 characters (after trimming)
 * - only letters, numbers, underscores, and hyphens
 *
 * Returns an empty string when valid, otherwise a localized error message.
 * Extracted from AccountSettings so the rule set is unit-testable (pure).
 */
export function validateUsername(value: string): string {
  if (!value || value.trim().length === 0) {
    return t`Username cannot be empty`;
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 30) {
    return t`Username must be between 3 and 30 characters`;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return t`Username can only contain letters, numbers, underscores, and hyphens`;
  }
  return "";
}
