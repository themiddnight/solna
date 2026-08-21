import { getVersilianDrumKit } from "../acoustic-drumset/acousticDrumKits";
import { getDrumAbuseMachineId } from "../drum/constants";
import { getPercussionSetConfig } from "../percussion/percussionSets";
import type { InstrumentProvider, SampleInstrumentDescriptor } from "./types";
import { Sf2AcousticDrumsetProvider } from "./Sf2AcousticDrumsetProvider";
import { SmplrDrumProvider } from "./SmplrDrumProvider";
import { SmplrSoundfontProvider } from "./SmplrSoundfontProvider";
import { VersilianAcousticDrumsetProvider } from "./VersilianAcousticDrumsetProvider";
import { VersilianPercussionProvider } from "./VersilianPercussionProvider";

export const createInstrumentProvider = (
  descriptor: SampleInstrumentDescriptor,
): InstrumentProvider => {
  switch (descriptor.providerKey) {
    case "smplr-soundfont":
      return new SmplrSoundfontProvider({
        instrument: String(descriptor.providerConfig.instrument ?? descriptor.id),
      });
    case "smplr-drum-machine":
      return new SmplrDrumProvider({
        kind: "machine",
        instrument: String(descriptor.providerConfig.instrument ?? descriptor.id),
      });
    case "smplr-drum-abuse": {
      const set = descriptor.providerConfig.set;
      return new SmplrDrumProvider({
        kind: "drum-abuse",
        machine: String(descriptor.providerConfig.machine ?? getDrumAbuseMachineId(descriptor.id)),
        ...(set !== undefined ? { set: String(set) } : {}),
      });
    }
    case "versilian-acoustic-drumset": {
      const kitId = String(descriptor.providerConfig.kit ?? descriptor.id);
      return new VersilianAcousticDrumsetProvider(getVersilianDrumKit(kitId));
    }
    case "sf2-acoustic-drumset":
      return new Sf2AcousticDrumsetProvider();
    case "versilian-percussion": {
      const setId = String(descriptor.providerConfig.set ?? descriptor.id);
      return new VersilianPercussionProvider(getPercussionSetConfig(setId));
    }
    default: {
      const exhaustive: never = descriptor.providerKey;
      throw new Error(`Unsupported instrument provider: ${String(exhaustive)}`);
    }
  }
};

export const isSampleInstrumentDescriptor = (
  descriptor: { providerKey: string },
): descriptor is SampleInstrumentDescriptor =>
  descriptor.providerKey !== "tone-synth";
