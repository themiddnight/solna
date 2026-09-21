import type { IncidentKind, RuntimeProfile, SanitizedError } from './types';

export interface FingerprintInput {
  kind: IncidentKind;
  error: SanitizedError | null;
  runtime: Pick<RuntimeProfile, 'engine' | 'platform'>;
  buildId: string;
}

function firstFrame(stack: string | null): string {
  if (stack === null) return '';
  const lines = stack.split('\n');
  // V8 stacks lead with the message line; frames start with "at ", Safari/Firefox frames contain "@".
  return lines.find((l) => /^\s*at\s/.test(l) || l.includes('@'))?.trim() ?? '';
}

/** 32-bit FNV-1a. A duplicate key for issue search, not a security primitive. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function incidentFingerprint(input: FingerprintInput): string {
  return fnv1a(
    [
      input.kind,
      input.error?.name ?? '',
      firstFrame(input.error?.stack ?? null),
      input.runtime.engine,
      input.runtime.platform,
      input.buildId,
    ].join('\u001f'),
  );
}
