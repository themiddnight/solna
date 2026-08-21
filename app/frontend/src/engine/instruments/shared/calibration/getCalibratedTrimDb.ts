import type { Decibels } from "@/shared/audio/gainUnits";

import { CALIBRATION_TRIM_TABLE } from "./trimTable.data";

/**
 * Looks up an instrument's measured pre-gain default (DEV-311). Returns `undefined` for any
 * instrumentId not yet in the committed table — callers fall back to their flat default, which
 * covers instruments added after the harness last ran (see scripts/calibration/README.md).
 */
export function getCalibratedTrimDb(instrumentId: string): Decibels | undefined {
  return CALIBRATION_TRIM_TABLE[instrumentId]?.trimDb;
}
