---
name: testing
description: How to write and run tests for the murva project — test commands, file conventions, mocking strategies, anti-patterns to avoid, and real examples that actually test code.
---

# Testing Guide

## Test Commands

Tests are layered into four tiers — full model in [`docs/TESTING.md`](../../../docs/TESTING.md).

```bash
# --- Tiers (canonical, from monorepo root) ---
bun run test:static      # Tier 1 — type + lint (incl. boundaries) + knip + build
bun run test:unit        # Tier 2a — Shared + BE + FE unit tests (no infra)
bun run test:integration # Tier 2b — BE + FE integration (needs Redis + Postgres)
bun run test:regression  # Tier 2c — BE + FE regression-category tests
bun run test:e2e:all     # Tier 3 — e2e sequential + webrtc (backend on :3001)
bun run test:full        # Tier 4 — everything; run before merging to develop

# Hook target + fast local loop
bun run gate:prepush     # Tier 1 + unit (what pre-push runs)
bun run test:local:gate  # static + unit + e2e:fast (quick pre-work check; backend needed for E2E)

# Individual pieces
bun run type          # Shared + BE + FE type-check
bun run lint          # Shared + BE + FE lint
bun run test:e2e:fast # Optimized E2E: auth parallel, room serial, realtime parallel, project serial
bun run test:fe       # Frontend only    bun run test:be   # Backend only

# Back-compat aliases: test:gate/test:push → test:full · test:push:light → gate:prepush

# E2E targeted runs
cd app/frontend && bun run test:e2e:room:w1
cd app/frontend && bun run test:e2e:parallel:realtime
cd app/frontend && bun run test:e2e:parallel:project

# Run specific test file
cd app/frontend && bun run test -- src/features/effects/__tests__/effectsStore.test.ts
cd app/backend && bun run test:related -- src/domains/arrange-room/__tests__/integration.test.ts

# Watch mode (FE)
cd app/frontend && bun run test -- --watch

# Run with coverage
cd app/frontend && bun run test -- --coverage
cd app/backend && bun run test:coverage
```

## Git Hooks

- `pre-commit`: `lint-staged` — ESLint on staged files only, per workspace (fast).
- `pre-push`: `bun run gate:prepush` — Tier 1 (`test:static`) + Tier 2a (`test:unit`); infra-free.

Do not put integration or E2E in Husky hooks. They are too slow / infra-dependent for normal push cadence — run `bun run test:full` manually before merging to `develop`. See [`docs/TESTING.md`](../../../docs/TESTING.md).

## Test File Conventions

- **Location**: `__tests__/` folder inside the feature/domain directory
- **Naming**: `<name>.test.ts` or `<name>.test.tsx` (for React components)
- **Types**:
  - `*.test.ts` — Unit tests (single function/module, minimal mocks)
  - `*.integration.test.ts` — Integration tests (multiple modules working together, real handler instances with mocked infrastructure)
  - `*.regression.test.ts` — Regression tests (each test documents a real bug that was fixed)

### Frontend (Vitest)

```
app/frontend/src/features/<feature>/__tests__/
├── myFeature.test.ts              # Unit test — test pure utils, store actions
├── myFeature.integration.test.ts  # Integration test — multiple stores/handlers together
├── MyComponent.test.tsx           # Component test — UI component renders/interactions
└── myFeature.regression.test.ts   # Regression test — each test documents a real bug
```

### Backend (Jest)

