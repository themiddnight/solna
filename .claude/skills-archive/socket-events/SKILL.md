---
name: socket-events
description: How to add or modify Socket.IO real-time events across Frontend and Backend, including the ephemeral/commit pattern, broadcasting strategy, and rate limiting.
---

# Adding / Modifying Socket.IO Events

This skill covers the full flow of adding a new real-time event to the murva application.

## Key Concepts

- **Commands (Client → Server)**: Imperative verbs — `create_room`, `bpm_change`
- **Events (Server → Client)**: Past tense — `room_created`, `bpm_changed`
- **Domain Prefixes**: `perform:*` for Perform Room, `arrange:*` for Arrange Room, no prefix for shared events
- **Ephemeral events**: High-frequency updates (knob/slider/drag) — broadcast only, NO Redis write
- **Commit events**: Final state after interaction ends — saved to Redis + broadcast to ALL (including sender)
- **Broadcasting strategy**:
  - Mutation events: `socket.to(roomId)` — excludes sender
  - Commit/lock events: `namespace.to(roomId)` — includes sender (for confirmation)

## Step-by-Step: Adding a New Event

### 1. Define Event Names (Backend)

File: `app/backend/src/shared/constants/EventNames.ts`

Add your event to the appropriate category constant:
- `SHARED_EVENTS` — universal room events (no prefix)
- `PERFORM_EVENTS` — perform room events (`perform:` prefix)
- `ARRANGE_EVENTS` — arrange room events (`arrange:` prefix)
- `METRONOME_EVENTS`, `VOICE_EVENTS` — specialized events

```typescript
// Example: Adding a new perform event
export const PERFORM_EVENTS = {
  // Client -> Server (command)
  MY_NEW_ACTION: 'perform:my_new_action',
  
  // Server -> Client (event)
  MY_NEW_ACTION_DONE: 'perform:my_new_action_done',
  
  // If ephemeral/commit pattern:
  MY_PARAM_UPDATE: 'perform:my_param_update',       // ephemeral (Client -> Server)
  MY_PARAM_COMMIT: 'perform:my_param_commit',       // commit (Client -> Server)
  MY_PARAM_CHANGED: 'perform:my_param_changed',     // ephemeral broadcast (Server -> Client)
  MY_PARAM_COMMITTED: 'perform:my_param_committed', // commit broadcast (Server -> Client)
};
```

### 2. Add Rate Limiting (Backend)

File: `app/backend/src/middleware/rateLimit.ts`

Add rate limit config to `socketRateLimits`:

```typescript
// Ephemeral events: 3600/min (60/sec — throttle 30/s + 2x safety)
'perform:my_param_update': {
  maxEvents: 3600,
  windowMs: 60 * 1000,
  eventType: 'general'
},
// Commit events: 600/min (10/sec)
'perform:my_param_commit': {
  maxEvents: 600,
  windowMs: 60 * 1000,
  eventType: 'general'
},
```

Rate limit tiers:
- **Note events**: 3600/min (60/sec)
- **Ephemeral (knob/slider/drag)**: 3600/min (60/sec)
- **Commit events**: 600/min (10/sec)
- **Chat**: 30/min
- **General (instrument change, etc.)**: 120/min
- **Room lifecycle**: 5-20/min

### 3. Add Handler Method (Backend)

**For Perform Room**: `app/backend/src/domains/perform-room/infrastructure/handlers/PerformRoomHandler.ts`
**For Arrange Room**: `app/backend/src/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler.ts`

Both extend `BaseRoomHandler` which provides:
- `this.validateSession(socket, roomId)` — validates user session
- `this.broadcast(namespace, roomId, eventSuffix, data)` — broadcasts via `namespace.to()` with event prefix
- `this.handleError(socket, error, context, roomId)` — error handling
- `this.stateService` — Redis state service (with per-room mutex)

