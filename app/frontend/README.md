# murva Frontend

> **🎵 A real-time collaborative music-making web application**  
> Built for musicians who want to jam together online with minimal latency!

---

## 📑 Table of Contents

- [Tech Stack](#-tech-stack)
- [Browser Support](#-browser-support)
- [Quick Start](#-quick-start)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Documentation](#-documentation)

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, React Router 7
- **Audio**: Web Audio API, Tone.js 15, Smplr 0.26, @tonejs/midi 2.0
- **Music Theory**: Tonal.js 6
- **Real-time**: Socket.IO 4.8, WebRTC
- **State**: Zustand 5, TanStack Query 5
- **Styling**: Tailwind CSS 4, DaisyUI 5
- **UI Components**: @dnd-kit, react-konva, react-easy-crop
- **PWA**: VitePWA with Workbox
- **Dev Tools**: ESLint 9, Prettier 3, TypeScript 5.8, Husky

---

## 🌐 Browser Support

- **Chrome/Edge/Brave 90+** ✅ Recommended - Full MIDI & synthesizer support
- **Firefox 88+** ⚠️ Limited MIDI support
- **Safari 14+** ⚠️ No external MIDI device support (WebKit limitation)

> **Best Performance**: Chromium-based browsers for full MIDI device support.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ or Bun
- Modern web browser with Web Audio API support

### Installation

```bash
# 1. Clone and install
git clone <repository-url>
cd app/frontend
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env with your settings

# 3. Start development
bun dev

# 4. Open browser
# Navigate to http://localhost:5173
```

### Full Stack Setup

**Backend** (separate terminal):
```bash
cd ../app/backend
bun install
cp .env.example .env
bun run start:dev  # Runs on http://localhost:3001
```

**Frontend**:
```bash
cd ../app/frontend
bun dev  # Runs on http://localhost:5173
```

> **Note**: Local dev runs over plain HTTP by default (`SSL_ENABLED=false`). HTTPS is opt-in — set `SSL_ENABLED=true` to enable a local certificate via `vite-plugin-mkcert` (only needed for WebRTC testing on real devices). See [`app/backend/README.md`](../app/backend/README.md) for backend setup details.

### E2E Testing (Playwright)

```bash
# Install browser (one-time per machine)
bunx playwright install chromium

# Optional: install all browsers used by Playwright projects
bunx playwright install chromium firefox webkit

# Run headless e2e tests
bun run test:e2e

# Open interactive Playwright UI
bun run test:e2e:ui
```

By default Playwright starts the Vite dev server at `http://127.0.0.1:4173` for tests.

Playwright uses a global setup (`e2e/global-setup.ts`) that logs in once and reuses auth state for all tests.

```bash
# Override account for e2e login if needed
E2E_USER_EMAIL=your@email.com E2E_USER_PASSWORD=yourpassword bun run test:e2e
```

---

## 🏛️ Architecture

> **This is the architecture the project has committed to.** All **new code must follow it.**
> The existing codebase is **converging toward it incrementally** — some areas don't conform yet
> and are grandfathered as tracked debt (see [status](#status--how-to-contribute) below). When in
> doubt, follow this model, not the surrounding legacy.

The frontend is organized along **three axes that stack on top of each other**:

### 1. Feature-driven (TR-37) — *how code is grouped*
Domain logic lives in `src/features/<feature>/` (its own `components/hooks/stores/services/utils`).
`src/pages/` are **route shells only** (compose features, no logic). Cross-feature imports go through
a feature's **public surface** (`index.ts` barrel = a *curated* API, not re-export-everything) — never
deep-import another feature's internals.

### 2. Unidirectional Data Flow / UDF (TR-36) — *how state moves*
```
event → store action → Zustand store → selector → UI
                     ↘ subscribe → side-effect (audio engine, socket emit, navigate)
```
- **One store per state** (no mirroring into `useState`, no duplication)
- **Write via named actions only** — components never call `getState`/`setState` (ESLint **error**)
- **Inbound socket = a store action or the typed `roomSocketBus`** (mitt bus for command events)
- **Read via selector** — derived values computed in selectors/`useMemo`, never stored

### 3. Capability layers (TR-38) — *which layer may depend on which*
On top of the feature axis, a capability-layer axis with a **lint-enforced, one-way dependency direction**:
```
shell (pages) → feature → driver → engine → shared      (same-tier feature → feature is allowed)
```
| Layer | Role | May import |
|-------|------|-----------|
| `src/pages/` (**shell**) | route composition | feature, driver, engine, shared |
| `src/features/` (**feature**) | UI + state + wiring of a product capability | feature, driver, engine, shared |
| `src/drivers/` (**driver**) | translate a room's control model → engine `NoteEvent`s (perform=live@now, arrange=scheduled@t) | engine, shared |
| `src/engine/` (**engine**) | room-agnostic capability core (instruments, synth, effects, AudioContext, the `NoteEvent` seam) — **no room-awareness** | engine, shared |
| `src/shared/` (**shared**) | generic leaf utilities/types | shared only |

Enforced by **`eslint-plugin-boundaries`** with a **shrink-only suppressions baseline**
(`eslint-suppressions.json`) — existing cross-layer edges are grandfathered and can only be *removed*,
never added. A new violation **fails lint**.

### Status & how to contribute
- ✅ **Enforced today:** the full matrix + ratchet — you **cannot introduce** a new layer violation.
- ✅ **Migration complete (2026-07-06):** engine capabilities (audio, instruments, effects) now live in
  `src/engine/` importing 0 features. A small set of `shared → feature` edges remain as **permanent
  grandfathers** (mostly type-only wire types + genuinely cross-cutting components); the ratchet keeps
  them from growing. Voice/recording/sequencer/companion + the effect-catalog UI intentionally stay
  feature-layer.
- 🟡 **Reserved / deferred:** `src/drivers/` is an empty reserved layer — the true thin live/scheduled
  seams are deliberately deferred until the perform/arrange input paths are decomposed (a design task,
  not a file move). Full status + rationale: [`docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md`](../../docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md).
- **When you touch a grandfathered file:** prefer moving it toward the target (shrinks the baseline);
  at minimum, don't add new violations.

**Canonical references:** [Architecture Guide](./docs/ARCHITECTURE.md) · Rules
[`docs/RULES_AND_CONSTRAINTS.md`](../../docs/RULES_AND_CONSTRAINTS.md) (TR-36 UDF, TR-37 features, TR-38 layers) ·
ADRs [UDF](../../docs/adr/2026-07-05-frontend-unidirectional-data-flow.md) ·
[Room/Engine re-layering](../../docs/adr/2026-07-05-room-engine-relayering.md)

---

## 📁 Project Structure

```
src/
├── features/           # Feature-based architecture
│   ├── account/        # Account settings & billing
│   ├── ai/             # AI-powered generation features
│   ├── audio/          # Audio processing & WebRTC voice
│   ├── auth/           # Authentication hooks & utilities
│   ├── band/           # Band management
│   ├── community/      # Community / public project discovery
│   ├── effects/        # Audio effects chains
│   ├── feedback/       # User feedback collection
│   ├── instruments/    # Virtual instruments (Guitar, Bass, Drums, Synth)
│   ├── lobby/          # Lobby room list & management
│   ├── metronome/      # Synchronized timing
│   ├── profile/        # User profile dashboard
│   ├── projects/       # Project save/load & management
│   ├── sequencer/      # Step sequencer (shared between rooms)
│   ├── subscription/   # Plan tiers & subscription UI
│   ├── virtual-inputs/ # Virtual input surfaces & MIDI input
│   ├── rooms/          # Room management & Socket.IO
│   │   ├── arrange/    # Arrange Room (Collaborative production)
│   │   ├── perform/    # Perform Room (Live Jamming)
│   │   └── shared/     # Shared room components
│   └── ui/             # Shared UI components (being split: primitives → shared, music-UI → feature)
├── engine/             # Capability core — room-agnostic (TR-38). Imports only shared.
│   ├── audio/          # AudioContext lifecycle + audio config
│   ├── effects/        # Canonical EffectType model
│   └── instruments/    # NoteEvent seam type
├── drivers/            # Event-source seam: room control → engine NoteEvents (TR-38)
│   ├── live/           # perform: schedule @now
│   └── scheduled/      # arrange: Tone.Transport @t
├── shared/             # Cross-feature leaf utilities & stores (imports nothing app-ward)
│   ├── technical-info/ # Technical environment context (OS, Browser, Session)
│   ├── webrtc/         # Browser capability detection
│   ├── services/       # BaseRoomSyncService, Socket.IO
│   ├── stores/         # Global Zustand stores
│   └── utils/          # Utility functions
├── pages/              # Main app routes (shell layer)
└── app-config/         # Router & provider configuration
```

> **For detailed architecture, see [Architecture Guide](./docs/ARCHITECTURE.md)**

---

## 📚 Documentation

### Core Documentation

- **[Architecture Guide](./docs/ARCHITECTURE.md)** - System architecture, audio routing, and design patterns
- **[Music Theory System](./docs/MUSIC_THEORY.md)** - Scale system, keyboard modes, and theory assistance
- **[Stem Export](../../docs/STEM_EXPORT_SPEC.md)** - Export audio stems + MIDI for external DAWs
- **[Development Guide](./docs/DEVELOPMENT.md)** - Development workflow, testing, and code style
- **[Authentication](../../docs/AUTHENTICATION_FLOW.md)** - Auth flows, token management, and OAuth

### Quick Links

- **Backend Setup**: See [`app/backend/README.md`](../backend/README.md)
- **API Documentation**: See [`docs/API_CONTRACT.md`](../../docs/API_CONTRACT.md)
- **WebSocket Events**: See [`docs/WS_CONTRACT.md`](../../docs/WS_CONTRACT.md)

---

_Built with ❤️ for musicians everywhere_

> **Note**: This app prioritizes **lowest latency over audio quality** — perfect for real-time musical collaboration where timing is everything!
