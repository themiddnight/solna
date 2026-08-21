<!-- doc-sync: codebase-reference -->
# Room Management Repository Infrastructure

This directory contains the repository implementations for the Room Management domain, providing data persistence capabilities for Room and User aggregates.

## Overview

The repository infrastructure follows the Repository pattern, providing a clean abstraction layer between the domain models and data storage. It holds two kinds of repositories:

- **Domain interfaces** (`domain/repositories/`) — the `RoomRepository` / `UserRepository` contracts that client code depends on.
- **Concrete implementations** — in-memory implementations of those interfaces (`InMemoryRoomRepository`, `InMemoryUserRepository`), plus the Redis-backed repositories used by the live real-time system (`RoomRepository`, `RoomUserRepository`).

## Architecture

```
repositories/
├── RoomRepository.ts             # Redis-backed Room repository (live real-time source of truth)
├── RoomUserRepository.ts         # Redis-backed room-membership repository (band members / audiences)
├── InMemoryRoomRepository.ts     # In-memory implementation of the RoomRepository interface
├── InMemoryUserRepository.ts     # In-memory implementation of the UserRepository interface
├── RepositoryFactory.ts          # Factory for the in-memory repository instances
├── index.ts                      # Exports
└── README.md                     # This file
```

Repository tests live in `../../__tests__/` (see Testing below).

## Repository Interfaces

The domain interfaces live in `domain/repositories/` (`RoomRepository.ts` · `UserRepository.ts`) and are what client code depends on.

### RoomRepository
- `save(room: Room): Promise<void>` - Save or update a room
- `findById(id: RoomId): Promise<Room | null>` - Find room by ID
- `findByOwner(ownerId: UserId): Promise<Room[]>` - Find rooms by owner
- `findPublicRooms(): Promise<Room[]>` - Find all public rooms
- `findByNamePattern(pattern: string): Promise<Room[]>` - Find rooms by name pattern
- `findWithPagination(offset: number, limit: number): Promise<Room[]>` - Paginated room retrieval
- `delete(id: RoomId): Promise<void>` - Delete a room

### UserRepository
- `save(user: User): Promise<void>` - Save or update a user
- `findById(id: UserId): Promise<User | null>` - Find user by ID
- `findByUsername(username: string): Promise<User | null>` - Find user by username
- `findAll(): Promise<User[]>` - Find all users
- `delete(id: UserId): Promise<void>` - Delete a user

## Implementation Details

### In-Memory Implementations
`InMemoryRoomRepository` and `InMemoryUserRepository` implement the domain interfaces using `Map<string, T>` for primary storage:
- **InMemoryRoomRepository**: Uses room ID as key
- **InMemoryUserRepository**: Uses user ID as key + maintains username index for efficient lookups

### Redis-Backed Implementations
The Redis-backed repositories support the live real-time system:
- **RoomRepository**: Reads/writes room metadata in Redis (`ROOMS_HASH` / `ROOM_IDS_SET`), layered over NodeCache + a local map for fast access and Redis-optional fallback.
- **RoomUserRepository**: Stores room membership (band members / audiences) in Redis, separate from room metadata to avoid join/instrument race conditions. Exposed as the `roomUserRepository` singleton.

### Key Features
- **Type Safety**: Full TypeScript support with proper value object handling
- **Performance**: O(1) lookups for primary keys, efficient filtering for queries
- **Memory Management**: Proper cleanup and indexing
- **Testing**: Repository tests live in `room-management/__tests__/` (see Testing below).

## Usage

### Basic Usage
```typescript
import { RepositoryFactory } from './infrastructure/repositories';

// Get repository instances
const roomRepo = RepositoryFactory.getRoomRepository();
const userRepo = RepositoryFactory.getUserRepository();

// Create and save a user
const user = User.create('username');
await userRepo.save(user);

// Create and save a room
const room = Room.create('My Room', user.id);
await roomRepo.save(room);

// Query data
const foundUser = await userRepo.findByUsername('username');
const userRooms = await roomRepo.findByOwner(user.id);
```

### Testing
```typescript
import { RepositoryFactory } from './infrastructure/repositories';

beforeEach(() => {
  // Reset repositories for clean test state
  RepositoryFactory.reset();
});
```

## Requirements Satisfied

- **1.3**: Repository interfaces provide clean abstraction for data access
- **1.4**: In-memory implementations support all required operations without external dependencies

## Future Enhancements

The Redis-backed `RoomRepository` / `RoomUserRepository` already cover the live real-time storage needs. If the domain interfaces (`domain/repositories/`) ever need a different backing store:
1. Implement new concrete repositories against the interfaces with storage-specific names
2. Update `RepositoryFactory` to use those implementations
3. Add connection/database management as needed
4. Implement data migration utilities

The interface design keeps client code decoupled from whichever concrete backing store is in use.

## Testing

Repository tests live in `room-management/__tests__/` (there is no `__tests__/` folder in this directory). From the repo root, run them with:

```bash
bun run --cwd app/backend test:unit -- --testPathPatterns="domains/room-management/__tests__/RoomRepository|domains/room-management/__tests__/RoomUserRepository"
```

The repository-specific test files are `RoomRepository.test.ts`, `RoomUserRepository.addUser.test.ts`, `RoomUserRepository.changeUserRole.test.ts`, and `RoomUserRepository.hasBandMembersStrict.test.ts`.

All tests include:
- Unit tests for individual repository operations
- Integration tests demonstrating cross-repository usage
- Edge case handling and error scenarios

## Code map

| File | Responsibility |
|---|---|
| `domain/repositories/RoomRepository.ts` | Domain interface for Room persistence. |
| `domain/repositories/UserRepository.ts` | Domain interface for User persistence. |
| `RoomRepository.ts` | Redis-backed concrete Room repository used by the live real-time system (Redis + NodeCache + local map). |
| `RoomUserRepository.ts` | Redis-backed concrete room-membership repository (band members / audiences); exported as the `roomUserRepository` singleton. |
| `InMemoryRoomRepository.ts` | In-memory implementation of the `RoomRepository` interface. |
| `InMemoryUserRepository.ts` | In-memory implementation of the `UserRepository` interface. |
| `RepositoryFactory.ts` | Constructs the in-memory repository instances (swap point for a different backing store). |

## Invariants & gotchas

1. **Domain code depends on the interfaces** — the domain abstractions live in `domain/repositories/` (`RoomRepository`, `UserRepository`). `InMemoryRoomRepository` / `InMemoryUserRepository` implement them and are wired through `RepositoryFactory`. Don't couple domain code to a concrete implementation directly.
2. **Redis is the authoritative live room state** — the concrete `RoomRepository.ts` and `RoomUserRepository.ts` in this folder ARE the Redis-backed source of truth for room metadata and active-room membership (band members / audiences); they are not a pure domain-model abstraction. Only the `domain/repositories/` interfaces are abstract. The in-memory repositories serve the domain-model / application-service side, not live membership.
