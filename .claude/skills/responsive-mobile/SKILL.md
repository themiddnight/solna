---
name: responsive-mobile
description: Responsive design and mobile UX for murva — breakpoints, mobile/desktop layouts, touch handling, safe areas, canvas-aware responsive patterns, and mobile-specific components. Read before adding or modifying any UI that renders on both mobile and desktop, or when introducing new touch interactions.
---

# Responsive & Mobile Design Skill

Read every time before working on: responsive layouts, mobile-specific UI, touch interactions, breakpoint changes, or any component that renders differently on mobile vs desktop.

**Related Skills:** `tailwind-daisyui` (UI framework — component classes, responsive sizing, daisyUI breakpoints), `perform-room` (mobile layout section), `arrange-room` (mobile layout section)

---

## 1. Breakpoint System

### THE Single Source of Truth

```typescript
// app/frontend/src/shared/hooks/useIsMobile.ts
const MOBILE_BREAKPOINT = 720;
// Mobile: < 720px  |  Desktop: >= 720px
```

> **720px, not the Tailwind default 768.** `md` is overridden to `720px` in
> `app/frontend/src/index.css` (`--breakpoint-md`) so iPad mini 6/7 portrait
> (744px CSS width) lands on the tablet side instead of the mobile layout, with
> a ~24px buffer. `MOBILE_BREAKPOINT` here and `--breakpoint-md` in `index.css`
> MUST stay equal.

**Do NOT define your own breakpoint constants.** Always use the project hooks:

| Hook | File | What it does |
|---|---|---|
| `useIsMobile()` | `shared/hooks/useIsMobile.ts` | `window.innerWidth < 720` — primary mobile gate |
| `useMediaQuery(query)` | `shared/hooks/useMediaQuery.ts` | Generic `window.matchMedia` wrapper — use for ad-hoc queries |

### Breakpoint Reference Table

| Name | Width | Tailwind Class | Usage |
|---|---|---|---|
| Mobile | `< 720px` | *(base)* | `MobileDock`, `MobileFloatingHUD`, bottom sheets, compact labels |
| Tablet | `720px - 1023px` | `md:` | Split layouts appear, full labels, sidebars collapse to icon-only (includes iPad mini portrait 744px) |
| Desktop | `1024px - 1279px` | `lg:` | Sidebars show, multi-column grids, expanded panels |
| XL Desktop | `>= 1280px` | `xl:` | Right sidebar (`PerformSidebar`), 3-column grids |

**XL detection via JS:**
```typescript
// Used in PerformRoomNonMobileLayout and ArrangeRoomNonMobileLayout
const isXL = useMediaQuery("(min-width: 1280px)");
```

### Responsive Visibility Cheatsheet

```
hidden sm:block      → show only on tablet+
block sm:hidden      → show only on mobile
hidden lg:block      → show only on desktop
hidden xl:block      → show only on XL
hidden sm:inline     → compact label hidden on mobile, shown as inline on tablet+
```

---

## 2. Architecture: Mobile vs Desktop Layout

### The Split Pattern

**Every room page** follows the same pattern — conditionally render one of two layout components:

```typescript
// PerformRoom.tsx pattern (ArrangeRoom.tsx is identical)
{isMobile ? (
  <PerformRoomMobileLayout {...props} />
) : (
  <PerformRoomNonMobileLayout {...props} />
)}
```

> Naming: the non-mobile layout components are `*NonMobileLayout` (e.g. `PerformRoomNonMobileLayout`,
> `ArrangeRoomNonMobileLayout`) — there is no `*DesktopLayout.tsx` anymore. "Non-mobile" covers both
> tablet (720–1279px, overlay sidebar) and desktop (≥1280px, inline sidebar); `isTablet`/`isDesktop`
> are derived inside the layout via `useMediaQuery("(min-width: 1280px)")`. These layouts assume
> `!isMobile` is already true (the parent page gates on `isMobile`) — do not re-check `useIsMobile()`
> inside them.

