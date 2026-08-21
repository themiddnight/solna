import { InstrumentCategory } from "@/engine/instruments/shared/constants";
import type { InstrumentFamily } from "@/engine/instruments/shared/calibration/trimTable.types";

/**
 * Per-instrument overrides for the rare case a category's default family assignment is wrong
 * for one specific instrument (e.g. a "Melodic" entry that is actually a plucked/percussive
 * sample). Empty until Task 8's real run surfaces a concrete need — do not pre-guess entries.
 */
const FAMILY_OVERRIDES: Readonly<Record<string, InstrumentFamily>> = {};

export function assignFamily(category: InstrumentCategory, instrumentId?: string): InstrumentFamily {
  const override = instrumentId != null ? FAMILY_OVERRIDES[instrumentId] : undefined;
  if (override !== undefined) return override;
  switch (category) {
    case InstrumentCategory.Synthesizer:
      return "sustained";
    case InstrumentCategory.DrumBeat:
    case InstrumentCategory.AcousticDrumset:
    case InstrumentCategory.Percussions:
      return "percussive";
    case InstrumentCategory.Melodic:
    default:
      return "polyphonic";
  }
}
