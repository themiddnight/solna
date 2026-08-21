# murva — Backend

A TypeScript Express.js backend for the murva application with **dual room architecture**:

- **Perform Rooms**: Real-time jamming sessions with ultra-low latency audio sync
- **Arrange Rooms**: Collaborative production workspace for multi-user music production with real-time timeline editing

Provides REST endpoints, WebSocket/Socket.IO handlers for real-time features, WebRTC signaling for voice communication, and comprehensive user/band/project management.

## Quick Overview

- **Language**: TypeScript
- **Framework**: Express (HTTP) + Socket.IO for real-time features
- **Runtime**: Node.js 22+ (Bun compatible)
- **Architecture**: Domain-Driven Design (DDD) with modular bounded contexts
- **Database**: PostgreSQL with Prisma ORM
- **Storage**: Backblaze B2 (S3-compatible) for audio files and images
- **Room Types**:
  - **Perform Room**: Live jamming with ephemeral sessions
  - **Arrange Room**: Collaborative production workspace with real-time multi-track production
- **Core Features**:
  - User authentication (email/password + Google OAuth)
  - Band creation and member management
  - Project sharing with visibility controls
  - Community browsing with active session detection
  - AI-powered music generation
  - Real-time collaboration with WebRTC voice

---

## 📑 Table of Contents

- [Getting Started](#getting-started)
  - [Requirements](#requirements)
  - [Installation](#installation)
  - [HTTPS Development Setup](#https-development-setup)
- [Available Scripts](#available-scripts)
- [Documentation](#documentation)

---

## Getting Started

### Requirements

- Node.js v22+ or Bun runtime
- PostgreSQL database
- **Redis (required for room state management)**
- For HTTPS development: mkcert (recommended) or OpenSSL

### Installation

1. **Install dependencies**

```bash
bun install
```

2. **Set up environment variables**

```bash
cp .env.example .env
```

Edit `.env` and configure:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string (required for room state management)
- `JWT_SECRET` - Secret key for JWT tokens
- `BACKEND_URL` - Backend URL for OAuth callbacks
- `FRONTEND_URL` - Frontend URL for CORS and redirects
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - For Google OAuth
- See [Deployment Guide](./docs/DEPLOYMENT.md#environment-variables) for full list

3. **Run database migrations**

```bash
bunx prisma migrate dev
```

4. **Start the development server**

```bash
bun run start:dev
# or with garbage collection monitoring:
bun run start:dev:gc
```

By default the server listens on http://localhost:3001 (see `PORT` env var).

### HTTPS Development Setup

Local development defaults to plain HTTP (`SSL_ENABLED=false`). HTTPS is opt-in and only needed when testing WebRTC on real devices:

```bash
# Generate SSL certificates (requires mkcert)
bun run scripts/generate-ssl.js

# Or validate existing HTTPS setup
bun run test:https:validate
```

Set in `.env`:
```bash
SSL_ENABLED=true
SSL_CERT_PATH=.ssl/server.crt
SSL_KEY_PATH=.ssl/server.key
```

Remember to switch `BACKEND_URL` / `FRONTEND_URL` to `https://` when SSL is enabled.

---

## Available Scripts

### Development

- `bun run start:dev` — Start development server with hot reload (tsx)
- `bun run start:dev:gc` — Development with garbage collection monitoring
- `bun run build` — Build the project for production
- `bun run start:prod` — Production server with optimized memory settings

### Testing

- `bun test` — Run unit + integration tests (regression runs separately, see `test:regression`)
- **`bun run test:regression`** — **CRITICAL**: Run regression tests before deploying
- `bun run test:unit` — Run unit tests
- `bun run test:integration` — Run integration tests
- `bun run test:coverage` — Generate test coverage reports
- `bun run test:webrtc` — Run WebRTC specific tests
- `bun run test:https:validate` — Validate HTTPS certificate setup

See [Development Guide](./docs/DEVELOPMENT.md) for complete testing documentation.

### Quality & Maintenance

- `bun run lint` — Run ESLint
- `bun run lint:fix` — Fix linting issues automatically
- `bun run type-check` — Run TypeScript type checks

### Deployment

See [Deployment Guide](./docs/DEPLOYMENT.md) for detailed deployment instructions (Docker and Railway deployment).

---

## Documentation

### Core Documentation

- **[Architecture Guide](./docs/ARCHITECTURE.md)** - Room architecture, DDD structure, service organization
- **[Database Schema](./docs/DATABASE.md)** - ER Diagram, models, user tiers
- **[API Reference](../../docs/API_CONTRACT.md)** - HTTP REST API endpoints
- **[WebSocket Events](../../docs/WS_CONTRACT.md)** - Real-time events and Socket.IO
- **[Development Guide](./docs/DEVELOPMENT.md)** - Testing, quality assurance, troubleshooting
- **[Deployment Guide](./docs/DEPLOYMENT.md)** - Docker, Railway, environment configuration
- **[Performance Guide](./docs/PERFORMANCE.md)** - Scaling, clustering, optimization
- **[Roadmap](../../docs/ROADMAP.md)** - Implementation roadmap and future plans

### Quick Reference

#### Room Types

- **Perform Room**: Live jamming with real-time instrument sync, step sequencer, WebRTC voice
- **Arrange Room**: Collaborative production workspace with multi-track production, MIDI/audio recording, locking system

See [Architecture Guide](./docs/ARCHITECTURE.md#room-architecture) for details.

#### Authentication

Supports email/password login and Google OAuth. See [Authentication Flow](./docs/ARCHITECTURE.md#service-architecture) in Architecture Guide.

#### Testing

Comprehensive test suite with unit, integration, and regression tests. Always run regression tests before deploying:

```bash
bun run test:regression
```

See [Development Guide](./docs/DEVELOPMENT.md#testing-framework) for testing details.

---

## Need Help?

- **Architecture questions**: See [Architecture Guide](./docs/ARCHITECTURE.md)
- **API Documentation**: See [`docs/API_CONTRACT.md`](../../docs/API_CONTRACT.md)
- **WebSocket Events**: See [`docs/WS_CONTRACT.md`](../../docs/WS_CONTRACT.md)

---

Built with ❤️ for musicians and creators 🎵✨