### Perform Room Layout Tree

```
PerformRoom
├── isMobile? ─── PerformRoomMobileLayout
│   ├── MobileFloatingHUD (mode="perform")
│   ├── Tab content by activeMobileTab (always-mounted, CSS hidden/visible):
│   │   ├── "stage" → VirtualStage
│   │   ├── "input" → InstrumentControlsPanel + VirtualInputPanel (resizable split)
│   │   └── "sequencer" → StepSequencerPanel
│   ├── MobileControlsStrip (compact effects summary + compact VoiceInputView/instrument/monitor/MIDI/chat)
│   ├── MobileBottomSheet (full-screen, opened from strip) → PerformSidebar
│   ├── MobileChatDrawer (chat popup, opened from strip's chat icon)
│   └── MobileDock (tabs: Stage, Seq, Input)
│
└── !isMobile? ─── PerformRoomNonMobileLayout
    ├── RoomActionBar (global: invite, recording, broadcast, pending, room switch, ping, leave)
    ├── SplitTabWorkspaceShell
    │   ├── Top Tabs: Virtual Stage | Instrument Settings
    │   └── Bottom Tabs: Instrument Settings | Instrument Input | Sequencer
    └── PerformSidebar (always rendered)
        ├── displayMode="inline" (desktop ≥1280px) — single sidebar, w-14 collapsed / w-96 expanded
        └── displayMode="overlay" (tablet 720–1279px) — collapsed strip (w-14) + absolute drawer (w-96)
```

### Arrange Room Layout Tree

```
ArrangeRoom
├── isMobile? ─── ArrangeRoomMobileLayout
│   ├── MobileFloatingHUD (mode="arrange")
│   ├── Tab content by activeMobileTab (always-mounted, CSS hidden/visible):
│   │   ├── "tracks" → MultitrackView
│   │   ├── "editor" → RegionEditor (Piano Roll / Audio Editor)
│   │   └── "instrument" → InstrumentControlsPanel + VirtualInstrumentPanel (resizable split)
│   ├── MobileTransportBar (play/pause/stop/record + expandable Snap/Metronome/Count-in/Scale row)
│   ├── MobileControlsStrip (compact track-effects summary + compact VoiceInput/broadcast/meter/members/chat)
│   ├── MobileBottomSheet (full-screen, opened from strip) → Sidebar (hideVoiceInput, since strip already has one)
│   ├── MobileChatDrawer (chat popup, opened from strip's chat icon)
│   └── MobileDock (tabs: Tracks, Editor, Input)
│
└── !isMobile? ─── ArrangeRoomNonMobileLayout
    ├── TransportToolbar (PlaybackToolbar + RoomTransportSettings)
    ├── SplitTabWorkspaceShell
    │   ├── Top Tabs: Multitrack | Region Editor | Instrument Settings
    │   └── Bottom Tabs: Region Editor | Instrument Input | Instrument Settings
    └── Sidebar (always rendered)
        ├── displayMode="inline" (desktop ≥1280px) — single sidebar, w-14 collapsed / w-96 expanded
        └── displayMode="overlay" (tablet 720–1279px) — collapsed strip (w-14) + absolute drawer (w-96)
```

> Note: `useToneTransportSync()` (drives `Tone.Transport` start/pause/stop/BPM/time-signature/loop
> from `arrangeProjectStore`) is mounted once at the page level (`ArrangeRoom.tsx`, via a small
> `ToneTransportSyncBridge`), NOT inside `TransportToolbar` or `MobileTransportBar`. This keeps the
> sync hook active regardless of which layout (mobile or non-mobile) is rendered — both
> `TransportToolbar` and `MobileTransportBar` only read/write `arrangeProjectStore` state and must
> stay free of the Tone.js side-effect itself.

### Key Layout Rules

