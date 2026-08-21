---
name: bug-fixing
description: Systematic approach to diagnosing and fixing bugs in the murva application — covers UI, audio, real-time sync, API, and database issues.
---

# Bug Fixing Guide

When a bug is reported, follow this systematic process to diagnose and fix it.

## Phase 0: Check Rules & Constraints

Before debugging, verify the reported behavior isn't actually **by design**.

1. Read **`docs/RULES_AND_CONSTRAINTS.md`** to check if the behavior matches an existing rule or foundational concept.
2. **Foundational Concepts (FC)**: e.g., Perform Room vs Arrange Room have completely different state models and event sets — a "missing feature" might simply not apply to that room type.
3. **Business Rules (BR)**: e.g., "1 project = 1 active Arrange Room" means a 409 on duplicate room creation is expected.
4. **Technical Rules (TR)**: e.g., ephemeral events not persisting to Redis is by design, not a data loss bug.

If the behavior matches a rule → it's not a bug. Explain the rule to the reporter.

## Phase 1: Classify the Bug

Determine which category the bug falls into, then jump to the relevant section:

| Category | Symptoms | Go to |
|----------|----------|-------|
| **Real-time sync** | State not syncing, stale data, lock stuck | → Use `debugging-realtime` skill |
| **Audio / Effects** | No sound, wrong sound, effect not working, latency | → Section A below |
| **UI / React** | Component not rendering, wrong state, crash | → Section B below |
| **API / Network** | 4xx/5xx errors, request failing, CORS | → Section C below |
| **Database** | Data not persisting, wrong data returned | → Section D below |
| **Socket connection** | Can't join room, disconnect, timeout | → Section E below |
| **Auth** | Login failing, token expired, permission denied | → Section F below |

## Phase 2: Reproduce & Locate

Before writing any fix:

1. **Reproduce the bug** — get exact steps to trigger it
2. **Check browser console** (FE) and **server logs** (BE) for errors
3. **Identify the layer** where the bug originates:
   - Is it a FE-only issue (UI, store, hook)?
   - Is it a BE-only issue (handler, service, Redis)?
   - Is it a communication issue (socket event, API call)?
4. **Find the root cause file(s)** — use `code_search` or `grep_search` to locate relevant code

### Quick Diagnostic Commands

```bash
# Check if backend is running
curl http://localhost:3001/health

# Check frontend dev server
curl http://localhost:5173

# Check Redis connection (from backend)
# Look for Redis connection logs in backend console

# Run tests to check for regressions
cd app/frontend && bun run test
cd app/backend && bun test -- tests/
```

## Phase 3: Fix by Category

### Section A: Audio / Effects Bugs

**Key files to check:**
- Audio config: `app/frontend/src/features/audio/constants/audioConfig.ts`
- Effect mappings: `app/frontend/src/features/effects/services/effectMappings.ts`
- Effect integration: `app/frontend/src/features/effects/services/effectsIntegration.ts`
- Individual effects: `app/frontend/src/features/effects/<effect-name>/`
- Instruments: `app/frontend/src/features/instruments/`

**Common audio bugs:**
- **No sound** → Check `AudioContext.state` (must be "running"), check Tone.js started, check master bus gain > 0
- **Wrong notes** → Check scale mapping, check instrument mode (Basic/Melody/Chord)
- **Effect not applying** → Check effect chain connection order, check wet/dry mix
- **Audio glitches** → Check polyphony limits, check buffer size, check CPU usage
- **Latency** → Check `AUDIO_CONFIG` settings, check WebRTC priority mode

**Debug in browser console:**
```javascript
// Check audio context
Tone.getContext().rawContext.state  // should be "running"

// Check master output
Tone.getDestination().volume.value  // should not be -Infinity
```

### Section B: UI / React Bugs

**Key files to check:**
- Zustand stores: `app/frontend/src/features/rooms/arrange/stores/`
- Shared stores: `app/frontend/src/shared/stores/`
- Feature components: `app/frontend/src/features/<feature>/components/`
- Feature hooks: `app/frontend/src/features/<feature>/hooks/`

**Common UI bugs:**
- **Component not updating** → Check Zustand selector (is it returning a new reference?), check `useEffect` dependencies
- **Stale state in callback** → Use `useMyStore.getState()` instead of closure variable in socket listeners
- **Infinite re-render** → Check `useEffect` dependency array, check if creating new objects/arrays in render
- **State lost on navigation** → Check if store is being cleared on route change, check if `clearRoom()` is called too early
- **Mobile layout broken** → Check responsive breakpoints, check mobile-specific components

**Debug approach:**
1. React DevTools → Components tab → inspect state/props
2. React DevTools → Profiler → find unnecessary re-renders
3. Add `console.log` in the store action or `useEffect` to trace state flow

