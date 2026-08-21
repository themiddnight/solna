import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { MidiNote, MidiNoteUpdate } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import { checkRegionEditAccess } from './arrangeRegionGuards';

/**
 * MIDI-note sub-handler — split out of `ArrangeRegionHandler` in DEV-350 Round 2, Task 2
 * (TR-20: the region handler had reached the 800-line cap). Behavior is unchanged apart
 * from that task's two fixes on the realtime path, marked below.
 *
 * Ephemeral key convention (TR-1): the realtime note edit schedules its auto-commit under
 * `noteUpdate:${regionId}:${noteId}`; every explicit commit path clears that exact key.
 */
export class ArrangeNoteHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /** Ephemeral auto-commit key for one note edit (TR-1) — one key per note, per user. */
  private static ephemeralKey(regionId: string, noteId: string): string {
    return `noteUpdate:${regionId}:${noteId}`;
  }

  /**
   * Handle note add
   */
  async handleNoteAdd(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; note: MidiNote }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Track-lock + occupancy guard from ONE room-state read (DEV-350 review follow-up,
    // finding 5 — the realtime path at `handleNoteRealtimeUpdate` was migrated first; note
    // CRUD carried the same double read). `validateTrackLockForRegion` and `getOwnerConflict`
    // each did a full Redis GET + deserialize of every track/region/note, and the occupancy
    // map lives on the very state the first call already fetched.
    //
    // Occupancy guard rationale (DEV-350 Round 2 Task 1) — holders[0] is the owner with edit
    // rights; this replaces the dead `state.locks` read, which let any user edit notes in a
    // region another user owns. TR-2 unchanged: still the mutex-free pre-check, the in-mutex
    // guard inside `*NoteAtomic` remains the atomicity guarantee.
    const access = await checkRegionEditAccess(this.handler, data.roomId, data.regionId, session.userId);
    if (!access.valid) {
      socket.emit('error', createSocketErrorPayload(access.error || 'Permission denied'));
      return;
    }
    if (access.conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: access.conflict.username });
      return;
    }

    try {
      // Atomic: lock check + state read + note append all inside a single mutex acquisition
      const result = await this.handler.getStateService().addNoteAtomic(data.roomId, data.regionId, data.note, session.userId);

      if (result.result === 'not_found') {
        return;
      }
      if (result.result === 'lock_conflict') {
        socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: result.lockedBy });
        return;
      }

      socket.to(data.roomId).emit(ARRANGE_EVENTS.NOTE_ADDED, {
        regionId: data.regionId,
        note: data.note,
        userId: session.userId,
      });
      loggingService.logInfo('Note added', {
        roomId: data.roomId,
        regionId: data.regionId,
        noteId: data.note.id,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeNoteHandler:handleNoteAdd', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to add note'));
    }
  }

  /**
   * Handle note update (COMMIT — save to Redis + broadcast)
   * TR-1: clears the pending realtime auto-commit for this note, since the client
   * explicitly committed the edit.
   */
  async handleNoteUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string; updates: MidiNoteUpdate }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Track-lock + occupancy guard from ONE room-state read (DEV-350 review follow-up,
    // finding 5 — the realtime path at `handleNoteRealtimeUpdate` was migrated first; note
    // CRUD carried the same double read). `validateTrackLockForRegion` and `getOwnerConflict`
    // each did a full Redis GET + deserialize of every track/region/note, and the occupancy
    // map lives on the very state the first call already fetched.
    //
    // Occupancy guard rationale (DEV-350 Round 2 Task 1) — holders[0] is the owner with edit
    // rights; this replaces the dead `state.locks` read, which let any user edit notes in a
    // region another user owns. TR-2 unchanged: still the mutex-free pre-check, the in-mutex
    // guard inside `*NoteAtomic` remains the atomicity guarantee.
    const access = await checkRegionEditAccess(this.handler, data.roomId, data.regionId, session.userId);
    if (!access.valid) {
      socket.emit('error', createSocketErrorPayload(access.error || 'Permission denied'));
      return;
    }
    if (access.conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: access.conflict.username });
      return;
    }

    // TR-1 (DEV-350 Round 2 Task 2): clear the pending auto-commit scheduled by
    // handleNoteRealtimeUpdate — this commit supersedes it. Mirrors handleRegionDragEnd's
    // `regionDrag` clear.
    this.handler.clearEphemeralCommitPublic(
      data.roomId,
      session.userId,
      ArrangeNoteHandler.ephemeralKey(data.regionId, data.noteId)
    );

    try {
      // Atomic: lock check + state read + note update all inside a single mutex acquisition
      const result = await this.handler.getStateService().updateNoteAtomic(data.roomId, data.regionId, data.noteId, data.updates, session.userId);

      if (result.result === 'not_found') {
        return;
      }
      if (result.result === 'lock_conflict') {
        socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: result.lockedBy });
        return;
      }

      socket.to(data.roomId).emit(ARRANGE_EVENTS.NOTE_UPDATED, {
        regionId: data.regionId,
        noteId: data.noteId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Note updated', {
        roomId: data.roomId,
        regionId: data.regionId,
        noteId: data.noteId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeNoteHandler:handleNoteUpdate', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to update note'));
    }
  }

  /**
   * Handle note delete
   * TR-1: clears the pending realtime auto-commit for this note — a deleted note must not
   * be resurrected by a timer that fires afterwards.
   */
  async handleNoteDelete(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Track-lock + occupancy guard from ONE room-state read (DEV-350 review follow-up,
    // finding 5 — the realtime path at `handleNoteRealtimeUpdate` was migrated first; note
    // CRUD carried the same double read). `validateTrackLockForRegion` and `getOwnerConflict`
    // each did a full Redis GET + deserialize of every track/region/note, and the occupancy
    // map lives on the very state the first call already fetched.
    //
    // Occupancy guard rationale (DEV-350 Round 2 Task 1) — holders[0] is the owner with edit
    // rights; this replaces the dead `state.locks` read, which let any user edit notes in a
    // region another user owns. TR-2 unchanged: still the mutex-free pre-check, the in-mutex
    // guard inside `*NoteAtomic` remains the atomicity guarantee.
    const access = await checkRegionEditAccess(this.handler, data.roomId, data.regionId, session.userId);
    if (!access.valid) {
      socket.emit('error', createSocketErrorPayload(access.error || 'Permission denied'));
      return;
    }
    if (access.conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: access.conflict.username });
      return;
    }

    // TR-1 (DEV-350 Round 2 Task 2): see handleNoteUpdate.
    this.handler.clearEphemeralCommitPublic(
      data.roomId,
      session.userId,
      ArrangeNoteHandler.ephemeralKey(data.regionId, data.noteId)
    );

    try {
      // Atomic: lock check + state read + note deletion all inside a single mutex acquisition
      const result = await this.handler.getStateService().deleteNoteAtomic(data.roomId, data.regionId, data.noteId, session.userId);

      if (result.result === 'not_found') {
        loggingService.logWarn('handleNoteDelete: state or region not found', {
          roomId: data.roomId,
          incomingRegionId: data.regionId,
          noteId: data.noteId,
        });
        return;
      }
      if (result.result === 'lock_conflict') {
        socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: result.lockedBy });
        return;
      }

      socket.to(data.roomId).emit(ARRANGE_EVENTS.NOTE_DELETED, {
        regionId: data.regionId,
        noteId: data.noteId,
        userId: session.userId,
      });
      loggingService.logInfo('Note deleted', {
        roomId: data.roomId,
        regionId: data.regionId,
        noteId: data.noteId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeNoteHandler:handleNoteDelete', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to delete note'));
    }
  }

  /**
   * Handle note realtime update (EPHEMERAL — broadcast only, no Redis write)
   * Used during note drag/resize/velocity changes in piano roll
   * TR-10: Schedules auto-commit if user disconnects before interaction end
   */
  async handleNoteRealtimeUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; noteId: string; updates: MidiNoteUpdate }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Track-lock + occupancy guard from ONE room-state read (DEV-350 final fix wave finding 5).
    // This event is rate-limited at 30/sec PER USER, and `getState` is an uncached Redis GET
    // plus a full deserialize of every track/region/note; the previous
    // `validateTrackLockForRegion` + `getOwnerConflict` pair deserialized the whole room twice
    // per event (the occupancy map lives on the very state the first call already fetched).
    // TR-2 unchanged: this is still the mutex-free pre-check — the in-mutex guard inside
    // `updateNoteAtomic` (auto-commit below) remains the atomicity guarantee.
    //
    // Occupancy guard rationale (DEV-350 Round 2 Task 2) — the ephemeral path needs the same
    // check as note CRUD: without it a non-owner's drag was broadcast to everyone AND written
    // to Redis by the auto-commit timer below, which made the client-side block meaningless.
    const access = await checkRegionEditAccess(this.handler, data.roomId, data.regionId, session.userId);
    if (!access.valid) {
      socket.emit('error', createSocketErrorPayload(access.error || 'Permission denied'));
      return;
    }
    if (access.conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: access.conflict.username });
      return;
    }

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(ARRANGE_EVENTS.NOTE_REALTIME_UPDATED, {
      regionId: data.regionId,
      noteId: data.noteId,
      updates: data.updates,
      userId: session.userId,
    });

    // TR-10: Schedule auto-commit in case user disconnects during note edit
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      ArrangeNoteHandler.ephemeralKey(data.regionId, data.noteId),
      data.updates,
      async () => {
        try {
          const result = await this.handler.getStateService().updateNoteAtomic(
            data.roomId, data.regionId, data.noteId, data.updates, session.userId
          );

          if (result.result !== 'not_found' && result.result !== 'lock_conflict') {
            namespace.to(data.roomId).emit(ARRANGE_EVENTS.NOTE_UPDATED, {
              regionId: data.regionId,
              noteId: data.noteId,
              updates: data.updates,
              userId: session.userId,
            });
          }
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeNoteHandler.handleNoteRealtimeUpdate.autoCommit',
            roomId: data.roomId,
            regionId: data.regionId,
            noteId: data.noteId,
            userId: session.userId,
          });
        }
      }
    );
  }
}
