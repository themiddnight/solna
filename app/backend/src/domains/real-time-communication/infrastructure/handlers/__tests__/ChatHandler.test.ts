/**
 * ChatHandler unit tests.
 *
 * Runs the REAL handler against injected service seams (RoomMembershipService,
 * NamespaceManager, RoomSessionManager) plus a fake socket/namespace with `.emit`
 * capture. The Redis fast path (`getRedisClient` + `isUserInRoomCache`) is mocked
 * at the infra boundary; the DB fallback (findUserInRoom) and the broadcast are
 * asserted end-to-end.
 *
 * TR-33: the acting identity is the verified room session (`session.userId`) — the
 * chat payload carries no userId at all, and the emitted ChatMessage must be keyed
 * off the session, never anything client-supplied.
 */

import type { Socket, Namespace } from 'socket.io';
import type { ChatMessageData } from '@/types';
import { SHARED_EVENTS } from '@jam-band/shared';
import { ChatHandler } from '../ChatHandler';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type { NamespaceManager } from '@/shared/infrastructure/namespace/NamespaceManager';
import type { RoomSessionManager, NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import { getRedisClient } from '@/config/redis';
import { isUserInRoomCache } from '@/shared/utils/redisCacheUtils';
import { createPartialMock, asSocket } from '@/testing/mocks';

// closeRedisConnections is called by the global teardown (tests/setup.ts) via a
// dynamic import — the factory must keep it a jest.fn or the teardown breaks.
jest.mock('@/config/redis', () => ({
  getRedisClient: jest.fn(),
  closeRedisConnections: jest.fn(),
}));

jest.mock('@/shared/utils/redisCacheUtils', () => ({
  isUserInRoomCache: jest.fn(),
}));

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

const getRedisClientMock = jest.mocked(getRedisClient);
const isUserInRoomCacheMock = jest.mocked(isUserInRoomCache);

// The Redis client shape is an unexported alias; derive it from the seam instead
// of duplicating it (TR-27: no any, no new prod exports for tests).
type RedisClientLike = Awaited<ReturnType<typeof getRedisClient>>;

const ROOM_ID = 'room-1';
const VERIFIED_USER_ID = 'user-verified-1';

function createSession(overrides: Partial<NamespaceSession> = {}): NamespaceSession {
  return {
    roomId: ROOM_ID,
    userId: VERIFIED_USER_ID,
    username: 'verified-user',
    role: 'band_member',
    socketId: 'socket-1',
    namespacePath: `/room/${ROOM_ID}`,
    connectedAt: new Date(),
    lastActivity: new Date(),
    ...overrides,
  };
}

interface HandlerSeams {
  handler: ChatHandler;
  sessionManager: jest.Mocked<RoomSessionManager>;
  membership: jest.Mocked<RoomMembershipService>;
  namespaceManager: jest.Mocked<NamespaceManager>;
  nsEmit: jest.Mock;
}

function makeHandler(): HandlerSeams {
  const sessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn().mockReturnValue(createSession()),
  });
  const membership = createPartialMock<RoomMembershipService>({
    findUserInRoom: jest.fn(),
  });
  const nsEmit = jest.fn();
  const roomNamespace = createPartialMock<Namespace>({ emit: nsEmit });
  const namespaceManager = createPartialMock<NamespaceManager>({
    getRoomNamespace: jest.fn().mockReturnValue(roomNamespace),
  });
  const handler = new ChatHandler(membership, namespaceManager, sessionManager);
  return { handler, sessionManager, membership, namespaceManager, nsEmit };
}

function makeSocket(): Socket {
  return asSocket({ id: 'socket-1' });
}

function memberUser() {
  return { id: VERIFIED_USER_ID, username: 'verified-user', role: 'band_member' as const, isReady: true };
}

beforeEach(() => {
  jest.clearAllMocks();
  getRedisClientMock.mockResolvedValue(createPartialMock<RedisClientLike>({}));
  isUserInRoomCacheMock.mockResolvedValue(true);
});

// ── handleChatMessage (socket + namespace lookup) ──────────────────────────────

