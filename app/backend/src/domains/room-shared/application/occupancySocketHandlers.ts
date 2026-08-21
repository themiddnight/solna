import type { Socket, Namespace } from 'socket.io';
import { OCCUPANCY_EVENTS } from '@jam-band/shared';
import type { RoomOccupancyOperations } from './RoomOccupancyService';

/**
 * Room-agnostic socket-event orchestration for `OCCUPANCY_EVENTS` (DEV-350 M2), backing the
 * `occupancy:join`/`occupancy:leave`/`occupancy:heartbeat` wire vocabulary against a
 * `RoomOccupancyService` instance. Extracted out of `ArrangeLockHandler` (Task 7) so a future
 * Perform-room handler (Task 24) can call the exact same orchestration against its own
 * `RoomOccupancyService`/session-lookup instances instead of copy-pasting these bodies —
 * every dependency is an explicit parameter, nothing is read off `this`.
 */

/**
 * Matches `BaseRoomHandler.getSession`'s minimal resolved session shape (and
 * `ArrangeRoomHandler.getSessionPublic`'s return type). TR-33: acting identity always comes
 * from this verified session, never from the client-sent `data` payload. Each room handler
 * passes its own session-lookup function bound to its own socket/session infrastructure.
 */
export type OccupancySessionLookup = (
  socket: Socket
) => Promise<{ roomId: string; userId: string; username: string } | null>;

export async function handleOccupancyJoin(
  occupancyService: RoomOccupancyOperations,
  getSession: OccupancySessionLookup,
  socket: Socket,
  namespace: Namespace,
  data: { roomId: string; elementId: string }
): Promise<void> {
  const session = await getSession(socket);
  if (!session || session.roomId !== data.roomId) {
    return;
  }

  const holder = { userId: session.userId, username: session.username, joinedAt: Date.now() };
  const { accepted: isAccepted, holders } = await occupancyService.join(data.roomId, data.elementId, holder);

  if (isAccepted) {
    namespace.to(data.roomId).emit(OCCUPANCY_EVENTS.JOINED, { elementId: data.elementId, holders });
  } else {
    socket.emit(OCCUPANCY_EVENTS.JOIN_DENIED, { elementId: data.elementId, heldBy: holders[0] });
  }
}

export async function handleOccupancyLeave(
  occupancyService: RoomOccupancyOperations,
  getSession: OccupancySessionLookup,
  socket: Socket,
  namespace: Namespace,
  data: { roomId: string; elementId: string }
): Promise<void> {
  const session = await getSession(socket);
  if (!session || session.roomId !== data.roomId) {
    return;
  }

  const result = await occupancyService.leave(data.roomId, data.elementId, session.userId);
  if (result) {
    namespace.to(data.roomId).emit(OCCUPANCY_EVENTS.LEFT, { elementId: data.elementId, holders: result.holders });
  }
}

/**
 * Heartbeat broadcasts nothing by design (it only refreshes the container owner's staleness
 * clock in Redis), so — unlike join/leave — it takes no `Namespace`.
 */
export async function handleOccupancyHeartbeat(
  occupancyService: RoomOccupancyOperations,
  getSession: OccupancySessionLookup,
  socket: Socket,
  data: { roomId: string; elementId: string }
): Promise<void> {
  const session = await getSession(socket);
  if (!session || session.roomId !== data.roomId) {
    return;
  }
  await occupancyService.heartbeat(data.roomId, data.elementId, session.userId);
}

/**
 * Release every occupancy entry a disconnecting/leaving user holds and broadcast `LEFT` for
 * each one. Room-agnostic counterpart of the old per-room `handleUserLeaveLocks` cleanup —
 * callers append any room-specific cleanup (e.g. Arrange's save-lock release) after this.
 */
export async function releaseAllOccupancyForUser(
  occupancyService: RoomOccupancyOperations,
  roomId: string,
  userId: string,
  namespace: Namespace
): Promise<void> {
  const released = await occupancyService.releaseAllForUser(roomId, userId);
  released.forEach(({ elementId, holders }) => {
    namespace.to(roomId).emit(OCCUPANCY_EVENTS.LEFT, { elementId, holders });
  });
}
