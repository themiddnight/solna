import type { Socket } from 'socket.io';
import { SHARED_EVENTS } from '@jam-band/shared';

/**
 * Shared Socket.IO utility functions
 */

/**
 * Handle ping measurement event for latency monitoring.
 * Responds with a ping_response containing the original pingId, timestamp, and server timestamp.
 */
export function handlePingMeasurement(socket: Socket, data: unknown): void {
  if (data != null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (record.pingId != null && record.timestamp != null) {
      socket.emit(SHARED_EVENTS.PING_RESPONSE, {
        pingId: String(record.pingId),
        timestamp: Number(record.timestamp),
        serverTimestamp: Date.now()
      });
    }
  }
}