> Backend runs on **Jest**, never Bun's runner — `bun test` in `app/backend` is blocked by a
> bunfig preload guard (Jest mock factories don't apply under Bun → false failures). Always use
> `bun run test:unit` / `bun run test:integration` / `bun run test`.

```
app/backend/src/domains/<domain>/__tests__/
├── myService.test.ts              # Unit test — pure functions, single service
├── myHandler.test.ts              # Handler test — real handler + mocked Socket/Redis
└── myService.regression.test.ts   # Regression test — each test documents a real bug

app/backend/src/__tests__/integration/
└── EventFlowIntegration.test.ts   # Full event flow — multiple handlers, real state transitions
```

---

## Mocking socket.io (frontend)

Do **not** scatter `as unknown as Socket` casts across tests. `socket.io-client`'s `Socket` is a huge interface, so a structural mock always needs a cast — but per **TR-27** that cast must not be repeated everywhere. Use the shared helper in `app/frontend/src/test-utils/mockSocket.ts`, which confines the single unavoidable cast to one place:

```typescript
import { createMockSocket, asMockSocket } from '@/test-utils/mockSocket';

const socket = createMockSocket();                 // typed mock: .emit/.on/.off/.to are vi.fn(); + .trigger(event, ...args)
renderHook(() => useThing({ socket: asMockSocket(socket) }));

socket.trigger('arrange:state_sync', payload);     // drive a registered on() handler
expect(socket.emit).toHaveBeenCalledWith('arrange:track_add', { /* ... */ });
```

- `createMockSocket()` returns a `MockSocket` (so you can assert on the `vi.fn()` mocks and call `trigger`).
- `asMockSocket(mock)` casts it to `Socket` **only** at the boundary where code under test needs a real `Socket`.
- Tests with richer needs (e.g. WebRTC) may keep their own local mock object and still pass it through `asMockSocket(localMock)` — the helper accepts any object, so the `as unknown as Socket` lives in exactly one file.

---

## The Golden Rule

**Every test must call real project code. If a test could pass by deleting all the code it claims to test, it is not a test — it is theater.**

This means:
- Do not mock out the function you're testing
- Do not assert only on `expect(mockFunction).toHaveBeenCalledWith()` without checking what actually changed
- Do not test plain inline objects with no connection to your codebase
- Do not write `expect(true).toBe(true)`

A good test imports real code, calls it, and verifies it worked.

---

## What Makes a Good Test (by Category)

### Zustand Stores

**Pattern**: Import the store, reset state in `beforeEach`, call actions directly, read state via `getState()`.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useEffectsStore } from '../stores/effectsStore';

describe('Effects Store', () => {
  beforeEach(() => {
    useEffectsStore.setState({
      effects: [],
      activeEffectId: null,
      // Reset to initial state
    });
  });

  it('should add an effect to the chain', () => {
    const { addEffect, getState } = useEffectsStore;

    addEffect({ id: 'rev1', type: 'reverb', wet: 0.3 });

    const state = getState();
    expect(state.effects).toHaveLength(1);
    expect(state.effects[0].type).toBe('reverb');
    expect(state.effects[0].wet).toBe(0.3);
  });

  it('should update effect parameter', () => {
    useEffectsStore.getState().addEffect({ id: 'rev1', type: 'reverb', wet: 0.3 });

    useEffectsStore.getState().updateEffect('rev1', { wet: 0.8 });

    const effect = useEffectsStore.getState().effects[0];
    expect(effect.wet).toBe(0.8);
  });

  it('should remove an effect', () => {
    useEffectsStore.getState().addEffect({ id: 'rev1', type: 'reverb', wet: 0.3 });

    useEffectsStore.getState().removeEffect('rev1');

    expect(useEffectsStore.getState().effects).toHaveLength(0);
  });
});
```

**Why this is good:**
- No mocks of the store itself
- Calls real `addEffect`, `updateEffect`, `removeEffect` actions
- Reads state with real `getState()` and verifies properties changed
- Each test documents one action and its expected result

### Pure Utility Functions

**Pattern**: Import the function, call it directly with test inputs, assert on output.

```typescript
import { describe, it, expect } from 'vitest';
import { quarterNoteMs } from '@jam-band/shared';
import { transposeNotes, beatToMs, voiceToMidiNotes } from '../utils/musicTheory';

describe('Music Theory Utils', () => {
  it('should transpose notes up by semitones', () => {
    const notes = ['C4', 'E4', 'G4'];
    const result = transposeNotes(notes, 2);

    expect(result).toEqual(['D4', 'F#4', 'A4']);
  });

  it('should convert beat position to milliseconds at tempo', () => {
    const ms = beatToMs(4, 120); // Beat 4 at 120 BPM

    expect(ms).toBe(4 * quarterNoteMs(120));
  });

  it('should map voice role to MIDI note numbers', () => {
    const notes = voiceToMidiNotes('bass');

    expect(notes).toContain(33); // Low B
    expect(notes.every(n => n >= 20 && n <= 55)).toBe(true);
  });
});
```

**Why this is good:**
- No setup complexity — just import, call, verify
- Output can be asserted directly
- Tests are fast (no I/O, no async)

### Backend Event Handlers

**Pattern**: Create a real handler instance, mock only the infrastructure (Socket, Redis, services), call the handler method, assert on state changes and broadcast targets.

```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UpdateTrackHandler } from '../handlers/UpdateTrackHandler';
import type { Socket } from 'socket.io';

