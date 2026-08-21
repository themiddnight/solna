import type { Dbfs, Decibels } from "@/shared/audio/gainUnits";
import type { InstrumentCategory } from "../constants";

export type InstrumentFamily = "sustained" | "percussive" | "polyphonic";

export interface CalibrationTrimTableEntry {
  instrumentId: string;
  category: InstrumentCategory;
  family: InstrumentFamily;
  measuredDbfs: Dbfs;
  trimDb: Decibels;
  configHash: string;
  measuredAt: string;
}

export type CalibrationTrimTable = Readonly<Record<string, CalibrationTrimTableEntry>>;
