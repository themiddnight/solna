import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import type { AppStore } from './types';
import {
  PROJECT_FORMAT_VERSION,
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
  newProjectId,
  type ProjectBody,
  type ProjectContent,
  type ProjectEnvelope,
} from './projectFormat';
import { unknownLibraryReferences } from './projectFile';
import { loopStatePatch, resolveActiveLoop } from './loop';
import type { ProjectStore, ProjectStoreResult, ProjectStoreStatus } from './projectStore';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export interface ProjectSlice {
  /** The envelope's name. null = untitled (never named, or a fresh slot). */
  projectName: string | null;
  projectStoreStatus: ProjectStoreStatus;
  /** A non-blocking toast surface: unknown references, quota, unavailable. */
  projectNotice: string | null;
  setProjectNotice: (notice: string | null) => void;
  setProjectName: (name: string) => void;
  /** Boot: read the one slot and install it (or keep the factory session). */
  loadProject: () => Promise<void>;
  /** The autosave write. Never throws; a failure surfaces as a notice. */
  save: () => Promise<ProjectStoreResult<ProjectBody>>;
  newProject: () => void;
  openProjectFile: (body: ProjectBody) => Promise<ProjectStoreResult<ProjectBody>>;
  exportProjectFile: () => ProjectBody;
}

/**
 * Same instant-but-clickless release loadLoop uses (LOAD_LOOP_RELEASE in
 * loadLoop.ts). Not imported from there: loadLoop imports the store module,
 * and this slice is part of building it.
 */
export const INSTALL_RELEASE = 0.02;

/** Untitled reads as an empty name on disk; `null` is its in-store spelling. */
function normalizeName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The project's envelope, minus the name (which lives in the store so the
 * header can render it). The `id` is kept but INERT: it rides the `.solna`
 * contract and is adopted from an opened file, but the storage slot is a fixed
 * key, so nothing looks a project up by it.
 */
interface SlotIdentity {
  id: string;
  createdAt: number;
}

/**
 * Lifecycle actions. Every path that replaces the live session goes through
 * `install`, in loadLoop's order: hardStopAll (dispatches the reducer's
 * 'stop-all', whose frozen singleton songMode compares by reference) → cut the
 * chord and bass voices → ONE set() carrying the content, the reset rules, the
 * flat per-loop patch and the identity. The cut happens BEFORE the set():
 * engineSync's subscriptions fire synchronously on that write, and a cut after
 * it would race them and let the old project's queued voices ring over the
 * new one. Drums are one-shots; one already-scheduled hit may still land.
 */
