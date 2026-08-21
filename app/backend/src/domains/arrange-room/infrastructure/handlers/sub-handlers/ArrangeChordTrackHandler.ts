import type { Socket, Namespace } from 'socket.io';
import type { ChordBlock } from '@jam-band/shared';
import { createSocketErrorPayload, ARRANGE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { ChordBlockUpdate } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import { getOwnerConflict as getElementOwnerConflict } from './arrangeRegionGuards';

/**
 * Chord track block CRUD socket handlers (DEV-279 P1, Task 1.6).
 *
 * Mirrors ArrangeRegionHandler's ephemeral-drag/commit pattern. The CRUD guard (DEV-350 M2,
 * Task 13) reads `holders[0]` of the block's element-occupancy entry (`RoomOccupancyService`,
 * `container` kind — see `getOwnerConflict` below) instead of the retired `state.locks` map:
 * the dedicated `CHORD_BLOCK_LOCK_ACQUIRE`/`_RELEASE` socket events and their `atomicLockSwap`-
 * backed handlers were removed — chord-block selection now joins/leaves the block's occupancy
 * queue via the generic `OCCUPANCY_EVENTS.JOIN`/`LEAVE` (handled by `ArrangeLockHandler`), the
 * same mechanism regions already use.
 *
 * Broadcast scopes follow spec §6 exactly (mutations/commits via `namespace.to` — including
 * the sender — while the ephemeral drag broadcasts via `socket.to`, excluding the sender, per
 * TR-3).
 */
export class ArrangeChordTrackHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /**
   * Handle chord block add
   */
  async handleChordBlockAdd(socket: Socket, namespace: Namespace, data: { roomId: string; block: ChordBlock }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      await this.handler.getStateService().addChordBlock(data.roomId, data.block);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.CHORD_BLOCK_ADDED, { block: data.block, userId: session.userId });
      loggingService.logInfo('Chord block added', { roomId: data.roomId, blockId: data.block.id, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeChordTrackHandler:handleChordBlockAdd', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to add chord block'));
    }
  }

  /**
   * Handle chord block remove
   */
  async handleChordBlockRemove(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const conflict = await this.getOwnerConflict(data.roomId, data.blockId, session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.blockId, lockedBy: conflict.username });
      return;
    }

    try {
      await this.handler.getStateService().removeChordBlock(data.roomId, data.blockId);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.CHORD_BLOCK_REMOVED, { blockId: data.blockId, userId: session.userId });
      loggingService.logInfo('Chord block removed', { roomId: data.roomId, blockId: data.blockId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeChordTrackHandler:handleChordBlockRemove', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to remove chord block'));
    }
  }

  /**
   * Handle chord block drag (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending drag commit event
   */
  async handleChordBlockDrag(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string; newStart: number }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Reject up front — mirrors Remove/DragCommit/Update — so a block locked by another
    // user gets no phantom ephemeral broadcast AND no auto-commit gets scheduled below.
    const conflict = await this.getOwnerConflict(data.roomId, data.blockId, session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.blockId, lockedBy: conflict.username });
      return;
    }

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(ARRANGE_EVENTS.CHORD_BLOCK_DRAGGED, {
      blockId: data.blockId,
      newStart: data.newStart,
      userId: session.userId,
    });

    // TR-10: Schedule auto-commit in case user disconnects mid-drag
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      `chordBlockDrag:${data.blockId}`,
      { newStart: data.newStart },
      async () => {
        try {
          const sanitizedStart = Math.max(0, data.newStart);
          await this.handler.getStateService().updateChordBlock(data.roomId, data.blockId, { start: sanitizedStart });
          namespace.to(data.roomId).emit(ARRANGE_EVENTS.CHORD_BLOCK_DRAG_COMMITTED, {
            blockId: data.blockId,
            newStart: sanitizedStart,
            userId: session.userId,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeChordTrackHandler.handleChordBlockDrag.autoCommit',
            roomId: data.roomId,
            blockId: data.blockId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle chord block drag commit (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent drag commit
   */
  async handleChordBlockDragCommit(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string; newStart: number }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const conflict = await this.getOwnerConflict(data.roomId, data.blockId, session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.blockId, lockedBy: conflict.username });
      return;
    }

    // TR-10: Clear pending auto-commit since user explicitly committed
    this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, `chordBlockDrag:${data.blockId}`);

    try {
      const sanitizedStart = Math.max(0, data.newStart);
      await this.handler.getStateService().updateChordBlock(data.roomId, data.blockId, { start: sanitizedStart });
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.CHORD_BLOCK_DRAG_COMMITTED, {
        blockId: data.blockId,
        newStart: sanitizedStart,
        userId: session.userId,
      });
      loggingService.logInfo('Chord block drag committed', { roomId: data.roomId, blockId: data.blockId, newStart: sanitizedStart, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeChordTrackHandler:handleChordBlockDragCommit', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to commit chord block drag'));
    }
  }

  /**
   * Handle chord block update (chord/duration/color edits, e.g. from the chord palette modal)
   */
  async handleChordBlockUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; blockId: string; updates: ChordBlockUpdate }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const conflict = await this.getOwnerConflict(data.roomId, data.blockId, session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.blockId, lockedBy: conflict.username });
      return;
    }

    try {
      await this.handler.getStateService().updateChordBlock(data.roomId, data.blockId, data.updates);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.CHORD_BLOCK_UPDATED, {
        blockId: data.blockId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Chord block updated', { roomId: data.roomId, blockId: data.blockId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeChordTrackHandler:handleChordBlockUpdate', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to update chord block'));
    }
  }

  /**
   * Container-ownership CRUD guard (DEV-350 M2, Task 13): reads `holders[0]` of the
   * block's occupancy entry (element occupancy service — chord block ids are bare/unprefixed,
   * so `resolveElementKind` classifies them via its bare-id `container` default; there is
   * deliberately no `chord_block:` prefix row, see `elementKindRegistry.ts`) rather than the
   * retired `state.locks` map — the owner (queue head, `holders[0]`) is the only one with edit
   * rights; everyone else in the queue is a read-only viewer. Returns the conflicting owner's
   * `{ username }` when the acting user is NOT the owner, `null` when they are (or nobody holds
   * the block).
   *
   * Delegates to the shared `arrangeRegionGuards.getOwnerConflict` (DEV-350 final fix wave
   * finding 8): this method used to be a verbatim copy of it, differing only in a parameter
   * name. Two copies of a permission guard is exactly the duplication that must not be allowed
   * to drift — the shared function's `elementId` parameter is any occupancy key, block ids
   * included. Kept as a thin private wrapper (aliased import, so there is no self-recursive
   * look-alike at the call site) so the four call sites below stay unchanged.
   */
  private getOwnerConflict(roomId: string, blockId: string, actingUserId: string): Promise<{ username: string } | null> {
    return getElementOwnerConflict(this.handler, roomId, blockId, actingUserId);
  }
}
