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
 * Keep-alive gap fix: a solo participant sends no VOICE_HEARTBEAT (zero peers),
 * so the 60s stale prune silently dropped them from the voice roster. The mesh
 * reconcile (REQUEST_MESH_CONNECTIONS, <=15s cadence) is already proof the client
 * is alive — the handler must bump the requester's lastHeartbeat.
 */

const ROOM_ID = 'room-1';
const ME = 'user-me';
const PEER_B = 'user-peer-b';
const ME_SOCKET = 'socket-me';
const PEER_B_SOCKET = 'socket-peer-b';

function session(userId: string, socketId: string): NamespaceSession {
  return {
    roomId: ROOM_ID,
    userId,
    username: userId,
    role: 'band_member',
    socketId,
    namespacePath: `/room/${ROOM_ID}`,
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
}

interface MeshPayload {
  participants: { userId: string }[];
  version: number;
  selfRegistered?: boolean;
}

/** The participants array MESH_PARTICIPANTS delivered to a socket's emit mock. */
function meshParticipantsOf(emitMock: jest.Mock): { userId: string }[] | undefined {
  const calls = emitMock.mock.calls as Array<[string, MeshPayload]>;
  const call = calls.find(([event]) => event === VOICE_EVENTS.MESH_PARTICIPANTS);
  return call?.[1]?.participants;
}

// Module-scope harness shared between both test describes
let handler: VoiceConnectionHandler;
let meSocket: jest.Mocked<Socket>;
let peerBSocket: jest.Mocked<Socket>;
let namespace: Namespace;

function joinVoiceAt(time: number): void {
  jest.spyOn(Date, 'now').mockReturnValue(time);
  handler.handleJoinVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME, username: ME }, namespace);
}

beforeEach(() => {
  jest.clearAllMocks();
  const sessions: Record<string, NamespaceSession> = {
    [ME_SOCKET]: session(ME, ME_SOCKET),
    [PEER_B_SOCKET]: session(PEER_B, PEER_B_SOCKET),
  };
  const sessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn((socketId: string) => sessions[socketId]),
    findSocketByUserId: jest.fn(),
  });
  const membership = createPartialMock<RoomMembershipService>({});
  const io = createPartialMock<Server>({});
  handler = new VoiceConnectionHandler(membership, io, sessionManager);
  meSocket = createPartialMock<Socket>({
    id: ME_SOCKET,
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
  });
  peerBSocket = createPartialMock<Socket>({
    id: PEER_B_SOCKET,
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
  });
  namespace = createPartialMock<Namespace>({
    name: `/room/${ROOM_ID}`,
    sockets: new Map<string, Socket>(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('VoiceConnectionHandler — REQUEST_MESH_CONNECTIONS is a keep-alive', () => {
  it('a reconciling solo participant survives the stale prune (lastHeartbeat bumped)', () => {
    joinVoiceAt(0);

    // 70s later (past the 60s stale threshold) ME's reconcile fires — this must
    // count as proof-of-life.
    jest.spyOn(Date, 'now').mockReturnValue(70_000);
    handler.handleRequestMeshConnectionsNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);
    handler.cleanupStaleVoiceConnections();

    // A second user's view is the authoritative check: if ME was pruned, PEER_B's
    // MESH_PARTICIPANTS would be empty — exactly the "new joiner can't see the
    // solo user" bug this task fixes.
    handler.handleRequestMeshConnectionsNamespace(peerBSocket, { roomId: ROOM_ID, userId: PEER_B }, namespace);
    expect(meshParticipantsOf(peerBSocket.emit as jest.Mock)).toEqual([
      expect.objectContaining({ userId: ME }),
    ]);
  });

  it('without any reconcile, a silent participant IS pruned after 60s (fix boundary)', () => {
    joinVoiceAt(0);
    jest.spyOn(Date, 'now').mockReturnValue(70_000);
    handler.cleanupStaleVoiceConnections();

    handler.handleRequestMeshConnectionsNamespace(peerBSocket, { roomId: ROOM_ID, userId: PEER_B }, namespace);
    expect(meshParticipantsOf(peerBSocket.emit as jest.Mock)).toEqual([]);
  });
});

describe('VoiceConnectionHandler — selfRegistered flag on MESH_PARTICIPANTS', () => {
  it('reports selfRegistered: true while the requester is in the voice roster', () => {
    joinVoiceAt(0);
    const emitMock = meSocket.emit as jest.Mock;
    emitMock.mockClear();

    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    handler.handleRequestMeshConnectionsNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);

    const calls = emitMock.mock.calls as Array<[string, MeshPayload]>;
    const meshCall = calls.find(([event]) => event === VOICE_EVENTS.MESH_PARTICIPANTS);
    expect(meshCall?.[1]).toMatchObject({ selfRegistered: true });
  });

  it('reports selfRegistered: false after the stale prune dropped the requester', () => {
    joinVoiceAt(0);
    jest.spyOn(Date, 'now').mockReturnValue(120_000);
    handler.cleanupStaleVoiceConnections();

    const emitMock = meSocket.emit as jest.Mock;
    emitMock.mockClear();
    handler.handleRequestMeshConnectionsNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);

    const calls = emitMock.mock.calls as Array<[string, MeshPayload]>;
    const meshCall = calls.find(([event]) => event === VOICE_EVENTS.MESH_PARTICIPANTS);
    expect(meshCall?.[1]).toMatchObject({ selfRegistered: false });
  });

  it('join-path MESH_PARTICIPANTS carries selfRegistered: true', () => {
    const emitMock = meSocket.emit as jest.Mock;
    joinVoiceAt(0);
    const calls = emitMock.mock.calls as Array<[string, MeshPayload]>;
    const meshCall = calls.find(([event]) => event === VOICE_EVENTS.MESH_PARTICIPANTS);
    expect(meshCall?.[1]).toMatchObject({ selfRegistered: true });
  });
});
