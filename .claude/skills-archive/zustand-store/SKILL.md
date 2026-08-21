---
name: zustand-store
description: How to create or modify Zustand stores following project patterns — store creation, socket integration, sync handlers, and selector patterns.
---

# Creating & Modifying Zustand Stores

This skill covers Zustand store patterns used in the murva frontend.

## Unidirectional Data Flow (TR-36) — read this first

All store access follows the UDF rules (ADR: `docs/adr/2026-07-05-frontend-unidirectional-data-flow.md`, rule TR-36 in `docs/RULES_AND_CONSTRAINTS.md`):

1. **One store per state** — no mirroring into local `useState`, no duplication across stores.
2. **Write via named action only** — components never call `store.getState()` / `store.setState()`; this is an ESLint **error** in `.tsx` (and anonymous `setState` is an error in `.ts` hooks). `getState()` is fine inside store actions, services, and feature hooks.
3. **Inbound socket → store action or bus** — state-bearing events call a `sync*` store action; one-shot command events (kick, owner-switch, synth-params RPC…) go through the typed `roomSocketBus` (mitt), consumed with `useRoomSocketEvent`. Callback-ref registries are forbidden.
4. **Read via selector** — derive with selectors / `useMemo`, never store derived values.

## Store Locations

- **Shared stores**: `app/frontend/src/shared/stores/` — global state (user, UI, voice, scale slots)
- **Feature stores**: `app/frontend/src/features/<feature>/stores/` — feature-scoped state
- **Arrange room stores**: `app/frontend/src/features/rooms/arrange/stores/` — DAW state (tracks, regions, MIDI, locks, etc.)
- **Effect stores**: `app/frontend/src/features/effects/stores/`
- **Sequencer stores**: `app/frontend/src/features/sequencer/`

## Basic Store Pattern

```typescript
// app/frontend/src/features/<feature>/stores/myStore.ts
import { create } from 'zustand';

interface MyStoreState {
  // State
  items: Item[];
  selectedId: string | null;

  // Actions
  addItem: (item: Item) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<Item>) => void;
  selectItem: (id: string | null) => void;
  clearItems: () => void;

  // Sync handlers (for socket events — bypass undo history)
  syncSetItems: (items: Item[]) => void;
  syncAddItem: (item: Item) => void;
  syncUpdateItem: (id: string, updates: Partial<Item>) => void;
  syncRemoveItem: (id: string) => void;
}

export const useMyStore = create<MyStoreState>((set, get) => ({
  // Initial state
  items: [],
  selectedId: null,

  // Local actions (may trigger socket emit + undo history)
  addItem: (item) => set((state) => ({
    items: [...state.items, item],
  })),

  removeItem: (id) => set((state) => ({
    items: state.items.filter((i) => i.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  })),

  updateItem: (id, updates) => set((state) => ({
    items: state.items.map((i) => i.id === id ? { ...i, ...updates } : i),
  })),

  selectItem: (id) => set({ selectedId: id }),

  clearItems: () => set({ items: [], selectedId: null }),

  // Sync handlers — called when receiving socket events from other users
  // These bypass undo history and directly update state
  syncSetItems: (items) => set({ items }),

  syncAddItem: (item) => set((state) => ({
    items: [...state.items, item],
  })),

  syncUpdateItem: (id, updates) => set((state) => ({
    items: state.items.map((i) => i.id === id ? { ...i, ...updates } : i),
  })),

  syncRemoveItem: (id) => set((state) => ({
    items: state.items.filter((i) => i.id !== id),
  })),
}));
```

## Key Pattern: Local Actions vs Sync Handlers

The project distinguishes between:

1. **Local actions** (`addItem`, `updateItem`, etc.)
   - Called by the current user's UI interactions
   - May trigger socket emit to broadcast changes
   - May be tracked in undo history

2. **Sync handlers** (`syncAddItem`, `syncUpdateItem`, etc.)
   - Called when receiving socket events from OTHER users
   - Directly update state without emitting or undo tracking
   - Prefixed with `sync` by convention

Example from `arrangeTrackStore.ts`:
```typescript
// Local action — user adds a track
addTrack: (overrides?) => { /* creates track, may emit socket */ },

// Sync handler — another user added a track
syncAddTrack: (track) => set((state) => ({ tracks: [...state.tracks, track] })),
```

## Connecting Store to Socket Events

**State-bearing events** — in a feature hook or sync service (never a component), listen and call the store's `sync*` action:

```typescript
// In a sync hook (e.g., features/rooms/arrange/hooks/sync/useArrange*Sync.ts)
useEffect(() => {
  if (!socket) return;

  const handleItemAdded = (data: { userId: string; item: Item }) => {
    // Only apply if from another user
    if (data.userId === currentUserId) return;
    useMyStore.getState().syncAddItem(data.item);
  };

  socket.on('arrange:item_added', handleItemAdded);
  return () => {
    socket.off('arrange:item_added', handleItemAdded);
  };
}, [socket, currentUserId]);
```

**One-shot command/notification events** (kick, owner-switch, synth-params RPC, lock conflict…) do **not** go through a store — they are emitted on the typed `roomSocketBus` (`features/audio/hooks/roomSocket/roomSocketBus.ts`) and consumed with `useRoomSocketEvent`:

```typescript
import { useRoomSocketEvent } from '@/features/audio/hooks/roomSocket/useRoomSocketEvent';

useRoomSocketEvent('userKicked', ({ reason }) => {
  // side-effect only — the bus is at-least-once, so keep handlers idempotent
});
```

