<!-- doc-sync: codebase-reference -->
# Real-time Communication Domain

This domain provides the foundation for hybrid audio communication strategies in the murva application, supporting both mesh WebRTC for band members and streaming for audience members.

> **Status:** the strategy layer (`AudioCommunicationService`, `MeshWebRTCStrategy`, `StreamingStrategy`, `DefaultCommunicationStrategyFactory`) is design scaffolding covered by unit tests but **not wired into any runtime path** — outside consumers import only `VoiceConnectionHandler` / `ChatHandler`. Live voice runs entirely through `infrastructure/handlers/Voice*Handler.ts` (namespace handlers). The latency/scalability tables below are design targets, not measured behavior.

## Overview

The hybrid communication strategy addresses different requirements for different user types:

- **Band Members**: Require ultra-low latency for real-time musical collaboration → **Mesh WebRTC**
- **Audience**: Require scalability to support many listeners → **Streaming Strategy**

## Architecture

### Domain Models

#### `Connection.ts`
- `ConnectionId`: Strongly-typed connection identifier
- `UserRole`: Enum defining user roles (BAND_MEMBER, AUDIENCE, ROOM_OWNER)
- `AudioConnection`: Represents an active audio connection with health monitoring
- `AudioBuffer`: Standard audio data format

#### `AudioCommunicationStrategy.ts`
- `AudioCommunicationStrategy`: Abstract interface for communication strategies
- `CommunicationStrategyFactory`: Factory for creating appropriate strategies
- Domain exceptions: `InvalidRoleError`, `ConnectionFailedError`, `UnsupportedOperationError`

### Infrastructure Strategies

#### `MeshWebRTCStrategy.ts`
- Implements peer-to-peer mesh networking for band members
- Each band member connects directly to every other band member
- Optimized for ultra-low latency (10-60ms)
- Supports up to 8 concurrent connections (practical mesh limit)
- Handles connection recovery and health monitoring

#### `StreamingStrategy.ts`
- Implements one-to-many streaming for audience members
- Band members stream to central hub, which broadcasts to audience
- Optimized for scalability (supports 1000+ audience members)
- Higher latency (100-300ms) but much more scalable
- Includes buffering and quality adaptation

### Application Services

#### `AudioCommunicationService.ts`
- Coordinates between different communication strategies
- Automatically selects appropriate strategy based on user role
- Provides unified interface for connection management
- Handles strategy lifecycle and resource cleanup

## Usage

### Basic Setup

```typescript
import { 
  AudioCommunicationService,
  DefaultCommunicationStrategyFactory,
  UserRole
} from './domains/real-time-communication';

// Initialize service
const strategyFactory = new DefaultCommunicationStrategyFactory(io, roomSessionManager);
const audioService = new AudioCommunicationService(strategyFactory, io, roomSessionManager);

// Connect band member (uses mesh WebRTC)
const bandConnectionId = await audioService.connectUser('user123', UserRole.BAND_MEMBER, 'room456');

// Connect audience member (uses streaming)
const audienceConnectionId = await audioService.connectUser('user789', UserRole.AUDIENCE, 'room456');
```

### Relationship to VoiceConnectionHandler

The strategy layer is not wired into `VoiceConnectionHandler`; live voice runs entirely through the namespace handlers.

### Strategy Selection Logic

The `DefaultCommunicationStrategyFactory` automatically selects strategies based on user role:

- **Band Members & Room Owners** → `MeshWebRTCStrategy`
  - Ultra-low latency for musical collaboration
  - Direct peer-to-peer connections
  - Limited to ~8 concurrent users

- **Audience Members** → `StreamingStrategy`
  - Scalable one-to-many streaming
  - Higher latency but supports 1000+ users
  - Centralized streaming hub

## Testing

Run the comprehensive test suite:

```bash
bun run --cwd app/backend test:unit -- --testPathPatterns="real-time-communication"
```

Tests cover:
- Strategy selection and connection management
- Audio data transmission
- Connection health monitoring
- Error handling and recovery
- Domain model validation

## Future Enhancements

This foundation is designed to support future audio features:

### 1. Advanced Audio Routing
```typescript
// Future: Audio bus routing through strategies
await audioService.routeAudio(userId, {
  effects: ['reverb', 'delay'],
  mixerChannel: 'lead-guitar',
  outputBus: 'main-mix'
});
```

### 2. Adaptive Quality
```typescript
// Future: Dynamic quality adaptation
const strategy = audioService.getStrategy(roomId);
await strategy.adaptQuality({
  targetLatency: 50, // ms
  maxBandwidth: 128000, // bps
  connectionQuality: 'poor'
});
```

