import type { Socket } from 'socket.io';
import { PERFORM_EVENTS } from '@jam-band/shared';
import { secureSocketEvent } from '../security';
import { checkSocketRateLimitAsync } from '../rateLimit';
import { createPartialMock } from '@/testing/mocks';

// Keep the rate limiter out of the way — these tests only exercise the payload-size guard.
jest.mock('../rateLimit');

jest.mock('../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logSocketEvent: jest.fn(),
    logSecurityEvent: jest.fn(),
    logError: jest.fn(),
    logValidationFailure: jest.fn(),
  },
}));

const rateLimitMock = jest.mocked(checkSocketRateLimitAsync);

// The jest config resets mock implementations between tests, so (re)apply it here.
beforeEach(() => {
  rateLimitMock.mockResolvedValue({ allowed: true });
});

const makeSocket = (): { socket: Socket; emit: jest.Mock } => {
  const emit = jest.fn();
  const socket = createPartialMock<Socket>({
    id: 's1',
    data: {},
    emit,
    handshake: createPartialMock<Socket['handshake']>({ address: '127.0.0.1', headers: {} }),
  });
  return { socket, emit };
};

describe('secureSocketEvent payload-size guard (DEV-191)', () => {
  it('rejects an oversized payload and never calls the handler', async () => {
    const handler = jest.fn();
    const { socket, emit } = makeSocket();
    // ~1 MB serialized — well over the 256 KB default cap.
    const oversized = { notes: new Array(200_000).fill('C4') };

    await secureSocketEvent('perform:play_note', null, handler)(socket, oversized);

    expect(handler).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Payload too large' }));
  });

  it('passes a normal-sized payload through to the handler', async () => {
    const handler = jest.fn();
    const { socket } = makeSocket();

    await secureSocketEvent('perform:play_note', null, handler)(socket, {
      notes: ['C4', 'E4', 'G4'],
      velocity: 100,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allows a larger base64 chunk for the audio-chunk event (media exemption)', async () => {
    const handler = jest.fn();
    const { socket } = makeSocket();
    // ~500 KB — over the 256 KB default but under the media cap.
    const chunk = 'a'.repeat(500 * 1024);

    await secureSocketEvent(PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK, null, handler)(socket, { chunk });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
