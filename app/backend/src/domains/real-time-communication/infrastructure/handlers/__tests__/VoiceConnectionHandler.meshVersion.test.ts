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
 * DEV-267 — the mesh reconcile heartbeat (REQUEST_MESH_CONNECTIONS) fanned out
 * NEW_MESH_PEER to every other participant on every request, even when the roster
 * had not changed (O(N) per heartbeat, O(N²) per room). A roster membership version
 * lets the server skip that fanout when the requester's view is already current,
 * while MESH_PARTICIPANTS (the authoritative full list) is still always returned.
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
}

describe('VoiceConnectionHandler — roster version gates NEW_MESH_PEER fanout (DEV-267)', () => {
  let handler: VoiceConnectionHandler;
  let sessionManager: jest.Mocked<RoomSessionManager>;
  let meSocket: jest.Mocked<Socket>;
  let meEmit: jest.Mock;
  let peerBEmit: jest.Mock;
  let namespace: Namespace;

  beforeEach(() => {
    jest.clearAllMocks();

    const sessions: Record<string, NamespaceSession> = {
      [ME_SOCKET]: session(ME, ME_SOCKET),
      [PEER_B_SOCKET]: session(PEER_B, PEER_B_SOCKET),
    };
    sessionManager = createPartialMock<RoomSessionManager>({
      getRoomSession: jest.fn((socketId: string) => sessions[socketId]),
      findSocketByUserId: jest.fn(),
    });

    const membership = createPartialMock<RoomMembershipService>({});
    const io = createPartialMock<Server>({});
    handler = new VoiceConnectionHandler(membership, io, sessionManager);

    meEmit = jest.fn();
    peerBEmit = jest.fn();
    meSocket = createPartialMock<Socket>({ id: ME_SOCKET, emit: meEmit, to: jest.fn().mockReturnThis() });
    const peerBSocket = createPartialMock<Socket>({ id: PEER_B_SOCKET, emit: peerBEmit, to: jest.fn().mockReturnThis() });

    namespace = createPartialMock<Namespace>({
      name: `/room/${ROOM_ID}`,
      sockets: new Map<string, Socket>([[PEER_B_SOCKET, peerBSocket]]),
    });

    // Both users are in the voice room.
    handler.handleJoinVoiceNamespace(peerBSocket, { roomId: ROOM_ID, userId: PEER_B, username: PEER_B }, namespace);
    handler.handleJoinVoiceNamespace(meSocket, { roomId: ROOM_ID, userId: ME, username: ME }, namespace);
    meEmit.mockClear();
    peerBEmit.mockClear();
  });

  const emitCalls = (spy: jest.Mock): [string, unknown][] => spy.mock.calls as [string, unknown][];

  const meshEmit = (): MeshPayload | undefined => {
    const call = emitCalls(meEmit).find((c) => c[0] === VOICE_EVENTS.MESH_PARTICIPANTS);
    return call?.[1] as MeshPayload | undefined;
  };

  const requireVersion = (): number => {
    const v = meshEmit()?.version;
    if (v === undefined) throw new Error('expected a MESH_PARTICIPANTS version');
    return v;
  };

  const fannedOut = (): boolean =>
    emitCalls(peerBEmit).some((c) => c[0] === VOICE_EVENTS.NEW_MESH_PEER);

  it('returns MESH_PARTICIPANTS with a version and fans out when the requester has no version yet', () => {
    handler.handleRequestMeshConnectionsNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);

    const payload = meshEmit();
    expect(payload).toBeDefined();
    expect(typeof payload?.version).toBe('number');
    expect(payload?.participants.map((p) => p.userId)).toEqual([PEER_B]);
    expect(fannedOut()).toBe(true); // unknown version → discovery fanout
  });

  it('skips the NEW_MESH_PEER fanout when the requester version already matches (steady state)', () => {
    // First request learns the current version.
    handler.handleRequestMeshConnectionsNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);
    const version = requireVersion();

    meEmit.mockClear();
    peerBEmit.mockClear();

    // Second request echoes that version — nothing changed.
    handler.handleRequestMeshConnectionsNamespace(
      meSocket,
      { roomId: ROOM_ID, userId: ME, lastVersion: version },
      namespace,
    );

    expect(meshEmit()?.version).toBe(version); // authoritative list still returned
    expect(fannedOut()).toBe(false); // no redundant fanout
  });

  it('fans out again after the roster changes (version no longer matches)', () => {
    handler.handleRequestMeshConnectionsNamespace(meSocket, { roomId: ROOM_ID, userId: ME }, namespace);
    const staleVersion = requireVersion();

    // A third participant joins → membership version changes.
    const peerCSocket = createPartialMock<Socket>({ id: 'socket-peer-c', emit: jest.fn(), to: jest.fn().mockReturnThis() });
    (sessionManager.getRoomSession as jest.Mock).mockImplementation((socketId: string) =>
      socketId === 'socket-peer-c' ? session('user-peer-c', 'socket-peer-c') : session(socketId === ME_SOCKET ? ME : PEER_B, socketId),
    );
    namespace.sockets.set('socket-peer-c', peerCSocket);
    handler.handleJoinVoiceNamespace(peerCSocket, { roomId: ROOM_ID, userId: 'user-peer-c', username: 'user-peer-c' }, namespace);

    meEmit.mockClear();
    peerBEmit.mockClear();

    handler.handleRequestMeshConnectionsNamespace(
      meSocket,
      { roomId: ROOM_ID, userId: ME, lastVersion: staleVersion },
      namespace,
    );

    expect(meshEmit()?.version).not.toBe(staleVersion);
    expect(fannedOut()).toBe(true); // roster changed → fanout resumes
  });
});