### 3. Hybrid Mesh-Streaming
```typescript
// Future: Hybrid approach for large bands
const hybridStrategy = new HybridMeshStreamingStrategy({
  meshLimit: 4, // First 4 band members use mesh
  streamingForRest: true // Additional members use streaming
});
```

## Requirements Fulfilled

- **Requirement 10.2**: Foundation for future audio features
  - ✅ Clear patterns for instrument swapping
  - ✅ Audio bus routing architecture
  - ✅ Mixer functionality preparation

- **Requirement 10.3**: Hybrid communication strategy
  - ✅ Abstract strategy interface
  - ✅ Mesh WebRTC for band members
  - ✅ Streaming strategy for audience
  - ✅ Automatic strategy selection

## Performance Characteristics

### Mesh WebRTC Strategy
- **Latency**: 10-60ms (excellent for music)
- **Scalability**: Up to 8 users (mesh network limit)
- **Bandwidth**: High (each user sends to all others)
- **Use Case**: Band members requiring tight synchronization

### Streaming Strategy
- **Latency**: 100-300ms (acceptable for listening)
- **Scalability**: 1000+ users (one-to-many)
- **Bandwidth**: Efficient (single stream per user)
- **Use Case**: Audience members listening to performance

## Integration Points

This domain integrates with:
- `VoiceConnectionHandler`: independent — owns the live namespace voice mesh; not strategy-driven
- FE peer: `app/frontend/src/features/audio/services/VoicePresenceManager.ts` (JOIN_VOICE debounce, `selfRegistered` re-announce)
- `RoomSessionManager`: User session tracking
- `Socket.IO`: Real-time communication transport
- Future `AudioBusService`: Audio routing and effects
- Future `MixerService`: Audio mixing and levels
## Code map

| File | Responsibility |
|---|---|
| `domain/models/Connection.ts` | Peer connection model (state, participants). |
| `domain/services/AudioCommunicationStrategy.ts` | Strategy interface for how audio is transported. |
| `infrastructure/strategies/MeshWebRTCStrategy.ts` | Full-mesh WebRTC transport (default small-room voice). |
| `infrastructure/strategies/StreamingStrategy.ts` | Server-relayed/streaming transport (larger audiences). |
| `application/AudioCommunicationService.ts` | Selects + drives the active strategy. |
| `infrastructure/handlers/VoiceConnectionHandler.ts` | Namespace voice orchestrator — join/leave, voice roster + mesh membership version, mesh reconcile (`MESH_PARTICIPANTS` + `selfRegistered`) with keep-alive, mute/speaking; delegates offer/answer/ICE to `VoiceSignalingHandler` and heartbeat/prune to `VoiceConnectionHealthHandler`. |
| `infrastructure/handlers/VoiceSignalingHandler.ts` | Offer/answer/ICE-candidate relay between peers. |
| `infrastructure/handlers/VoiceConnectionHealthHandler.ts` | Peer health monitoring + stuck-peer reconnect signaling. |
| `infrastructure/handlers/ChatHandler.ts` | Room text-chat socket handler. |

## Invariants & gotchas

1. **Transport is strategy-selected, not hard-coded** — mesh vs streaming is chosen by `AudioCommunicationService`; add new transports as a `AudioCommunicationStrategy` implementation, don't branch inside handlers.
2. **Signaling identity comes from the verified session** (TR-33), not the socket payload.
3. **Cross-browser WebRTC quirks** are documented in [`docs/WEBRTC_BROWSER_COMPAT.md`](../../../../../docs/WEBRTC_BROWSER_COMPAT.md) / [`WEBRTC_CAPABILITY_PROFILE.md`](../../../../../docs/WEBRTC_CAPABILITY_PROFILE.md) — keep browser-conditional code in the capability profile, not scattered.
4. **Mesh reconcile is a keep-alive** — `handleRequestMeshConnectionsNamespace` refreshes `lastHeartbeat`, because `VOICE_HEARTBEAT` is not sent when a client has zero peers and the 60s stale prune (`VoiceConnectionHealthHandler`) would drop solo participants. Codified by `__tests__/VoiceConnectionHandler.keepAlive.test.ts`.
5. **`MESH_PARTICIPANTS.selfRegistered` is the only drop signal** — the roster excludes self, so a client learns it was pruned (or lost a JOIN_VOICE race) only from this flag and must re-announce. Codified by `VoiceConnectionHandler.keepAlive.test.ts`.
6. **Broadcast to the plain `roomId`, never `namespace.name`** — sockets join the bare
   room id (`RoomJoinEmitter.ts`), so `socket.to(namespace.name)` targets an empty room
   and is silently dropped. Use `session.roomId` (token-verified, TR-33). Codified by the
   `no-restricted-syntax` rule in `app/backend/eslint.config.mjs` and by
   `__tests__/VoiceConnectionHandler.broadcastRoomKey.test.ts`.