1. **Mount once, move once:** Each panel is rendered only once in the DOM. `SplitTabWorkspaceShell` moves panels between grid areas via `gridRow` — the panel is NOT duplicated.

2. **Audio continuity on mobile tabs:** All instrument sections remain mounted (hidden via CSS `hidden`/`flex`) when switching mobile tabs. Voice chat runtime is owned by the room-level `VoiceRuntimeProvider`; mobile/tab/drawer UI must render `VoiceInputView` controls from that provider instead of owning microphone/WebRTC lifecycle locally.

3. **Tab conflict resolution:** When the same tab is selected in both top and bottom sections, the section that was just clicked wins; the other section falls back to its `conflictFallback`.

4. **Bottom height persistence:** `bottomHeight` is persisted (likely in localStorage). Active tab selection is NOT persisted — starts fresh each visit.

---

## 3. Shared Mobile Components

### MobileDock (`features/rooms/shared/components/MobileDock.tsx`)

Bottom tab bar using DaisyUI `dock dock-md`. Fixed at bottom, always visible on mobile.

```typescript
interface DockTab { id: string; icon: string; label: string; }

<MobileDock
  tabs={[
    { id: "stage", icon: "mdi:stage", label: "Stage" },
    // ...
  ]}
  activeTab={currentTab}
  onTabChange={setCurrentTab}
/>
```

- Uses `fixed bottom-0 left-0 right-0 w-full` with `z-50`
- Active tab gets `dock-active` class
- Includes `paddingBottom: env(safe-area-inset-bottom)` so iOS standalone/PWA mode does not cover the dock with the home indicator
- Parent mobile room layouts must reserve `calc(4rem + env(safe-area-inset-bottom))` at the bottom for the fixed dock

### MobileFloatingHUD (`features/rooms/shared/components/MobileFloatingHUD.tsx`)

Top status bar for mobile rooms. Fixed at top with safe area padding.

```typescript
<MobileFloatingHUD
  mode="perform" | "arrange"   // sets badge color
  isConnected={boolean}         // green/yellow/red dot
  pendingCount={number}         // badge on menu button
  onMenuOpen={callback}         // opens room actions
  onLeave={callback}            // leave room button
/>
```

- `paddingTop: "env(safe-area-inset-top)"` — always include this
- Height: `h-11` (44px)
- z-index: `z-[60]` (above dock, below modals)

### MobileBottomSheet (`features/rooms/shared/components/MobileBottomSheet.tsx`)

Draggable bottom sheet with snap points. For overlays, settings panels, pickers on mobile.

- Uses React Pointer Events (`onPointerDown/Move/Up`) with `setPointerCapture`
- `maxHeight: calc(100dvh - env(safe-area-inset-top) - 8px)`
- `paddingBottom: env(safe-area-inset-bottom)`
- Locks body scroll when open, restores on close

### MobileControlsStrip (`features/rooms/shared/components/MobileControlsStrip.tsx`)

Compact strip placed directly above `MobileDock` (`h-12`, `z-55`). Used by both
`PerformRoomMobileLayout` and `ArrangeRoomMobileLayout` as the single entry point into the
room's sidebar/tools content on mobile.

```typescript
interface MobileControlsStripProps {
  leftSlot: ReactNode;   // compact effect/track summary
  rightSlot: ReactNode;  // compact controls: VoiceInputView, broadcast, meter, members, chat icon, etc.
  onOpen: () => void;    // opens the paired MobileBottomSheet
  drawerTitle?: string;
}
```

- Layout: `| [left summary] --- [compact controls] [▲ chevron] |`
- The chevron is the **only** way to open the full-screen `MobileBottomSheet`
- If `rightSlot` already renders a compact `VoiceInputView`, avoid rendering another voice control inside
  the paired `MobileBottomSheet` unless the product intentionally wants a second control surface. `VoiceRuntimeProvider`
  keeps microphone/WebRTC runtime single-owned, so this is now a UX duplication concern rather than a stream
  duplication concern.