describe('ChatHandler.handleChatMessage', () => {
  it('ignores sockets without a room session (no emit, no membership check)', async () => {
    const { handler, sessionManager, membership, namespaceManager } = makeHandler();
    sessionManager.getRoomSession.mockReturnValue(undefined);

    await handler.handleChatMessage(makeSocket(), { message: 'hello' });

    expect(membership.findUserInRoom).not.toHaveBeenCalled();
    expect(namespaceManager.getRoomNamespace).not.toHaveBeenCalled();
  });

  it('broadcasts the chat message to the room namespace', async () => {
    const { handler, membership, namespaceManager, nsEmit } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(memberUser());

    await handler.handleChatMessage(makeSocket(), { message: 'hello everyone' });

    expect(isUserInRoomCacheMock).toHaveBeenCalledWith(expect.anything(), ROOM_ID, VERIFIED_USER_ID);
    expect(namespaceManager.getRoomNamespace).toHaveBeenCalledWith(ROOM_ID);
    expect(nsEmit).toHaveBeenCalledWith(
      SHARED_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({
        // TR-33: identity comes from the verified session, not any payload field.
        userId: VERIFIED_USER_ID,
        username: 'verified-user',
        message: 'hello everyone',
      })
    );
  });

  it('keys the emitted message off the session even when the payload is hostile', async () => {
    const { handler, membership, nsEmit } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(memberUser());

    // TR-27 confined boundary cast: socket payloads arrive unvalidated — the
    // handler must ignore everything except `message`.
    const payload = { message: 'hi', userId: 'victim-9999', username: 'impostor' } as unknown as ChatMessageData;
    await handler.handleChatMessage(makeSocket(), payload);

    expect(nsEmit).toHaveBeenCalledWith(
      SHARED_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({ userId: VERIFIED_USER_ID, username: 'verified-user' })
    );
    expect(nsEmit).not.toHaveBeenCalledWith(
      SHARED_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({ userId: 'victim-9999' })
    );
  });

  it('falls back to the DB membership check when Redis fails', async () => {
    const { handler, membership, nsEmit } = makeHandler();
    isUserInRoomCacheMock.mockRejectedValue(new Error('redis down'));
    membership.findUserInRoom.mockResolvedValue(memberUser());

    await handler.handleChatMessage(makeSocket(), { message: 'fallback works' });

    expect(membership.findUserInRoom).toHaveBeenCalledWith(ROOM_ID, VERIFIED_USER_ID);
    expect(nsEmit).toHaveBeenCalledWith(
      SHARED_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({ message: 'fallback works' })
    );
  });

  it('drops the message when the user is not a room member', async () => {
    const { handler, membership, namespaceManager } = makeHandler();
    isUserInRoomCacheMock.mockResolvedValue(false);

    await handler.handleChatMessage(makeSocket(), { message: 'hello' });

    expect(membership.findUserInRoom).not.toHaveBeenCalled();
    expect(namespaceManager.getRoomNamespace).not.toHaveBeenCalled();
  });

  it('drops the message when the membership check passes but no user record exists', async () => {
    const { handler, membership, namespaceManager } = makeHandler();
    // Redis says member (fast path), but the DB lookup for the username finds nobody.
    membership.findUserInRoom.mockResolvedValue(undefined);

    await handler.handleChatMessage(makeSocket(), { message: 'hello' });

    expect(membership.findUserInRoom).toHaveBeenCalledWith(ROOM_ID, VERIFIED_USER_ID);
    expect(namespaceManager.getRoomNamespace).not.toHaveBeenCalled();
  });

  it('drops empty, whitespace-only, and non-string messages', async () => {
    const { handler, membership, nsEmit } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(memberUser());
    // TR-27 confined boundary casts: unvalidated socket payloads (handler validates).
    await handler.handleChatMessage(makeSocket(), { message: '' });
    await handler.handleChatMessage(makeSocket(), { message: '   ' });
    await handler.handleChatMessage(makeSocket(), { message: 42 } as unknown as ChatMessageData);

    expect(nsEmit).not.toHaveBeenCalled();
  });

  it('trims the message and caps it at 500 characters', async () => {
    const { handler, membership, nsEmit } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(memberUser());

    await handler.handleChatMessage(makeSocket(), { message: `  ${'a'.repeat(600)}  ` });

    expect(nsEmit).toHaveBeenCalledTimes(1);
    expect(nsEmit).toHaveBeenCalledWith(
      SHARED_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({ message: 'a'.repeat(500) })
    );
  });

  it('logs a warning when the room namespace is missing', async () => {
    const { handler, membership, namespaceManager } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(memberUser());
    namespaceManager.getRoomNamespace.mockReturnValue(undefined);

    await handler.handleChatMessage(makeSocket(), { message: 'hello' });

    expect(namespaceManager.getRoomNamespace).toHaveBeenCalledWith(ROOM_ID);
  });
});

