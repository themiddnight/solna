import type { Server, Namespace, Socket } from 'socket.io';
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
 * Sockets join the PLAIN roomId (RoomJoinEmitter.ts:44), so a broadcast addressed to
 * `namespace.name` ("/room/<id>") targets a room nobody is in and is silently dropped.
 * Every voice broadcast must be addressed to session.roomId.
 *
 * NOTE: this file deliberately uses the `to: jest.fn().mockReturnValue({ emit })` idiom
 * (copied from VoiceConnectionHandler.speaking.test.ts) rather than `mockReturnThis()`.
 * mockReturnThis funnels broadcasts into the same `emit` spy, so the room key is never
 * asserted — which is exactly why the sibling suites pass against the buggy code.
 */

const ROOM_ID = 'room-1';
const NAMESPACE_PATH = `/room/${ROOM_ID}`;
const ME = 'user-me';
const ME_SOCKET = 'socket-me';

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

let handler: VoiceConnectionHandler;
let meSocket: jest.Mocked<Socket>;
let namespace: Namespace;
let toSpy: jest.Mock;
let toEmit: jest.Mock;
let directEmit: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  const sessions: Record<string, NamespaceSession> = {
    [ME_SOCKET]: session(ME, ME_SOCKET),
  };
  const sessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn((socketId: string) => sessions[socketId]),
    findSocketByUserId: jest.fn(),
  });
  const membership = createPartialMock<RoomMembershipService>({});
  const io = createPartialMock<Server>({});
  handler = new VoiceConnectionHandler(membership, io, sessionManager);

  toEmit = jest.fn();
  toSpy = jest.fn().mockReturnValue({ emit: toEmit });
  directEmit = jest.fn();
  meSocket = createPartialMock<Socket>({ id: ME_SOCKET, emit: directEmit, to: toSpy });

  namespace = createPartialMock<Namespace>({
    name: NAMESPACE_PATH,
    sockets: new Map<string, Socket>(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('VoiceConnectionHandler — broadcasts address the joined room key', () => {
  it('USER_JOINED_VOICE goes to the plain roomId, never the namespace path', () => {
    handler.handleJoinVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME, username: ME }, namespace);

    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
    expect(toEmit).toHaveBeenCalledWith(VOICE_EVENTS.USER_JOINED_VOICE, {
      userId: ME,
      username: ME,
    });
  });

  it('USER_LEFT_VOICE goes to the plain roomId, never the namespace path', () => {
    handler.handleJoinVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME, username: ME }, namespace);
    toSpy.mockClear();
    toEmit.mockClear();

    handler.handleLeaveVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);

    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
    expect(toEmit).toHaveBeenCalledWith(VOICE_EVENTS.USER_LEFT_VOICE, { userId: ME });
  });

  it('VOICE_MUTE_CHANGED goes to the plain roomId, never the namespace path', () => {
    handler.handleJoinVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME, username: ME }, namespace);
    toSpy.mockClear();
    toEmit.mockClear();

    handler.handleVoiceMuteChangedNamespace(meSocket, { roomId: ROOM_ID, userId: ME, isMuted: false }, namespace);

    expect(toSpy).toHaveBeenCalledWith(ROOM_ID);
    expect(toSpy).not.toHaveBeenCalledWith(NAMESPACE_PATH);
    expect(toEmit).toHaveBeenCalledWith(VOICE_EVENTS.VOICE_MUTE_CHANGED, {
      userId: ME,
      isMuted: false,
    });
  });
});

/** Event names from a jest.fn() emit spy. */
function eventsOf(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => call[0]);
}

describe('VoiceConnectionHandler — dead VOICE_PARTICIPANTS emits are gone', () => {
  it('does not emit VOICE_PARTICIPANTS on join (no client listens for it)', () => {
    handler.handleJoinVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME, username: ME }, namespace);

    expect(eventsOf(directEmit)).not.toContain(VOICE_EVENTS.VOICE_PARTICIPANTS);
    // MESH_PARTICIPANTS is the live roster channel and must still be sent to the joiner.
    expect(eventsOf(directEmit)).toContain(VOICE_EVENTS.MESH_PARTICIPANTS);
  });

  it('does not broadcast VOICE_PARTICIPANTS on leave', () => {
    handler.handleJoinVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME, username: ME }, namespace);
    directEmit.mockClear();
    toEmit.mockClear();

    handler.handleLeaveVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);

    expect(eventsOf(toEmit)).not.toContain(VOICE_EVENTS.VOICE_PARTICIPANTS);
    expect(eventsOf(toEmit)).toContain(VOICE_EVENTS.USER_LEFT_VOICE);
  });
});
