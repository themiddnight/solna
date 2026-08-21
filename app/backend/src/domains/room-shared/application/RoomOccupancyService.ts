import { PRIMITIVE_LOCK_TTL_MS, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, resolveElementKind } from '@jam-band/shared';
import type { Holder, ElementOccupancy } from '@jam-band/shared';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';

export interface OccupancyState {
  occupancy: Map<string, ElementOccupancy>;
}

/**
 * State-agnostic view of the operations consumers (socket handlers, sub-handlers, lifecycle
 * cleanup) actually call. None of these signatures mention the room-state type parameter, so
 * a `RoomOccupancyService<ArrangeRoomState>` and a `RoomOccupancyService<PerformRoomState>`
 * are both assignable to it — consumers depend on this instead of the generic class.
 */
export type RoomOccupancyOperations = Pick<
  RoomOccupancyService,
  'join' | 'leave' | 'heartbeat' | 'releaseAllForUser' | 'getOccupancy'
>;

export class RoomOccupancyService<TState extends OccupancyState = OccupancyState> {
  /**
   * @param saveState receives the mutated `occupancy` map AND the `state` snapshot this
   * service already read inside the mutex. Adapters that need to write occupancy back into a
   * larger room-state object must reuse that snapshot rather than issuing a second
   * `getState` — the whole read-mutate-write sequence runs under the room-wide
   * `room-state-mutex:{roomId}` (TR-2), the same key every other room-state read-modify-write
   * takes, so no other writer can have changed it in between.
   */
  constructor(
    private readonly getState: (roomId: string) => Promise<TState | null>,
    private readonly saveState: (roomId: string, occupancy: Map<string, ElementOccupancy>, state: TState) => Promise<void>,
  ) {}

  async join(roomId: string, elementId: string, holder: Holder): Promise<{ accepted: boolean; holders: Holder[] }> {
    return this.withMutex(roomId, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        return { accepted: false, holders: [] };
      }
      const occupancy = new Map(state.occupancy);
      const kind = resolveElementKind(elementId);
      const existing = occupancy.get(elementId);
      const holders = existing ? [...existing.holders] : [];

      if (kind === 'primitive') {
        const current = holders[0];
        if (current && current.userId !== holder.userId) {
          const isStale = Date.now() - current.joinedAt >= PRIMITIVE_LOCK_TTL_MS;
          if (!isStale) {
            return { accepted: false, holders };
          }
        }
        const newHolders = [holder];
        occupancy.set(elementId, { kind, holders: newHolders });
        await this.saveState(roomId, occupancy, state);
        return { accepted: true, holders: newHolders };
      }

      // container: append if not already present (idempotent re-join)
      if (!holders.some((h) => h.userId === holder.userId)) {
        holders.push(holder);
      }
      occupancy.set(elementId, { kind, holders });
      await this.saveState(roomId, occupancy, state);
      return { accepted: true, holders };
    });
  }

  async leave(roomId: string, elementId: string, userId: string): Promise<{ holders: Holder[] } | null> {
    return this.withMutex(roomId, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        return null;
      }
      const occupancy = new Map(state.occupancy);
      const existing = occupancy.get(elementId);
      if (!existing) {
        return null;
      }
      const holders = existing.holders.filter((h) => h.userId !== userId);
      // Not a holder -> nothing changed. Returning `null` (instead of the unchanged holder
      // list) is what stops `handleOccupancyLeave` re-broadcasting a no-op `LEFT` AND stops
      // a full room-state rewrite under the room-wide mutex. The client emitters are
      // deliberately unguarded on several paths (`interactionEndHandlers` fires on up to
      // five events for one fader release), so this is the single place that has to absorb
      // the duplicates.
      if (holders.length === existing.holders.length) {
        return null;
      }
      if (holders.length === 0) {
        occupancy.delete(elementId);
      } else {
        occupancy.set(elementId, { kind: existing.kind, holders });
      }
      await this.saveState(roomId, occupancy, state);
      return { holders };
    });
  }

  async heartbeat(roomId: string, elementId: string, userId: string): Promise<boolean> {
    // Heartbeat is scoped to `container` owners only (spec §5). A `primitive` lock relies on
    // the TR-4 30-second staleness override in `join()` above as its ONLY safety net, so
    // accepting a heartbeat on one would let a client keep it alive forever and defeat that
    // override. Checked before `withMutex` — `resolveElementKind` is pure, so a rejected
    // heartbeat costs no Redis mutex acquisition either. (This DOES refresh the container
    // owner's staleness clock — see the `joinedAt` rewrite below; the comment that used to
    // claim otherwise was wrong. It simply has no consumer yet: nothing expires a container.
    // See the CONTAINER_LOCK_TTL_MS doc comment in SyncConfig.ts and DEV-361.)
    if (resolveElementKind(elementId) !== 'container') {
      return false;
    }
    return this.withMutex(roomId, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        return false;
      }
      const occupancy = new Map(state.occupancy);
      const existing = occupancy.get(elementId);
      const owner = existing?.holders[0];
      if (!existing || !owner || owner.userId !== userId) {
        return false;
      }
      // Refreshing the owner's `joinedAt` is safe for FIFO order precisely because it is the
      // OWNER: position 0 stays position 0 no matter how the timestamp moves. A dedicated
      // `lastSeenAt` field would be cleaner, but it would widen the `Holder` shape shared by
      // FE and BE (TR-14) for a value only this method reads.
      const holders = [{ ...owner, joinedAt: Date.now() }, ...existing.holders.slice(1)];
      occupancy.set(elementId, { kind: existing.kind, holders });
      await this.saveState(roomId, occupancy, state);
      return true;
    });
  }

  async releaseAllForUser(roomId: string, userId: string): Promise<Array<{ elementId: string; holders: Holder[] }>> {
    return this.withMutex(roomId, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        return [];
      }
      const occupancy = new Map(state.occupancy);
      const released: Array<{ elementId: string; holders: Holder[] }> = [];
      for (const [elementId, occ] of state.occupancy.entries()) {
        if (!occ.holders.some((h) => h.userId === userId)) {
          continue;
        }
        const holders = occ.holders.filter((h) => h.userId !== userId);
        if (holders.length === 0) {
          occupancy.delete(elementId);
        } else {
          occupancy.set(elementId, { kind: occ.kind, holders });
        }
        released.push({ elementId, holders });
      }
      // Nothing held -> nothing changed: skip the full room-state write. Every user leave
      // runs this under the room-wide mutex, and most leavers hold no occupancy at all
      // (mirrors RoomLifecycleHandler.releaseArrangeLocksForUser's `released.length === 0`
      // short-circuit, which only skips the BROADCAST — this skips the write itself).
      if (released.length === 0) {
        return released;
      }
      await this.saveState(roomId, occupancy, state);
      return released;
    });
  }

  async getOccupancy(roomId: string, elementId: string): Promise<ElementOccupancy | null> {
    const state = await this.getState(roomId);
    return state?.occupancy.get(elementId) ?? null;
  }

  private withMutex<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    return redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, fn);
  }
}