### MobileBottomSheet (`features/rooms/shared/components/MobileBottomSheet.tsx`)

Full-screen drawer that slides up from the bottom (`z-[71]`), opened from `MobileControlsStrip`'s
chevron. Drag-to-close (pointer events, `CLOSE_THRESHOLD_PX`), Escape-to-close, locks body scroll
while open. **Children are always mounted** (just translated offscreen when closed) — so any
component placed inside must be safe to keep alive (sockets, subscriptions, expensive observers, etc.) or explicitly
gated. Voice controls are safe as views only when a room-level `VoiceRuntimeProvider` owns the runtime.

- Arrange Room: hosts `<Sidebar hideVoiceInput />` (Track Effects + broadcast/meter/members) to avoid duplicate voice controls in the mobile drawer.
- Perform Room: hosts `<PerformSidebar layout="column" />` (Effects Chain + Personal Tools)
- This replaces the old mobile "tools" dock tab — there is no longer a `MobileDock` tab for
  tools/sidebar; it's reached via the strip's chevron instead.

### ResizeHandle (`features/rooms/shared/components/ResizeHandle.tsx`)

Shared draggable divider used inside mobile tab content for resizable splits (e.g. Arrange Room's
"instrument" tab: `InstrumentControlsPanel` over `VirtualInstrumentPanel`; Perform Room's "input"
tab: `InstrumentControlsPanel` over `VirtualInputPanel`). Pairs with `useResizable` (mouse + touch
handlers via `onMouseDown`/`onTouchStart`).

### MobileTransportBar (`features/rooms/arrange/components/transport/MobileTransportBar.tsx`)

Arrange Room mobile transport bar, rendered between the main tab content and
`MobileControlsStrip`. Two rows:
- Row 1 (always visible): back-to-start, play/pause, stop, record (`btn-md` square buttons) +
  expand/collapse chevron
- Row 2 (expandable): `Metronome`, `SnapToggle`, `CountInButton`, `ScaleSelector`

It only reads/writes `arrangeProjectStore` transport state (`setTransportState`,
`toggleRecording`, etc.) — it does **not** call `useToneTransportSync()`. The actual
`Tone.Transport` side-effects are driven by `ToneTransportSyncBridge` mounted once in
`ArrangeRoom.tsx`, so Play/Pause/Stop/Record work identically whether `MobileTransportBar`
(mobile) or `TransportToolbar` (non-mobile) is the active UI.

### MobileChatDrawer (`features/rooms/shared/components/chat/MobileChatDrawer.tsx`)

Shared mobile chat popup (backdrop + `RoomChatPanel`), opened via the chat icon in
`MobileControlsStrip`'s `rightSlot`. Used by both `ArrangeRoomMobileLayout` and
`PerformRoomMobileLayout` to avoid duplicating the ~20-line backdrop/panel/z-index block.

```typescript
<MobileChatDrawer
  socket={chatSocket}
  roomId={chatRoomId}
  currentUserId={currentUserId}
  isOpen={isChatDrawerOpen}
  onClose={() => setIsChatDrawerOpen(false)}
/>
```

Pairs with `<RoomChatRoot ... />` rendered at the page level — `RoomChatRoot` keeps the socket
subscription/unread-count state alive (props: `socket`/`roomId`/`currentUserId`/`isOpen` — no
`hideChat`), while `MobileChatDrawer` owns the visible mobile popup.

### RoomChatRoot — Mobile Position

```typescript
// Mobile position (different from desktop)
<RoomChatRoot position="mobile-right" />
// Renders at: inset-x-3 bottom-36 h-[min(70dvh,30rem)]
// vs Desktop: bottom-24 right-6 h-[28rem] w-96
```

---

## 4. Responsive Patterns Used in This Project

### Pattern 1: Compact Labels (SM-inline)

