import { EventWebSocketBridge } from '../EventWebSocketBridge';
import { RoomClosed } from '@/shared/domain/events/RoomEvents';
import type { EventBus, EventHandler } from '@/shared/domain/events/EventBus';
import type { DomainEvent } from '@/shared/domain/events/EventBus';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { Namespace, Server } from 'socket.io';
import { CORE_NAMESPACES, ROOM_STATE_EVENTS } from '@jam-band/shared';
import { createPartialMock } from '@/testing/mocks';

/**
 * DEV lobby-broadcast-namespace-fix, Task 3.
 *
 * `EventWebSocketBridge.handleRoomClosed` broadcasts `ROOM_CLOSED_BROADCAST` for the lobby
 * to pick up. The lobby client connects on `/lobby` — a root `io.emit(...)` lands on the
 * default namespace `/`, which no client is on, so the lobby never hears about the closed
 * room. This test asserts the broadcast reaches `/lobby` specifically, and that the root
 * `io.emit` is never used for it.
 */
describe('EventWebSocketBridge — RoomClosed lobby broadcast targets /lobby', () => {
  const ROOM_ID = 'room-1';

  function buildBridge(lobbyEmit: jest.Mock, rootEmit: jest.Mock, roomNamespaceEmit: jest.Mock) {
    const handlers = new Map<string, EventHandler<DomainEvent>>();

    const eventBus = createPartialMock<EventBus>({
      subscribe: jest.fn((eventType: string, handler: EventHandler<DomainEvent>) => {
        handlers.set(eventType, handler);
      }),
    });

    const lobbyNamespace = createPartialMock<Namespace>({ emit: lobbyEmit });
    const otherNamespace = createPartialMock<Namespace>({ emit: jest.fn() });

    const io = createPartialMock<Server>({
      emit: rootEmit,
      of: jest.fn((path) => (path === CORE_NAMESPACES.LOBBY ? lobbyNamespace : otherNamespace)),
    });
    const of = jest.mocked(io.of);

    const roomNamespace = createPartialMock<Namespace>({ emit: roomNamespaceEmit });
    const namespaceManager = createPartialMock<NamespaceManager>({
      getRoomNamespace: jest.fn().mockReturnValue(roomNamespace),
    });

    new EventWebSocketBridge(eventBus, io, namespaceManager);

    const roomClosedHandler = handlers.get('RoomClosed');
    if (roomClosedHandler == null) {
      throw new Error('EventWebSocketBridge did not subscribe a RoomClosed handler');
    }

    return { roomClosedHandler, of };
  }

  it('emits ROOM_CLOSED_BROADCAST on /lobby, not the root io namespace', async () => {
    const lobbyEmit = jest.fn();
    const rootEmit = jest.fn();
    const roomNamespaceEmit = jest.fn();
    const { roomClosedHandler, of } = buildBridge(lobbyEmit, rootEmit, roomNamespaceEmit);

    const event = new RoomClosed(ROOM_ID, 'user-1', 'owner left');
    await roomClosedHandler(event);

    expect(of).toHaveBeenCalledWith(CORE_NAMESPACES.LOBBY);
    expect(lobbyEmit).toHaveBeenCalledWith(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, {
      roomId: ROOM_ID,
      reason: 'owner left',
    });
    expect(rootEmit).not.toHaveBeenCalled();
  });
});
