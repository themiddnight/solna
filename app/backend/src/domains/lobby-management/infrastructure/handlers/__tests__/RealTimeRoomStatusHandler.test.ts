import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { CORE_NAMESPACES } from '@jam-band/shared';
import type { EventBus } from '@/shared/domain/events/EventBus';
import type { LobbyIntegrationService } from '../../LobbyIntegrationService';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import { RealTimeRoomStatusHandler } from '../RealTimeRoomStatusHandler';

const fakeBus = (): EventBus => ({ publish: jest.fn() }) as unknown as EventBus;

// Confined cast: the handler reaches the namespace via ['io'] bracket access
// jest.fn generics required: jest 30 types untyped jest.fn() as a zero-arg mock,
// which breaks toHaveBeenCalledWith(...) and payload access below (TS2554)
const fakeLobby = () => {
  // emit is called with (eventName, payload) — the payload is args[1]
  const emit = jest.fn<(eventName: string, payload: unknown) => void>();
  const to = jest.fn<(room: string) => { emit: typeof emit }>(() => ({ emit }));
  const of = jest.fn<(namespacePath: string) => { to: typeof to }>(() => ({ to }));
  return { emit, to, of, service: { io: { of } } as unknown as LobbyIntegrationService };
};

describe('RealTimeRoomStatusHandler — B2 regression (queue overflow must not silently drop updates)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('flushes the whole queue on overflow — no silent drops', async () => {
    const lobby = fakeLobby();
    const warnSpy = jest.spyOn(loggingService, 'logSystemHealth');
    const handler = new RealTimeRoomStatusHandler(fakeBus(), lobby.service);

    for (let i = 0; i < 101; i++) {
      await handler.updateRoomStatus(`room-${i}`, { memberCount: 1 }, 'low');
    }
    // processQueuedUpdates runs via `void` — flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(lobby.of).toHaveBeenCalledWith(CORE_NAMESPACES.LOBBY);
    const payload = lobby.emit.mock.calls[0]?.[1] as { updates: unknown[] };
    expect(payload.updates).toHaveLength(101);
    expect(warnSpy).toHaveBeenCalledWith(
      'lobby_status',
      'warning',
      expect.objectContaining({ message: expect.stringContaining('overflow') })
    );

    handler.shutdown();
  });

  it('keeps small queues buffered — no premature broadcast', async () => {
    const lobby = fakeLobby();
    const handler = new RealTimeRoomStatusHandler(fakeBus(), lobby.service);

    for (let i = 0; i < 5; i++) {
      await handler.updateRoomStatus(`room-${i}`, { memberCount: 1 }, 'low');
    }
    await Promise.resolve();

    expect(lobby.of).not.toHaveBeenCalled();
    handler.shutdown();
  });

  it('updates the status cache immediately', async () => {
    const handler = new RealTimeRoomStatusHandler(fakeBus(), fakeLobby().service);
    await handler.updateRoomStatus('room-1', { memberCount: 3, isPrivate: true }, 'high');

    const status = handler.getRoomStatus('room-1');
    expect(status?.memberCount).toBe(3);
    expect(status?.isPrivate).toBe(true);

    handler.shutdown();
  });
});
