import path from 'path';

/**
 * Reduce an untrusted upload filename to a safe basename before it is composed into a
 * storage key. Strips directory components and path-traversal sequences, allows only a
 * conservative charset, and guarantees a non-empty result.
 *
 * This is the boundary defense for DEV-182; LocalStorageAdapter additionally asserts that
 * the resolved path stays inside the base directory as a universal backstop.
 */
export function sanitizeFilename(rawName: string): string {
  // Drop any directory components / traversal first.
  const base = path.basename(rawName);
  const cleaned = base
    // Neutralize anything outside a conservative allow-list (also kills "/" and "\").
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    // No leading dots — prevents "..", hidden files, and "...".
    .replace(/^\.+/, '')
    .replace(/_{2,}/g, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}
