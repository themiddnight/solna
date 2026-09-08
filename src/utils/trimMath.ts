/**
 * KEEP IN SYNC WITH MURVA — see murva
 * `src/engine/instruments/shared/calibration/trimMath.ts`.
 *
 * A copy, by decision (DEV-388). `src/utils/gainContract.test.ts` pins
 * TARGET_DBFS to -18 and TOLERANCE_DB to 3 as literals. These two numbers are
 * the loudness a solna project is calibrated to; if they move on one side only,
 * a project still imports into murva and simply plays at the wrong level.
 */

/**
 * The calibration target and the arithmetic around it. Ported from murva's
 * `src/engine/instruments/shared/calibration/trimMath.ts` with the Zod branding
 * dropped (shared-contract divergence 1) and the Decibels/Dbfs naming kept: a
 * measurement is ABSOLUTE (Dbfs, 0 = ceiling), a trim is RELATIVE (Decibels,
 * 0 = unity).
 *
 * Lives in src/utils/ so `bun run lint` type-checks it and DEV-388 can pin it.
 * Only `scripts/calibration/` imports it, so it never enters the vite bundle.
 */
import { toDbfs, toDecibels, type Dbfs, type Decibels } from '@/utils/gainUnits';

/** The reference level every voice is calibrated toward. Shared contract, `trimMath.ts` row. */
export const TARGET_DBFS: Dbfs = toDbfs(-18);

/** The acceptance band, verbatim from the shared contract. This file hits it, it does not redefine it. */
export const TOLERANCE_DB = 3;

export function computeTrimDb(measuredDbfs: Dbfs, targetDbfs: Dbfs = TARGET_DBFS): Decibels {
  return toDecibels(targetDbfs - measuredDbfs);
}

export function isWithinTolerance(
  measuredDbfs: Dbfs,
  appliedTrimDb: Decibels,
  targetDbfs: Dbfs = TARGET_DBFS,
): boolean {
  const resultingDbfs = measuredDbfs + appliedTrimDb;
  return Math.abs(resultingDbfs - targetDbfs) <= TOLERANCE_DB;
}
