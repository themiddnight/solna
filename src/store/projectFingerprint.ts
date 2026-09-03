import { PROJECT_CONTENT_KEYS, PROJECT_LOOP_KEYS, factoryProjectContent, type ProjectContent } from './projectFormat';

/** JSON with object keys sorted at every level, so insertion order cannot leak in. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

/**
 * The content set serialised through the explicit key orders in
 * projectFormat.ts — PROJECT_CONTENT_KEYS at the top level and
 * PROJECT_LOOP_KEYS inside each loop — with every nested object sorted. Keys
 * outside the content set are never read, so excluded state cannot dirty it.
 */
export function canonicalContent(content: ProjectContent): string {
  const source = content as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of PROJECT_CONTENT_KEYS) {
    if (key === 'loops') {
      const loops = content.loops.map((loop) => {
        const row = loop as unknown as Record<string, unknown>;
        return PROJECT_LOOP_KEYS.map((k) => stableStringify(row[k])).join(',');
      });
      parts.push(`[${loops.join('|')}]`);
    } else {
      parts.push(stableStringify(source[key]));
    }
  }
  return parts.join(';');
}

/** FNV-1a 32-bit over the canonical string, plus its length, as hex. */
export function fingerprintContent(content: ProjectContent): string {
  const text = canonicalContent(content);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${text.length.toString(36)}`;
}

let defaultFingerprint: string | null = null;

/**
 * The fingerprint of a brand-new project — the comparison target for an
 * untitled session. factoryProjectContent() is the same values the slices
 * start from (transportSlice bpm/meter/masterVolume, effectsSlice
 * INITIAL_EFFECTS, loopSlice [createDefaultLoop()]), so a fresh launch is
 * clean by construction. Computed once; the factory content never changes.
 */
export function defaultContentFingerprint(): string {
  defaultFingerprint ??= fingerprintContent(factoryProjectContent());
  return defaultFingerprint;
}

/**
 * The one dirty rule. Untitled session (no currentProjectId): dirty when the
 * content differs from the default project — the baseline hash is ignored and
 * stays null. Saved project: dirty when the content differs from the baseline
 * taken on open / save; a missing baseline is treated as dirty, never clean.
 *
 * Never seed a baseline from whatever is on screen: that made an untitled
 * session look clean, so Import could silently replace unsaved work because
 * the dirty guard never fired.
 */
export function isContentDirty(
  content: ProjectContent,
  currentProjectId: string | null,
  projectBaselineHash: string | null,
  fingerprint: (c: ProjectContent) => string = fingerprintContent,
): boolean {
  const hash = fingerprint(content);
  if (currentProjectId === null) return hash !== defaultContentFingerprint();
  if (projectBaselineHash === null) return true;
  return hash !== projectBaselineHash;
}
