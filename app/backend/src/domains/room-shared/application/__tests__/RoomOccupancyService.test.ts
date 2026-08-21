import { RoomOccupancyService } from '../RoomOccupancyService';
import type { ElementOccupancy } from '@jam-band/shared';

/**
 * Stands in for a real room state (ArrangeRoomState/PerformRoomState): occupancy plus at least
 * one unrelated field, so the fake save adapter has to reuse the snapshot the service hands it
 * the way the production adapters do (`{ ...state, occupancy }`).
 */
interface FakeRoomState {
  occupancy: Map<string, ElementOccupancy>;
  revision: number;
}

describe('RoomOccupancyService', () => {
  function makeService() {
    const store = new Map<string, FakeRoomState>();
    const saveCalls = { count: 0 };
    const getStateCalls = { count: 0 };
    const savedStates: FakeRoomState[] = [];
    const getState = async (roomId: string): Promise<FakeRoomState> => {
      getStateCalls.count += 1;
      return store.get(roomId) ?? { occupancy: new Map(), revision: 0 };
    };
    const saveState = async (roomId: string, occupancy: Map<string, ElementOccupancy>, state: FakeRoomState) => {
      saveCalls.count += 1;
      savedStates.push(state);
      store.set(roomId, { ...state, occupancy, revision: state.revision + 1 });
    };
    return { service: new RoomOccupancyService(getState, saveState), store, saveCalls, getStateCalls, savedStates };
  }

  it('hands saveState the state snapshot it already read, so adapters need no second read', async () => {
    const { service, getStateCalls, savedStates, store } = makeService();

    await service.join('room-1', 'popup:track:t1:fx', { userId: 'u1', username: 'Alice', joinedAt: Date.now() });

    expect(getStateCalls.count).toBe(1);
    expect(savedStates).toHaveLength(1);
    expect(savedStates[0]?.revision).toBe(0);
    expect(store.get('room-1')?.revision).toBe(1);

    getStateCalls.count = 0;
    await service.leave('room-1', 'popup:track:t1:fx', 'u1');

    expect(getStateCalls.count).toBe(1);
    expect(savedStates[1]?.revision).toBe(1);
    expect(store.get('room-1')?.revision).toBe(2);
  });

  it('passes the snapshot through heartbeat and releaseAllForUser too', async () => {
    const { service, getStateCalls, savedStates, store } = makeService();
    await service.join('room-1', 'popup:track:t1:fx', { userId: 'u1', username: 'Alice', joinedAt: Date.now() });

    getStateCalls.count = 0;
    await expect(service.heartbeat('room-1', 'popup:track:t1:fx', 'u1')).resolves.toBe(true);
    expect(getStateCalls.count).toBe(1);
    expect(savedStates[1]?.revision).toBe(1);

    getStateCalls.count = 0;
    await service.releaseAllForUser('room-1', 'u1');
    expect(getStateCalls.count).toBe(1);
    expect(savedStates[2]?.revision).toBe(2);
    expect(store.get('room-1')?.occupancy.size).toBe(0);
  });

  it('join() accepts a primitive with no existing holder', async () => {
    const { service } = makeService();
    const result = await service.join('room-1', 'track:t1:volume', { userId: 'u1', username: 'Alice', joinedAt: 1 });
    expect(result.accepted).toBe(true);
    expect(result.holders).toEqual([{ userId: 'u1', username: 'Alice', joinedAt: 1 }]);
  });

  it('join() rejects a primitive already held by someone else within TTL', async () => {
    const { service } = makeService();
    // Deviation from the brief's literal `joinedAt: 1` / `joinedAt: 2`: the service's
    // staleness check (`Date.now() - current.joinedAt >= PRIMITIVE_LOCK_TTL_MS`) compares against
    // the real wall clock, so a hardcoded epoch-relative value like `1` is always judged
    // stale and the join wrongly succeeds. Real callers (Task 7's handler) pass
    // `Date.now()` for `joinedAt`, so this test uses realistic "just joined" timestamps
    // to actually exercise the within-TTL rejection path. See task-5-report.md.
    await service.join('room-1', 'track:t1:volume', { userId: 'u1', username: 'Alice', joinedAt: Date.now() });
    const result = await service.join('room-1', 'track:t1:volume', { userId: 'u2', username: 'Bob', joinedAt: Date.now() });
    expect(result.accepted).toBe(false);
    expect(result.holders[0]?.userId).toBe('u1');
  });

  it('treats a primitive holder as stale after 30 seconds', async () => {
    const { service } = makeService();
    await service.join('room-1', 'track:t1:volume', { userId: 'u1', username: 'Alice', joinedAt: Date.now() - 31_000 });
    const result = await service.join('room-1', 'track:t1:volume', { userId: 'u2', username: 'Bob', joinedAt: Date.now() });
    expect(result.accepted).toBe(true);
    expect(result.holders[0]?.userId).toBe('u2');
  });

  it('still refuses a primitive held 20 seconds ago', async () => {
    const { service } = makeService();
    await service.join('room-1', 'track:t1:volume', { userId: 'u1', username: 'Alice', joinedAt: Date.now() - 20_000 });
    const result = await service.join('room-1', 'track:t1:volume', { userId: 'u2', username: 'Bob', joinedAt: Date.now() });
    expect(result.accepted).toBe(false);
    expect(result.holders[0]?.userId).toBe('u1');
  });

  it('join() appends to a container queue in join order', async () => {
    const { service } = makeService();
    await service.join('room-1', 'region-1', { userId: 'u1', username: 'Alice', joinedAt: 1 });
    const result = await service.join('room-1', 'region-1', { userId: 'u2', username: 'Bob', joinedAt: 2 });
    expect(result.accepted).toBe(true);
    expect(result.holders.map((h) => h.userId)).toEqual(['u1', 'u2']);
  });

  it('leave() promotes the next holder to owner (FIFO) for a container', async () => {
    const { service } = makeService();
    await service.join('room-1', 'region-1', { userId: 'u1', username: 'Alice', joinedAt: 1 });
    await service.join('room-1', 'region-1', { userId: 'u2', username: 'Bob', joinedAt: 2 });
    const result = await service.leave('room-1', 'region-1', 'u1');
    expect(result?.holders.map((h) => h.userId)).toEqual(['u2']);
  });

  it('leave() removes the element entirely once the last holder leaves', async () => {
    const { service } = makeService();
    await service.join('room-1', 'track:t1:volume', { userId: 'u1', username: 'Alice', joinedAt: 1 });
    await service.leave('room-1', 'track:t1:volume', 'u1');
    const occ = await service.getOccupancy('room-1', 'track:t1:volume');
    expect(occ).toBeNull();
  });

  it('releaseAllForUser() clears every element the user holds and reports each one', async () => {
    const { service } = makeService();
    await service.join('room-1', 'track:t1:volume', { userId: 'u1', username: 'Alice', joinedAt: 1 });
    await service.join('room-1', 'region-1', { userId: 'u1', username: 'Alice', joinedAt: 2 });
    const released = await service.releaseAllForUser('room-1', 'u1');
    const elementIds = released.map((r) => r.elementId).sort();
    expect(elementIds).toEqual(['region-1', 'track:t1:volume']);
  });

  it('heartbeat() is a no-op success when the user is the current owner', async () => {
    const { service } = makeService();
    await service.join('room-1', 'region-1', { userId: 'u1', username: 'Alice', joinedAt: 1 });
    const isSuccess = await service.heartbeat('room-1', 'region-1', 'u1');
    expect(isSuccess).toBe(true);
  });

  it('heartbeat() fails when the user does not hold the element', async () => {
    const { service } = makeService();
    const isSuccess = await service.heartbeat('room-1', 'region-1', 'u1');
    expect(isSuccess).toBe(false);
  });

  it('heartbeat() refuses a primitive even for its own holder, so the TR-4 staleness override cannot be defeated (final review M5)', async () => {
    const { service, saveCalls } = makeService();
    const joinedAt = Date.now();
    await service.join('room-1', 'track:t1:volume', { userId: 'u1', username: 'Alice', joinedAt });
    const savesAfterJoin = saveCalls.count;

    const isSuccess = await service.heartbeat('room-1', 'track:t1:volume', 'u1');

    expect(isSuccess).toBe(false);
    // No write at all — the guard runs before the room-state mutex is even taken.
    expect(saveCalls.count).toBe(savesAfterJoin);
    // …and the staleness clock is untouched, so the 30-second override still applies.
    const occ = await service.getOccupancy('room-1', 'track:t1:volume');
    expect(occ?.holders[0]?.joinedAt).toBe(joinedAt);
  });

  it('releaseAllForUser() skips the room-state write entirely when the user held nothing (final review L6)', async () => {
    const { service, saveCalls } = makeService();
    await service.join('room-1', 'region-1', { userId: 'u1', username: 'Alice', joinedAt: 1 });
    const savesAfterJoin = saveCalls.count;

    const released = await service.releaseAllForUser('room-1', 'u2');

    expect(released).toEqual([]);
    expect(saveCalls.count).toBe(savesAfterJoin);
    // The other user's entry is of course still intact.
    expect((await service.getOccupancy('room-1', 'region-1'))?.holders[0]?.userId).toBe('u1');
  });
});
