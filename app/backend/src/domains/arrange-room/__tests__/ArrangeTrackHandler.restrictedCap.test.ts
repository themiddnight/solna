import { ArrangeTrackHandler } from '../infrastructure/handlers/sub-handlers/ArrangeTrackHandler';
import { ARRANGE_CONSTANTS, SOCKET_ERROR_CODES, UserType } from '@jam-band/shared';
import type { Socket, Namespace } from 'socket.io';
import type { ArrangeRoomHandler } from '../infrastructure/handlers/ArrangeRoomHandler';
import { setSocketSession } from '@/shared/infrastructure/socket/socketSession';
import type { SocketAuthUser } from '@/config/socket';

describe('ArrangeTrackHandler restricted track cap', () => {
  const roomId = 'room-1';
  const makeTracks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

  const build = (userType: string, emailVerified: boolean, trackCount: number) => {
    const socket = { emit: jest.fn(), data: { user: { id: 'u', userType, emailVerified } } } as unknown as jest.Mocked<Socket>;
    const namespace = { to: jest.fn().mockReturnThis(), emit: jest.fn() } as unknown as jest.Mocked<Namespace>;
    const addTrack = jest.fn().mockResolvedValue(undefined);
    const handler = {
      getSessionPublic: jest.fn().mockResolvedValue({ roomId, userId: 'u' }),
      getStateService: () => ({ getState: jest.fn().mockResolvedValue({ tracks: makeTracks(trackCount) }), addTrack }),
    } as unknown as ArrangeRoomHandler;
    return { th: new ArrangeTrackHandler(handler), socket, namespace, addTrack };
  };

  it('blocks a guest from adding a 4th track (restricted cap = 3)', async () => {
    const { th, socket, namespace, addTrack } = build('GUEST', false, ARRANGE_CONSTANTS.MAX_TRACKS_PER_ROOM_RESTRICTED);
    await th.handleTrackAdd(socket, namespace, { roomId, track: { id: 'new' } as never });
    expect(addTrack).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ code: SOCKET_ERROR_CODES.REGISTER_REQUIRED }));
  });

  it('lets a guest add while under the restricted cap', async () => {
    const { th, socket, namespace, addTrack } = build('GUEST', false, 2);
    await th.handleTrackAdd(socket, namespace, { roomId, track: { id: 'new' } as never });
    expect(addTrack).toHaveBeenCalledTimes(1);
  });

  it('lets a verified user add past the restricted cap', async () => {
    const { th, socket, namespace, addTrack } = build('REGISTERED', true, 10);
    await th.handleTrackAdd(socket, namespace, { roomId, track: { id: 'new' } as never });
    expect(addTrack).toHaveBeenCalledTimes(1);
  });

  // Regression coverage: the cases above hand-craft the FINAL socket.data (`.user` already
  // sitting there) and never run it through a session assignment, so they could never have
  // caught the original bug — a bare `socket.data = session` in the join handler wiping the
  // auth-middleware-attached `.user`, which made every verified user look like a restricted
  // guest to this exact cap check (see socketSession.ts docblock + setSocketSession.test.ts).
  // This case chains the REAL production `setSocketSession` (not a hand-assigned socket.data)
  // — the same call `RoomConnectionHandler.handleJoinRoomInner` makes right after resolving join
  // identity — into the real `ArrangeTrackHandler`, so the join→session→add-track seam is
  // exercised together instead of only its two halves in isolation.
  it('allows a verified REGISTERED user to add a 4th track after a real join (session preserved)', async () => {
    const realRoomId = 'room-real-join';
    const userId = 'verified-user-1';

    // 1. Socket as the connection middleware leaves it post-auth, pre-join: only `.user` set
    // (see authenticateSocket / createDynamicNamespaceMiddleware in @/config/socket).
    const authUser: SocketAuthUser = {
      id: userId,
      email: 'verified@test.com',
      username: 'VerifiedUser',
      userType: UserType.REGISTERED,
      emailVerified: true,
      profilePictureUrl: null,
    };
    const socket = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      data: { user: authUser },
    } as unknown as jest.Mocked<Socket>;

    // 2. Run the REAL join-time session assignment (production import, not re-implemented or
    // mocked) instead of fabricating post-join socket.data directly.
    setSocketSession(socket, { roomId: realRoomId, userId });

    // Sanity: setSocketSession must not have clobbered the verified identity.
    expect((socket.data as { user?: SocketAuthUser }).user).toBe(authUser);

    const namespace = { to: jest.fn().mockReturnThis(), emit: jest.fn() } as unknown as jest.Mocked<Namespace>;

    // 3. Add tracks up to and past the restricted cap (3) via the real handler, backed by a
    // stateful fake state service so persistence is asserted for real, not just call-counted.
    const tracks: ReturnType<typeof makeTracks> = makeTracks(ARRANGE_CONSTANTS.MAX_TRACKS_PER_ROOM_RESTRICTED);
    const addTrack = jest.fn(async (_roomId: string, track: { id: string }): Promise<void> => {
      tracks.push(track);
    });
    const getState = jest.fn(async (_roomId: string): Promise<{ tracks: ReturnType<typeof makeTracks> }> => ({ tracks }));
    const stateService = { getState, addTrack };
    const handler = {
      getSessionPublic: jest.fn().mockResolvedValue({ roomId: realRoomId, userId }),
      getStateService: () => stateService,
    } as unknown as ArrangeRoomHandler;
    const th = new ArrangeTrackHandler(handler);

    await th.handleTrackAdd(socket, namespace, { roomId: realRoomId, track: { id: 'track-4' } as never });

    expect(addTrack).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());

    const state = await stateService.getState(realRoomId);
    expect(state.tracks).toHaveLength(4);
  });
});