```typescript
// Standard event (mutation → Redis + broadcast)
async handleMyAction(socket: Socket, namespace: Namespace, data: { roomId: string; value: string }): Promise<void> {
  const session = await this.validateSession(socket, data.roomId);
  if (!session) return;

  try {
    await this.stateService.updateSomething(data.roomId, data.value);
    this.broadcast(namespace, data.roomId, 'my_action_done', {
      userId: session.userId,
      value: data.value,
    });
  } catch (error) {
    this.handleError(socket, error as Error, 'Handler.handleMyAction', data.roomId);
  }
}

// Ephemeral event (broadcast only, NO Redis)
async handleMyParamUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; params: any }): Promise<void> {
  const session = await this.validateSession(socket, data.roomId);
  if (!session) return;
  // Ephemeral: socket.to() excludes sender
  socket.to(data.roomId).emit('perform:my_param_changed', {
    userId: session.userId,
    params: data.params,
  });
}

// Commit event (Redis write + namespace broadcast includes sender)
async handleMyParamCommit(socket: Socket, namespace: Namespace, data: { roomId: string; params: any }): Promise<void> {
  const session = await this.validateSession(socket, data.roomId);
  if (!session) return;
  try {
    await this.stateService.updateUserState(data.roomId, session.userId, { myParams: data.params });
    // Commit: namespace.to() includes sender for confirmation
    namespace.to(data.roomId).emit('perform:my_param_committed', {
      userId: session.userId,
      params: data.params,
    });
  } catch (error) {
    this.handleError(socket, error as Error, 'Handler.handleMyParamCommit', data.roomId);
  }
}
```

### 4. Bind Event in EventHandler (Backend)

**Perform**: `app/backend/src/domains/perform-room/infrastructure/handlers/PerformEventHandler.ts`
**Arrange**: `app/backend/src/domains/arrange-room/infrastructure/handlers/ArrangeEventHandler.ts`

> **Room-level / shared events** (join/leave, chat, voice, ownership, roles, approval — anything
> in `SHARED_EVENTS` / `VOICE_EVENTS` rather than `PERFORM_EVENTS`/`ARRANGE_EVENTS`) are bound in
> `app/backend/src/shared/infrastructure/handlers/NamespaceEventHandlers.ts` via the one-line
> `bindSecure` helper — pass the event name, its Zod schema from `@jam-band/shared` (or `null`
> for schema-less payloads), and the handler; it wraps `secureSocketEvent` (validation + rate
> limiting + logging, TR-33) for you:
>
> ```typescript
> this.bindSecure(socket, SHARED_EVENTS.MY_EVENT, myEventSchema,
>   (socket, data) => this.myHandler.handleMyEvent(socket, data, namespace));
> ```
>
> Grep `bindSecure` in that file to list the full room-level contract. Do NOT hand-roll
> `socket.on` + `secureSocketEvent` there.

```typescript
// In bindPerformEvents() or bindArrangeEvents():
socket.on(PERFORM_EVENTS.MY_NEW_ACTION, (data) => {
  this.performRoomHandler.handleMyAction(socket, namespace, { ...data, roomId });
});

// With rate limiting:
socket.on(PERFORM_EVENTS.MY_NEW_ACTION, (data) => {
  const rateLimitCheck = checkSocketRateLimit(socket, PERFORM_EVENTS.MY_NEW_ACTION);
  if (!rateLimitCheck.allowed) {
    socket.emit('error', {
      message: `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} seconds.`,
      retryAfter: rateLimitCheck.retryAfter
    });
    return;
  }
  this.performRoomHandler.handleMyAction(socket, namespace, { ...data, roomId });
});
```

### 5. Emit from Frontend

In the relevant hook or store, emit the event via socket:

```typescript
// In a hook (e.g., usePerformRoomSync.ts or useArrangeCollaboration.ts):
const emitMyAction = useCallback((value: string) => {
  if (!socket || !roomId) return;
  socket.emit('perform:my_new_action', { roomId, value });
}, [socket, roomId]);
```

For ephemeral/commit pattern on FE, use throttle for ephemeral and debounced commit:

```typescript
import { EPHEMERAL_THROTTLE_MS } from '@shared/constants/SyncConfig';
import { throttle } from 'lodash';

// Ephemeral: throttled at ~30fps + volatile flag so stale frames aren't buffered
// when socket briefly disconnects (dropped silently rather than queued).
const emitParamUpdate = useMemo(
  () => throttle((params: any) => {
    socket?.volatile.emit('perform:my_param_update', { roomId, params });
  }, EPHEMERAL_THROTTLE_MS),
  [socket, roomId]
);

// Commit: on interaction end (mouseup, pointerup, etc.)
// Do NOT use volatile here — commits must be delivered reliably.
const emitParamCommit = useCallback((params: any) => {
  socket?.emit('perform:my_param_commit', { roomId, params });
}, [socket, roomId]);
```

#### Volatile vs. Non-Volatile

| Event type | Flag | Behaviour |
|---|---|---|
| Ephemeral (knob/drag/cursor) | `socket.volatile.emit()` | Dropped if transport not ready — prevents stale frame pile-up on reconnect |
| Commit / lifecycle | `socket.emit()` | Buffered and delivered after reconnect (Socket.IO default) |

