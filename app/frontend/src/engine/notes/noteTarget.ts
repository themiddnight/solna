import type { InstrumentCategory } from "@/engine/instruments/shared/constants";

/**
 * Identifies which engine a note should be auditioned on, without the caller
 * knowing how that engine is stored or keyed. Each room context maps its own
 * key namespace (design spec §2.4):
 *   perform    = user-scoped (everyone plays their own instrument)
 *   arrange    = track-scoped (an instrument belongs to a track)
 *   companion  = companion-scoped
 */
export type NoteTarget =
  | { kind: "user"; userId: string; instrument: string; category: InstrumentCategory }
  | { kind: "track"; trackId: string }
  | { kind: "companion"; companionId: string };
