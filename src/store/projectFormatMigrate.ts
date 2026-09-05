import {
  DEFAULT_LEAD_GATE,
  isLegacyLeadMelody,
  upgradeLeadMelodyToTicks,
  upgradeLeadMelodyV1,
  type LeadNote,
} from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';

/**
 * The traversal every per-loop step of THIS chain repeats: reach `raw.content`,
 * leave the body untouched unless it is a plain object whose `loops` is an
 * array, and map each plain-object loop through `fn` (anything else passes
 * through, for sanitizeContent to refuse). Each version step below is then only
 * the field map it actually is.
 *
 * This is deliberately a SECOND copy of the same idea that mapLoops in
 * migrate.ts carries, and the two must NOT be merged: a project body is an
 * external contract (it has an envelope around `content`), the persist payload
 * is private localStorage shape, and their version numbers move for different
 * reasons (CLAUDE.md).
 */
function mapBodyLoops(
  raw: Record<string, unknown>,
  fn: (loop: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
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
        return fn(loop as Record<string, unknown>);
      }),
    },
  };
}

/**
 * v1 -> v2: lead notes gain a length and each loop gains a gate. Shares only
 * the pure upgradeLeadMelodyV1 transform with the persist chain in
 * migrate.ts — the two must NOT be refactored into one function: a project
 * body is an external contract, the persist payload is private localStorage
 * shape, and their version numbers move for different reasons.
 */
function upgradeLeadNotesV2(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (row) => ({
    ...row,
    leadMelodySteps: isLegacyLeadMelody(row.leadMelodySteps)
      ? upgradeLeadMelodyV1(row.leadMelodySteps)
      : row.leadMelodySteps,
    leadGate: typeof row.leadGate === 'number' ? row.leadGate : DEFAULT_LEAD_GATE,
  }));
}

/**
 * v2 -> v3: the melody is stored in ticks and each loop carries the
 * resolution it was authored at. Shares only the pure
 * upgradeLeadMelodyToTicks transform with the persist chain in migrate.ts —
 * the two must NOT be refactored into one: a project body is an external
 * contract, the persist payload is private localStorage shape, and their
 * version numbers move for different reasons.
 */
function upgradeLeadTicksV3(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (row) => {
    const bars = typeof row.leadLoopLength === 'number' ? row.leadLoopLength : 1;
    return {
      ...row,
      leadMelodySteps: Array.isArray(row.leadMelodySteps)
        ? upgradeLeadMelodyToTicks(row.leadMelodySteps as LeadNote[][], bars)
        : row.leadMelodySteps,
      leadStepResolution:
        typeof row.leadStepResolution === 'string'
          ? row.leadStepResolution
          : DEFAULT_LEAD_STEP_RESOLUTION,
    };
  });
}

/**
 * The `.solna` format migration chain. Separate from the persist chain in
 * store.ts on purpose (see projectFormat.ts): a project file is an external
 * contract, the persist payload is private.
 *
 * Each step must be PURE, and steps run in version order. A step is NOT
 * required to be a no-op on an already-current payload, and upgradeLeadTicksV3
 * deliberately is not one: applied twice it re-doubles the melody (96 rows to
 * 192). The `fromVersion` gate in migrateProjectBody is what guarantees single
 * application, and each step may assume it.
 *
 * That is not laxity. upgradeLeadTicksV3 used to make itself idempotent by
 * comparing the array's width against leadLoopLength, and because
 * LEAD_TICKS_PER_BAR is 2 * MAX_STEPS_PER_BAR that guard read two OLD bars as
 * one NEW one and returned a real user's melody un-widened, to be replayed at
 * half its beat. Do not restore a width guard here: the version gate already
 * does the job, and a width cannot tell the two shapes apart.
 *
 * This whole chain runs BEFORE sanitizeContent (parseProjectFile in
 * projectFile.ts) and must never be moved into or after it: asLeadNoteMatrix —
 * the guard sanitizeLoops reads through — returns `undefined` for the v1 string
 * shape rather than throwing, so an un-upgraded body would fall back to the
 * default and come back with a blank melody and no error.
 */
export function migrateProjectBody(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...raw };
  if (fromVersion < 2) next = upgradeLeadNotesV2(next);
  if (fromVersion < 3) next = upgradeLeadTicksV3(next);
  return next;
}