Used extensively for buttons with limited mobile space:

```tsx
<button className="btn btn-xs join-item">
  <Icon icon={tab.icon} />
  <span className="hidden sm:inline">{tab.label}</span>
  {/* "Velocity" on desktop → icon-only on mobile */}
</button>
```

Also used in `BaseInstrument.tsx` for parameter labels:
- `hidden sm:inline` → "Velocity" / "Octave" / "Sustain"
- `sm:hidden` → "Vel" / "Oct" / "Sus" (abbreviated)

### Pattern 2: Responsive Stacking

```tsx
// Stack on mobile, row on desktop
<div className="flex flex-col lg:flex-row gap-4">
  <Sidebar className="w-full lg:w-1/2" />
  <Content className="w-full lg:w-1/2" />
</div>

// Collapse columns on mobile
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {items.map(item => <Card key={item.id} />)}
</div>
```

### Pattern 3: Responsive Sizing

**Full daisyUI component sizing + responsive patterns → see `tailwind-daisyui` skill § Pattern 2.**

```tsx
// daisyUI components support responsive size modifiers (v5 feature)
// See tailwind-daisyui skill for the complete component reference

// Buttons
<button className="btn btn-xs sm:btn-sm">Action</button>

// Range inputs
<input type="range" className="range range-xs sm:range-sm" />

// Spacing
<div className="p-2 sm:p-4 gap-1 sm:gap-2">

// Widths
<select className="w-14 sm:w-auto select select-xs sm:select-sm">

// Text
<h2 className="text-lg sm:text-xl">Heading</h2>

// Badges
<span className="badge badge-xs sm:badge-sm">

// Tables
<table className="table table-xs sm:table-md">
```

### Pattern 4: Mobile Tabs vs Desktop Split Panels

Mobile: `MobileDock` + conditional tab content visibility
Desktop: `SplitTabWorkspaceShell` with resizable split panels

**Do NOT** try to make a single component work for both — the interaction models are fundamentally different. Always create separate layout components.

### Pattern 5: Sidebar Collapse

`SidebarShell` component: `w-14` (collapsed, icon-only) ↔ `w-96` (expanded)

Used in both rooms:
- Perform: `<PerformSidebar>` — `EffectsChainSection` on top + personal tools (voice, scale slots, instrument, MIDI, metronome, time signature) below
- Arrange: `<Sidebar>` — contains arrangement tools

---

## 5. Touch & Mobile Interaction Rules

### Touch-Friendly CSS Class

Always apply `touch-manipulation` class to interactive music elements:

```css
/* Defined in index.css */
.touch-manipulation {
  touch-action: manipulation;      /* prevents double-tap zoom */
  -webkit-tap-highlight-color: transparent;  /* removes tap highlight */
  user-select: none;               /* prevents text selection */
}

/* Active feedback for touch */
@media (hover: none) and (pointer: coarse) {
  .touch-manipulation:active {
    transform: scale(0.95);        /* subtle press feedback */
  }
}
```

### Touch Events Hook

```typescript
// shared/ui/useTouchEvents.ts
useTouchEvents({
  onPress: () => { /* note on */ },
  onRelease: () => { /* note off */ },
  isPlayButton: boolean,     // true = play button (hold to sustain)
  shouldHandleEvent: (e) => boolean,  // guard condition
})
```

Uses native `touchstart`/`touchend`/`touchcancel` with `passive: false` + `preventDefault()`.

### Viewport Meta (index.html)

```html
<meta name="viewport"
  content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

- `maximum-scale=1.0, user-scalable=no` — prevents accidental zoom on instrument buttons
- `viewport-fit=cover` — enables safe area insets on notched devices (iPhone X+)

### Use `dvh` (Dynamic Viewport Height)

Always use `dvh` (not `vh`) for full-screen mobile layouts:

```tsx
// ✅ Correct — accounts for mobile browser chrome
<div className="h-dvh min-h-dvh">