Use `socket.volatile.emit()` whenever stale data at delivery time would be wrong (position snapshots, knob values mid-drag). Never use it for commits, room join/leave, or anything that must arrive exactly once.

#### Acknowledgements for Critical Events (v4.4.0+)

For room lifecycle or writes where you need delivery confirmation:

```typescript
// Promise-based — await the server's ack, throws if timeout exceeded
try {
  const result = await socket.timeout(5000).emitWithAck('room:create', { name });
  // result = whatever the server cb passed back
} catch (err) {
  // Server did not ack within 5 s
}

// Callback-based
socket.timeout(5000).emit('room:create', { name }, (err, result) => {
  if (err) { /* timeout */ } else { /* success */ }
});
```

Only use ack for critical one-shot writes. High-frequency events must **never** use ack — it adds per-event RTT overhead.

### 6. Listen on Frontend

In the relevant hook, listen for the server event:

```typescript
useEffect(() => {
  if (!socket) return;

  const handleMyActionDone = (data: { userId: string; value: string }) => {
    // Update local state/store
    someStore.getState().updateValue(data.value);
  };

  socket.on('perform:my_action_done', handleMyActionDone);
  return () => {
    socket.off('perform:my_action_done', handleMyActionDone);
  };
}, [socket]);
```

### 7. Update State Service if Needed (Backend)

If the event modifies Redis state, add a method to the state service:

**Perform**: `app/backend/src/domains/perform-room/application/PerformRoomStateService.ts`
**Arrange**: `app/backend/src/domains/arrange-room/application/ArrangeRoomStateService.ts`

Both extend `BaseRoomStateService` which provides per-room mutex via `this.getRoomMutex(roomId)`:

```typescript
async updateSomething(roomId: string, value: string): Promise<PerformRoomState> {
  const mutex = this.getRoomMutex(roomId);
  return await mutex.runExclusive(async () => {
    let state = await this.getState(roomId);
    if (!state) state = await this.initializeState(roomId);
    const updatedState = { ...state, something: value, lastUpdated: new Date() };
    await this.saveState(roomId, updatedState);
    return updatedState;
  });
}
```

## Connection State Recovery (v4.6.0)

Socket.IO can optionally buffer missed events server-side and replay them on reconnect:

```typescript
// Backend — enable on Server init
const io = new Server(server, {
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 min window
    skipMiddlewares: true,
  }
});
```

When recovery succeeds, `socket.recovered === true` and the client receives all missed events automatically without needing a full re-sync. This is **not currently used** in this project (we rebuild state from Redis on reconnect instead), but worth knowing if the Redis re-sync approach becomes a bottleneck.

---

## Common Pitfalls

1. **Forgetting mutex**: Always use `mutex.runExclusive()` for Redis read-modify-write operations
2. **Wrong broadcast method**: Use `socket.to()` for ephemeral, `namespace.to()` for commit/lock
3. **Missing rate limit**: Add rate limit config for any new event, especially high-frequency ones
4. **Event name mismatch**: Ensure FE emit name matches BE `socket.on()` name exactly
5. **Missing cleanup**: If event creates state, handle cleanup in `handleUserLeave()`
6. **Volatile on commits**: `socket.volatile.emit()` is drop-on-disconnect — never use for commits, acks, or lifecycle events
7. **Ack on high-frequency events**: `emitWithAck()` adds per-event RTT — only for critical one-shot writes

## Doc Update (Mandatory)

After adding or modifying any Socket.IO event, update `docs/WS_CONTRACT.md` before closing the task.

| Change | What to update in WS_CONTRACT.md |
|---|---|
| New event | Add full entry: event name, namespace, direction (C→S / S→C), payload schema, ephemeral/commit classification |
| Changed payload shape | Update the payload schema (field names, types, optional vs required) |
| Changed behavior (ephemeral ↔ commit) | Update the classification table and the behavior description |
| Removed event | Remove the entry |
| New shared constant (EventNames, SyncConfig) | Update `docs/CONSTANTS.md` as well |

If the event name is new, also confirm it is added to `EventNames.ts` in the shared package and both FE and BE reference the constant (TR-14).

---

## Reference Files

- Event names: `shared/src/constants/EventNames.ts`
- Rate limits: `app/backend/src/middleware/rateLimit.ts`
- Sync config: `shared/src/constants/SyncConfig.ts`
- Base handler: `app/backend/src/shared/infrastructure/handlers/BaseRoomHandler.ts`
- WebSocket docs: `docs/WS_CONTRACT.md`
