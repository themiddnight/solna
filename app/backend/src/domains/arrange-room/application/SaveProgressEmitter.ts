import type { Server as SocketIOServer } from 'socket.io';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import type { SaveProgressCallback } from '../domain/services/ProjectSaveService';

/** Create a progress callback that emits socket events to the room namespace. */
export function createSaveProgressCallback(
  io: SocketIOServer | undefined,
  roomId: string
): SaveProgressCallback {
  const namespace = io?.of(`/room/${roomId}`);
  return (step, detail) => {
    if (namespace) {
      namespace.to(roomId).emit(ARRANGE_EVENTS.SAVE_PROGRESS, {
        roomId,
        step,
        detail,
      });
    }
  };
}
