# Room Lifecycle & Cleanup Management

Documentation for room creation, user join flows, ghost user cleanup mechanisms, and room deletion triggers.

---

## Overview

Room lifecycle management handles:
- Room creation flow (HTTP + Socket)
- User join flow (Owner vs Others)
- Ghost user cleanup mechanism
- Room deletion triggers

---

## Room Creation Flow

### Owner Flow (HTTP → Socket)

1. **HTTP**: `createRoom` → owner added to `bandMembers`
2. **HTTP**: `loadProjectFromStorage` (may take time loading audio files from Backblaze)
3. **FE**: Navigate to room page
4. **Socket**: Connect + `join_room`
5. **Socket**: Receive `room_joined`

**Gap**: Owner exists in room but no socket session yet — this is the critical window where ghost cleanup could incorrectly remove the owner.

### Other Users Flow (Socket Only)

1. **FE**: Navigate to room page
2. **Socket**: Connect + `join_room` → user added to room
3. **Socket**: Receive `room_joined`

**No Gap**: User added with active socket session — no risk of ghost cleanup.

---

## Ghost User Cleanup

### Purpose

Remove users who exist in room but have no active socket session (disconnected/crashed without proper cleanup).

### Mechanism

- Runs once, 2 minutes after server start (one-shot post-restart cleanup). Periodic ghost cleanup is handled by the 5-minute interval in index.ts via cleanupExpiredGraceTime.
- Checks all users in all rooms
- Removes users without active socket session via **`RoomSessionManager.isUserActiveInRoom(roomId, userId)`** — cross-process-safe, checks Redis session keys directly

### Protection Mechanisms

Ghost user cleanup has **4 protection layers** to prevent incorrect removal:

#### 1. Room Age Check (30 seconds)

```typescript
const ROOM_GRACE_PERIOD_MS = 30_000;
const roomAgeMs = Date.now() - new Date(room.createdAt).getTime();
if (roomAgeMs < ROOM_GRACE_PERIOD_MS) {
  continue; // Skip entire room
}
```

- Skip cleanup for rooms < 30 seconds old
- Protects newly created rooms
- Gives owner time to connect socket

#### 2. Reconnection Window (2 minutes)

- After server restart, wait 2 minutes before running the one-shot ghost cleanup
- Gives all users time to reconnect
- Implemented in `index.ts` as a one-shot `setTimeout(() => cleanupGhostUsers(), 2 * 60 * 1000)`
- There is no `roomRepository.isInReconnectionWindow()` method; the delay is enforced by the setTimeout itself

#### 3. Grace Period Check

```typescript
const isInGracePeriod = namespaceGracePeriodManager.isUserInGracePeriod(userId, roomId);
if (isInGracePeriod) {
  continue; // Skip user
}
```

- Users in reconnection grace period are skipped
- 60s for regular users, 30s for owners (TR-6)
- Managed by `NamespaceGracePeriodManager`

#### 4. Cross-Process Session Check

```typescript
const isActive = await roomSessionManager.isUserActiveInRoom(roomId, userId);
if (isActive) {
  continue; // User has valid session
}
// Ghost: remove user
await roomUserService.removeUserFromRoom(roomId, userId, true);
```

- Uses `RoomSessionManager.isUserActiveInRoom()` — checks Redis directly
- Works across multiple server processes/instances (multi-process safe)
- If session key is gone (deleted on disconnect), user is treated as ghost

### Protection Layer Summary

> **Note:** The previous "Owner Exception" pattern (owners were never cleaned up) has been **removed**. Owners are now treated equally and cleaned up if their Redis session is gone. The Room Age Check (30s) provides sufficient protection for the typical project-loading window.

| Layer | Scope | Duration | Purpose |
|-------|-------|----------|---------|
| **Reconnection Window** | All rooms | 2 minutes | Server restart survival |
| **Room Age Check** | Per room | 30 seconds | New room protection |
| **Grace Period** | Per user | 30-60s | Reconnection tolerance |
| **Cross-Process Session Check** | Per user | Instant | Redis-based liveness check |

---

## Future Enhancement: Option 1 (isInitializing Flag)

### Concept

Add `isInitializing: boolean` flag to Room entity to track initialization state explicitly.

### Implementation

```typescript
interface Room {
  // ... existing fields
  isInitializing: boolean;
}

// createRoom
room.isInitializing = true;
await roomRepository.saveRoom(room);

// handleJoinRoom (when owner joins)
if (user.id === room.owner && room.isInitializing) {
  room.isInitializing = false;
  await roomRepository.saveRoom(room);
}

// cleanupGhostUsers
if (room.isInitializing) {
  continue; // skip cleanup
}
```

### Benefits

- ✅ **Semantic clarity** — explicit initialization state
- ✅ **No time limit** — works for any project size
- ✅ **Extensible** — can be used for UI loading states, progress bars
- ✅ **Testable** — no timing dependencies

