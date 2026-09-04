import { DEFAULT_LEAD_GATE, isLegacyLeadMelody, upgradeLeadMelodyV1 } from '../audio/leadMelody';

/**
 * v1 -> v2: lead notes gain a length and each loop gains a gate. Shares only
 * the pure upgradeLeadMelodyV1 transform with the persist chain in
 * migrate.ts — the two must NOT be refactored into one function: a project
 * body is an external contract, the persist payload is private localStorage
 * shape, and their version numbers move for different reasons.
 */
function upgradeLeadNotesV2(raw: Record<string, unknown>): Record<string, unknown> {
  const content = raw.content;
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return raw;
  const c = content as Record<string, unknown>;
  if (!Array.isArray(c.loops)) return raw;
  return {
    ...raw,
    content: {
      ...c,
      loops: c.loops.map((loop) => {
        if (typeof loop !== 'object' || loop === null || Array.isArray(loop)) return loop;
        const row = loop as Record<string, unknown>;
        return {
          ...row,
          leadMelodySteps: isLegacyLeadMelody(row.leadMelodySteps)
            ? upgradeLeadMelodyV1(row.leadMelodySteps)
            : row.leadMelodySteps,
          leadGate: typeof row.leadGate === 'number' ? row.leadGate : DEFAULT_LEAD_GATE,
        };
      }),
    },
  };
}

/**
 * The `.solna` format migration chain. Separate from the persist chain in
 * store.ts on purpose (see projectFormat.ts): a project file is an external
 * contract, the persist payload is private.
 *
 * Each step must be pure and a no-op on an already-current payload. Steps run
 * in version order. This whole chain runs BEFORE sanitizeContent
 * (projectFile.ts:91-100) and must never be moved into or after it: the
 * isLeadNoteMatrix guard rejects the v1 string shape, so an un-upgraded body
 * would come back with a blank melody and no error.
 */
export function migrateProjectBody(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...raw };
  if (fromVersion < 2) next = upgradeLeadNotesV2(next);
  return next;
}
