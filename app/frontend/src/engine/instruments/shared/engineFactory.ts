import type { InstrumentEngine, InstrumentEngineConfig } from "./types";
import { InstrumentCategory } from "./constants";
import { MelodicEngine } from "../melodic/MelodicEngine";
import { DrumEngine } from "../drum/DrumEngine";
import { AcousticDrumEngine } from "../acoustic-drumset/AcousticDrumEngine";
import { PercussionEngine } from "../percussion/PercussionEngine";
import { SynthEngine } from "../synthesizer/SynthEngine";

export function createEngine(config: InstrumentEngineConfig): InstrumentEngine {
  switch (config.category) {
    case InstrumentCategory.Synthesizer:
      return new SynthEngine(config);
    case InstrumentCategory.DrumBeat:
      return new DrumEngine(config);
    case InstrumentCategory.AcousticDrumset:
      return new AcousticDrumEngine(config);
    case InstrumentCategory.Percussions:
      return new PercussionEngine(config);
    case InstrumentCategory.Melodic:
    default:
      return new MelodicEngine(config);
  }
}