// ❌ Wrong — overflows on mobile (browser bars not accounted for)
<div className="h-screen min-h-screen">
```

### Pointer Events (Not Mouse + Touch Separate)

Prefer React Pointer Events over separate mouse/touch handlers:

```tsx
// ✅ Unified pointer events
<div onPointerDown={start} onPointerMove={move} onPointerUp={end}>

// ❌ Duplicated handlers
<div onMouseDown={start} onTouchStart={start} onMouseMove={move} onTouchMove={move}>
```

**Exception:** `useTouchEvents` uses native touch events specifically because some mobile browsers delay `pointerdown` on music instrument buttons.

### Safe Area Insets

Four locations need safe area handling:

| Component | Property | Value |
|---|---|---|
| `MobileFloatingHUD` | `paddingTop` | `env(safe-area-inset-top)` |
| `PerformRoom` / `ArrangeRoom` (mobile) | `paddingTop` | `calc(44px + env(safe-area-inset-top) + 4px)` |
| `MobileBottomSheet` | `maxHeight` | `calc(100dvh - env(safe-area-inset-top) - 8px)` |
| `MobileBottomSheet` | `paddingBottom` | `env(safe-area-inset-bottom)` |

---

## 6. Canvas-Specific Responsive Considerations

This is a **music production app** — canvas and audio constraints differ from typical web apps.

### Mobile is Mostly View-Only

Music production on mobile is **limited by design.** Mobile users can:
- Join as audience (listen only — HLS stream)
- Basic instrument playing (limited polyphony)
- View session state (who's playing, BPM, key/scale)

They cannot:
- Access advanced DAW features (piano roll editing, multi-track arrangement)
- Use project tools (import/export, mixdown) — these remain desktop-only

### Canvas Scaling

When rendering Konva stages on mobile:
- Keep the stage at a fixed internal resolution and CSS-scale it down
- Do NOT recalculate canvas sizes on every resize — debounce with 200ms
- Instrument keyboards/fretboards: use `touch-manipulation` + `useTouchEvents`

### AudioContext on Mobile

Mobile browsers suspend AudioContext until user gesture. Always resume on interaction:
```typescript
// In instrument initialization
if (Tone.getContext().rawContext.state === "suspended") {
  await Tone.getContext().rawContext.resume();
}
```

### WebRTC on Mobile

Mobile Safari has known WebRTC limitations. Always check:
- `shared/utils/webkitCompat.ts` → `isSafariMobile()`, `isMobile()` (UA-based)
- Voice chat may be limited on mobile Safari — test before enabling

---

## 7. Responsive Component Checklist (Pre-Implementation)

Before writing a new UI component, answer:

1. **Does it render on mobile?** If yes → which mobile tab does it belong to?
2. **Does it use canvas/Konva?** If yes → fixed internal resolution + CSS scale
3. **Does it play audio?** If yes → mount outside tab content (audio continuity)
4. **Does it need touch handling?** If yes → `touch-manipulation` class + `useTouchEvents` or Pointer Events
5. **Does it need safe area?** If yes → which edge? Add the correct `env(safe-area-inset-*)`
6. **Is the label too long for mobile?** If yes → `hidden sm:inline` full + `sm:hidden` abbreviated
7. **Does it use `vh`?** If yes on mobile → should it be `dvh` instead?

---

## 8. Testing Responsive Layouts

### Test Widths

| Width | What to test |
|---|---|
| 320px | Smallest phone (iPhone SE) — all tabs visible, no overflow |
| 375px | iPhone 6/7/8/SE2 — common mobile |
| 390px | iPhone 12/13/14 — notched device, safe areas |
| 720px | `md` breakpoint — split/tablet layout appears |
| 744px | iPad mini 6/7 portrait — must render tablet layout, not mobile |
| 1024px | Desktop — sidebars appear |
| 1280px | XL Desktop — right sidebar, 3-column grids |
| 1440px | Large desktop — everything expanded |

### E2E Test Helpers

```typescript
// Mock mobile for integration tests
vi.mock("@/shared/hooks/useIsMobile", () => ({
  useIsMobile: () => true,  // force mobile layout
}));

