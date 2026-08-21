/**
 * StreamingStrategy unit tests.
 *
 * Runs the REAL strategy (including its private StreamingHub) with no seams — the
 * hub is created/destroyed as a side effect of connect/disconnect and is only
 * observable through connection state and subscriber counts. Latency is stubbed
 * via Math.random to pin the quality tiers.
 *
 * Unreachable-without-seams branches (reported, not mocked around): the
 * recoverConnection catch (hub.addSubscriber cannot fail), handleIncomingStreamAudio
 * (the hub instance is private), and the 'excellent' quality tier (min simulated
 * latency is 100ms, so <100 is impossible).
 */

import { StreamingStrategy } from '../StreamingStrategy';
import {
  InvalidRoleError,
  ConnectionFailedError,
  UnsupportedOperationError,
} from '@/domains/real-time-communication/domain/services/AudioCommunicationStrategy';
import { UserRole, type ConnectionId, type AudioBuffer } from '@/domains/real-time-communication/domain/models/Connection';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

function audioBuffer(): AudioBuffer {
  return { data: new ArrayBuffer(8), sampleRate: 48000, channels: 2, timestamp: Date.now() };
}

// TR-27 confined boundary cast: an unknown id arrives from the wire layer.
const MISSING_ID = 'missing' as unknown as ConnectionId;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('StreamingStrategy.connect', () => {
  it('rejects non-audience roles with InvalidRoleError', async () => {
    const strategy = new StreamingStrategy('room-1');

    await expect(strategy.connect('user-a', UserRole.BAND_MEMBER)).rejects.toBeInstanceOf(InvalidRoleError);
    expect(strategy.getSubscriberCount()).toBe(0);
  });

  it('connects an audience member and subscribes them to the stream', async () => {
    const strategy = new StreamingStrategy('room-1');

    const connectionId = await strategy.connect('user-a', UserRole.AUDIENCE);

    expect(connectionId.toString()).toMatch(/^[0-9a-f-]{36}$/);
    expect(strategy.getSubscriberCount()).toBe(1);
    await expect(strategy.getConnectionHealth(connectionId)).resolves.toMatchObject({ isHealthy: true });
  });

  it('supports many audience members on one hub', async () => {
    const strategy = new StreamingStrategy('room-1');

    await strategy.connect('user-a', UserRole.AUDIENCE);
    await strategy.connect('user-b', UserRole.AUDIENCE);

    expect(strategy.getSubscriberCount()).toBe(2);
  });
});

describe('StreamingStrategy.disconnect', () => {
  it('logs a warning for an unknown connection without throwing', async () => {
    const strategy = new StreamingStrategy('room-1');

    await expect(strategy.disconnect(MISSING_ID)).resolves.toBeUndefined();
  });

  it('unsubscribes and cleans up the hub when the last audience leaves', async () => {
    const strategy = new StreamingStrategy('room-1');
    const connectionId = await strategy.connect('user-a', UserRole.AUDIENCE);

    await strategy.disconnect(connectionId);

    expect(strategy.getSubscriberCount()).toBe(0);
  });

  it('keeps the hub alive while other audiences remain', async () => {
    const strategy = new StreamingStrategy('room-1');
    const connectionA = await strategy.connect('user-a', UserRole.AUDIENCE);
    await strategy.connect('user-b', UserRole.AUDIENCE);

    await strategy.disconnect(connectionA);

    expect(strategy.getSubscriberCount()).toBe(1);
  });

  it('re-initializes the hub for a new audience after full cleanup', async () => {
    const strategy = new StreamingStrategy('room-1');
    const connectionId = await strategy.connect('user-a', UserRole.AUDIENCE);
    await strategy.disconnect(connectionId);

    const reconnectedId = await strategy.connect('user-b', UserRole.AUDIENCE);

    expect(strategy.getSubscriberCount()).toBe(1);
    expect(reconnectedId.toString()).not.toBe(connectionId.toString());
  });
});

describe('StreamingStrategy.sendAudio', () => {
  it('rejects audience audio with UnsupportedOperationError', async () => {
    const strategy = new StreamingStrategy('room-1');
    const connectionId = await strategy.connect('user-a', UserRole.AUDIENCE);

    await expect(strategy.sendAudio(connectionId, audioBuffer())).rejects.toBeInstanceOf(
      UnsupportedOperationError
    );
  });
});

describe('StreamingStrategy.getConnectionHealth', () => {
  it('reports failed for an unknown connection', async () => {
    const strategy = new StreamingStrategy('room-1');

    await expect(strategy.getConnectionHealth(MISSING_ID)).resolves.toEqual({
      isHealthy: false,
      quality: 'failed',
    });
  });

  it('reports good quality at the low end of streaming latency', async () => {
    const strategy = new StreamingStrategy('room-1');
    const connectionId = await strategy.connect('user-a', UserRole.AUDIENCE);
    jest.spyOn(Math, 'random').mockReturnValue(0); // latency 100ms

    const health = await strategy.getConnectionHealth(connectionId);

    expect(health.isHealthy).toBe(true);
    expect(health.quality).toBe('good');
  });

  it('reports poor quality at the high end of streaming latency', async () => {
    const strategy = new StreamingStrategy('room-1');
    const connectionId = await strategy.connect('user-a', UserRole.AUDIENCE);
    jest.spyOn(Math, 'random').mockReturnValue(0.9); // latency 280ms

    const health = await strategy.getConnectionHealth(connectionId);

    expect(health.isHealthy).toBe(true);
    expect(health.quality).toBe('poor');
  });
});

describe('StreamingStrategy.recoverConnection', () => {
  it('throws ConnectionFailedError for an unknown connection', async () => {
    const strategy = new StreamingStrategy('room-1');

    await expect(strategy.recoverConnection(MISSING_ID)).rejects.toBeInstanceOf(ConnectionFailedError);
  });

  it('re-subscribes a known connection as CONNECTED', async () => {
    const strategy = new StreamingStrategy('room-1');
    const connectionId = await strategy.connect('user-a', UserRole.AUDIENCE);

    await strategy.recoverConnection(connectionId);

    await expect(strategy.getConnectionHealth(connectionId)).resolves.toMatchObject({
      isHealthy: true,
    });
  });
});

describe('StreamingStrategy.onAudioReceived', () => {
  it('registers a callback without throwing', async () => {
    const strategy = new StreamingStrategy('room-1');
    await strategy.connect('user-a', UserRole.AUDIENCE);

    const callback = jest.fn();
    expect(() => strategy.onAudioReceived(callback)).not.toThrow();
    // The callback can only fire from StreamingHub.receiveAudioFromBand, which is
    // private to the strategy — registration is all that is observable here.
    expect(strategy.getSubscriberCount()).toBe(1);
  });
});

describe('StreamingStrategy.getStrategyInfo', () => {
  it('reports streaming configuration', () => {
    const strategy = new StreamingStrategy('room-1');

    expect(strategy.getStrategyInfo()).toEqual({
      type: 'streaming',
      maxConnections: 1000,
      supportedRoles: [UserRole.AUDIENCE],
    });
  });
});
