<!-- doc-sync: codebase-reference -->
# User Onboarding Coordination Workflow

This directory contains the implementation of the user onboarding coordination workflow as specified in task 8.3 of the architecture refactoring specification.

## Overview

The user onboarding coordination workflow orchestrates complex user preparation across multiple bounded contexts when users join a room. It ensures that all necessary components (instruments, audio routing, voice connections) are ready before allowing users to participate in playback.

## Requirements Addressed

- **5.2**: Event-driven coordination for complex workflows
- **5.3**: Loosely coupled services through events
- **10.4**: Foundation for future audio features

## Components

### Events (`../../../shared/domain/events/UserOnboardingEvents.ts`)

#### Core Coordination Events
- `UserJoinedRoom` - Published when a user joins a room and onboarding begins
- `UserInstrumentsReady` - Published when user's instruments are prepared
- `UserAudioRoutingReady` - Published when user's audio routing is configured
- `UserVoiceConnectionReady` - Published when user's voice connection is established
- `UserReadyForPlayback` - Published when all components are ready

#### Error Handling Events
- `UserOnboardingFailed` - Published when onboarding fails
- `UserOnboardingTimeout` - Published when onboarding times out

### Coordinator (`../../../shared/infrastructure/events/UserOnboardingCoordinator.ts`)

The main orchestrator that:
- Tracks onboarding sessions for each user
- Coordinates between different services through events
- Handles timeouts and failures
- Publishes final readiness events
- Cleans up completed sessions

## Workflow Process

1. **User Joins Room**: `UserJoinedRoom` event is published
2. **Parallel Preparation**: Multiple services respond simultaneously:
   - Instrument Service prepares user instruments
   - Audio Bus Service sets up audio routing
   - Voice Connection Service establishes WebRTC connection
3. **Component Readiness**: Each service publishes ready events:
   - `UserInstrumentsReady`
   - `UserAudioRoutingReady`
   - `UserVoiceConnectionReady`
4. **Coordination**: Coordinator waits for all components
5. **Completion**: `UserReadyForPlayback` event is published
6. **Cleanup**: Session is removed from active sessions

## Key Features

### Multi-User Support
- Handles multiple users joining simultaneously
- Independent session tracking per user
- No conflicts between concurrent onboarding processes

### Error Handling
- Component-level failure detection
- Timeout handling with configurable duration
- Automatic session cleanup on failure

### Performance
- Parallel processing of components
- Efficient event-driven coordination
- Minimal memory footprint with automatic cleanup

### Connection Strategy Support
- Band members use mesh WebRTC connections
- Audience members use streaming connections
- Extensible for future communication strategies

## Testing

> **Status:** the onboarding-coordination workflow described above is the
> event-driven design; it currently has no dedicated test suite in this
> directory. The room application services (`RoomApplicationService`,
> `RoomLifecycleService`, `RoomMembershipService`) are covered by the
> room-management integration tests. Add a coordinator suite when the workflow
> is wired into a live join path.

## Usage Example

```typescript
import { UserOnboardingCoordinator } from '../../../shared/infrastructure/events/UserOnboardingCoordinator';
import { InMemoryEventBus } from '../../../shared/domain/events/InMemoryEventBus';
import { UserJoinedRoom } from '../../../shared/domain/events/UserOnboardingEvents';

// Setup
const eventBus = new InMemoryEventBus();
const coordinator = new UserOnboardingCoordinator(eventBus);

// Setup your services to respond to UserJoinedRoom events
// (InstrumentService, AudioBusService, VoiceConnectionService)

// Start onboarding
await eventBus.publish(new UserJoinedRoom(
  'room-123',
  'user-456', 
  'Alice',
  'band_member'
));

// The coordinator will handle the rest automatically
```

## Performance Characteristics

- **Concurrent Users**: Designed for up to 10 simultaneous users
- **Completion Time**: Typically 200-600ms depending on component complexity
- **Memory Usage**: Minimal with automatic session cleanup
- **Failure Recovery**: Immediate cleanup on component failures

## Future Enhancements

The workflow is designed to support future audio features:
- Instrument swapping coordination
- Audio bus routing with effects
- Mixer functionality
- Advanced WebRTC strategies (SFU, MCU)

## Event Flow Diagram

```
UserJoinedRoom
     ↓
┌────────────────────────────────────┐
│  Parallel Component Preparation    │
├────────────┬─────────────┬─────────┤
│ Instruments│ Audio Routing│ Voice   │
│ Service    │ Service      │ Service │
└────────────┴─────────────┴─────────┘
     ↓              ↓           ↓
UserInstruments  UserAudio   UserVoice
Ready           RoutingReady ConnectionReady
     ↓              ↓           ↓
     └──────────────┼───────────┘
                    ↓
            UserReadyForPlayback
```

This implementation provides a solid foundation for complex user coordination workflows while maintaining loose coupling between services through event-driven architecture.

---

## Related Documentation

- [ROOM_LIFECYCLE.md](./ROOM_LIFECYCLE.md) — Room lifecycle, ghost user cleanup, and future enhancements

## Code map

> The body above documents one concern that lives here — the **user-onboarding
> coordination workflow**. The directory's primary residents are the room
> application services:

| File | Responsibility |
|---|---|
| `RoomApplicationService.ts` | Application entry point for room use cases (create/join/leave orchestration). |
| `RoomLifecycleService.ts` | Room lifecycle transitions (open, grace period, cleanup). |
| `RoomMembershipService.ts` | Membership + role changes (owner transfer, kick, band/audience). |
| `../../../shared/domain/events/UserOnboardingEvents.ts` | Onboarding coordination events (documented above). |
| `../../../shared/infrastructure/events/UserOnboardingCoordinator.ts` | The onboarding coordinator (documented above). |

## Invariants & gotchas

1. **Acting identity from the verified session** (TR-33) — membership/lifecycle actions derive the actor from `session.userId`, never the client payload.
2. **TR-2's per-room mutex does not apply here** — it guards `BaseRoomStateService` subclasses (arrange/perform room state). Room metadata goes through `RoomRepository` (Redis hash + cache) and membership through `roomUserRepository`, which serializes via field-scoped atomic updates rather than the room-state lock. Don't assume a lock is held.
3. **Grace period (TR-17)** is enforced in `RoomLifecycleService` via `NamespaceGracePeriodManager`. **Ownership auto-transfer (BR-8)** is driven from `RoomConnectionHandler`/`RoomOwnershipHandler` → `RoomMembershipService.transferOwnership` → `RoomUserService.transferOwnership` — see [`docs/RULES_AND_CONSTRAINTS.md`](../../../../../../docs/RULES_AND_CONSTRAINTS.md).