// Set viewport in Playwright
await page.setViewportSize({ width: 375, height: 812 });
```

### What to Test on Each Breakpoint

- **Mobile (< 720px):** `MobileDock` tabs switch correctly, `MobileFloatingHUD` shows, safe areas applied, `VoiceInputView` persists across tab switches, instrument audio works after tab switch
- **Tablet (720-1023px):** `SplitTabWorkspaceShell` renders, tabs are functional, bottom splitter drags
- **Desktop (1024-1279px):** Sidebar visible, full labels shown, multi-column layouts
- **XL (≥1280px):** Right sidebar with effects/tools, 3-column grids

---

## 9. Anti-Patterns & Common Mistakes

| # | What | Why it's wrong | Do this instead |
|---|---|---|---|
| 1 | **Duplicating instrument UI for mobile tabs** | Breaks audio continuity — Tone.js synths disconnect on unmount | Mount once outside tabs, show/hide with CSS `hidden` |
| 2 | **`VoiceInputView` inside mobile tab panel** | WebRTC reconnects on every tab switch | Render `VoiceInputView` once in the mobile layout root |
| 3 | **Defining custom breakpoint constants** | `720` already defined in `useIsMobile` | Use `useIsMobile()` or `useMediaQuery()` |
| 4 | **`h-screen` instead of `h-dvh`** | Overflows on mobile (browser bars not subtracted) | Use `h-dvh min-h-dvh` |
| 5 | **Forgetting safe area on fixed elements** | Content hidden behind notch/home indicator | Add `env(safe-area-inset-*)` for fixed top/bottom elements |
| 6 | **Trying to unify mobile/desktop into one component** | Interaction models are fundamentally different (tabs vs split panels) | Create separate `*MobileLayout` and `*NonMobileLayout` |
| 7 | **Using `max-width` media queries (desktop-first)** | Leads to override chains, harder to maintain mobile | Always mobile-first: base = mobile, `min-width` to add desktop |
| 8 | **Recalculating canvas size on every resize event** | Performance killer on mobile orientation change | Debounce resize handler (200ms minimum) |
| 9 | **Missing `touch-manipulation` on instrument buttons** | Double-tap zoom triggers during fast playing | Always add `touch-manipulation` class + `touch-action: manipulation` |
| 10 | **Using `window.innerWidth` directly in render** | No reactive update on resize/orientation change | Always use `useIsMobile()` hook |
| 11 | **Hardcoding `44px` for top safe area** | Different devices have different notch sizes | Use `env(safe-area-inset-top)` |
| 12 | **Putting session-critical state in mobile-only components** | State lost when switching between mobile/desktop (e.g., rotate device) | Keep state in Zustand stores or the shared controller hook |

---

## 10. File Reference Map

### Hooks
| File | Purpose |
|---|---|
| `shared/hooks/useIsMobile.ts` | Mobile detection (`< 720px`) |
| `shared/hooks/useMediaQuery.ts` | Generic media query hook |
| `shared/hooks/useResizable.ts` | Pointer-driven resizable panels |
| `shared/ui/useTouchEvents.ts` | Touch press/release for instruments |

### Mobile-Specific Components
| File | Purpose |
|---|---|
| `features/rooms/shared/components/MobileDock.tsx` | Bottom tab bar |
| `features/rooms/shared/components/MobileFloatingHUD.tsx` | Top status bar |
| `features/rooms/shared/components/MobileBottomSheet.tsx` | Draggable bottom sheet |
| `features/rooms/shared/components/MobileControlsStrip.tsx` | Compact strip above `MobileDock` — entry point to `MobileBottomSheet` |
| `features/rooms/shared/components/MobileBottomSheet.tsx` | Full-screen drawer (slides up, drag-to-close), opened from `MobileControlsStrip` |
| `features/rooms/shared/components/ResizeHandle.tsx` | Shared resizable-split divider (mouse + touch) |
| `features/rooms/shared/components/chat/MobileChatDrawer.tsx` | Shared mobile chat popup, opened from `MobileControlsStrip`'s chat icon |
| `features/rooms/shared/components/SidebarShell.tsx` | Collapsible sidebar — `inline` (single sidebar) or `overlay` (strip + drawer) `displayMode` |
| `features/rooms/shared/components/SplitTabWorkspaceShell.tsx` | Split-panel non-mobile workspace |
| `features/rooms/arrange/components/transport/MobileTransportBar.tsx` | Arrange Room mobile transport bar (play/pause/stop/record + expandable tools row) |

### Layout Files
| Room | Non-Mobile | Mobile |
|---|---|---|
| Perform | `PerformRoomNonMobileLayout.tsx` | `PerformRoomMobileLayout.tsx` |
| Arrange | `ArrangeRoomNonMobileLayout.tsx` | `ArrangeRoomMobileLayout.tsx` |

> No `*DesktopLayout.tsx` files exist anymore — they were renamed to `*NonMobileLayout.tsx` since
> they cover both tablet (overlay sidebar) and desktop (inline sidebar) via internal `isTablet`/`isDesktop`
> checks (`useMediaQuery("(min-width: 1280px)")`). The old mobile "tools" dock tab was removed in
> favor of the `MobileControlsStrip` + `MobileBottomSheet` pattern (see § 3).

### Browser Compatibility
| File | Purpose |
|---|---|
| `shared/utils/webkitCompat.ts` | Safari/WebKit detection, touch delays, overscroll |

### Entry Pages
| File | Key Responsive Details |
|---|---|
| `pages/PerformRoom.tsx` | `isMobile` gate, safe area padding, `VoiceInputView` positioning |
| `pages/ArrangeRoom.tsx` | `isMobile` gate, safe area padding, `MultitrackTimeline` collapsible on mobile |
| `pages/Lobby.tsx` | Responsive tabs (`lg:hidden` vs `hidden lg:block`) |

### Global Styles
| File | Responsive Content |
|---|---|
| `index.css` | `touch-manipulation` class, `@media (pointer: coarse)` rules, `@media (hover: none)` rules |
| `index.html` | Viewport meta tag with `viewport-fit=cover` |

---

## 11. Quick Reference Card

```
MOBILE (< 720px):
  Layout: MobileDock + MobileFloatingHUD + tab content
  Safe area: paddingTop = calc(44px + env(safe-area-inset-top) + 4px)
  Avoid: h-screen → use h-dvh
  Canvas: fixed resolution + CSS scale-down
  Audio: mount outside tabs, use touch-manipulation class
  daisyUI: Use smallest sizes (btn-xs, select-xs, range-xs, badge-xs)
  UI framework: See tailwind-daisyui skill for component reference

DESKTOP (≥ 720px):
  Layout: SplitTabWorkspaceShell with resizable splitter
  Visibility: hidden sm:block, sm:hidden patterns
  Sidebar: SidebarShell (collapsible w-14 / w-96)
  daisyUI: Scale up sizes (btn-sm+, select-sm+, table-md)

XL (≥ 1280px):
  Sidebar: Right sidebar with effects + tools panels
  Grids: 3-column layouts
  daisyUI: Full-size components (btn-lg, modal-box with xl:p-5)

TOUCH:
  Class: touch-manipulation on all instrument buttons
  Hook: useTouchEvents for press/release
  Events: Prefer Pointer Events, native touch for instruments
  Viewport: maximum-scale=1.0, user-scalable=no
```
