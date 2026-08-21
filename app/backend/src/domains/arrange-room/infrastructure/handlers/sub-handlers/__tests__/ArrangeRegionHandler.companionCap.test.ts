/**
 * DEV-279 P2 Task 2.9 — `ArrangeRegionHandler.handleRegionAdd` surfaces the
 * companion-region cap rejection thrown by `addRegionToState` (via
 * `ArrangeRoomStateService.addRegion`) through the handler's existing
 * generic catch-and-emit error pattern (mirrors every other handler in this
 * file, e.g. `handleRegionDelete`'s "Region not found"): the client gets a
 * socket `'error'` event and no `REGION_ADDED` broadcast, and the region is
 * never appended to the in-memory state the mock stands in for Redis.
 */
import type { Socket, Namespace } from 'socket.io';
import { ArrangeRegionHandler } from '../ArrangeRegionHandler';
import type { ArrangeRoomHandler } from '../../ArrangeRoomHandler';
import type { CompanionRegion, ArrangeRoomState } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { toDecibels } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import { ARRANGE_CONSTANTS, DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';

describe('ArrangeRegionHandler.handleRegionAdd — companion region cap', () => {
  const roomId = 'room-1';
  const CAP = ARRANGE_CONSTANTS.MAX_COMPANION_REGIONS_PER_PROJECT;

  function companionRegion(id: string): CompanionRegion {
    return {
      id,
      trackId: 'track-1',
      name: `Companion ${id}`,
      start: 0,
      length: 16,
      loopEnabled: false,
      loopIterations: 1,
      type: 'companion',
      config: { style: 'block', density: 'normal', volume: toDecibels(DEFAULT_COMPANION_VOLUME_DB), isMuted: false },
    };
  }

  function build(companionCount: number) {
    const regions = Array.from({ length: companionCount }, (_, i) => companionRegion(`c${i}`));
    const state = {
      tracks: [{ id: 'track-1', isLocked: false, regionIds: regions.map((r) => r.id) }],
      regions,
    } as unknown as ArrangeRoomState;

    const socket = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      data: { user: { id: 'u', userType: 'REGISTERED' } },
    } as unknown as jest.Mocked<Socket>;
    const namespace = { to: jest.fn().mockReturnThis(), emit: jest.fn() } as unknown as jest.Mocked<Namespace>;

    // addRegion mirrors the real ArrangeRoomStateService.addRegion: it calls the real
    // addRegionToState mutation (which throws at the cap) rather than being a bare stub,
    // so this test exercises the actual reject path, not just a mocked rejection.
    const addRegion = jest.fn(async (_roomId: string, region: CompanionRegion) => {
      const { addRegionToState } = jest.requireActual(
        '@/domains/arrange-room/application/ArrangeRoomStateMutations',
      ) as { addRegionToState: (s: ArrangeRoomState, r: CompanionRegion) => ArrangeRoomState };
      const next = addRegionToState(state, region);
      state.regions = next.regions;
      return next;
    });

    const handler = {
      getSessionPublic: jest.fn().mockResolvedValue({ roomId, userId: 'u' }),
      getStateService: () => ({ getState: jest.fn().mockResolvedValue(state), addRegion }),
    } as unknown as ArrangeRoomHandler;

    return { rh: new ArrangeRegionHandler(handler), socket, namespace, addRegion, state };
  }

  it('rejects the 11th companion region: emits a socket error, no broadcast, state unchanged', async () => {
    const { rh, socket, namespace, state } = build(CAP);
    const region = companionRegion('c-eleventh');

    await rh.handleRegionAdd(socket, namespace, { roomId, region });

    expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
    expect(socket.to).not.toHaveBeenCalled();
    expect(state.regions).toHaveLength(CAP);
  });

  it('allows the 10th companion region (at the cap, not over it)', async () => {
    const { rh, socket, state } = build(CAP - 1);
    const region = companionRegion('c-tenth');

    await rh.handleRegionAdd(socket, {} as Namespace, { roomId, region });

    expect(socket.emit).not.toHaveBeenCalledWith('error', expect.anything());
    expect(state.regions).toHaveLength(CAP);
  });
});