describe('UpdateTrackHandler', () => {
  let handler: UpdateTrackHandler;
  let mockSocket: Socket;
  // Type infra mocks by inference — never `any` (TR-27).
  let mockRedis: { hgetall: ReturnType<typeof jest.fn>; hset: ReturnType<typeof jest.fn> };

  beforeEach(() => {
    // socket.io's server `Socket` is a huge interface — confine the single
    // unavoidable cast to this boundary (never `as any`, which disables ALL
    // checking). Frontend tests use the asMockSocket helper instead (see
    // "Mocking socket.io" above).
    mockSocket = {
      id: 'socket-1',
      data: { userId: 'user-1', projectId: 'proj-1' },
      emit: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
    } as unknown as Socket;

    mockRedis = {
      hgetall: jest.fn(),
      hset: jest.fn(),
    };

    // Create real handler with mocked dependencies
    handler = new UpdateTrackHandler(mockRedis);
  });

  it('should update track volume in Redis and broadcast to room', async () => {
    // Setup: mock Redis to return existing track state
    mockRedis.hgetall.mockResolvedValue({
      trackId: 'track-1',
      volume: 0.5,
    });

    // Act: call the real handler
    await handler.handle(mockSocket, {
      trackId: 'track-1',
      volume: 0.8,
    });

    // Assert: Redis was updated with new volume
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'track:track-1',
      'volume',
      0.8
    );

    // Assert: broadcast was sent to room (not to sender)
    expect(mockSocket.to).toHaveBeenCalledWith('room:proj-1');
    const broadcastEmit = mockSocket.to('room:proj-1').emit;
    expect(broadcastEmit).toHaveBeenCalledWith('track:updated', {
      trackId: 'track-1',
      volume: 0.8,
    });
  });

  it('should return early if user does not have room_member role', async () => {
    mockSocket.data.role = 'audience';

    const result = await handler.handle(mockSocket, {
      trackId: 'track-1',
      volume: 0.8,
    });

    expect(result).toEqual({ error: 'Insufficient permissions' });
    expect(mockRedis.hset).not.toHaveBeenCalled();
  });
});
```

**Why this is good:**
- Handler is a real class/function, not mocked
- Only the external dependencies (Socket, Redis) are mocked
- Tests verify both state changes (Redis) and side effects (broadcast)
- Permissions and error cases are tested
- Each assertion has a purpose — not just "mock was called"

### Regression Tests

**Pattern**: Each test documents the bug that was fixed with a comment referencing the date. This creates a living record of what broke and how we fixed it.

```typescript
describe('Arrange Room — Regression Tests', () => {
  // Regression: Arpeggiator notes overlapped when tempo changed mid-playback (fixed 2026-04)
  // Previously, changeArpTempo() didn't cancel pending noteOff events, causing stale notes.
  it('should cancel previous arpeggio noteOff events when tempo changes', async () => {
    const synth = createTestSynth();
    const arpeggiator = new Arpeggiator(synth, { tempo: 120 });

    arpeggiator.start(['C4', 'E4', 'G4']);
    await sleep(100); // Let first note trigger

    arpeggiator.changeTempo(240); // Double tempo

    // Verify that old scheduled noteOffs were cancelled
    expect(synth.triggerAttackRelease).toHaveBeenCalledTimes(2); // Only 2 notes played
    // If the bug still existed, we'd see 3+ calls
  });

  // Regression: Tracks reordered by drag but not persisted to Redux (fixed 2026-03)
  it('should persist track order to store when user drops track in new position', async () => {
    const { trackList, store } = renderArrangeRoom();

    // Drag track at index 2 to index 0
    fireEvent.drop(trackList[2], { dropTarget: trackList[0] });

    // Store state should reflect new order immediately
    const state = store.getState();
    expect(state.tracks[0].id).toBe('track-3');
    expect(state.tracks[2].id).toBe('track-1');
  });
});
```

**Why this is good:**
- Every test documents a real bug with a date
- Future developers know what to check when modifying this code
- Tests prevent regressions from happening again
- Comments explain why the bug happened

---

## Anti-patterns — What NOT to Do

### 1. Mock Theater (Testing Mock Calls, Not Behavior)

**BAD:**
```typescript
it('should emit event', () => {
  const mockEmit = jest.fn();

  handler.doSomething();

  // This test passes even if handler does nothing useful
  expect(mockEmit).toHaveBeenCalledWith('some-event');
});
```

**Why it's bad:** The test asserts on the mock, not on what actually changed in the system. If you delete all the code in `handler.doSomething()`, the test still passes as long as `mockEmit` was called before.

**GOOD:**
```typescript
it('should update state when event is emitted', () => {
  const initialState = getState();

  handler.doSomething();

  const newState = getState();
  expect(newState.isProcessed).toBe(true);
  expect(newState.items).toHaveLength(1);
});
```

### 2. Placeholder Tests

**BAD:**
```typescript
it('should work', () => {
  expect(true).toBe(true);
});
```

**Why it's bad:** This is not a test. It passes without testing anything.

**GOOD:**
```typescript
it('should calculate step duration correctly for 4/4 time', () => {
  const duration = calcStepDuration(120, 4, 4);
  expect(duration).toBe(500); // 120 BPM = 500ms per beat
});
```

### 3. Testing Inline Objects

**BAD:**
```typescript
it('should work with a beat object', () => {
  const beat = { id: '1', tempo: 120, timeSignature: [4, 4] };

  expect(beat.tempo).toBe(120);
});
```

**Why it's bad:** You're testing a plain object literal, not project code. This tells you nothing about whether your actual beat logic works.

**GOOD:**
```typescript
it('should create a beat with default tempo', () => {
  const beat = new Beat({ id: '1' });

  expect(beat.tempo).toBe(120); // Default from Beat class
});
```

### 4. Asserting Only on Mock Calls Without Checking Effects

**BAD:**
```typescript
it('should update track', () => {
  updateTrack(trackId, { volume: 0.8 });

  expect(mockSocket.emit).toHaveBeenCalledWith('track:updated', {
    trackId,
    volume: 0.8,
  });
  // But did the track actually update? Who knows.
});
```

**Why it's bad:** The test only checks that emit was called, not whether the track state actually changed in Redis or the store.

**GOOD:**
```typescript
it('should update track volume in Redis', async () => {
  mockRedis.hgetall.mockResolvedValue({ trackId, volume: 0.5 });

  await updateTrack(trackId, { volume: 0.8 });

  // Verify Redis was updated
  expect(mockRedis.hset).toHaveBeenCalledWith(
    'track:' + trackId,
    'volume',
    0.8
  );

  // Verify broadcast was sent
  expect(mockSocket.to).toHaveBeenCalledWith('room:proj-1');
});
```

### 5. Adding `maxWorkers: 1` Without a Documented Reason

**BAD:**
```typescript
// jest.config.js
module.exports = {
  maxWorkers: 1, // ???
};
```

**Why it's bad:** Tests run in parallel (slower), and there's no record of why this was set. Future developers will remove it, causing flaky tests.

**GOOD:**
```typescript
// jest.config.js
module.exports = {
  // maxWorkers left at default (4) — tests are isolated and don't share state
  // If tests fail in parallel, investigate test isolation instead of reducing maxWorkers.
};
```

If you actually need `maxWorkers: 1`, document it:
```javascript
module.exports = {
  maxWorkers: 1, // TODO: Events in separate tests are not isolated — Redis keys collide. Investigate moving to ephemeral Redis instances.
};
```

---

## Mocking Patterns

### Mock Socket.IO (Frontend — Vitest)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSocket = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  connected: true,
  disconnect: vi.fn(),
  connect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});
```

