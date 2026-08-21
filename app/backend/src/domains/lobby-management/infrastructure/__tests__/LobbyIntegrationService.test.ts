/**
 * LobbyIntegrationService — the lobby wiring facade.
 *
 * Constructs the REAL integration stack (RoomServiceRoomListingRepository →
 * CachedRoomListingRepository → LobbyApplicationService → all three handlers);
 * only the infra boundaries are fakes: the socket.io Server, the
 * RoomLifecycleService and the EventBus. Assertions therefore lock real
 * wiring/caching/broadcast behavior, not mock behavior.
 */
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
    logSystemHealth: jest.fn(),
  },
}));

jest.mock('@/config/socket', () => ({
  authenticateSocket: jest.fn(),
}));

import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { CORE_NAMESPACES, LOBBY_EVENTS } from '@jam-band/shared';
import type { Server } from 'socket.io';
import { LobbyIntegrationService } from '../LobbyIntegrationService';
import { LobbyApplicationService } from '../../application/LobbyApplicationService';
import { LobbyNamespaceHandlers } from '../handlers/LobbyNamespaceHandlers';
import { LobbyEventHandlers } from '../handlers/LobbyEventHandlers';
import { RealTimeRoomStatusHandler } from '../handlers/RealTimeRoomStatusHandler';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import { authenticateSocket } from '@/config/socket';
import type { RoomLifecycleService } from '../../../room-management/application/RoomLifecycleService';
import type { EventBus } from '../../../../shared/domain/events/EventBus';
import type { Room } from '../../../../types';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number): Date => new Date(Date.now() - ms);

// Room summaries in the shape RoomService.getAllRooms() returns (see the
// RoomServiceRoomListingRepository B4 mapper tests for the mapping semantics).
const SUMMARY_FIXTURES = [
  { id: 'room-a', name: 'Rock Arena', userCount: 7, isPrivate: true, owner: 'user-1', createdAt: ago(5 * MIN) },
  { id: 'room-b', name: 'Jazz Lounge', userCount: 3, isPrivate: false, owner: 'user-2', createdAt: ago(3 * HOUR) },
  { id: 'room-c', name: 'Metal Pit', userCount: 8, isPrivate: false, owner: 'user-3', createdAt: ago(10 * MIN) },
  { id: 'room-d', name: 'Acoustic Corner', userCount: 0, isPrivate: false, owner: 'user-1', createdAt: ago(2 * HOUR) },
  { id: 'room-e', name: 'Synth Lab', userCount: 5, isPrivate: false, owner: 'user-4', createdAt: ago(1 * HOUR) },
  { id: 'room-f', name: 'Empty Studio', userCount: 0, isPrivate: true, owner: 'user-5', createdAt: ago(6 * HOUR) },
];

// Only getAllRooms/getRoom/getRoomOccupancy are exercised — cast to
// RoomLifecycleService at the constructor boundary below.
const fakeLifecycle = (rooms: unknown[] = []) => ({
  getAllRooms: jest.fn<() => Promise<unknown[]>>().mockResolvedValue(rooms),
  getRoom: jest.fn<() => Promise<Room | undefined>>(),
  getRoomOccupancy: jest.fn<() => Promise<null>>().mockResolvedValue(null),
});

type FakeLifecycle = ReturnType<typeof fakeLifecycle>;

const fakeBus = (): EventBus =>
  ({
    subscribe: jest.fn(),
    publish: jest.fn(),
    publishAll: jest.fn(),
    unsubscribe: jest.fn(),
  }) as unknown as EventBus;

interface FakeHarness {
  service: LobbyIntegrationService;
  lifecycle: FakeLifecycle;
  bus: EventBus;
  of: jest.Mock<(namespacePath: string) => unknown>;
  use: jest.Mock;
  on: jest.Mock;
  toEmit: jest.Mock<(event: string, payload: unknown) => void>;
}

const build = (rooms: unknown[] = SUMMARY_FIXTURES): FakeHarness => {
  const toEmit = jest.fn<(event: string, payload: unknown) => void>();
  const use = jest.fn();
  const on = jest.fn();
  const to = jest.fn<(room: string) => { emit: typeof toEmit }>(() => ({ emit: toEmit }));
  const of = jest.fn<(namespacePath: string) => unknown>(() => ({ use, on, to }));

  const lifecycle = fakeLifecycle(rooms);
  const bus = fakeBus();
  // Confined casts: only `of` and the three lifecycle methods are exercised —
  // infra boundaries (socket.io Server, RoomLifecycleService)
  const service = new LobbyIntegrationService(
    { of } as unknown as Server,
    lifecycle as unknown as RoomLifecycleService,
    bus
  );

  return { service, lifecycle, bus, of, use, on, toEmit };
};

