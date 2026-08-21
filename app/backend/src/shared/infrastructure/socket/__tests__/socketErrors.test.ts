import type { Socket } from 'socket.io';
import { SOCKET_ERROR_CODES } from '@jam-band/shared';
import {
  createSocketConnectionError,
  decorateSocketErrorEmits,
  isSocketErrorEvent,
  normalizeSocketErrorPayload,
} from '../socketErrors';

describe('socketErrors', () => {
  it('normalizes message-only error payloads with shared codes', () => {
    expect(normalizeSocketErrorPayload({ message: 'Room not found' })).toMatchObject({
      code: SOCKET_ERROR_CODES.ROOM_NOT_FOUND,
      message: 'Room not found',
    });
  });

  it('falls back to the error field when no message is present', () => {
    expect(normalizeSocketErrorPayload({ error: 'Room not found' })).toMatchObject({
      code: SOCKET_ERROR_CODES.ROOM_NOT_FOUND,
      message: 'Room not found',
    });
  });

  it('decorates socket error emits without changing non-error events', () => {
    const emit = jest.fn();
    const socket = { emit } as unknown as Socket;

    decorateSocketErrorEmits(socket);
    socket.emit('join_error', { message: 'This room has no active sessions.' });
    socket.emit('room_joined', { message: 'ok' });

    expect(emit).toHaveBeenNthCalledWith(
      1,
      'join_error',
      expect.objectContaining({
        code: SOCKET_ERROR_CODES.ROOM_NO_ACTIVE_SESSIONS,
        message: 'This room has no active sessions.',
      }),
    );
    expect(emit).toHaveBeenNthCalledWith(2, 'room_joined', { message: 'ok' });
  });

  it('is idempotent — decorating an already-decorated socket is a no-op', () => {
    const emit = jest.fn();
    const socket = { emit } as unknown as Socket;

    decorateSocketErrorEmits(socket);
    decorateSocketErrorEmits(socket); // early return on the decorated flag
    socket.emit('join_error', { message: 'This room has no active sessions.' });

    expect(emit).toHaveBeenCalledWith(
      'join_error',
      expect.objectContaining({ code: SOCKET_ERROR_CODES.ROOM_NO_ACTIVE_SESSIONS }),
    );
  });

  it('is a no-op for sockets without an emit function', () => {
    // Confined cast: socket.io sockets always have emit; the guard defends
    // against non-socket objects flowing in (mirrors the socket cast above).
    const nonSocket = {} as unknown as Socket;
    expect(() => decorateSocketErrorEmits(nonSocket)).not.toThrow();
  });

  it('attaches payload data to Socket.IO connection errors', () => {
    const error = createSocketConnectionError('Room not found', { roomId: 'room-1' });

    expect(error.message).toBe('Room not found');
    expect(error.data).toMatchObject({
      code: SOCKET_ERROR_CODES.ROOM_NOT_FOUND,
      message: 'Room not found',
      roomId: 'room-1',
    });
  });

  it('defaults the connection-error code to OPERATION_FAILED when no overrides are given', () => {
    const error = createSocketConnectionError('boom');
    expect(error.data).toMatchObject({
      code: SOCKET_ERROR_CODES.OPERATION_FAILED,
      message: 'boom',
    });
  });

  it('classifies error events by suffix and rejects non-strings', () => {
    expect(isSocketErrorEvent('error')).toBe(true);
    expect(isSocketErrorEvent('join_error')).toBe(true);
    expect(isSocketErrorEvent('room:error')).toBe(true);
    expect(isSocketErrorEvent('room_joined')).toBe(false);
    // Non-string payloads (e.g. a bare object) are never error events.
    expect(isSocketErrorEvent(42)).toBe(false);
  });
});
