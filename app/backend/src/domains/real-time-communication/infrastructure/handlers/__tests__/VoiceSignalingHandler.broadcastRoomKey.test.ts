import type { Namespace, Socket } from 'socket.io';
import { VOICE_EVENTS } from '@jam-band/shared';
import { VoiceSignalingHandler } from '../VoiceSignalingHandler';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type {
  RoomSessionManager,
  NamespaceSession,
} from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { User } from '@/types';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// Auto-mock: getRedisClient() resolves to `undefined`, so the real
// isUserInRoomCache() throws reading off it — resolveOfferUsername's own
// try/catch then falls back to roomMembershipService.findUserInRoom, which
// this suite stubs. Keeps the test off the network entirely (no real Redis).
jest.mock('@/config/redis');

/**
 * The offer/answer/ICE fallback broadcasts fired into `namespace.name`, a room no
 * socket joins, so a peer whose socket was not found in the namespace never got
 * the signal. Address session.roomId instead.
 */

const ROOM_ID = 'room-1';
const NAMESPACE_PATH = `/room/${ROOM_ID}`;
const ME = 'user-me';
const ME_SOCKET = 'socket-me';
const ABSENT_PEER = 'user-not-in-namespace';

function session(userId: string, socketId: string): NamespaceSession {
  return {
    roomId: ROOM_ID,
    userId,
    username: userId,
    role: 'band_member',
    socketId,
    namespacePath: NAMESPACE_PATH,
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
}

let handler: VoiceSignalingHandler;
let meSocket: jest.Mocked<Socket>;
let namespace: Namespace;
let toSpy: jest.Mock;
let toEmit: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  const sessions: Record<string, NamespaceSession> = {
    [ME_SOCKET]: session(ME, ME_SOCKET),
  };
  const sessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn((socketId: string) => sessions[socketId]),
    // The target peer is deliberately absent → the handler takes the fallback path.
    getRoomSessions: jest.fn((_roomId: string) => new Map<string, NamespaceSession>()),
  });
  const meUser: User = { id: ME, username: ME, role: 'band_member', isReady: true };
  const membership = createPartialMock<RoomMembershipService>({
    findUserInRoom: jest.fn().mockResolvedValue(meUser),
  });
  // Real signature: (roomMembershipService, roomSessionManager)
  handler = new VoiceSignalingHandler(membership, sessionManager);

  toEmit = jest.fn();
  toSpy = jest.fn().mockReturnValue({ emit: toEmit });
  meSocket = createPartialMock<Socket>({ id: ME_SOCKET, emit: jest.fn(), to: toSpy });

  namespace = createPartialMock<Namespace>({
    name: NAMESPACE_PATH,
    sockets: new Map<string, Socket>(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Event names from a jest.fn() emit spy. */
function eventsOf(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => call[0]);
}

describe('VoiceSignalingHandler — fallback broadcasts address the joined room key', () => {
  it('VOICE_OFFER fallback goes to the plain roomId', async () => {
    await handler.handleVoiceOfferNamespace(
      meSocket,
      { roomId: ROOM_ID, targetUserId: ABSENT_PEER, offer: { type: 'offer', sdp: 'x' } },
      namespace,
    );

    expect(eventsOf(toEmit)).toContain(VOICE_EVENTS.VOICE_OFFER);
    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
  });

  it('VOICE_ANSWER fallback goes to the plain roomId', () => {
    handler.handleVoiceAnswerNamespace(
      meSocket,
      { roomId: ROOM_ID, targetUserId: ABSENT_PEER, answer: { type: 'answer', sdp: 'x' } },
      namespace,
    );

    expect(eventsOf(toEmit)).toContain(VOICE_EVENTS.VOICE_ANSWER);
    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
  });

  it('VOICE_ICE_CANDIDATE fallback goes to the plain roomId', () => {
    handler.handleVoiceIceCandidateNamespace(
      meSocket,
      { roomId: ROOM_ID, targetUserId: ABSENT_PEER, candidate: { candidate: 'c' } },
      namespace,
    );

    expect(eventsOf(toEmit)).toContain(VOICE_EVENTS.VOICE_ICE_CANDIDATE);
    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
  });
});