### Section C: API / Network Bugs

**Key files to check:**
- Route definitions: `app/backend/src/routes/index.ts`
- Feature routes: `app/backend/src/routes/<feature>.ts`
- Auth middleware: `app/backend/src/domains/auth/infrastructure/middleware/authMiddleware.ts`
- Validation: `app/backend/src/validation/schemas.ts`
- API docs: `docs/API_CONTRACT.md`

**Common API bugs:**
- **401 Unauthorized** → Token expired, missing `authenticateToken` middleware, wrong token format
- **403 Forbidden** → User doesn't have permission (check role, ownership)
- **404 Not Found** → Route not registered in `index.ts`, wrong HTTP method, wrong path
- **400 Bad Request** → Validation failing (check Zod schema), missing required fields
- **500 Internal Error** → Check server logs, likely unhandled exception in service/repository
- **CORS error** → Check `FRONTEND_URL` in backend `.env`, check `allowedOrigins` config

**Debug approach:**
1. Browser DevTools → Network tab → inspect request/response
2. Check backend console for error logs
3. Test endpoint directly with `curl` or Postman

### Section D: Database Bugs

**Key files to check:**
- Prisma schema: `app/backend/prisma/schema.prisma`
- Repositories: `app/backend/src/domains/<domain>/infrastructure/repositories/`
- Database docs: `app/backend/docs/DATABASE.md`

**Common database bugs:**
- **Data not saving** → Check Prisma query, check transaction, check unique constraints
- **Wrong data returned** → Check query filters, check `include`/`select` clauses
- **Migration error** → Run `bunx prisma migrate status`, check for pending migrations
- **Relation error** → Check foreign key references, check `onDelete` behavior

**Debug approach:**
```bash
# Open Prisma Studio to inspect data
cd app/backend && bunx prisma studio

# Check migration status
cd app/backend && bunx prisma migrate status
```

**Important**: Room state (tracks, regions, notes, effects) is in **Redis**, NOT Postgres. If the bug is about room state, check Redis via the StateService, not Prisma.

### Section E: Socket Connection Bugs

**Key files to check:**
- FE socket hook: `app/frontend/src/features/audio/hooks/useRoomSocket.ts`
- FE socket context: `app/frontend/src/features/rooms/shared/contexts/`
- BE socket setup: `app/backend/src/index.ts`
- BE room lifecycle: `app/backend/src/domains/room-management/infrastructure/handlers/RoomLifecycleHandler.ts`
- Event names: `app/backend/src/shared/constants/EventNames.ts`

**Common socket bugs:**
- **Can't connect** → Check `VITE_SOCKET_URL`, check CORS, check backend is running
- **Joins room but no events** → Check namespace path (`/room/${roomId}`), check event binding in EventHandler
- **Disconnects randomly** → Check ping timeout, check rate limiting, check server memory
- **Events not received** → Check event name spelling, check room membership, check broadcasting method

**Debug approach:**
```javascript
// FE: Monitor all socket events
socket.onAny((event, ...args) => console.log('[WS]', event, args));

// FE: Check connection state
socket.connected  // true/false
socket.id         // socket ID
```

### Section F: Auth Bugs

**Key files to check:**
- Auth routes: `app/backend/src/routes/auth.ts`
- Auth controller: `app/backend/src/domains/auth/infrastructure/controllers/AuthController.ts`
- Auth service: `app/backend/src/domains/auth/domain/services/AuthService.ts`
- Auth middleware: `app/backend/src/domains/auth/infrastructure/middleware/authMiddleware.ts`
- FE auth: `app/frontend/src/features/auth/`
- FE user store: `app/frontend/src/shared/stores/userStore.ts`

**Common auth bugs:**
- **Login fails** → Check credentials, check password hash, check user exists
- **Token expired** → Check refresh token flow, check token expiry config
- **Guest can't access** → Check `isUserRestricted()` logic, check route guards
- **OAuth fails** → Check Google OAuth config, check callback URL, check strategy setup

## Phase 4: Verify the Fix

1. **Reproduce the original bug** — confirm it existed
2. **Apply the fix** — minimal change, root cause only
3. **Test the fix** — confirm bug is resolved
4. **Check for regressions** — run related tests
5. **Test edge cases** — empty state, concurrent users, reconnection

```bash
# Run relevant tests
cd app/frontend && bun run test
cd app/backend && bun test -- tests/
```

## Related Skills

- **`debugging-realtime`** — Deep dive into real-time sync issues (Redis, mutex, locks, reconnection)
- **`socket-events`** — Understanding socket event flow and patterns
- **`audio-engine`** — Audio architecture and effect chain details
- **`testing`** — How to write regression tests for the fix
the fix
