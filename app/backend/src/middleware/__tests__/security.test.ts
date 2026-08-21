import { secureSocketEvent } from '../security';
import { checkSocketRateLimitAsync } from '../rateLimit';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { SOCKET_ERROR_CODES } from '@jam-band/shared';

jest.mock('../rateLimit', () => ({
  checkSocketRateLimitAsync: jest.fn(),
}));

jest.mock('../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logSocketEvent: jest.fn(),
    logSecurityEvent: jest.fn(),
    logValidationFailure: jest.fn(),
    logError: jest.fn(),
  },
}));

jest.mock('../../shared/infrastructure/security/webrtcValidation', () => ({
  validateWebRTCRequest: jest.fn(() => ({ isValid: true })),
}));

describe('secureSocketEvent', () => {
  const socket = {
    id: 'socket-1',
    data: { userId: 'user-1' },
    emit: jest.fn(),
  } as unknown as Socket;

  beforeEach(() => {
    jest.clearAllMocks();
    (checkSocketRateLimitAsync as jest.Mock).mockResolvedValue({ allowed: true });
  });

  it('awaits async Redis-backed socket rate limiting before executing handler', async () => {
    const handler = jest.fn();
    const wrapped = secureSocketEvent('chat_message', null, handler);

    await wrapped(socket, { message: 'hello' });

    expect(checkSocketRateLimitAsync).toHaveBeenCalledWith(socket, 'chat_message');
    expect(handler).toHaveBeenCalledWith(socket, { message: 'hello' });
  });

  it('rejects events when async rate limiter denies the request', async () => {
    (checkSocketRateLimitAsync as jest.Mock).mockResolvedValue({ allowed: false, retryAfter: 30 });
    const handler = jest.fn();
    const wrapped = secureSocketEvent('chat_message', null, handler);

    await wrapped(socket, { message: 'hello' });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      code: expect.any(String),
      retryAfter: 30,
    }));
  });

  const bpmSchema = z.object({ bpm: z.number() });

  it('infers handler data type from the Zod schema and forwards the parsed value', async () => {
    const seen: number[] = [];
    const wrapped = secureSocketEvent('metronome_update', bpmSchema, (_socket, data) => {
      // data must be inferred as { bpm: number }; reading data.bpm must type-check
      seen.push(data.bpm);
    });

    await wrapped(socket, { bpm: 120 });

    expect(seen).toEqual([120]);
  });

  it('rejects data that fails the Zod schema without calling the handler', async () => {
    const handler = jest.fn();
    const wrapped = secureSocketEvent('metronome_update', bpmSchema, handler);

    await wrapped(socket, { bpm: 'fast' });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: SOCKET_ERROR_CODES.INVALID_DATA_FORMAT,
    }));
  });
});
