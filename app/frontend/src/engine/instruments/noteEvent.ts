export interface NoteEvent {
  note: string | number;
  velocity?: number;
  time?: number;
}

export type NoteStopEvent = Pick<NoteEvent, "note" | "time">;
