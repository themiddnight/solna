export type { NoteEvent, NoteStopEvent } from "./instruments/noteEvent";

// NoteDispatch core — room-agnostic audition dispatch (DEV-251 epic)
export type { NoteTarget, EngineResolver } from "./notes";
export { NoteDispatch } from "./notes";
