/**
 * MeshWebRTCStrategy unit tests.
 *
 * Runs the REAL strategy against an injected fake `Server` (only
 * `io.sockets.sockets` is touched — peer sockets are looked up by id and emitted
 * on) and a mocked RoomSessionManager seam. The strategy is a pure in-memory
 * connection bookkeeper: connections, user mappings, health, recovery, and the
 * NEW_MESH_PEER / MESH_PARTICIPANTS notifications are all asserted through the
 * fake sockets' `.emit` capture.
 */

import type { Server, Namespace, Socket } from 'socket.io';
import { VOICE_EVENTS } from '@jam-band/shared';
import { MeshWebRTCStrategy } from '../MeshWebRTCStrategy';
import { InvalidRoleError, ConnectionFailedError } from '@/domains/real-time-communication/domain/services/AudioCommunicationStrategy';
import { UserRole, type ConnectionId, type AudioBuffer } from '@/domains/real-time-communication/domain/models/Connection';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

const ROOM_ID = 'room-1';

function audioBuffer(): AudioBuffer {
  return { data: new ArrayBuffer(8), sampleRate: 48000, channels: 2, timestamp: Date.now() };
}

interface StrategySeams {
  strategy: MeshWebRTCStrategy;
  io: jest.Mocked<Server>;
  sessionManager: jest.Mocked<RoomSessionManager>;
  sockets: Map<string, Socket>;
}

function makeStrategy(): StrategySeams {
  const sockets = new Map<string, Socket>();
  const io = createPartialMock<Server>({
    sockets: createPartialMock<Namespace>({
      sockets,
    }),
  });
  const sessionManager = createPartialMock<RoomSessionManager>({
    findSocketByUserId: jest.fn(),
  });
  const strategy = new MeshWebRTCStrategy(io, sessionManager, ROOM_ID);
  return { strategy, io, sessionManager, sockets };
}

function addPeerSocket(seams: StrategySeams, userId: string): jest.Mock {
  const emit = jest.fn();
  seams.sockets.set(`socket-${userId}`, createPartialMock<Socket>({ id: `socket-${userId}`, emit }));
  // Session lookup resolves any peer that has a socket registered in the io map.
  seams.sessionManager.findSocketByUserId.mockImplementation(
    (_roomId: string, targetUserId: string) =>
      seams.sockets.has(`socket-${targetUserId}`) ? `socket-${targetUserId}` : undefined
  );
  return emit;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MeshWebRTCStrategy.connect', () => {
  it('rejects unsupported roles (audience) with InvalidRoleError', async () => {
    const { strategy } = makeStrategy();

    await expect(strategy.connect('user-a', UserRole.AUDIENCE)).rejects.toBeInstanceOf(InvalidRoleError);
    expect(strategy.getConnectedUsersCount()).toBe(0);
  });

  it('connects a band member and tracks the connection', async () => {
    const { strategy } = makeStrategy();

    const connectionId = await strategy.connect('user-a', UserRole.BAND_MEMBER);

    expect(connectionId.toString()).toMatch(/^[0-9a-f-]{36}$/);
    expect(strategy.getConnectedUsersCount()).toBe(1);
    expect(strategy.getConnectionStatus()).toEqual([
      { userId: 'user-a', connectionIds: [connectionId.toString()], isHealthy: true },
    ]);
  });

  it('supports room owners', async () => {
    const { strategy } = makeStrategy();

    const connectionId = await strategy.connect('user-owner', UserRole.ROOM_OWNER);

    expect(connectionId).toBeDefined();
  });

  it('allows multiple connections per user', async () => {
    const { strategy } = makeStrategy();

    await strategy.connect('user-a', UserRole.BAND_MEMBER);
    await strategy.connect('user-a', UserRole.BAND_MEMBER);

    expect(strategy.getConnectedUsersCount()).toBe(1);
    expect(strategy.getConnectionStatus()[0]?.connectionIds).toHaveLength(2);
  });

  it('notifies existing participants of the new peer and the new user of participants', async () => {
    const seams = makeStrategy();
    const emitA = addPeerSocket(seams, 'user-a');
    const emitB = addPeerSocket(seams, 'user-b');

    await seams.strategy.connect('user-a', UserRole.BAND_MEMBER);
    expect(emitA).not.toHaveBeenCalled(); // first participant: nobody to notify

    await seams.strategy.connect('user-b', UserRole.BAND_MEMBER);

    // user-a hears about user-b and initiates because a < b
    expect(emitA).toHaveBeenCalledWith(VOICE_EVENTS.NEW_MESH_PEER, {
      userId: 'user-b',
      shouldInitiate: true,
    });
    // user-b gets the participant roster; b > a so b does not initiate
    expect(emitB).toHaveBeenCalledWith(VOICE_EVENTS.MESH_PARTICIPANTS, {
      participants: [{ userId: 'user-a', shouldInitiate: false }],
    });
  });

  it('skips notifications when a peer has no socket in the io map', async () => {
    const seams = makeStrategy();
    const emitB = addPeerSocket(seams, 'user-b');
    // user-a has a session entry but no socket in io.sockets.sockets — lookup misses.

    await seams.strategy.connect('user-a', UserRole.BAND_MEMBER);
    await seams.strategy.connect('user-b', UserRole.BAND_MEMBER);

    expect(emitB).toHaveBeenCalledWith(
      VOICE_EVENTS.MESH_PARTICIPANTS,
      expect.objectContaining({ participants: [{ userId: 'user-a', shouldInitiate: false }] })
    );
  });
});

