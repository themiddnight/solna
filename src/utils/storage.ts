/**
 * Reads a raw string from storage, degrading to `null` (i.e. "no stored
 * value") if storage access throws. Safari private browsing, "block all
 * cookies" and some embedded webviews throw on the *property access* itself,
 * not just on read failure, so a bare `localStorage.getItem(...)` call is
 * unsafe — `storage ?? localStorage` is resolved *inside* the try for that
 * reason.
 */
export function readGuardedStorageValue(
  key: string,
  storage?: Pick<Storage, 'getItem'>,
): string | null {
  try {
    return (storage ?? localStorage).getItem(key);
  } catch {
    return null;
  }
}

/**
 * Like {@link readGuardedStorageValue}, but also degrades to `null` when the
 * stored value doesn't satisfy `isValid` (e.g. it's garbage, or a value from
 * a since-removed enum member).
 */
export function readValidatedStorageValue<T extends string>(
  key: string,
  isValid: (value: string | null) => value is T,
  storage?: Pick<Storage, 'getItem'>,
): T | null {
  const stored = readGuardedStorageValue(key, storage);
  return isValid(stored) ? stored : null;
}

/**
 * Best-effort persistence: swallows a throwing `setItem` so the caller's
 * in-memory value still updates for the session — only cross-session
 * persistence is lost when storage is blocked.
 */
export function persistGuardedStorageValue(
  key: string,
  value: string,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? localStorage).setItem(key, value);
  } catch {
    // Blocked storage (private mode, cookies disabled, some webviews): the
    // session still works, it just won't remember the choice next visit.
  }
}
