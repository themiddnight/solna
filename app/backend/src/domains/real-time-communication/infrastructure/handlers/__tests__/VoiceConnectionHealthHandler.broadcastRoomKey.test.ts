import type { Namespace, Socket } from 'socket.io';
import { VOICE_EVENTS } from '@jam-band/shared';
import { VoiceConnectionHealthHandler } from '../VoiceConnectionHealthHandler';
import type {
  RoomSessionManager,
  NamespaceSession,
} from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { VoiceParticipantInfo } from '@/types';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

/**
 * Sockets join the PLAIN roomId (RoomJoinEmitter.ts:44), so a broadcast addressed to
 * `namespace.name` ("/room/<id>") targets a room nobody is in and is silently dropped.
 * VOICE_RECONNECTION_REQUESTED must be addressed to session.roomId, not namespace.name.
 *
 * NOTE: this file deliberately uses the `to: jest.fn().mockReturnValue({ emit })` idiom
 * rather than `mockReturnThis()`. mockReturnThis funnels broadcasts into the same `emit`
 * spy, so the room key is never asserted — which is exactly why this bug shipped.
 */

const ROOM_ID = 'room-1';
const NAMESPACE_PATH = `/room/${ROOM_ID}`;
const ME = 'user-me';
const ME_SOCKET = 'socket-me';
const PEER = 'user-peer';

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

let handler: VoiceConnectionHealthHandler;
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
  });

  const voiceParticipants = new Map<string, Map<string, VoiceParticipantInfo>>();
  const roomMap = new Map<string, VoiceParticipantInfo>();
  voiceParticipants.set(ROOM_ID, roomMap);

  handler = new VoiceConnectionHealthHandler(
    sessionManager,
    voiceParticipants,
    (roomId: string) => {
      const existing = voiceParticipants.get(roomId);
      if (existing) return existing;
      const created = new Map<string, VoiceParticipantInfo>();
      voiceParticipants.set(roomId, created);
      return created;
    }
  );

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

describe('VoiceConnectionHealthHandler — reconnection request addresses the room key', () => {
  it('VOICE_RECONNECTION_REQUESTED goes to the plain roomId', () => {
    handler.handleVoiceConnectionFailedNamespace(
      meSocket,
      { roomId: ROOM_ID, targetUserId: PEER },
      namespace
    );

    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
    expect(toEmit).toHaveBeenCalledWith(VOICE_EVENTS.VOICE_RECONNECTION_REQUESTED, {
      fromUserId: ME,
      targetUserId: PEER,
      roomId: ROOM_ID,
    });
  });
});
