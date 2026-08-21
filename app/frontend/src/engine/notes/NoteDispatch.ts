import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";
import type { EngineResolver } from "./engineResolver";
import type { NoteTarget } from "./noteTarget";

/**
 * Room-agnostic audition dispatch (design spec §3). Resolves a NoteTarget to an
 * engine via the injected resolver and forwards the floor calls. Auditions
 * ONLY — record / broadcast / monitor live in per-room orchestration ABOVE this
 * core, which knows nothing of rooms, sockets or regions.
 *
 * When the resolver has no ready engine for the target, calls no-op (mirroring
 * the existing registry guard where getEngine() returns null before playback).
 * The target is re-resolved on every call, so an engine may be created, swapped
 * or disposed between notes without the caller holding a stale reference.
 *
 * NoteEvent.time carries both live (@now, undefined) and scheduled (@t) playback,
 * so this one surface serves real-time input and region playback alike.
 */
export class NoteDispatch {
  constructor(private readonly resolver: EngineResolver) {}

  playNote(target: NoteTarget, event: NoteEvent): void {
    this.resolver.resolve(target)?.playNote(event);
  }

  stopNote(target: NoteTarget, event: NoteStopEvent): void {
    this.resolver.resolve(target)?.stopNote(event);
  }

  stopAllNotes(target: NoteTarget): void {
    this.resolver.resolve(target)?.stopAllNotes();
  }

  setSustain(target: NoteTarget, active: boolean): void {
    this.resolver.resolve(target)?.setSustain(active);
  }
}
