---
name: backend-performance
description: Backend performance optimization for the murva Node.js + Prisma + Redis + Socket.IO stack — Prisma N+1, query optimization, Redis cache strategy, payload size, mutex patterns, and algorithmic complexity. Use this skill whenever you're writing service layer logic that queries the database, adding new endpoints that fetch multiple relations, observing slow API responses, encountering frequent Redis read-modify-write operations, or dealing with unusually large Socket.IO payloads. Use this before writing any queries that join multiple tables or loop across large collections.
---

# Backend Performance Optimization

Backend performance is categorized into 3 levels — address the level that matches your problem first:

1. **Database layer** — slow queries, N+1 issues, missing indexes.
2. **Redis layer** — cache misses, over-fetching state, mutex contention.
3. **Runtime / Socket layer** — large payloads, algorithmic inefficiency, memory usage.

---

## 1. Algorithmic Complexity — Think Before You Write

**Golden Rule**: If an input can grow (number of tracks, users, regions, notes), always consider complexity first.

### Red Flags

```typescript
// ❌ O(n²) — nested loops on the same collection
for (const track of tracks) {
  for (const region of regions) {
    if (region.trackId === track.id) { /* ... */ }
  }
}

// ✅ O(n) — index first, then look up
const regionsByTrack = new Map<string, Region[]>();
for (const region of regions) {
  const list = regionsByTrack.get(region.trackId) ?? [];
  list.push(region);
  regionsByTrack.set(region.trackId, list);
}
for (const track of tracks) {
  const trackRegions = regionsByTrack.get(track.id) ?? [];
}
```

```typescript
// ❌ O(n) find within a loop → overall O(n²)
const getRegion = (id: string) => regions.find(r => r.id === id);
notes.forEach(note => {
  const region = getRegion(note.regionId); // O(n) every iteration
});

// ✅ Create a Map first → O(1) look up
const regionMap = new Map(regions.map(r => [r.id, r]));
notes.forEach(note => {
  const region = regionMap.get(note.regionId); // O(1)
});
```

### Project Context
- **Arrange room**: Max 10 users, 20 tracks (TR-7), regions can be in the hundreds.
- **Perform room**: Max 8 users, sequencer with 16 steps × 16 instruments.
- **Redis state operations**: Frequent (every socket event) — O(1) or O(n) on small collections is acceptable; O(n²) is not.

---

## 2. Prisma Query Optimization

### N+1 Problem — The Most Common Issue

N+1 occurs when code queries parent data and then loops to query children one by one:

```typescript
// ❌ N+1 — 1 query for projects + N queries for contributors
const projects = await prisma.savedProject.findMany({ where: { userId } });
for (const project of projects) {
  project.contributors = await prisma.projectContributor.findMany({
    where: { projectId: project.id }
  });
}

// ✅ Single query using include
const projects = await prisma.savedProject.findMany({
  where: { userId },
  include: {
    contributors: {
      include: { user: { select: { id: true, username: true } } }
    }
  }
});
```

### select Only Required Fields

```typescript
// ❌ Fetch entire user row — includes passwordHash, tokens, etc.
const user = await prisma.user.findUnique({ where: { id } });

// ✅ Select specific fields
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    username: true,
    displayName: true,
    userType: true,
    profilePictureUrl: true,
    // Do not select passwordHash, refreshToken, etc.
  }
});
```

### Batch Operations Instead of Loops

```typescript
// ❌ Insert records one by one in a loop
for (const contributor of contributors) {
  await prisma.projectContributor.create({ data: contributor });
}

// ✅ createMany — single query
await prisma.projectContributor.createMany({
  data: contributors,
  skipDuplicates: true,
});
```

### Pagination — Don't Query Everything

```typescript
// ❌ Fetch every project for a user — could be hundreds
const projects = await prisma.savedProject.findMany({
  where: { userId }
});

// ✅ Cursor-based pagination
const projects = await prisma.savedProject.findMany({
  where: { userId },
  take: 20,
  skip: cursor ? 1 : 0,
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { updatedAt: 'desc' },
});
```

### Transactions for Multiple Writes

```typescript
// ❌ Separate writes — risk of partial failure
await prisma.savedProject.update({ where: { id }, data: { isLocked: true } });
await prisma.projectContributor.deleteMany({ where: { projectId: id } });

// ✅ Transaction — atomic
await prisma.$transaction([
  prisma.savedProject.update({ where: { id }, data: { isLocked: true } }),
  prisma.projectContributor.deleteMany({ where: { projectId: id } }),
]);
```

### Recommended Indexes
Prisma schema should index fields frequently used in `where` clauses:
```prisma
model SavedProject {
  // ...
  userId    String
  createdAt DateTime

  @@index([userId])           // query by owner
  @@index([userId, createdAt]) // query with sort
}
```
Refer to existing schema tables: `app/backend/docs/DATABASE.md`

---

## 3. Redis Patterns

### Per-Room Mutex (TR-2) — Proper Usage

Mutex prevents race conditions in Redis read-modify-write operations, but misuse can create bottlenecks:

