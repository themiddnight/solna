# Project Save System - Arrange Room

## Overview

New save system for Arrange Room that supports both **Initial Save** and **Save (Overwrite)**, along with a **Save Lock** system to prevent simultaneous saving by multiple users.

## Features

### 1. Smart Save Behavior

- **Project opened from storage** → Automatically overwrites the existing project.
- **New Project** → First save as "Save As" → Subsequent saves overwrite.
- **Collaborator Permission**:
  - New Room (`hasBeenSaved = false`) → Any authenticated member can perform the first save; the new project is owned by the **room owner** (the saver becomes a contributor if different). Save is blocked if the room owner is a guest / unverified / at quota.
  - Saved Room (`hasBeenSaved = true`) → The owner and contributors with access can overwrite.

### 2. Save Lock System

- When a user clicks save, it **disables the save button** for others until completion.
- **Auto-release** when the user disconnects.
- **Timeout protection** (60 seconds) to prevent deadlocks.
- **Real-time sync** via WebSocket.

### 3. Incremental Save (Content-Hash Based)

Since 2026-07-27, saves use a content-hash manifest to skip re-uploading unchanged files:

- **`manifest.json`** is stored alongside `project.json` in B2, recording SHA-256 hashes of every persisted file (`projectJsonHash` + per-audio-file hashes).
- On save (overwrite), the backend downloads the old manifest and compares hashes:
  - `projectJsonHash` unchanged → skip `project.json` upload.
  - Audio hash unchanged → skip audio file upload (existing B2 file is preserved via `finalKeys`).
  - Audio in old manifest but not in current → orphan → deleted from B2 after successful finalize.
- First save (no manifest) or manifest download failure → full upload (safe fallback).
- Orphan audio cleanup is best-effort — errors are logged, not thrown.

See `ProjectManifestService` for hash computation and `ProjectManifest` for the manifest schema.

**Audio hash stability (skipEncoding):** When a project is loaded from B2, audio files are imported through `ProjectImportService`. Audio stored in B2 is already Opus/Ogg — re-encoding through ffmpeg would produce different binary output (lossy VBR encoder is non-deterministic), breaking the manifest hash match on the next save. `AudioRegionStorageService.saveRegionAudio()` accepts a `skipEncoding` flag that copies the source file directly without re-encoding. `ProjectImportService` passes `skipEncoding: true` for all B2-imported audio, preserving the exact bytes that were hashed into the manifest.

### 4. Project Schema Version Gate (DEV-310, relaxed by DEV-295)