export function createProjectSlice(
  set: Set,
  get: Get,
  projectStore: ProjectStore,
  now: () => number = Date.now,
): ProjectSlice {
  let slot: SlotIdentity = { id: newProjectId(), createdAt: now() };

  const install = (content: ProjectContent, identity: ProjectEnvelope, activeLoopId: string | null = null): void => {
    get().hardStopAll();
    for (const source of ACCOMPANIMENT_SOURCES) {
      audioEngine.stopSource(source, INSTALL_RELEASE);
    }
    slot = { id: identity.id, createdAt: identity.createdAt };
    set({
      ...applyProjectContent(content, activeLoopId),
      // A song-mode cursor into the OLD project's loops[] must not survive
      // the swap: it would index the new project's loops[] instead (out of
      // range, or in range but pointing at the wrong loop) and enterSongIndex
      // is skipped once the cursor is non-null. loadLoop recomputes it on
      // every loops/activeLoopId change; a wholesale content swap has no
      // such recompute, so it is reset here explicitly.
      songLoopIndex: null,
      // A latched track solo is scoped to the surface the user set it on, and a
      // whole-content swap is the most complete surface change there is.
      // soloNav.ts's SOLO_NAV_KEYS cannot catch this on its own: loop ids are
      // not unique across projects, so the incoming project's first loop can
      // carry the same id the outgoing one did (every fresh project's default
      // loop is `loop-default-1`), and this patch writes neither activeTab nor
      // focusTrack. Clearing it here, in the same atomic set() as the content,
      // is what makes the guarantee hold regardless of which loop id lands.
      soloTracks: [],
      // Same reasoning, same atomic patch: the arm is scoped to the loop the
      // user was recording into, and a whole-content swap leaves nothing for
      // it to still name.
      recordingTrack: null,
      projectName: normalizeName(identity.name),
    });
  };

  /** Re-publish availability only when it CHANGED — a store write per autosave would re-render every mounted view. */
  const publishStatus = (): void => {
    const next = projectStore.status();
    if (get().projectStoreStatus !== next) set({ projectStoreStatus: next });
  };

  /**
   * `activeLoopId` is persisted while `loops` now comes from IndexedDB, so a
   * stored value can name a loop the loaded project does not have — the same
   * reconciliation persist `merge` does for a localStorage payload.
   */
  const reconcileActiveLoop = (): void => {
    const { loops, activeLoopId } = get();
    if (loops.some((row) => row.id === activeLoopId)) return;
    const active = resolveActiveLoop(loops, null);
    set({ activeLoopId: active.id, ...loopStatePatch(active) });
  };

  return {
    projectName: null,
    projectStoreStatus: 'unknown',
    projectNotice: null,

    setProjectNotice: (projectNotice) => set({ projectNotice }),

    setProjectName: (name) => set({ projectName: normalizeName(name) }),

    loadProject: async () => {
      const result = await projectStore.load();
      publishStatus();
      if (result.ok === false) {
        if (result.error === 'not-found') {
          // Empty slot: a normal first run. Keep the factory content the
          // slices already booted with — no install, so nothing is announced
          // and the engine is not touched. The first autosave writes the slot.
          slot = { id: newProjectId(), createdAt: now() };
        } else {
          set({ projectNotice: result.message });
        }
        reconcileActiveLoop();
        return;
      }
      const body = result.value;
      install(body.content, body, get().activeLoopId);
      const warnings = unknownLibraryReferences(body.content);
      set({
        projectNotice:
          warnings.length > 0 ? `Opened with unrecognised references: ${warnings.join(', ')}` : null,
      });
    },

    save: async () => {
      const body = get().exportProjectFile();
      const result = await projectStore.save(body);
      publishStatus();
      // A failed autosave never blocks the app and never rolls the live
      // session back — the notice is the only signal. The failure is not
      // re-scheduled: `projectAutosave.write()` fires this `save()` once and
      // clears its handle, so the slot stays stale until the next content
      // change schedules a write. That re-attempt covers everything, because
      // autosave writes the whole content set rather than a delta.
      if (result.ok === false) set({ projectNotice: result.message });
      return result;
    },

    newProject: () => {
      install(factoryProjectContent(), makeEnvelope('', now()));
      set({ projectNotice: null });
      // Explicit, not left to the content subscription: New on an
      // already-factory session changes nothing content-wise, so nothing
      // would schedule a write and the slot would stay empty.
      void get().save();
    },

    openProjectFile: async (body) => {
      install(body.content, body);
      const result = await get().save();
      const warnings = unknownLibraryReferences(body.content);
      // `save()` has already published its own failure notice, and this set()
      // runs after it. Writing the warnings unconditionally would ERASE it: an
      // ordinary file has no warnings, so a file opened on a device with
      // unavailable storage would install correctly and say nothing at all —
      // the exact case the notice exists for. Both are combined instead, and
      // the failure leads because it is the one that costs the user work.
      const notices = [
        ...(result.ok === false ? [result.message] : []),
        ...(warnings.length > 0 ? [`Opened with unrecognised references: ${warnings.join(', ')}`] : []),
      ];
      set({ projectNotice: notices.length > 0 ? notices.join(' ') : null });
      return result;
    },

    exportProjectFile: (): ProjectBody => ({
      formatVersion: PROJECT_FORMAT_VERSION,
      id: slot.id,
      name: get().projectName ?? '',
      createdAt: slot.createdAt,
      updatedAt: now(),
      content: buildProjectContent(get()),
    }),
  };
}