// ── handleChatMessageNamespace (provided namespace) ────────────────────────────

describe('ChatHandler.handleChatMessageNamespace', () => {
  it('broadcasts through the provided namespace without a namespace lookup', async () => {
    const { handler, membership, namespaceManager, nsEmit } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(memberUser());

    await handler.handleChatMessageNamespace(makeSocket(), { message: 'hi room' }, createPartialMock<Namespace>({ emit: nsEmit }));

    expect(namespaceManager.getRoomNamespace).not.toHaveBeenCalled();
    expect(nsEmit).toHaveBeenCalledWith(
      SHARED_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({ userId: VERIFIED_USER_ID, message: 'hi room' })
    );
  });

  it('ignores sockets without a room session', async () => {
    const { handler, sessionManager, nsEmit } = makeHandler();
    sessionManager.getRoomSession.mockReturnValue(undefined);

    await handler.handleChatMessageNamespace(makeSocket(), { message: 'hi' }, createPartialMock<Namespace>({ emit: nsEmit }));

    expect(nsEmit).not.toHaveBeenCalled();
  });

  it('drops the message when the user is not a member', async () => {
    const { handler, nsEmit } = makeHandler();
    isUserInRoomCacheMock.mockResolvedValue(false);

    await handler.handleChatMessageNamespace(makeSocket(), { message: 'hi' }, createPartialMock<Namespace>({ emit: nsEmit }));

    expect(nsEmit).not.toHaveBeenCalled();
  });

  it('drops the message when the membership check passes but no user record exists', async () => {
    const { handler, membership, nsEmit } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(undefined);

    await handler.handleChatMessageNamespace(makeSocket(), { message: 'hi' }, createPartialMock<Namespace>({ emit: nsEmit }));

    expect(nsEmit).not.toHaveBeenCalled();
  });

  it('drops empty, whitespace-only, and non-string messages', async () => {
    const { handler, membership, nsEmit } = makeHandler();
    membership.findUserInRoom.mockResolvedValue(memberUser());
    // TR-27 confined boundary casts: unvalidated socket payloads (handler validates).
    await handler.handleChatMessageNamespace(makeSocket(), { message: '' }, createPartialMock<Namespace>({ emit: nsEmit }));
    await handler.handleChatMessageNamespace(makeSocket(), { message: '   ' }, createPartialMock<Namespace>({ emit: nsEmit }));
    await handler.handleChatMessageNamespace(makeSocket(), { message: 42 } as unknown as ChatMessageData, createPartialMock<Namespace>({ emit: nsEmit }));

    expect(nsEmit).not.toHaveBeenCalled();
  });

  it('trims and caps messages, using the DB fallback when Redis fails', async () => {
    const { handler, membership, nsEmit } = makeHandler();
    isUserInRoomCacheMock.mockRejectedValue(new Error('redis down'));
    membership.findUserInRoom.mockResolvedValue(memberUser());

    await handler.handleChatMessageNamespace(makeSocket(), { message: `  ${'b'.repeat(600)}  ` }, createPartialMock<Namespace>({ emit: nsEmit }));

    expect(membership.findUserInRoom).toHaveBeenCalledWith(ROOM_ID, VERIFIED_USER_ID);
    expect(nsEmit).toHaveBeenCalledTimes(1);
    expect(nsEmit).toHaveBeenCalledWith(
      SHARED_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({ message: 'b'.repeat(500) })
    );
  });
});
