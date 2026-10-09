/**
 * Reads a `.solna` file into the resolved song of `contract.ts`: the file
 * goes through the app's own validator (`parseProjectFile`) and the body
 * through `resolveSong`.
 */
import { parseProjectFile } from '@/store/projectFile';
import type { SolnaReadResult, SolnaWarning } from './contract';
import { resolveSong } from './resolveSong';

/** The `formatVersion` a file carries. Only called after `parseProjectFile` accepted or version-refused it. */
function fileFormatVersion(text: string): number {
  return (JSON.parse(text) as { formatVersion: number }).formatVersion;
}

/**
 * A `.solna` file's text as a resolved song. Never throws: a file the app
 * would refuse to open is refused here the same way, and a newer file is
 * refused with its version rather than read on a guess.
 */
export function readSolnaSong(text: string): SolnaReadResult {
  const parsed = parseProjectFile(text);
  if (!parsed.ok) {
    return parsed.error === 'newer-version'
      ? { ok: false, reason: 'newer-version', formatVersion: fileFormatVersion(text) }
      : { ok: false, reason: 'malformed' };
  }
  const warnings: SolnaWarning[] = parsed.warnings.map((detail) => ({ code: 'file-warning', detail }));
  try {
    return { ok: true, song: resolveSong(parsed.body, fileFormatVersion(text), warnings), warnings };
  } catch {
    // Sanitised content should always walk; a body that does not is not one this build can read.
    return { ok: false, reason: 'malformed' };
  }
}