### Mock Socket.IO (Backend — Jest)

```typescript
import type { Socket, Namespace } from 'socket.io';

const createMockSocket = (id: string = 'test-socket'): Socket => ({
  id,
  emit: jest.fn(),
  to: jest.fn((roomId) => ({ emit: jest.fn() })),
  broadcast: { emit: jest.fn() },
  on: jest.fn(),
  off: jest.fn(),
  data: { userId: 'test-user', projectId: 'test-project' },
  join: jest.fn(),
  leave: jest.fn(),
  rooms: new Set(['test-room']),
} as unknown as Socket);

const createMockNamespace = (name: string = '/test'): Namespace => ({
  name,
  emit: jest.fn(),
  to: jest.fn((roomId) => ({ emit: jest.fn() })),
  in: jest.fn((roomId) => ({ emit: jest.fn() })),
  sockets: new Map(),
} as unknown as Namespace);
```

### Mock Web Audio API (Frontend)

```typescript
const mockAudioContext = {
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 1 },
  })),
  createOscillator: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { value: 440, setValueAtTime: vi.fn() },
    type: 'sine',
  })),
  createAnalyser: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteFrequencyData: vi.fn(),
    fftSize: 2048,
  })),
  createBufferSource: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    buffer: null,
    playbackRate: { value: 1 },
  })),
  createConvolver: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    buffer: null,
  })),
  destination: {},
  currentTime: 0,
  sampleRate: 44100,
  state: 'running',
  resume: vi.fn(),
};

beforeEach(() => {
  global.AudioContext = vi.fn(() => mockAudioContext) as unknown as typeof AudioContext;
  global.OfflineAudioContext = vi.fn() as unknown as typeof OfflineAudioContext;
});
```