describe('LobbyIntegrationService', () => {
  let harness: FakeHarness;

  beforeEach(() => {
    harness = build();
  });

  afterEach(() => {
    // Clears the handler intervals (metrics collection) and caches.
    harness.service.shutdown();
  });

  describe('constructor wiring — the real stack', () => {
    it('exposes the real application service wired to the real repository chain', async () => {
      const appService = harness.service.getLobbyApplicationService();

      expect(appService).toBeInstanceOf(LobbyApplicationService);

      // End-to-end through RoomServiceRoomListingRepository → CachedRoomListingRepository
      const stats = await appService.getLobbyStatistics();
      expect(stats.totalRooms).toBe(6);
      expect(stats.activeRooms).toBe(2);
      expect(stats.availableRooms).toBe(3);
      expect(stats.averageMemberCount).toBeCloseTo(23 / 6);

      const available = await appService.getAvailableRooms();
      expect(available.map(room => room.id.toString())).toEqual(['room-a', 'room-b', 'room-e']);
    });

    it('returns the injected room lifecycle service unchanged', () => {
      expect(harness.service.getRoomLifecycleService()).toBe(harness.lifecycle);
    });

    it('exposes the three handler instances', () => {
      expect(harness.service.getLobbyNamespaceHandlers()).toBeInstanceOf(LobbyNamespaceHandlers);
      expect(harness.service.getLobbyEventHandlers()).toBeInstanceOf(LobbyEventHandlers);
      expect(harness.service.getRealTimeStatusHandler()).toBeInstanceOf(RealTimeRoomStatusHandler);
    });
  });

  describe('createLobbyNamespace', () => {
    it('creates the /lobby namespace, requires a valid token and binds the connection handler', () => {
      const namespace = harness.service.createLobbyNamespace();

      expect(harness.of).toHaveBeenCalledWith(CORE_NAMESPACES.LOBBY);
      // DEV-179: the lobby namespace requires a valid token (registered or guest)
      expect(harness.use).toHaveBeenCalledWith(authenticateSocket);
      expect(harness.on).toHaveBeenCalledWith('connection', expect.any(Function));
      expect(namespace).toBeDefined();
    });
  });

  describe('cache statistics', () => {
    it('getCacheStatistics reflects the real cache state after reads and invalidateCache clears it', async () => {
      const appService = harness.service.getLobbyApplicationService();
      expect(harness.service.getCacheStatistics().roomListings.cached).toBe(false);

      await appService.getLobbyStatistics();
      // Real behavior: the statistics path reads the base repo directly and
      // never warms the listings entry — only statistics get cached.
      expect(harness.service.getCacheStatistics().roomListings.cached).toBe(false);
      expect(harness.service.getCacheStatistics().statistics.cached).toBe(true);

      await appService.getAvailableRooms(); // goes through CachedRoomListingRepository.findAll
      expect(harness.service.getCacheStatistics().roomListings.cached).toBe(true);

      harness.service.invalidateCache();

      expect(harness.service.getCacheStatistics().roomListings.cached).toBe(false);
      expect(harness.service.getCacheStatistics().statistics.cached).toBe(false);
    });

    it('the real cache serves repeated statistics reads without touching the lifecycle service', async () => {
      const appService = harness.service.getLobbyApplicationService();

      await appService.getLobbyStatistics();
      const firstCalls = harness.lifecycle.getAllRooms.mock.calls.length;
      await appService.getLobbyStatistics();
      expect(harness.lifecycle.getAllRooms.mock.calls.length).toBe(firstCalls); // cached
    });
  });

  describe('broadcastRoomUpdate', () => {
    it.each(['created', 'updated', 'deleted'] as const)(
      'broadcasts a %s room-list update to lobby_updates',
      (updateType) => {
        harness.service.broadcastRoomUpdate(updateType, { id: 'room-a', name: 'Rock Arena' });

        expect(harness.of).toHaveBeenCalledWith(CORE_NAMESPACES.LOBBY);
        expect(harness.toEmit).toHaveBeenCalledWith(
          LOBBY_EVENTS.ROOM_LIST_UPDATED,
          expect.objectContaining({
            type: updateType,
            room: expect.objectContaining({ id: 'room-a', name: 'Rock Arena' }),
          })
        );
      }
    );
  });

  describe('broadcastLobbyStatistics', () => {
    it('broadcasts statistics computed by the real repository chain', async () => {
      await harness.service.broadcastLobbyStatistics();

      expect(harness.toEmit).toHaveBeenCalledWith(
        LOBBY_EVENTS.LOBBY_STATISTICS_UPDATED,
        expect.objectContaining({
          statistics: expect.objectContaining({ totalRooms: 6, activeRooms: 2 }),
        })
      );
    });

    it('logs and swallows failures from the statistics chain', async () => {
      harness.lifecycle.getAllRooms.mockRejectedValue(new Error('db down'));

      await expect(harness.service.broadcastLobbyStatistics()).resolves.toBeUndefined();

      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ context: 'LobbyIntegrationService.broadcastLobbyStatistics' })
      );
      expect(harness.toEmit).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('clears the caches and stops the handlers without throwing', async () => {
      await harness.service.getLobbyApplicationService().getLobbyStatistics();

      expect(() => harness.service.shutdown()).not.toThrow();
      expect(harness.service.getCacheStatistics().roomListings.cached).toBe(false);
      expect(harness.service.getCacheStatistics().statistics.cached).toBe(false);
    });
  });
});
