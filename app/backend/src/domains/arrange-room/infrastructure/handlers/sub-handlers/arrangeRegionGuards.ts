import type { ElementOccupancy } from '@jam-band/shared';
import type { ArrangeRoomState } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';

/**
 * Shared region-scoped permission guards for the Arrange sub-handlers.
 *
 * Extracted from `ArrangeRegionHandler` (DEV-350 Round 2, Task 2) when the note handlers
 * moved to `ArrangeNoteHandler` for TR-20 — both sub-handlers need the exact same checks,
 * so they live here instead of being duplicated.
 */

export interface TrackLockValidation {
  valid: boolean;
  error?: string;
}

/**
 * Track-level lock check with project-owner bypass.
 */
export function validateTrackLock(
  state: ArrangeRoomState,
  trackId: string,
  userId: string
): TrackLockValidation {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) {
    return { valid: false, error: 'Track not found' };
  }
  const isProjectOwner = userId === state.projectOwnerId;
  if (track.isLocked === true && !isProjectOwner) {
    return { valid: false, error: 'Track is locked' };
  }
  return { valid: true };
}

/**
 * Pure queue-head ownership decision, split out of `getOwnerConflict` so callers that
 * ALREADY hold the room state (see `checkRegionEditAccess`) can reach the same verdict
 * without a second Redis read. `holders[0]` is the owner; no entry / no holders = unlocked.
 */
export function ownerConflictFromOccupancy(
  occupancy: ElementOccupancy | null | undefined,
  actingUserId: string
): { username: string } | null {
  const owner = occupancy?.holders[0];
  if (owner && owner.userId !== actingUserId) {
    return { username: owner.username };
  }
  return null;
}

/**
 * Container-ownership CRUD guard (DEV-350 M2, Task 14 Part 2) — the single implementation
 * shared by the region, note and chord-block sub-handlers (`ArrangeChordTrackHandler`
 * delegates here; it used to carry a verbatim copy, DEV-350 final fix wave finding 8).
 * Reads `holders[0]` of the element's occupancy entry (`RoomOccupancyService`, `container`
 * kind): only the current queue owner may mutate; no occupancy entry / no holders is treated
 * as unlocked. Replaces the retired `state.locks`/`getActiveLockConflict` check, which had
 * already gone dead by Task 12 — nothing populates `state.locks` for regions since the old
 * `LOCK_ACQUIRE` event was retired in Task 7.
 *
 * `elementId` is any occupancy key (a bare region id, a bare chord-block id, …) — both are
 * `container`-kind via `elementKindRegistry`'s bare-id default.
 *
 * TR-2: `getOccupancy` is a mutex-free read, so this is a check-then-act pre-check. The
 * in-mutex guard inside `ArrangeRoomStateService.*NoteAtomic` is kept alongside it, not
 * replaced by it.
 */
export async function getOwnerConflict(
  handler: ArrangeRoomHandler,
  roomId: string,
  elementId: string,
  actingUserId: string
): Promise<{ username: string } | null> {
  const occupancy = await handler.getOccupancyService().getOccupancy(roomId, elementId);
  return ownerConflictFromOccupancy(occupancy, actingUserId);
}

export interface RegionEditPreCheck extends TrackLockValidation {
  /** Only meaningful when `valid` is true; the track-lock rejection short-circuits first. */
  conflict: { username: string } | null;
}

/**
 * Combined, SINGLE-READ unlocked pre-check for a region mutation: the track-lock decision
 * and the occupancy-owner decision both come out of one `getState` call.
 *
 * `getState` is an uncached Redis GET plus a full `deserializeState` of every track, region
 * and note (`BaseRoomStateService.getState`), and `RoomOccupancyService.getOccupancy` is
 * literally `(await getState(roomId))?.occupancy.get(elementId)` — so the retired
 * `validateTrackLockForRegion` + `getOwnerConflict` pair deserialized the whole room twice
 * per event. On the 30 Hz `arrange:note_realtime_update` path that was ~60 full room
 * deserializations per second per dragging user (DEV-350 final fix wave finding 5).
 *
 * Every region/note mutation path now routes through here (review follow-up, findings 5/6);
 * `validateTrackLockForRegion` was deleted with the last of them. Handlers that already hold
 * the state call `ownerConflictFromOccupancy` directly instead.
 *
 * TR-2: still a mutex-free check-then-act pre-check — the atomicity guarantee remains the
 * in-mutex guard inside `ArrangeRoomStateService.*NoteAtomic`, which is untouched.
 */
export async function checkRegionEditAccess(
  handler: ArrangeRoomHandler,
  roomId: string,
  regionId: string,
  userId: string
): Promise<RegionEditPreCheck> {
  const state = await handler.getStateService().getState(roomId);
  if (!state) {
    return { valid: false, error: 'Project state not found', conflict: null };
  }
  const region = state.regions.find((r) => r.id === regionId);
  if (!region) {
    return { valid: false, error: 'Region not found', conflict: null };
  }
  const validation = validateTrackLock(state, region.trackId, userId);
  if (!validation.valid) {
    return { ...validation, conflict: null };
  }
  return { ...validation, conflict: ownerConflictFromOccupancy(state.occupancy.get(regionId), userId) };
}