describe('MeshWebRTCStrategy.disconnect', () => {
  it('logs a warning for an unknown connection without throwing', async () => {
    const { strategy } = makeStrategy();
    // TR-27 confined boundary cast: an unknown id arrives from the wire layer.
    const missingId = 'missing' as unknown as ConnectionId;

    await expect(strategy.disconnect(missingId)).resolves.toBeUndefined();
  });

  it('removes the connection and clears the user mapping on the last connection', async () => {
    const { strategy } = makeStrategy();
    const connectionId = await strategy.connect('user-a', UserRole.BAND_MEMBER);
    expect(strategy.getConnectedUsersCount()).toBe(1);

    await strategy.disconnect(connectionId);

    expect(strategy.getConnectedUsersCount()).toBe(0);
    expect(strategy.getConnectionStatus()).toEqual([]);
  });

  it('keeps the user mapping when other connections remain', async () => {
    const { strategy } = makeStrategy();
    await strategy.connect('user-a', UserRole.BAND_MEMBER);
    const second = await strategy.connect('user-a', UserRole.BAND_MEMBER);

    await strategy.disconnect(second);

    expect(strategy.getConnectedUsersCount()).toBe(1);
    expect(strategy.getConnectionStatus()[0]?.connectionIds).toHaveLength(1);
  });
});

describe('MeshWebRTCStrategy.sendAudio', () => {
  it('throws ConnectionFailedError for an unknown connection', async () => {
    const { strategy } = makeStrategy();
    // TR-27 confined boundary cast: an unknown id arrives from the wire layer.
    const missingId = 'nope' as unknown as ConnectionId;

    await expect(strategy.sendAudio(missingId, audioBuffer())).rejects.toBeInstanceOf(
      ConnectionFailedError
    );
  });

  it('marks a healthy connection as connected after sending (no other users)', async () => {
    const { strategy } = makeStrategy();
    const connectionId = await strategy.connect('user-a', UserRole.BAND_MEMBER);

    await strategy.sendAudio(connectionId, audioBuffer());

    expect(strategy.getConnectionStatus()[0]?.isHealthy).toBe(true);
  });

  it('relays to other users and resolves when peers exist (audio relay is a no-op today)', async () => {
    const seams = makeStrategy();
    const emitA = addPeerSocket(seams, 'user-a');
    const emitB = addPeerSocket(seams, 'user-b');
    const connectionA = await seams.strategy.connect('user-a', UserRole.BAND_MEMBER);
    await seams.strategy.connect('user-b', UserRole.BAND_MEMBER);
    // Clear the connect-time NEW_MESH_PEER/MESH_PARTICIPANTS notifications.
    emitA.mockClear();
    emitB.mockClear();

    await seams.strategy.sendAudio(connectionA, audioBuffer());

    // mesh_audio_data relay was abandoned — no emits, but the send path resolves.
    expect(emitA).not.toHaveBeenCalled();
    expect(emitB).not.toHaveBeenCalled();
  });
});

