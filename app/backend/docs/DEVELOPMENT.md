# Development Guide

This document provides comprehensive guidance for developing, testing, and debugging the murva backend.

## Table of Contents

- [Available Scripts](#available-scripts)
- [Definition of Done](#-definition-of-done)
- [Testing Framework](#testing-framework)
- [Quality Assurance](#quality-assurance)
- [Troubleshooting](#troubleshooting)
- [WebRTC Configuration](#webrtc-configuration)

---

## ✅ Definition of Done

When implementing or modifying features, you **MUST** ensure the following steps are completed before considering the task done. This applies to both human and AI agents.

### 1. Update Tests
- [ ] **Unit Tests**: Update or add unit tests for services/utils.
- [ ] **Integration Tests**: Ensure APIs and WebSocket events work as expected.
- [ ] **Regression Tests**: **CRITICAL** - Run `bun run test:regression` and add new cases if fixing bugs.

### 2. Update Documentation
- [ ] **API Docs**: Update `../docs/API_CONTRACT.md` if REST endpoints changed.
- [ ] **Event Docs**: Update `../docs/WS_CONTRACT.md` if Socket.IO events changed.
- [ ] **Database**: Update `docs/DATABASE.md` if schema changed.
- [ ] **Architecture**: Update `docs/ARCHITECTURE.md` if system design changed.

### 3. Verification
- [ ] All tests pass: `bun test`
- [ ] Linting and Types pass: `bun run lint && bun run type-check`
- [ ] Build succeeds: `bun run build`

---

## Available Scripts

### Development

- `bun run start:dev` — Start development server with hot reload (tsx)
- `bun run start:dev:gc` — Development with garbage collection monitoring
- `bun run build` — Build the project for production
- `bun run start` — Start the production server
- `bun run start:prod` — Production server with optimized memory settings

### Testing

#### Test Commands

- `bun test` — Run all Jest tests (unit + integration + regression)
- **`bun run test:regression`** — **CRITICAL**: Run regression tests (room management, arrange room, etc.)
- `bun run test:unit` — Run unit tests for isolated components
- `bun run test:integration` — Run integration tests for complete workflows
- `bun run test:e2e` — Run end-to-end tests for API/WebSocket validation
- `bun run test:watch` — Run tests in watch mode
- `bun run test:coverage` — Generate test coverage reports
- `bun run test:ci` — Run tests for CI/CD environments
- `bun run test:all` — Run all tests (unit + integration + regression)
- **`bun run test:webrtc`** — Run WebRTC specific tests
- **`bun run test:https`** — Run HTTPS validation tests
- **`bun run test:https:validate`** — Validate HTTPS certificate setup

**IMPORTANT**: Always run `bun run test:regression` before deploying to catch breaking changes.

### Quality & Maintenance

- `bun run lint` — Run ESLint
- `bun run lint:fix` — Fix linting issues automatically
- `bun run clean` — Remove build artifacts
- `bun run type-check` — Run TypeScript type checks

### Deployment

- `bun run docker:build` — Build Docker image
- `bun run docker:run` — Run Docker container
- `bun run docker:dev` — Run with Docker Compose
- `bun run railway:deploy` — Deploy to Railway
- `bun run railway:logs` — View Railway deployment logs
- `bun run railway:status` — Check Railway deployment status

---

## Testing Framework

### Overview

**276 tests total** across 26 test suites

Test breakdown:
- **Regression Tests**: Protect against breaking changes in critical features
- **Integration Tests**: Complete workflows and room lifecycle
- **Unit Tests**: Isolated component testing with proper mocking
- **End-to-End Tests**: API endpoints and WebSocket integration

### Regression Test Coverage

The regression test suite protects against critical bugs that were fixed. These tests are identified by the `.regression.test.ts` suffix and are co-located with the features they test.

**1. Room Management Fixes** (`src/domains/room-management/__tests__/fixes.regression.test.ts`):
- Active user count accuracy (prevents double increment on user rejoin)
- Private room user stability (prevents disappearing users)
- Race condition prevention in join/leave flows

**2. Arrange Room** (`src/domains/arrange-room/__tests__/regression.test.ts`):
- Multi-user track/region management
- Collaborative locking and conflict prevention
- State synchronization consistency

**3. Room Join Flow** (`src/domains/room-management/__tests__/room-join-flow.regression.test.ts`):
- Socket connection and disconnection flows
- User approval workflows
- Namespace creation and cleanup

### Test Structure

```
src/
├── domains/
│   ├── arrange-room/
│   │   └── __tests__/      # Feature-specific tests
│   └── room-management/
│       └── __tests__/      # Lifecycle and fix tests
tests/
├── e2e/                    # End-to-end API tests
├── helpers/                # Test utilities
└── utils/                  # Test utilities
```

### Test Utilities

**TestEnvironment**:
```typescript
import { TestEnvironment } from '../helpers/TestEnvironment';

const testEnv = new TestEnvironment();

beforeAll(() => testEnv.setup());
afterAll(() => testEnv.cleanup());
```

**MockFactory**:
```typescript
import { MockFactory } from '../helpers/MockFactory';

const mockUser = MockFactory.createUser({ userType: 'REGISTERED' });
const mockRoom = MockFactory.createRoom({ roomType: 'perform' });
```

### Running Tests

```bash
# Run all tests
bun test

# Run specific test suite
bun test src/domains/room-management/__tests__/fixes.regression.test.ts

# Run tests in watch mode
bun run test:watch

# Generate coverage report
bun run test:coverage

# Run only regression tests (CRITICAL before deployment)
bun run test:regression
```

### Performance Monitoring

Tests include built-in performance monitoring:

- Real-time performance metrics collection
- Automated regression detection
- Memory usage tracking
- Connection health monitoring
- Load testing with up to 100 concurrent users

### Legacy Testing

- **Performance Tests**: Load testing with concurrent users
- **HTTPS Tests**: WebRTC over TLS validation
- **Edge Case Tests**: Boundary conditions and error scenarios
- **WebRTC Integration**: Voice communication and signaling tests

---

## Quality Assurance

### Real Infrastructure Testing
To ensure reliability, we run integration tests against real infrastructure (Redis) instead of just mocks.

**Redis Integration Tests**:
- Located in `src/shared/__tests__/integration/RealRedisStateService.integration.test.ts`
- Verifies reading/writing to a real Redis instance.
- Requires `REDIS_URL` to be set in `.env` (e.g., `redis://localhost:6379`).

```bash
# Run Real Redis tests
bun test src/shared/__tests__/integration/RealRedisStateService.integration.test.ts
```

### Concurrency Testing
We test for potential race conditions and data consistency under high load.

**Concurrency Tests**:
- Located in `src/domains/arrange-room/__tests__/integration/ProjectSaveConcurrency.test.ts`
- Simulates concurrent project save requests.
- Verifies that the system handles parallel operations without crashing or corrupting data.

```bash
# Run Concurrency tests
bun test src/domains/arrange-room/__tests__/integration/ProjectSaveConcurrency.test.ts
```

### Linting

```bash
# Run ESLint
bun run lint

# Auto-fix issues
bun run lint:fix
```

### Type Checking

```bash
# Run TypeScript type checker
bun run type-check
```

### Code Quality Tools

- **ESLint** with TypeScript strict rules (`@typescript-eslint/no-explicit-any` enforced as `error`)
- **TypeScript** strict mode
- **Prettier** (if configured)

### Development Tools

- **Hot reload** development server (tsx)
- **SSL certificate** generation scripts
- **Garbage collection** monitoring

---

## Troubleshooting

###Common Issues

**Rate limit exceeded**
- Wait or set `DISABLE_VOICE_RATE_LIMIT=true` for development

**HTTPS required**
- Use `bun run test:https:validate` to check SSL setup
- Generate certificates: `bun run scripts/generate-ssl.js`

**WebRTC connection fails**
- Ensure both frontend and backend use HTTPS
- Check STUN/TURN server configuration
- Verify firewall settings

**Audio not heard**
- Check browser permissions
- Review WebRTC signaling logs
- Verify voice chat is enabled

**Memory leaks**
- Monitor with `bun run start:dev:gc`
- Check for unclosed connections
- Review event listener cleanup

**Performance issues**
- Run `bun run test:performance` for analysis
- Enable clustering: `CLUSTER_ENABLED=true`
- Review memory thresholds

**Test failures**
- Use `bun test` not `bun test`
- Check test environment setup
- Review mock configurations
- Run in isolation: `bun test -- tests/path/to/test.ts`

### Debug Commands

```bash
# Validate HTTPS configuration
bun run test:https:validate
bun run scripts/validate-https-setup.ts

# Run load tests
bun run test:load

# Performance monitoring
bun run test:performance

# Check system health
bun run start:dev:gc
```

### Debugging Tests

**1. Enable Console Output**

```bash
# Run tests with verbose output
bun test -- --verbose

# Run specific test file
bun test tests/unit/room-management/RoomLifecycleService.test.ts
```

**2. Isolate Failing Tests**

```typescript
// Use .only to run single test
it.only('should create room correctly', async () => {
  // test code
});
```

**3. Debug with Node Inspector**

```bash
node --inspect-brk node_modules/.bin/jest tests/path/to/test.ts
# Open chrome://inspect in Chrome
```

---

## WebRTC Configuration

### Rate Limiting

To protect signaling and voice traffic, the app applies per-user rate limits:

- `voice_offer`: 60/min (≈1/sec)
- `voice_answer`: 60/min (≈1/sec)
- `voice_ice_candidate`: 200/min (≈3.3/sec)

**Recovery and Safety:**
- Exponential backoff for reconnection attempts (2s, 4s, 8s)
- Temporary extra attempts for users who recently hit limits
- Development bypass via `DISABLE_VOICE_RATE_LIMIT=true`

> Adjust limits carefully — raising them can increase server and network load.

### STUN/TURN Servers

Default STUN servers configured:

```javascript
{
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
}
```

**For production**, add TURN servers for reliable connectivity behind restrictive NATs/firewalls:

```javascript
{
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'username',
      credential: 'password'
    }
  ]
}
```

### HTTPS Development Setup

For WebRTC testing, HTTPS is required:

```bash
# Generate SSL certificates (requires mkcert)
bun run scripts/generate-ssl.js

# Or validate existing HTTPS setup
bun run test:https:validate
```

**Environment Variables:**

```bash
SSL_ENABLED=true
SSL_KEY_PATH=./certs/key.pem
SSL_CERT_PATH=./certs/cert.pem
WEBRTC_ENABLED=true
WEBRTC_REQUIRE_HTTPS=true
```

---

See also:
- [Architecture Documentation](./ARCHITECTURE.md) - System architecture
- [API Reference](../../docs/API_CONTRACT.md) - REST API
- [WebSocket Events](../../docs/WS_CONTRACT.md) - Real-time events
- [Deployment Guide](./DEPLOYMENT.md) - Production deployment