## Selector Pattern

For performance, use selectors to avoid unnecessary re-renders:

```typescript
// Inline selector
const items = useMyStore((state) => state.items);
const selectedId = useMyStore((state) => state.selectedId);

// Derived selector
const selectedItem = useMyStore((state) =>
  state.items.find((i) => i.id === state.selectedId) ?? null
);

// External selector file (for reusable action bundles / complex selectors)
// app/frontend/src/features/rooms/arrange/stores/selectors/trackSelectors.ts
export const useTrackActions = () => useArrangeTrackStore(
  useShallow((state) => ({
    addTrack: state.addTrack,
    removeTrack: state.removeTrack,
    // ...
  }))
);
```

## Accessing Store Outside React

Allowed **only** in store actions, services, and feature hooks — never in components (UDF guard, ESLint error):

```typescript
// Get current state
const currentItems = useMyStore.getState().items;

// Call an action
useMyStore.getState().syncAddItem(newItem);

// Subscribe to changes (Zustand v5 plain subscribe takes a listener only;
// selector-based subscribe needs the subscribeWithSelector middleware —
// see arrangeStoreObservers.ts)
const unsubscribe = useMyStore.subscribe(() => {
  /* react to any store change */
});
```

## Existing Stores Reference

### Shared Stores (`src/shared/stores/`)
- `userStore` — User auth state (userId, username, email, userType)
- `themeStore` — Theme state
- `scaleSlotsStore` — Scale preset slots (10 slots, hotkeys 1-0)
- `voiceStateStore` — Voice chat state
- `signupModalStore` — Signup modal open/close
- `inRoomAuthPromptStore` — In-room auth prompt state

### Room Shared Stores (`src/features/rooms/shared/stores/`)
- `roomStore` — Room + members (incl. the `memberRuntime` slice: per-member instrument/effects/mute runtime flags)
- `roomChatStore` — Room chat messages

### Arrange Room Stores (`src/features/rooms/arrange/stores/`)
- `arrangeRoomStore` — Room-level state (BPM, time signature, scale)
- `arrangeTrackStore` — Track list and track properties
- `arrangeRegionStore` — Regions on timeline (+ `arrangeRegionSelection`)
- `arrangePianoRollStore` — Piano roll editor state (+ `arrangePianoRollSelection`)
- `arrangeMidiStore` — MIDI note data
- `arrangeLockStore` — Collaborative locks
- `arrangeSynthStore` — Per-track synth parameters
- `arrangeProjectStore` — Project save/load state
- `arrangeRecordingStore` — Recording state
- `arrangeHistoryStore` — Undo/redo history (fed by `arrangeStoreObservers` subscriptions)
- `arrangeLayoutStore` — DAW layout preferences
- `arrangeMarkerStore` — Timeline markers
- `arrangePerformanceStore` — Performance metrics
- `arrangeVoiceRecordingStore` — Voice-to-MIDI recording
- `arrangeBroadcastStore` — HLS broadcast state
- `arrangeStoreRegistry` — reset registry: `createArrangeStore()` factory + `resetArrangeStores()` (clears all registered arrange stores + `voiceStateStore` on room enter/leave)

> **Creating a NEW arrange store?** Do NOT use plain `create()` — use
> `createArrangeStore<MyState>((set) => ({ ... }))` from
> `features/rooms/arrange/stores/arrangeStoreRegistry.ts`. It auto-registers the store's
> `reset()` (your state type MUST include `reset: () => void`) so `resetArrangeStores()` can
> never miss it. Stores built with middleware (`persist(...)` etc.) keep their curried
> `create()()` shape and call `registerArrangeStore(useMyStore)` right after creation instead.
> A completeness test (`stores/__tests__/arrangeStoreRegistry.test.ts`) globs every
> `useArrange*Store` export in the stores dir and **fails by default** if one is unregistered;
> genuinely non-resettable stores (persisted user preferences with no per-room state, e.g.
> `arrangeLayoutStore`, `arrangePerformanceStore`) must be added to its documented
> `NON_RESETTABLE_STORES` allowlist — an explicit, review-gated act. History: a store missing
> from the old hand-maintained roster once leaked `sourceProjectId` across rooms, making Save
> overwrite the previous project.

### Perform Room Stores (`src/features/rooms/perform/stores/`)
- `performLayoutStore`, `companionAudioStateStore`, `performCompanion*LockStore` (settings/volume/progression locks)

### Other Feature Stores
- `sequencerStore` (`src/features/sequencer/stores/`, with `slices/`)
- `effectsStore` (`src/features/effects/stores/`) — effect chain state per instrument/voice
- `metronomeStore` (`src/features/metronome/stores/`)

## Common Pitfalls

1. **Don't emit socket events inside store actions** — emit in hooks/services that call the action
2. **Always use sync handlers for remote updates** — prevents infinite loops (emit → receive → emit)
3. **Use `getState()` in socket listeners** — avoids stale closure issues with `useEffect` (listeners live in hooks/services, so this is UDF-legal)
4. **Keep stores flat** — avoid deeply nested state; split into multiple stores if needed
5. **Clear store on room leave** — call `clearItems()` or equivalent when user leaves room (arrange: `resetArrangeStores()` from `arrangeStoreRegistry` — stores created via `createArrangeStore` are covered automatically)
6. **Never `getState()`/`setState()` in components** — the UDF ESLint guard makes this an error; move the logic into a named store action, service, or feature hook (TR-36)
