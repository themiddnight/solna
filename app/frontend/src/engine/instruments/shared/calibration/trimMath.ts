import { toDbfs, toDecibels, type Dbfs, type Decibels } from "@/shared/audio/gainUnits";

/** Reference level every instrument is calibrated toward (spec §4.4, epic AC#1). */
export const TARGET_DBFS: Dbfs = toDbfs(-18);
/** Epic AC#1's tolerance band, verbatim — this issue hits the criterion, it does not redefine it. */
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
