---
name: debugging-realtime
description: How to systematically debug real-time sync issues — Socket.IO events, Redis state, mutex, collaborative locks, and reconnection.
---

# Debugging Real-Time Sync Issues

This skill provides a systematic approach to diagnosing and fixing real-time collaboration bugs.

## Symptom Categories

| Symptom | Likely Cause | Start Here |
|---------|-------------|------------|
| State not syncing to other users | Event not emitting/receiving, wrong broadcast method | Step 1-2 |
| State reverts after a moment | Race condition, missing mutex, stale Redis state | Step 3 |
| Lock stuck / can't edit | Lock TTL not expiring, user disconnect not cleaning up | Step 4 |
| State lost on reconnect | Reconnection reconciliation not working | Step 5 |
| Duplicate updates | Missing sender check, event listener registered twice | Step 6 |
| Lag / delayed updates | Rate limiting, throttle too aggressive, network | Step 7 |

## Debugging Steps

### Step 1: Verify Event Flow (FE → BE → FE)

**Frontend emit check:**
```typescript
// Add temporary logging in the hook/component that emits
console.log('[EMIT]', eventName, data);
socket.emit(eventName, data);
```

**Backend receive check:**
```typescript
// In the EventHandler (e.g., PerformEventHandler.ts)
socket.on('my_event', (data) => {
  console.log('[RECV]', 'my_event', socket.id, data);
  // ...
});
```

**Backend broadcast check:**
```typescript
// In the RoomHandler method
console.log('[BROADCAST]', eventName, roomId, data);
this.broadcast(namespace, roomId, eventSuffix, data);
// or
socket.to(roomId).emit(eventName, data);
```

**Frontend receive check:**
```typescript
// In the useEffect that listens
socket.on('my_event_done', (data) => {
  console.log('[RECV-FE]', 'my_event_done', data);
});
```

### Step 2: Check Event Name Matching

Common issue: FE emits `perform:my_action` but BE listens for `perform:my_action` with different casing or typo.

- Verify event names in `app/backend/src/shared/constants/EventNames.ts`
- Check that FE uses the exact same string
- Check that the EventHandler actually binds the event in `bindPerformEvents()` or `bindArrangeEvents()`

### Step 3: Check Redis State & Mutex

**Verify state is being saved:**
```typescript
// In the StateService method
async updateSomething(roomId: string, value: string) {
  const mutex = this.getRoomMutex(roomId);
  return await mutex.runExclusive(async () => {
    let state = await this.getState(roomId);
    console.log('[REDIS-BEFORE]', roomId, state);
    // ... update
    await this.saveState(roomId, updatedState);
    console.log('[REDIS-AFTER]', roomId, updatedState);
    return updatedState;
  });
}
```

**Common Redis issues:**
- Missing `mutex.runExclusive()` → race condition on concurrent updates
- State not initialized → `getState()` returns null, update fails silently
- Map serialization → `Map` objects don't serialize to JSON automatically; check `getState()`/`saveState()` handle Map ↔ Object conversion

### Step 4: Debug Collaborative Locks

Lock config: `LOCK_TTL_MS = 5 * 60 * 1000` (5 minutes) in `app/backend/src/shared/constants/SyncConfig.ts`

**Check lock state:**
```typescript
// In lockStore (FE)
console.log('[LOCKS]', useLockStore.getState().locks);
```

**Lock not releasing:**
1. Check if `lock_release` event is being emitted on deselect/blur
2. Check if `handleUserLeave()` cleans up locks for disconnected users
3. Check if lock TTL is being enforced (locks older than 5 min should be overridable)

**Lock conflict:**
- `arrange:lock_conflict` event is emitted when a user tries to edit a locked resource
- FE should show a lock indicator and prevent editing

### Step 5: Debug Reconnection

On socket reconnect, the FE should:
1. Clear local locks
2. Request fresh state (`perform:request_state` or `arrange:request_state`)
3. Re-apply received state

**Check reconnection flow:**
```typescript
// In the socket connection hook
socket.on('connect', () => {
  console.log('[RECONNECT] Socket reconnected, requesting fresh state');
});

socket.on('perform:state_sync', (data) => {
  console.log('[STATE-SYNC]', data);
});
```

**Common reconnection issues:**
- Stale event listeners from previous connection (not cleaned up in `useEffect` return)
- Race condition between reconnect and state request
- `RoomSocketManager` handles `join_room` directly after connect — if this fails, user is in limbo

### Step 6: Debug Duplicate Updates

**Sender check missing:**
```typescript
// WRONG — applies own updates twice (once locally, once from socket)
socket.on('item_updated', (data) => {
  store.syncUpdateItem(data.itemId, data.updates);
});

// CORRECT — skip own updates
socket.on('item_updated', (data) => {
  if (data.userId === currentUserId) return;
  store.syncUpdateItem(data.itemId, data.updates);
});
```

**Note**: For **commit events** (broadcast via `namespace.to()` which includes sender), the sender SHOULD receive the event as confirmation. The FE should handle this appropriately — either skip it or use it to confirm the commit.

**Duplicate listeners:**
- Ensure `useEffect` cleanup removes listeners: `return () => { socket.off(...) }`
- Check that the hook isn't re-mounting unnecessarily (missing/wrong dependency array)

### Step 7: Debug Performance / Lag

**Rate limiting:**
- Check if events are being rate-limited: look for `Rate limit exceeded` errors in console
- Check `socketRateLimits` in `app/backend/src/middleware/rateLimit.ts`

**Throttle settings:**
- Ephemeral events throttled at `EPHEMERAL_THROTTLE_MS = 33ms` (~30fps)
- If updates feel laggy, check if throttle is too aggressive for the use case