```typescript
// ✅ Correct Pattern — lock → read → modify → write → release
async updateTrackInRoom(roomId: string, trackId: string, updates: Partial<Track>) {
  const release = await this.mutex.acquire(roomId); // lock specifically for this room
  try {
    const state = await this.getState(roomId);
    if (!state) return;

    const trackIndex = state.tracks.findIndex(t => t.id === trackId);
    if (trackIndex === -1) return;

    state.tracks[trackIndex] = { ...state.tracks[trackIndex], ...updates };
    await this.saveState(roomId, state);
  } finally {
    release(); // Must always release — put in finally block
  }
}
```

**Avoid** performing slow operations within critical sections (do not query the database or call external APIs while holding a lock).

### Cache Strategy — Read-Through

```typescript
// Pattern: If in Redis, use it; if not, query DB and then cache
async getProjectData(projectId: string) {
  const cacheKey = `project:data:${projectId}`;

  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Cache miss — query DB
  const project = await prisma.savedProject.findUnique({
    where: { id: projectId },
    include: { contributors: true }
  });

  if (project) {
    await this.redis.setex(
      cacheKey,
      300, // TTL 5 minutes
      JSON.stringify(project)
    );
  }

  return project;
}
```

### TTL Guidelines for This Project

Refer to TR-8 in RULES_AND_CONSTRAINTS.md for official TTL values.

| Key Pattern | Recommended TTL | Reason |
|-------------|-----------------|--------|
| `perform:state:{roomId}` | 24h (TR-8) | Room state must survive server restarts |
| `arrange:state:{roomId}` | 24h (TR-8) | Same as above |
| `project:data:{projectId}` | 5-10 minutes | Changes frequently when saved |
| `room:active:{projectId}` | Temporary | Clear when room closes |

### Minimize Redis Round-trips

```typescript
// ❌ 3 round-trips
const state = await this.redis.get(stateKey);
const lock = await this.redis.get(lockKey);
const ttl = await this.redis.ttl(stateKey);

// ✅ Pipeline — 1 round-trip
const [state, lock, ttl] = await this.redis.pipeline()
  .get(stateKey)
  .get(lockKey)
  .ttl(stateKey)
  .exec();
```

---

## 4. Socket.IO Payload Optimization

Real-time events are broadcasted frequently — excessively large payloads consume bandwidth and increase latency.

### Send Only Deltas, Not Full State

```typescript
// ❌ Broadcast entire state every time
socket.to(roomId).emit('arrange:track_updated', {
  tracks: entireTrackArray, // could be 20 tracks with all regions
});

// ✅ Send only what changed
socket.to(roomId).emit('arrange:track_updated', {
  trackId,
  updates: { name: newName }, // delta only
  userId,
});
```

### Omit Fields Client Doesn't Need

```typescript
// Helper — strip large fields before broadcasting
function toPublicRegion(region: Region) {
  const { rawAudioBuffer, ...publicRegion } = region; // Strip binary data
  return publicRegion;
}

socket.to(roomId).emit('arrange:region_added', {
  region: toPublicRegion(newRegion),
  userId,
});
```

### Broadcasting Strategy (TR-3)
```typescript
// socket.to() — excludes sender (use for mutation events)
socket.to(roomId).emit('arrange:note_added', data);

// namespace.to() — includes sender (use for commit/lock confirmation)
this.namespace.to(roomId).emit('arrange:lock_acquired', data);
```

---

## 5. Service Layer Patterns

### Early Return Over Nested Ifs

```typescript
// ❌ Nested — hard to read + all validations run on original code
async updateRegion(data: UpdateRegionDto) {
  const room = await getState(data.roomId);
  if (room) {
    const track = room.tracks.find(t => t.id === data.trackId);
    if (track) {
      const region = track.regions.find(r => r.id === data.regionId);
      if (region) {
        // update...
      }
    }
  }
}

// ✅ Guard clauses — fail fast
async updateRegion(data: UpdateRegionDto) {
  const room = await getState(data.roomId);
  if (!room) return;

  const track = room.tracks.find(t => t.id === data.trackId);
  if (!track) return;

  const regionIndex = track.regions.findIndex(r => r.id === data.regionId);
  if (regionIndex === -1) return;

  track.regions[regionIndex] = { ...track.regions[regionIndex], ...data.updates };
  await saveState(data.roomId, room);
}
```

### Do Not Query Inside Loops

```typescript
// ❌ Query N times in a loop
const tracks = room.tracks;
for (const track of tracks) {
  const project = await prisma.savedProject.findUnique({
    where: { id: track.projectId }
  });
  // ...
}

// ✅ Collect IDs → Single query → Index with a Map
const projectIds = [...new Set(tracks.map(t => t.projectId))];
const projects = await prisma.savedProject.findMany({
  where: { id: { in: projectIds } }
});
const projectMap = new Map(projects.map(p => [p.id, p]));

for (const track of tracks) {
  const project = projectMap.get(track.projectId);
  // ...
}
```

---

## 6. Pre-Merge Checklist

Ask yourself these questions before committing code that touches the database or Redis:

- [ ] Any N+1 issues? — Every `findMany` followed by a `findUnique` in a loop is a red flag.
- [ ] `select` only necessary fields? — Especially for Users (contains sensitive fields).
- [ ] Nested loops on large collections? — Use a Map instead.
- [ ] Redis lock released in `finally`? — Prevents deadlocks.
- [ ] Socket payload sending only deltas? — Do not broadcast full state.
- [ ] Multiple writes wrapped in a transaction? — Ensures atomicity.