Since 2026-08-03, saved project files include a `projectSchemaVersion` field checked on load. As of 2026-08-05 (DEV-295's legacy-loudness-reset work), the gate is **no longer a strict equality check** — it refuses only files from a *newer* build and loads everything else, with a one-time loudness reset for anything that isn't the exact current version.

**Why it changed:** DEV-310's original strict gate refused any project not stamped with the exact current `PROJECT_SCHEMA_VERSION` — including every genuine pre-epic user project, which predates the gain-staging epic entirely and carries the historical version string `'1.0.0'`. Since the epic never reached production, every real user file is from that pre-epic era; refusing it outright would have made those projects permanently unopenable. DEV-295 replaced "refuse anything not current" with "refuse only what we can't safely interpret" (see Decisions 1–3 in [`docs/superpowers/plans/2026-08-05-dev295-legacy-project-loudness-reset.md`](../../../docs/superpowers/plans/2026-08-05-dev295-legacy-project-loudness-reset.md) for the full rationale).

**How it works:**

- **Single source of truth:** `PROJECT_SCHEMA_VERSION` is defined in `shared/src/constants/ProjectSchemaVersion.ts` (currently 5). Every producer (frontend `projectSerializer.ts`, backend `ProjectSerializationService`, `sessionToCollabConverter`) stamps this value into the saved `project.json` file. The associated `manifest.json` independently records the same constant via `ProjectManifestService.buildManifest()`.
- **Two-tier validation on load:** `shared/src/constants/ProjectSchemaVersion.ts` exports two predicates consumers use instead of the old strict `isSupportedProjectSchemaVersion()` (that function still exists — exact-equality only — and is used solely by `ProjectManifestService`'s manifest-comparison fallback, §below):
  - `isFutureProjectSchemaVersion(version)` — **true only for an integer greater than the current constant.** This is the sole remaining hard refusal: a file written by a newer build could mean anything, so it can't be safely loaded. Every consumer (`deserializeProject` on the frontend; `ProjectImportService` both call sites, `ProjectSerializationService.deserializeProjectData`, and `assertSupportedProjectVersion` on the backend) throws `ProjectVersionMismatchError` (or the equivalent `BAD_REQUEST:`-prefixed error) only for this case.
  - `needsLegacyLoudnessReset(version)` — true for everything that isn't the exact current version (older integers, the pre-epic `'1.0.0'` string, a missing or unrecognised version field). The frontend's `deserializeProject` uses this to decide whether to run `resetLegacyLoudnessFields()` before restoring store state — see `app/frontend/src/features/rooms/arrange/services/legacyLoudnessReset.ts`. **Update (2026-08-05, final-review fix wave):** the backend also resets these fields — at both `ProjectImportService` call sites (`importProject`, `importProjectFromStorage`), gated on the same `needsLegacyLoudnessReset(projectData.version)`, via its own mirror `app/backend/src/domains/arrange-room/domain/services/legacyLoudnessReset.ts` — BEFORE the projectData reaches `arrangeRoomStateService.updateState(...)` (Redis). This closes a write-path gap the FE-only reset left open: without it, the backend wrote un-reset legacy values straight into Redis, and a later backend-driven save (`ProjectSerializationService.serializeRoomState`) re-stamped the current `PROJECT_SCHEMA_VERSION` onto those un-reset numbers — permanently laundering them as current-schema, so the reset (and its one-time toast) would never fire again on a second load. The two loudness-default constants that used to live only under `app/frontend/src/` (`DEFAULT_VOCODER_OUTPUT_GAIN_DB`, `DEFAULT_SYNTH_GAIN_DB`) were hoisted into `shared/src/constants/LegacyLoudnessDefaults.ts` so the FE and BE resets can never drift apart; the FE modules re-export them under the same names so no FE call site changed.
- **What gets reset, and what never does:** exactly four field groups whose *unit* changed meaning during the epic — `tracks[].volume`, companion `regions[].config.volume`, vocoder/vocoderext "Output gain" parameters, and `synthStates[].volume` — are reset to their current defaults. Everything else (pan, mute state, already-dB fields like `AudioRegion.gain` and compressor/ducker/graphiceq parameters, notes, regions, markers, the chord track) survives untouched; a companion region muted in the legacy file is still muted after load. Saving re-stamps the file at the current `PROJECT_SCHEMA_VERSION` with the reset values, so a legacy project only ever needs the reset once.
- **User notice:** the frontend shows a one-time toast when a load triggers the reset ("This project was made with an older version — track, companion, synth and vocoder levels have been reset to defaults. Save to keep the new levels."), fired from the three `deserializeProject` call sites, never from inside the serializer itself.
- **Manifest version mismatch (unchanged):** When comparing incremental-save manifests (see §3), if the old manifest's `projectSchemaVersion` doesn't match the current constant, the entire manifest is discarded and a full re-upload is forced (identical to first-save fallback), via the original strict `isSupportedProjectSchemaVersion()`. This is a hash-comparison optimization, not a load-refusal — it doesn't gate whether the project opens.
- **HTTP 409 response (now newer-build-only):** When a client attempts to load a project from a *newer* build, `ProjectImportService`/`ProjectSerializationService` throw `ProjectVersionMismatchError`, caught by `ProjectController` and surfaced as HTTP 409 with a client-safe, actionable error message ("this file was saved with a newer version of the app..."). `assertSupportedProjectVersion`'s two call sites (`createProject`, `remixProject`) instead throw a plain `BAD_REQUEST:`-prefixed error, mapped to HTTP 400 — this 409-vs-400 inconsistency across the two error conventions predates DEV-295 and remains out of scope. Unlike generic errors, these messages are **never stripped in production** — the `clientErrorDetail()` gate does not apply, because the message is constructed safely and addresses a user-actionable problem.
- **Known gap (documented, not fixed):** `synthStates[].volume` changed from a linear 0..1 multiplier to dB *after* v2 shipped (DEV-300) without a version bump, so a v2-stamped file's synth volume is technically ambiguous. Not retro-fixable and not worth fixing — DEV-295 never deployed, so no real user file is at v2, and the legacy loader resets that field regardless of which unit it was actually in. See the history comment at the top of `ProjectSchemaVersion.ts` for the full account.
- **Bumping the version:** Any future phase that changes what an existing saved field means increments `PROJECT_SCHEMA_VERSION` by 1 in the one shared file. That single change cascades to all producers and consumers automatically, and — unlike before DEV-295 — does not by itself break older files; it only marks them as needing the loudness reset on next load.

### 5. Real-Time Save Progress

Since 2026-07-27, the save flow emits real-time progress via WebSocket so the frontend can show a dynamic status message during the save operation:

- **`arrange:save_progress`** (Server → Client) — emitted at each phase boundary during the HTTP save request.
- **Step sequence:** `preparing` → `saving_data` → `saving_audio` (per file) → `finalizing`.
- **Audio step detail:** `saving_audio` carries `{ current, total }` for per-file progress (e.g. "Saving audio files... (2/5)").
- **No audio to upload:** `saving_audio` is skipped entirely when no audio files changed.
- **FE mapping:** Step codes are semantic keys; the frontend maps them to localized labels via Lingui.

**BE components:**

| Component | Role |
|-----------|------|
| `SaveProgressStep` / `SaveProgressCallback` | Type definitions in `ProjectSaveService.ts` |
| `ProjectSaveService.emitProgress()` | Defensive callback wrapper (failure must not fail save) |
| `SaveProgressEmitter.createSaveProgressCallback()` | Factory that creates a callback emitting `arrange:save_progress` to the room namespace |
| `ProjectApplicationService.setSocketServer()` | Receives the Socket.IO `Server` instance during bootstrap |

**Load progress** is FE-driven (no backend socket events): the `arrangeProjectStore.loadProgressStep` field transitions from `downloading` (when loading starts via HTTP) to `preparing` (when `arrange:project_loaded` arrives and deserialization begins). The `FullscreenLoadingOverlay` renders the current phase as a single dynamic message line.

### 6. Save Flow Diagram (with Progress)

## Architecture

### Backend Components

#### 1. Room State Metadata

```typescript
// ArrangeRoomState
interface ArrangeRoomState {
  // ... existing fields
  projectId?: string;        // ID of the loaded project
  projectOwnerId?: string;   // ID of the project owner
  hasBeenSaved: boolean;     // Indicates if the project has been saved at least once
}
```

#### 2. Save Lock Service

```typescript
// ProjectSaveLockService
class ProjectSaveLockService {
  acquireLock(projectId: string, userId: string, username: string): SaveLockInfo | null
  releaseLock(projectId: string, userId: string): boolean
  releaseUserLocks(userId: string): string[]
  isLocked(projectId: string): { locked: boolean; lockInfo?: SaveLockInfo }
}
```

**Features:**
- Lock timeout: 60 seconds
- Auto-release on disconnect
- Returns username for UI display

#### 3. WebSocket Events

**Client → Server:**
- `arrange:save_lock_request` - Request lock for saving.
- `arrange:save_lock_release` - Release lock after saving is complete.

**Server → Client (Broadcast):**
- `arrange:save_lock_acquired` - Notify that someone has acquired the lock (disables save button).
- `arrange:save_lock_denied` - Lock denied (someone else is saving).
- `arrange:save_lock_released` - Lock released (enables save button).

#### 4. REST API Endpoint

```typescript
POST /api/projects/save-from-room
Body: {
  roomId: string;
  projectId?: string;  // If present = Overwrite, if absent = New Save
  name: string;        // Required if no projectId
  description?: string;
  allowFork?: boolean; // Default: true (for new projects)
  visibility?: ProjectVisibility; // Default: PRIVATE (for new projects)
}
```

**Logic:**
- Validate permissions (owner/contributor).
- Check `hasBeenSaved` — non-owners cannot perform the first save (owner must save first).
- Check project limits for new projects.
- Check `isLocked` — non-owners cannot save if the project is locked.
- Update room state metadata after successful save (`hasBeenSaved: true`, `projectOwnerId`).
- Auto-track contributor if user is not the owner (BR-13).

### Frontend Components

#### 1. Project Store

```typescript
// projectStore
interface ProjectStoreState {
  // ... existing fields
  roomProjectId: string | null;        // Project ID from room state
  roomProjectOwnerId: string | null;   // Owner ID from room state
  roomHasBeenSaved: boolean;           // Save status from room state
}
```

#### 2. Custom Hooks

**useProjectMetadataSync:**
- Sync metadata from WebSocket `arrange:state_sync`.
- Automatically update `projectStore`.

**useSaveLockSync:**
- Manage save lock state.
- Listen to save lock events.
- Provide methods: `requestSaveLock()`, `releaseSaveLock()`.
- Provide state: `isLockedByOther`, `isLockedByMe`, `saveLockInfo`.

#### 3. API Layer

```typescript
// saveProjectFromRoom
async function saveProjectFromRoom(request: SaveProjectFromRoomRequest): Promise<SaveProjectFromRoomResponse>
```

## Usage Examples

### Backend: Set Project Metadata When Loading

```typescript
// ProjectImportService.ts
await this.arrangeRoomStateService.setProjectMetadata(
  roomId,
  projectId,
  userId,
  true  // hasBeenSaved
);
```

### Backend: Handle Save Lock

```typescript
// ArrangeRoomHandler.ts
async handleSaveLockRequest(socket, namespace, data) {
  const lockInfo = this.projectSaveLockService.acquireLock(
    data.projectId,
    session.userId,
    session.username
  );

  if (lockInfo) {
    namespace.to(data.roomId).emit('arrange:save_lock_acquired', {
      projectId: data.projectId,
      lockInfo,
    });
  } else {
    socket.emit('arrange:save_lock_denied', {
      projectId: data.projectId,
      reason: 'locked_by_other',
    });
  }
}
```

### Frontend: Use Save Lock

```typescript
// In component
const { saveLockSync } = useArrangeRoomController();

// Request lock before save
saveLockSync.requestSaveLock(projectId);

// Save project
await saveProjectFromRoom({
  roomId,
  projectId,  // If present = Overwrite
  name,
  description,
});

// Release lock after save
saveLockSync.releaseSaveLock(projectId, true);
```

### Frontend: Disable Save Button

```typescript
// ProjectMenu.tsx
<button
  onClick={handleSave}
  disabled={saveLockSync.isLockedByOther}
>
  {saveLockSync.isLockedByOther 
    ? `${saveLockSync.saveLockInfo?.username} is saving...`
    : 'Save Project'}
</button>
```

## Permission Matrix

| User Type | New Room (hasBeenSaved=false) | Saved Room (hasBeenSaved=true) | Locked Project (BR-11) |
|-----------|-------------------------------|--------------------------------|------------------------|
| Owner     | ✅ Saves to room owner        | ✅ Can save                    | ✅ Can save            |
| Contributor (BR-13) | ✅ Saves to room owner[^1] | ✅ Can save (Auto-track) | ❌ Cannot save |
| Band Member (BR-6) | ✅ Saves to room owner[^1] | ✅ Can save (Auto-track) | ❌ Cannot save |
| Public User | ✅ Saves to room owner[^1] | ✅ Can save (if public, Auto-track) | ❌ Cannot save |
| Guest     | ❌ Cannot save                | ❌ Cannot save                 | ❌ Cannot save         |

[^1]: Blocked if room owner is guest/unverified/at quota.

## Save Flow Diagram

```
┌─────────────────┐
│  User clicks    │
│  "Save"         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Check if        │
│ projectId       │
│ exists          │
└────┬───────┬────┘
     │       │
  Yes│       │No
     │       │
     ▼       ▼
┌─────────┐ ┌──────────────┐
│ Save    │ │ Check project│
│ Over    │ │ limit        │
└────┬────┘ └──────┬───────┘
     │             │
     │             ▼
     │      ┌──────────────┐
     │      │ Show Save    │
     │      │ Modal        │
     │      └──────┬───────┘
     │             │
     └─────┬───────┘
           │
           ▼
    ┌─────────────────┐
    │ Request Save    │
    │ Lock            │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ Call API        │
    │ /save-from-room │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ Release Lock    │
    └─────────────────┘
```

## Testing

### Backend Tests

```bash
# Test save lock service
bun test ProjectSaveLockService.test.ts

# Test room state metadata
bun test ArrangeRoomStateService.projectMetadata.test.ts
```

### Frontend Tests

```bash
# Test hooks
bun test useProjectMetadataSync.test.ts
bun test useSaveLockSync.test.ts
```

## Migration Notes

- Existing rooms without metadata will continue to work normally.
- `projectId`, `projectOwnerId` are optional fields.
- `hasBeenSaved` has a default value of `false`.
- Frontend fallbacks to using local `savedProjectId` if `roomProjectId` is missing.

## Troubleshooting

### Save button remains disabled

**Cause:** Save lock was not released.
**Solution:** 
- Ensure `releaseSaveLock()` is called after save completion.
- Wait 60 seconds (timeout); the lock will be released automatically.
- Refresh the web page.

### Collaborator cannot save

**Cause:** `hasBeenSaved = false` (New Room).
**Solution:** 
- Have the owner save the project for the first time.
- After that, collaborators will be able to save.

### Project metadata lost after refresh

**Cause:** Metadata is stored in the room state (Redis), not local storage.
**Solution:** 
- Normally, metadata is synced via WebSocket.
- Check if `useProjectMetadataSync` is functioning correctly.

## Related Documentation

- [WebSocket Events](../../docs/WS_CONTRACT.md#88-project-save-lock)
- [API Endpoints](../../docs/API_CONTRACT.md)
- [Architecture](./ARCHITECTURE.md)
