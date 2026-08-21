import type { Server, Namespace, Socket } from 'socket.io';
import { VOICE_EVENTS } from '@jam-band/shared';
import { VoiceConnectionHandler } from '../VoiceConnectionHandler';
import type { RoomMembershipService } from '@/domains/room-management/application/RoomMembershipService';
import type {
  RoomSessionManager,
  NamespaceSession,
} from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { JoinVoiceData, LeaveVoiceData, VoiceMuteChangedData } from '@/types';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const VERIFIED_USER_ID = 'user-verified-1';
const VERIFIED_USERNAME = 'verified-tester';
// What a malicious client puts in the event payload to impersonate someone else.
const SPOOFED_USER_ID = 'victim-9999-aaaa';
const SPOOFED_USERNAME = 'I-am-the-victim';

function createSession(overrides: Partial<NamespaceSession> = {}): NamespaceSession {
  return {
    roomId: ROOM_ID,
    userId: VERIFIED_USER_ID,
    username: VERIFIED_USERNAME,
    role: 'band_member',
    socketId: 'socket-attacker',
    namespacePath: `/room/${ROOM_ID}`,
    connectedAt: new Date(),
    lastActivity: new Date(),
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('VoiceConnectionHandler — acting identity comes from the session, never the payload (DEV-179)', () => {
  let handler: VoiceConnectionHandler;
  let sessionManager: jest.Mocked<RoomSessionManager>;
  let socket: jest.Mocked<Socket>;
  let socketEmit: jest.Mock;
  let namespace: Namespace;

  beforeEach(() => {
    jest.clearAllMocks();

    sessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn().mockReturnValue(createSession()),
      findSocketByUserId: jest.fn(),
    });

    const membership = createPartialMock<RoomMembershipService>({});
    const io = createPartialMock<Server>({});
    handler = new VoiceConnectionHandler(membership, io, sessionManager);

    socketEmit = jest.fn();
    // socket.to(room).emit(...) funnels through the same spy as socket.emit(...),
    // so a single assertion target captures both direct and broadcast emits.
    socket = createPartialMock<Socket>({
      id: 'socket-attacker',
      emit: socketEmit,
      to: jest.fn().mockReturnThis(),
    });

    namespace = createPartialMock<Namespace>({
      name: `/room/${ROOM_ID}`,
      sockets: new Map(),
    });
  });

  it('handleJoinVoiceNamespace keys presence by the session id and ignores a spoofed payload', () => {
    const data: JoinVoiceData = {
      roomId: ROOM_ID,
      userId: SPOOFED_USER_ID,
      username: SPOOFED_USERNAME,
    };

    handler.handleJoinVoiceNamespace(socket, data, namespace);

    const participants = handler.getVoiceParticipants(ROOM_ID);
    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({
      userId: VERIFIED_USER_ID,
      username: VERIFIED_USERNAME,
    });
    expect(participants.find((p) => p.userId === SPOOFED_USER_ID)).toBeUndefined();

    expect(socketEmit).toHaveBeenCalledWith(VOICE_EVENTS.USER_JOINED_VOICE, {
      userId: VERIFIED_USER_ID,
      username: VERIFIED_USERNAME,
    });
    expect(socketEmit).not.toHaveBeenCalledWith(
      VOICE_EVENTS.USER_JOINED_VOICE,
      expect.objectContaining({ userId: SPOOFED_USER_ID }),
    );
  });

  it('handleVoiceMuteChangedNamespace applies to the session id, not a spoofed payload userId', () => {
    // Verified user is present in the voice room (joins muted by default).
    handler.handleJoinVoiceNamespace(
      socket,
      { roomId: ROOM_ID, userId: VERIFIED_USER_ID, username: VERIFIED_USERNAME },
      namespace,
    );
    socketEmit.mockClear();

    const muteData: VoiceMuteChangedData = {
      roomId: ROOM_ID,
      userId: SPOOFED_USER_ID, // spoofed — must be ignored
      isMuted: false,
    };
    handler.handleVoiceMuteChangedNamespace(socket, muteData, namespace);

    const verified = handler
      .getVoiceParticipants(ROOM_ID)
      .find((p) => p.userId === VERIFIED_USER_ID);
    expect(verified?.isMuted).toBe(false);

    expect(socketEmit).toHaveBeenCalledWith(VOICE_EVENTS.VOICE_MUTE_CHANGED, {
      userId: VERIFIED_USER_ID,
      isMuted: false,
    });
    expect(socketEmit).not.toHaveBeenCalledWith(
      VOICE_EVENTS.VOICE_MUTE_CHANGED,
      expect.objectContaining({ userId: SPOOFED_USER_ID }),
    );
  });

  it('handleLeaveVoiceNamespace removes only the caller’s own session, never a spoofed victim', () => {
    // A victim is already in the voice room on their own socket/session.
    const victimSocket = createPartialMock<Socket>({
      id: 'socket-victim',
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
    });
    sessionManager.getRoomSession.mockImplementation((socketId: string) =>
      socketId === 'socket-victim'
        ? createSession({ userId: SPOOFED_USER_ID, username: SPOOFED_USERNAME, socketId: 'socket-victim' })
        : createSession(),
    );

    handler.handleJoinVoiceNamespace(
      victimSocket,
      { roomId: ROOM_ID, userId: SPOOFED_USER_ID, username: SPOOFED_USERNAME },
      namespace,
    );
    handler.handleJoinVoiceNamespace(
      socket,
      { roomId: ROOM_ID, userId: VERIFIED_USER_ID, username: VERIFIED_USERNAME },
      namespace,
    );
    expect(handler.getVoiceParticipants(ROOM_ID)).toHaveLength(2);

    // Attacker tries to evict the victim by passing the victim's id in the leave payload.
    const leaveData: LeaveVoiceData = { roomId: ROOM_ID, userId: SPOOFED_USER_ID };
    handler.handleLeaveVoiceNamespace(socket, leaveData, namespace);

    const remaining = handler.getVoiceParticipants(ROOM_ID);
    // The victim is untouched; the attacker removed only themselves.
    expect(remaining.map((p) => p.userId)).toEqual([SPOOFED_USER_ID]);
  });

  it('handleJoinVoiceNamespace broadcasts the join and defaults the new participant to muted', () => {
    const data: JoinVoiceData = {
      roomId: ROOM_ID,
      userId: SPOOFED_USER_ID,
      username: SPOOFED_USERNAME,
    };

    handler.handleJoinVoiceNamespace(socket, data, namespace);

    const participants = handler.getVoiceParticipants(ROOM_ID);
    expect(participants).toHaveLength(1);
    // Namespace variant registers new joiners soft-muted by default (Requirement 5.3) —
    // unlike the deleted non-namespace variant, which defaulted to unmuted.
    expect(participants[0]).toMatchObject({
      userId: VERIFIED_USER_ID,
      username: VERIFIED_USERNAME,
      isMuted: true,
    });
    // Broadcasts are addressed to the plain roomId (what sockets actually join via
    // RoomJoinEmitter) — socket.to(namespace.name) would target an empty room.
    expect(socket.to).toHaveBeenCalledWith(ROOM_ID);
    expect(socketEmit).toHaveBeenCalledWith(VOICE_EVENTS.USER_JOINED_VOICE, {
      userId: VERIFIED_USER_ID,
      username: VERIFIED_USERNAME,
    });
  });
});
