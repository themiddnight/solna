import type { InstrumentEngine } from "@/engine/instruments/shared/types";
import type { NoteTarget } from "./noteTarget";

/**
 * The per-context seam of the NoteDispatch core (design spec §3). Each room
 * implements one resolver that wraps its own InstrumentEnginePool instance
 * (plus any context concerns, e.g. arrange's track mixer/loading) and maps a
 * NoteTarget to a ready InstrumentEngine — or null when no engine is ready.
 */
export interface EngineResolver {
  resolve(target: NoteTarget): InstrumentEngine | null;
}