### Drawbacks

- ❌ **Requires Room entity changes** + Redis migration
- ❌ **State sync complexity** — must clear flag in all cases (success, error, timeout)
- ❌ **Redis overhead** — save room on every flag update
- ❌ **Edge cases** — stuck flags if owner never connects (need fallback timeout)
- ❌ **Larger refactor** — multiple files affected

### When to Implement

Consider Option 1 when:
- There's a requirement for initialization progress UI
- Time budget allows for larger refactor
- Semantic clarity is more important than quick fix
- Need to track initialization for other features (monitoring)

### Migration Path

1. Add `isInitializing` field to Room entity/interface
2. Update `RoomRepository` serialize/deserialize logic
3. Set `isInitializing = true` in `createRoom`
4. Clear flag in `handleJoinRoom` when owner joins
5. Add fallback timeout (e.g., 5 minutes) for stuck flags
6. Update `cleanupGhostUsers` to check flag
7. Add cleanup job for stuck `isInitializing` rooms
8. Test all edge cases (owner disconnect, timeout, error)

### Comparison: Option 1 vs Option 3 (Current)

| Criteria | Option 1 (isInitializing) | Option 3 (Owner Exception) |
|----------|---------------------------|----------------------------|
| **Complexity** | 🔴 High (5-6 files) | 🟢 Low (1 file) |
| **Risk** | 🔴 High (state sync) | 🟢 Low (isolated) |
| **Time to Deploy** | 🔴 1-2 days | 🟢 Immediate |
| **Solves Problem** | 🟢 100% | 🟢 100% |
| **Extensibility** | 🟢 Excellent | 🟡 Good |
| **Clarity** | 🟢 Very clear | 🟡 Acceptable |
| **Maintenance** | 🔴 High | 🟢 Low |

---

## Room Deletion Triggers

Rooms are deleted in the following scenarios:

### 1. Owner Leave (TR-8)

- **Intentional leave**: Immediate ownership transfer
- **Unintentional disconnect**: 10-second delay before transfer
- If no band member accepts ownership → room deleted

### 2. Empty Room

- All users leave → room deleted
- Dynamic namespace middleware checks (30s grace period)

### 3. Ghost Cleanup

- All users are ghosts (no active sockets) → room deleted
- After ghost user removal, if room is empty → cleanup

### 4. Manual Delete

- Room owner deletes room explicitly via API
- Triggers `RoomLifecycleService.deleteRoom()`

---

## Related Files

### Core Services
- `RoomLifecycleService.ts` — Room lifecycle operations, ghost cleanup
- `RoomCleanupService.ts` — Cleanup logic, grace period management
- `RoomLifecycleHandler.ts` — Socket event handlers (join, leave, create)
- `RoomRepository.ts` — Room persistence, reconnection window check

### Supporting Services
- `ProjectRoomService.ts` — Project↔Room mapping (BR-1)
- `NamespaceGracePeriodManager.ts` — Grace period tracking (TR-6)
- `RoomSessionManager.ts` — Socket session management

### Configuration
- `config/socket.ts` — `ROOM_GRACE_PERIOD_MS = 30_000`
- `SyncConfig.ts` — Shared constants

---

## Related Rules

### Business Rules (BR)
- **BR-1**: 1 Project = 1 Arrange Room
- **BR-2**: Project Owner Always Opens as Room Owner
- **BR-8**: Room Owner Leave → Auto-Transfer Ownership

### Technical Rules (TR)
- **TR-5**: Room Restart Survival (2-min reconnection window)
- **TR-6**: Grace Period (Owner 30s, Regular 60s)
- **TR-8**: Redis State TTL (24 hours)

---

## Testing

### Unit Tests

See `__tests__/RoomServiceGhostUser.test.ts`:
- Ghost user removal (`isUserActiveInRoom=false`)
- Stale session detection (cross-process)
- Active user protection (`isUserActiveInRoom=true`)
- **Equal owner treatment** (owners cleaned up if no session)
- **Non-owner cleanup** (old rooms)
- **Room age protection** (new rooms < 30s)

### Manual Testing

1. Create project with large audio files
2. Verify owner not cleaned up during load
3. Verify room not deleted before owner connects
4. Test with various project sizes (30s+, 60s+)

---

## Troubleshooting

### Owner Still Being Removed

Check:
1. Is `user.id === room.owner` check working?
2. Is owner in `bandMembers` or `audiences`?
3. Check logs for "Found ghost user - removing" with owner ID

### Room Deleted Too Early

Check:
1. Room age calculation correct?
2. Reconnection window active?
3. Dynamic namespace middleware grace period?

### Ghost Users Not Cleaned Up

Check:
1. Is `cleanupGhostUsers()` running? (2-min delay after start)
2. Are users actually ghosts? (check socket sessions)
3. Are they in grace period?
