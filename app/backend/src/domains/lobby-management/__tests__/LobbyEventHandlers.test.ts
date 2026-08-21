/**
 * LobbyEventHandlers — live occupancy broadcast.
 *
 * Verifies that occupancy-relevant domain events (member join, companion change)
 * result in a per-room `room_updated_broadcast` on the /lobby namespace carrying
 * the canonical live counts from RoomLifecycleService.getRoomOccupancy — the
 * channel the lobby client actually consumes.
 */
import { LobbyEventHandlers } from '../infrastructure/handlers/LobbyEventHandlers';
import {
  MemberJoined,
  RoomOccupancyChanged,
  RoomCreated,
  RoomSettingsUpdated,
} from '../../../shared/domain/events/RoomEvents';
import { RoomListingsRefreshed } from '../domain/events/LobbyEvents';
import { RoomType } from '../../../types';
import type { EventBus } from '../../../shared/domain/events/EventBus';
import type { LobbyIntegrationService } from '../infrastructure/LobbyIntegrationService';
import type { RoomOccupancy } from '../../room-management/application/RoomLifecycleService';

type Handler = (event: unknown) => void | Promise<void>;

const flushAsync = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

describe('LobbyEventHandlers — live occupancy broadcast', () => {
  let subscribed: Record<string, Handler>;
  let namespaceEmit: jest.Mock;
  let roomNamespaceEmit: jest.Mock;
  let getRoomOccupancy: jest.Mock;
  let publishMock: jest.Mock;
  let handlers: LobbyEventHandlers;

  const occupancy = (overrides: Partial<RoomOccupancy> = {}): RoomOccupancy => ({
    activeBandMemberCount: 2,
    audienceCount: 0,
    companionCount: 3,
    userCount: 2,
    roomType: RoomType.PERFORM,
    isBroadcasting: false,
    ...overrides,
  });

  const buildHandlers = (): LobbyEventHandlers => {
    subscribed = {};
    namespaceEmit = jest.fn();
    roomNamespaceEmit = jest.fn();
    getRoomOccupancy = jest.fn().mockResolvedValue(occupancy());
    publishMock = jest.fn();

    const namespace = {
      to: jest.fn(() => ({ emit: roomNamespaceEmit })),
      emit: namespaceEmit,
    };

    const roomListing = {
      // Only the fields enrichSummaryWithOccupancy spreads / the emit reads matter here.
      toSummary: () => ({ id: 'room-1', name: 'Room One' }),
    };

    const eventBus = {
      subscribe: jest.fn((name: string, handler: Handler) => {
        subscribed[name] = handler;
      }),
      publish: publishMock,
    } as unknown as EventBus;

    const lobbyIntegrationService = {
      io: { of: jest.fn(() => namespace) },
      getLobbyApplicationService: () => ({
        roomListingRepository: { findById: jest.fn().mockResolvedValue(roomListing) },
        getLobbyStatistics: jest.fn().mockResolvedValue({ totalRooms: 5, activeRooms: 3 }),
      }),
      getRoomLifecycleService: () => ({ getRoomOccupancy }),
      broadcastRoomUpdate: jest.fn(),
      broadcastLobbyStatistics: jest.fn(),
    } as unknown as LobbyIntegrationService;

    return new LobbyEventHandlers(eventBus, lobbyIntegrationService);
  };

  beforeEach(() => {
    handlers = buildHandlers();
  });

  afterEach(() => {
    handlers.shutdown();
  });

  it('emits room_updated_broadcast with live counts when a companion is added/removed', async () => {
    await subscribed[RoomOccupancyChanged.name]?.(
      new RoomOccupancyChanged('room-1', 'companion_change'),
    );

    handlers.shutdown(); // flushes the pending batch
    await flushAsync();

    expect(getRoomOccupancy).toHaveBeenCalledWith('room-1');
    expect(namespaceEmit).toHaveBeenCalledWith('room_updated_broadcast', {
      id: 'room-1',
      userCount: 2,
      activeBandMemberCount: 2,
      audienceCount: 0,
      companionCount: 3,
    });
  });

  it('emits room_updated_broadcast when a member joins', async () => {
    await subscribed[MemberJoined.name]?.(
      new MemberJoined('room-1', 'user-1', 'alice', 'band_member'),
    );

    handlers.shutdown();
    await flushAsync();

    expect(namespaceEmit).toHaveBeenCalledWith(
      'room_updated_broadcast',
      expect.objectContaining({ id: 'room-1', activeBandMemberCount: 2 }),
    );
  });

  it('does NOT broadcast an empty (0-user) room — those are removed via room_closed_broadcast', async () => {
    getRoomOccupancy.mockResolvedValue(occupancy({ userCount: 0, activeBandMemberCount: 0 }));

    await subscribed[MemberJoined.name]?.(
      new MemberJoined('room-1', 'user-1', 'alice', 'band_member'),
    );

    handlers.shutdown();
    await flushAsync();

    expect(namespaceEmit).not.toHaveBeenCalledWith(
      'room_updated_broadcast',
      expect.anything(),
    );
  });

  it('publishes RoomListingsRefreshed with total/active counts on room created', async () => {
    await subscribed[RoomCreated.name]?.(
      new RoomCreated('room-1', 'user-1', 'Room One', false),
    );
    await flushAsync();

    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        constructor: RoomListingsRefreshed,
        totalRooms: 5,
        activeRooms: 3,
        refreshTrigger: 'room_change',
      }),
    );
  });

  it('gates settings-updated broadcast on lobby-affecting fields only', async () => {
    await subscribed[RoomSettingsUpdated.name]?.(
      new RoomSettingsUpdated('room-1', 'user-1', { volume: 0.5 }), // NOT a lobby-affecting field
    );
    handlers.shutdown();
    await flushAsync();

    expect(namespaceEmit).not.toHaveBeenCalled();
  });
});
