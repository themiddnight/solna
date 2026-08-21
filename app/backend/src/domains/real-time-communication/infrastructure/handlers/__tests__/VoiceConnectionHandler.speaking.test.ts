import type { Server, Socket } from 'socket.io';
import { VOICE_EVENTS } from '@jam-band/shared';
import { VoiceConnectionHandler } from '../VoiceConnectionHandler';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type {
  RoomSessionManager,
  NamespaceSession,
} from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

/**
 * DEV-270 — the speaking (talking) indicator is broadcast over websocket. The
 * server is a thin relay: it takes the client's { roomId, isSpeaking } intent and
 * fans it out to the rest of the room keyed by the TOKEN-VERIFIED session userId
 * (TR-33), never a client-supplied id. The signal is ephemeral — no Redis, no
 * participant state mutation.
 */

const ROOM_ID = 'room-1';
const ME = 'user-me';
const ME_SOCKET = 'socket-me';

function session(userId: string, socketId: string, roomId = ROOM_ID): NamespaceSession {
  return {
    roomId,
    userId,
    username: userId,
    role: 'band_member',
    socketId,
    namespacePath: `/room/${roomId}`,
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
}

describe('VoiceConnectionHandler.handleVoiceSpeakingNamespace (DEV-270)', () => {
  let handler: VoiceConnectionHandler;
  let sessionManager: jest.Mocked<RoomSessionManager>;
  let meSocket: jest.Mocked<Socket>;
  let toEmit: jest.Mock;
  let toSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    const sessions: Record<string, NamespaceSession> = {
      [ME_SOCKET]: session(ME, ME_SOCKET),
    };
    sessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn((socketId: string) => sessions[socketId]),
    });

    const membership = createPartialMock<RoomMembershipService>({});
    const io = createPartialMock<Server>({});
    handler = new VoiceConnectionHandler(membership, io, sessionManager);

    toEmit = jest.fn();
    toSpy = jest.fn().mockReturnValue({ emit: toEmit });
    meSocket = createPartialMock<Socket>({ id: ME_SOCKET, emit: jest.fn(), to: toSpy });

  });

  it('relays isSpeaking:true to the rest of the room keyed by the session userId', () => {
    handler.handleVoiceSpeakingNamespace(meSocket, { roomId: ROOM_ID, isSpeaking: true });

    // Sockets join the plain roomId as their room (RoomJoinEmitter), NOT the
    // namespace path ("/room/<id>") — broadcasting to namespace.name goes to an
    // empty room and silently reaches nobody. socket.to(...) excludes sender (TR-3).
    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toEmit).toHaveBeenCalledWith(VOICE_EVENTS.VOICE_SPEAKING, {
      userId: ME,
      isSpeaking: true,
    });
  });

  it('relays isSpeaking:false the same way', () => {
    handler.handleVoiceSpeakingNamespace(meSocket, { roomId: ROOM_ID, isSpeaking: false });

    expect(toEmit).toHaveBeenCalledWith(VOICE_EVENTS.VOICE_SPEAKING, {
      userId: ME,
      isSpeaking: false,
    });
  });

  it('never trusts a spoofed userId in the payload — keys off the session (TR-33)', () => {
    handler.handleVoiceSpeakingNamespace(
      meSocket,
      // @ts-expect-error — a malicious client could add userId; it must be ignored.
      { roomId: ROOM_ID, isSpeaking: true, userId: 'victim' },
    );

    expect(toEmit).toHaveBeenCalledWith(VOICE_EVENTS.VOICE_SPEAKING, {
      userId: ME,
      isSpeaking: true,
    });
  });

  it('drops the event when there is no matching room session', () => {
    handler.handleVoiceSpeakingNamespace(
      createPartialMock<Socket>({ id: 'unknown-socket', to: toSpy }),
      { roomId: ROOM_ID, isSpeaking: true },
    );
    expect(toEmit).not.toHaveBeenCalled();
  });

  it('drops the event when the session belongs to a different room', () => {
    (sessionManager.getRoomSession as jest.Mock).mockReturnValue(session(ME, ME_SOCKET, 'other-room'));
    handler.handleVoiceSpeakingNamespace(meSocket, { roomId: ROOM_ID, isSpeaking: true });
    expect(toEmit).not.toHaveBeenCalled();
  });
});