**Network:**
- Use browser DevTools → Network → WS tab to inspect Socket.IO frames
- Check ping/latency via `ping_measurement` / `ping_response` events

## Broadcasting Strategy Quick Reference

| Pattern | Method | Sender receives? | Use case |
|---------|--------|-------------------|----------|
| Mutation | `socket.to(roomId).emit()` | No | Note play, ephemeral knob/slider |
| Commit | `namespace.to(roomId).emit()` | Yes | Final state commit, lock acquire |
| Direct | `socket.emit()` | Only sender | Error, state sync response |
| Broadcast helper | `this.broadcast(ns, roomId, suffix, data)` | Yes (uses `namespace.to()`) | Standard room events |

**⚠️ Note**: `BaseRoomHandler.broadcast()` uses `namespace.to()` (includes sender). For ephemeral events that should exclude sender, use `socket.to()` directly.

## Useful Log Points

Add these temporarily when debugging:

```typescript
// BE: Log all events for a room
socket.onAny((eventName, ...args) => {
  console.log(`[SOCKET ${socket.id}] ${eventName}`, args);
});

// FE: Log all incoming events
socket.onAny((eventName, ...args) => {
  console.log(`[WS-IN] ${eventName}`, args);
});
```

## WebRTC Voice Debug

> Read the `webrtc-voice` skill first — this section focuses specifically on debug scenarios.

### Symptom → Cause Table

| Symptom | Likely Cause |
|---------|-------------|
| Can't hear others at all | ICE connection failed, TURN server unreachable |
| One-way audio | Incomplete offer/answer negotiation, tracks not added on both sides |
| Audio cuts out after reconnect | Old MediaStream closed but still trying to use old tracks |
| Signaling race condition | Simultaneous offers crossing each other in Full Mesh |

### ICE Connection Debug

```typescript
// Monitor ICE state
peerConnection.oniceconnectionstatechange = () => {
  console.log('[ICE]', peerConnection.iceConnectionState);
  // Expected: checking → connected → completed
  // If "failed" → potential TURN server issue
};

peerConnection.onicegatheringstatechange = () => {
  console.log('[ICE-GATHER]', peerConnection.iceGatheringState);
};

// Inspect gathered candidates
peerConnection.onicecandidate = ({ candidate }) => {
  console.log('[CANDIDATE]', candidate?.type, candidate?.address);
  // srflx = STUN reflexive, relay = TURN
  // If only "host" candidates exist → STUN/TURN not working
};
```

### Signaling Race Condition (Full Mesh)

In Full Mesh, when user C joins a room with A and B already present:
- C must create an offer to **both** A and B.
- A and B must send back an answer.
- If A/B also send an offer to C at the same time → simultaneous offer → tiebreaker logic is required.

```typescript
// Debug: log all signaling events
socket.on('webrtc:offer', (data) => {
  console.log('[SIGNAL] offer from', data.fromSocketId, '→ me');
});
socket.on('webrtc:answer', (data) => {
  console.log('[SIGNAL] answer from', data.fromSocketId, '→ me');
});
socket.on('webrtc:ice_candidate', (data) => {
  console.log('[SIGNAL] ICE from', data.fromSocketId);
});
```

**Key reminder**: The server acts as a forwarder — if signaling events aren't reaching the destination, check socket room membership first.

### No Audio After Reconnect

```
1. Verify that the old PeerConnection has been `.close()`ed.
2. Ensure a new MediaStream is obtained via `getUserMedia`, not reusing old tracks.
3. Confirm renegotiation actually occurred (new offer/answer cycle).
4. Check AudioContext state — it may need a `.resume()` after a page visibility change.
```

---

## Running Backend for Debug Sessions

Use when you need to observe BE logs alongside FE actions (e.g., during E2E debug or realtime sync investigation).

### 1. Check SSL Before Running

```bash
# Check SSL_ENABLED in app/backend/.env
# false → http://localhost:3001
# true  → https://localhost:3001
```

### 2. Run Backend

```bash
# Localhost only (normal)
cd app/backend && bun run start:dev

# Exposed to network (for other devices)
cd app/backend && bun run start:dev --host
# Find your IP: ipconfig getifaddr en0
```

For more verbose output, set `LOG_LEVEL=debug` in `app/backend/.env`.

### 3. Filter Logs

```bash
# Socket events only
bun run start:dev 2>&1 | grep -i "socket\|event\|emit\|join\|leave"

# Room lifecycle only
bun run start:dev 2>&1 | grep -i "room\|lifecycle\|cleanup\|switch"

# Errors and warnings only
bun run start:dev 2>&1 | grep -iE "error|warn|exception|fail"

# Save to file for timeline comparison with Playwright
bun run start:dev 2>&1 | tee /tmp/app-backend.log
# Then in another terminal:
tail -f /tmp/app-backend.log
```

### 4. Health Check

```bash
curl http://localhost:3001/health
# or if SSL_ENABLED=true:
curl -k https://localhost:3001/health
```

---

## Reference Files

- Event names: `app/backend/src/shared/constants/EventNames.ts`
- Sync config: `app/backend/src/shared/constants/SyncConfig.ts`
- Rate limits: `app/backend/src/middleware/rateLimit.ts`
- Base room handler: `app/backend/src/shared/infrastructure/handlers/BaseRoomHandler.ts`
- Lock store (FE): `app/frontend/src/features/rooms/arrange/stores/lockStore.ts`
- WebSocket docs: `docs/WS_CONTRACT.md`
- WebRTC skill: `.claude/skills/webrtc-voice/SKILL.md`