describe('MeshWebRTCStrategy.onAudioReceived / handleIncomingAudio', () => {
  it('forwards incoming audio to registered callbacks', () => {
    const { strategy } = makeStrategy();
    const callback = jest.fn();
    strategy.onAudioReceived(callback);
    const buffer = audioBuffer();

    strategy.handleIncomingAudio(buffer, 'user-a');

    expect(callback).toHaveBeenCalledWith(buffer, 'user-a');
  });

  it('isolates a throwing callback and still calls the rest', () => {
    const { strategy } = makeStrategy();
    const boom = jest.fn().mockImplementation(() => {
      throw new Error('callback blew up');
    });
    const fine = jest.fn();
    strategy.onAudioReceived(boom);
    strategy.onAudioReceived(fine);

    expect(() => strategy.handleIncomingAudio(audioBuffer(), 'user-a')).not.toThrow();

    expect(boom).toHaveBeenCalledTimes(1);
    expect(fine).toHaveBeenCalledTimes(1);
  });
});

describe('MeshWebRTCStrategy.getConnectionHealth', () => {
  it('reports failed for an unknown connection', async () => {
    const { strategy } = makeStrategy();
    // TR-27 confined boundary cast: an unknown id arrives from the wire layer.
    const missingId = 'missing' as unknown as ConnectionId;

    await expect(strategy.getConnectionHealth(missingId)).resolves.toEqual({
      isHealthy: false,
      quality: 'failed',
    });
  });

  it('reports excellent quality for low-latency connections', async () => {
    const { strategy } = makeStrategy();
    const connectionId = await strategy.connect('user-a', UserRole.BAND_MEMBER);
    jest.spyOn(Math, 'random').mockReturnValue(0); // latency 10ms

    const health = await strategy.getConnectionHealth(connectionId);

    expect(health.isHealthy).toBe(true);
    expect(health.quality).toBe('excellent');
  });

  it('reports good quality for mid-latency connections', async () => {
    const { strategy } = makeStrategy();
    const connectionId = await strategy.connect('user-a', UserRole.BAND_MEMBER);
    jest.spyOn(Math, 'random').mockReturnValue(0.9); // latency 55ms

    const health = await strategy.getConnectionHealth(connectionId);

    expect(health.isHealthy).toBe(true);
    expect(health.quality).toBe('good');
  });
});

describe('MeshWebRTCStrategy.recoverConnection', () => {
  it('throws ConnectionFailedError for an unknown connection', async () => {
    const { strategy } = makeStrategy();
    // TR-27 confined boundary cast: an unknown id arrives from the wire layer.
    const missingId = 'missing' as unknown as ConnectionId;

    await expect(strategy.recoverConnection(missingId)).rejects.toBeInstanceOf(
      ConnectionFailedError
    );
  });

  it('re-establishes a known connection as CONNECTED', async () => {
    const { strategy } = makeStrategy();
    const connectionId = await strategy.connect('user-a', UserRole.BAND_MEMBER);

    await strategy.recoverConnection(connectionId);

    expect(strategy.getConnectionStatus()[0]?.isHealthy).toBe(true);
  });

  it('marks the connection FAILED and rethrows when mesh setup fails', async () => {
    const seams = makeStrategy();
    const connectionId = await seams.strategy.connect('user-a', UserRole.BAND_MEMBER);
    await seams.strategy.connect('user-b', UserRole.BAND_MEMBER);
    // A peer lookup failure inside the mesh setup rejects the recovery.
    seams.sessionManager.findSocketByUserId.mockImplementation(() => {
      throw new Error('session map exploded');
    });

    await expect(seams.strategy.recoverConnection(connectionId)).rejects.toThrow(
      'Failed to recover connection'
    );
  });
});

describe('MeshWebRTCStrategy.getStrategyInfo', () => {
  it('reports mesh configuration', () => {
    const { strategy } = makeStrategy();

    expect(strategy.getStrategyInfo()).toEqual({
      type: 'mesh',
      maxConnections: 8,
      supportedRoles: [UserRole.BAND_MEMBER, UserRole.ROOM_OWNER],
    });
  });
});

describe('MeshWebRTCStrategy.getConnectionStatus', () => {
  it('reports per-user connection ids and aggregate health', async () => {
    const { strategy } = makeStrategy();
    const connectionA = await strategy.connect('user-a', UserRole.BAND_MEMBER);
    await strategy.connect('user-b', UserRole.BAND_MEMBER);

    const status = strategy.getConnectionStatus();

    expect(status).toHaveLength(2);
    expect(status.find((entry) => entry.userId === 'user-a')).toEqual({
      userId: 'user-a',
      connectionIds: [connectionA.toString()],
      isHealthy: true,
    });
  });
});