### Mock Tone.js (Frontend)

```typescript
vi.mock('tone', () => ({
  start: vi.fn(),
  getContext: vi.fn(() => ({ rawContext: mockAudioContext })),
  PolySynth: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    triggerAttackRelease: vi.fn(),
    dispose: vi.fn(),
  })),
  Synth: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    triggerAttackRelease: vi.fn(),
    triggerAttack: vi.fn(),
    triggerRelease: vi.fn(),
    dispose: vi.fn(),
  })),
  Reverb: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
    wet: { value: 0.5, setValueAtTime: vi.fn() },
  })),
  Delay: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
    time: { value: 0.5 },
    wet: { value: 0.3, setValueAtTime: vi.fn() },
  })),
  Gain: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
    gain: { value: 1, setValueAtTime: vi.fn() },
  })),
}));
```

### Shared Frontend Test Utilities (`app/frontend/src/test-utils/`)

Mock helpers live in ONE place — `app/frontend/src/test-utils/`:
- `mockSocket.ts` — `createMockSocket(): MockSocket` (plain vi.fn() object + `trigger()`), `asMockSocket()`
- `fireableSocket.ts` — `createFireableMockSocket(id?)` returning `{ socket, fire }` for services that receive a Socket
- `createPartialMock.ts` — TR-27-compliant `createPartialMock<T>(partial)`

#### Konva pointer/click event mocks — build locally with `createPartialMock`

For testing Konva canvas interaction handlers (`handleRegionClick`, `handlePointerUp`, `useTrackInteractions`), there is no shared pointer-event factory — build a small file-local helper with `createPartialMock` instead (see `useTrackInteractions.test.ts` for the full pattern):

```typescript
import type { KonvaEventObject } from 'konva/lib/Node';
import { createPartialMock } from '@/test-utils/createPartialMock';

function makeClickEvent(opts: { shiftKey?: boolean } = {}): KonvaEventObject<MouseEvent | TouchEvent> {
  return createPartialMock<KonvaEventObject<MouseEvent | TouchEvent>>({
    evt: createPartialMock<MouseEvent>({ shiftKey: opts.shiftKey ?? false, type: 'click' }),
    cancelBubble: false,
    type: 'click',
  });
}
```

Only stub the fields your handler actually reads for that test.

---

### Mock Zustand Store

```typescript
import { useMyStore } from '../stores/myStore';

beforeEach(() => {
  useMyStore.setState({
    items: [],
    selectedId: null,
    // Reset to initial state
  });
});

it('should add an item', () => {
  useMyStore.getState().addItem({ id: '1', name: 'Test' });

  expect(useMyStore.getState().items).toHaveLength(1);
  expect(useMyStore.getState().items[0].name).toBe('Test');
});
```

---

## Test Structure Pattern

```typescript
describe('Feature Name', () => {
  beforeEach(() => {
    // Clear mocks and reset state
    vi.clearAllMocks();
    useMyStore.setState({ /* initial state */ });
  });

  describe('Unit: specific function/method', () => {
    it('should handle happy path', () => {
      /* ... */
    });
    it('should handle edge case', () => {
      /* ... */
    });
    it('should handle error case', () => {
      /* ... */
    });
  });

  describe('Integration: feature workflow', () => {
    it('should complete full workflow', () => {
      // Multiple functions/modules working together
    });
  });

  describe('Regression: real bugs we fixed', () => {
    // Each test documents a bug
  });
});
```

---

## What to Test (by Area)

### Zustand Stores

- Initial state shape and values
- Each action modifies state correctly
- Multiple actions in sequence don't conflict
- Edge cases (empty arrays, null values, duplicate IDs)
- Selectors return correct slices of state

### Socket Event Handlers (Backend)

- Session/auth validation (invalid session returns early with error)
- Permission checks (correct role required)
- State mutation (Redis state updated correctly)
- Broadcast target (uses `socket.to(roomId)` vs `namespace.to(roomId)` correctly)
- Error handling (errors logged, user notified)
- Ephemeral vs commit events (high-freq events broadcast immediately, commits go to Redis)

### React Hooks

- Event listeners registered on mount
- Listeners cleaned up on unmount
- Emit called with correct event name and payload
- State updates from received events
- Multiple listeners don't interfere

### Audio/Effects

- Effect created with correct parameters
- Effect chain connections in correct order (input → effect → output)
- Cleanup on unmount (disconnect, dispose, stop)
- Parameter changes (wet, delay, etc.) reflected immediately
- Stereo/mono handling correct

### Music Theory Utilities

- Note transposition
- Interval calculations
- Scale generation
- Chord voicing
- Beat/measure/time signature conversions. Use `@jam-band/shared` helpers from `shared/src/music/timeSignature.ts` in both implementation and assertions; add helper-level tests for new meter cases.

### UI Components (React)

- Component renders without errors
- Props are passed through correctly
- User interactions trigger correct callbacks
- Conditional rendering (show/hide based on state)

---

## Reference Test Files

Good examples to read and learn from:

**Frontend (Zustand + Vitest):**
- `app/frontend/src/features/effects/__tests__/effectsStore.test.ts` — Store actions, state mutations
- `shared/src/music/__tests__/timeSignature.test.ts` — Pure utility functions (shared helpers)
- `app/frontend/src/features/audio/services/__tests__/RoomSocketManager.test.ts` — Service using `createFireableMockSocket` + `fire()` pattern
- `app/frontend/src/features/rooms/arrange/hooks/interactions/__tests__/useTrackInteractions.test.ts` — Hook test for track interactions (file-local pointer-event helpers via `createPartialMock` — no shared factory)

**Backend (Jest):**
- `app/backend/src/domains/arrange-room/__tests__/ArrangeRoomStateService.test.ts` — Real service + mocked Redis
- `app/backend/src/domains/arrange-room/__tests__/integration.test.ts` — Multiple handlers, full workflow
- `app/backend/src/domains/arrange-room/__tests__/ProjectSaveService.test.ts` — Service methods with dependencies mocked

**What NOT to learn from:**
- Old test files with many `expect(mock.emit).toHaveBeenCalled()` assertions
- Tests with `expect(true).toBe(true)`
- Integration tests that mock everything
- Tests without clear intent or documentation

---

## Running Tests Locally

### Frontend

```bash
cd app/frontend

# Run all tests
bun run test

# Run specific file
bun run test -- src/features/effects/__tests__/effectsStore.test.ts

# Watch mode
bun run test -- --watch

# Coverage
bun run test -- --coverage
```

### Backend

```bash
cd app/backend

# Run all tests
bun run test

# Run specific domain
bun run test:unit -- src/domains/arrange-room/__tests__/

# Run regression tests only
bun run test:regression

# Coverage
bun run test:coverage
```

### CI/CD

Tests run automatically in CI on:
- Every push to `main` and feature branches
- Pull requests (must pass before merge)

---

## Debugging Failed Tests

**Vitest (Frontend):**
```bash
# Run single test in debug mode
bun run test -- --inspect-brk src/features/effects/__tests__/effectsStore.test.ts
```

**Jest (Backend):**
```bash
# Run with node debugger
node --inspect-brk node_modules/.bin/jest src/domains/arrange-room/__tests__/
```

Then open `chrome://inspect` in Chrome to debug.

**Print debugging:**
```typescript
console.log('State:', useMyStore.getState());
console.log('Mock calls:', mockSocket.emit.mock.calls);
```

---

## Tips

1. **Test behavior, not implementation.** If you rename a private function, tests shouldn't break.
2. **One assertion per test is fine.** It's okay to have many tests with one `expect()` each — it's clearer than 10 assertions in one test.
3. **Use descriptive test names.** `it('should add item')` is better than `it('works')`.
4. **Clean up after tests.** Use `beforeEach()` to reset state, mocks, and stores.
5. **Avoid test interdependence.** Each test should be runnable in isolation and in any order.
6. **Document tricky mocks.** If a mock is complex, add a comment explaining why it's needed.
