import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import type { AppStore, ProjectIdentityState } from './types';
import {
  PROJECT_FORMAT_VERSION,
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
  newProjectId,
  type ProjectBody,
  type ProjectContent,
  type ProjectMeta,
} from './projectFormat';
import { fingerprintContent, isContentDirty } from './projectFingerprint';
import { toMeta, type ProjectStore, type ProjectStoreResult, type ProjectStoreStatus } from './projectStore';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export interface ProjectSlice extends ProjectIdentityState {
  /** Transient. Owned by the dirty tracker (projectDirty.ts); actions here only reset it. */
  dirty: boolean;
  /** Transient; resolved from projectMeta on refresh. Null = unsaved session or lookup miss. */
  currentProjectName: string | null;
  projectStoreStatus: ProjectStoreStatus;
  projectList: ProjectMeta[];
  /** A non-blocking notice for the modal (unknown references, quota, unavailable). */
  projectNotice: string | null;
  setProjectNotice: (notice: string | null) => void;
  refreshProjects: () => Promise<void>;
  newProject: () => void;
  openProject: (id: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  saveProject: () => Promise<ProjectStoreResult<ProjectMeta>>;
  saveProjectAs: (name: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  renameProject: (id: string, name: string) => Promise<ProjectStoreResult<ProjectMeta>>;
  deleteProject: (id: string) => Promise<ProjectStoreResult<null>>;
  importProject: (body: ProjectBody, mode: 'new' | 'overwrite' | 'copy') => Promise<ProjectStoreResult<ProjectMeta | null>>;
  exportStoredProject: (id: string) => Promise<ProjectStoreResult<ProjectBody>>;
  buildSessionExport: (name: string, now: number) => ProjectBody;
}

export const IMPORTED_SUFFIX = ' (imported)';

/**
 * Same instant-but-clickless release loadLoop uses (LOAD_LOOP_RELEASE in
 * loadLoop.ts). Not imported from there: loadLoop imports the store module,
 * and this slice is part of building it.
 */
export const INSTALL_RELEASE = 0.02;

/**
 * Lifecycle actions. Every path that replaces the live session goes through
 * `install`, in loadLoop's order: hardStopAll (dispatches the reducer's
 * 'stop-all', whose frozen singleton songMode compares by reference) → cut the
 * chord and bass voices → ONE set() carrying the content, the reset rules, the
 * flat per-loop patch and the identity. The cut happens BEFORE the set():
 * engineSync's subscriptions fire synchronously on that write, and a cut after
 * it would race them and let the old project's queued voices ring over the
 * new one. Drums are one-shots; one already-scheduled hit may still land.
 *
 * Baseline: a saved project gets the fingerprint of what was installed; an
 * untitled session (New, or an import with storage unavailable) keeps a null
 * baseline and its dirty flag comes from the default-project comparison
 * (isContentDirty). The dirty guard is the UI's job — by the time an action
 * here runs, the user has already chosen Discard or saved.
 */
export function createProjectSlice(set: Set, get: Get, projectStore: ProjectStore, now: () => number = Date.now): ProjectSlice {
  const install = (content: ProjectContent, identity: { id: string | null; name: string | null }): void => {
    get().hardStopAll();
    audioEngine.stopSource('chord', INSTALL_RELEASE);
    audioEngine.stopSource('bass', INSTALL_RELEASE);
    const saved = identity.id !== null;
    set({
      ...applyProjectContent(content),
      // A song-mode cursor into the OLD project's loops[] must not survive
      // the swap: it would index the new project's loops[] instead (out of
      // range, or in range but pointing at the wrong loop) and enterSongIndex
      // is skipped once the cursor is non-null. loadLoop recomputes it on
      // every loops/activeLoopId change; a wholesale content swap has no
      // such recompute, so it is reset here explicitly.
      songLoopIndex: null,
      currentProjectId: identity.id,
      currentProjectName: identity.name,
      projectBaselineHash: saved ? fingerprintContent(content) : null,
      dirty: saved ? false : isContentDirty(content, null, null),
    });
  };

  const currentBody = (name: string, at: number): ProjectBody => {
    const s = get();
    const content = buildProjectContent(s);
    const existing = s.currentProjectId ? s.projectList.find((m) => m.id === s.currentProjectId) : undefined;
    if (existing) {
      return { ...existing, name: existing.name, updatedAt: at, content };
    }
    return { ...makeEnvelope(name, at), content };
  };

  const upsertList = (meta: ProjectMeta): void =>
    set((s) => ({
      projectList: [meta, ...s.projectList.filter((m) => m.id !== meta.id)].sort((a, b) => b.updatedAt - a.updatedAt),
    }));

  const write = async (body: ProjectBody, makeCurrent: boolean): Promise<ProjectStoreResult<ProjectMeta>> => {
    const result = await projectStore.put(body);
    set({ projectStoreStatus: projectStore.status() });
    if (!result.ok) return result; // a failed save never clears dirty
    upsertList(result.value);
    if (makeCurrent) {
      set({
        currentProjectId: body.id,
        currentProjectName: body.name,
        projectBaselineHash: fingerprintContent(body.content),
        dirty: false,
      });
    }
    return result;
  };

  return {
    currentProjectId: null,
    projectBaselineHash: null,
    dirty: false,
    currentProjectName: null,
    projectStoreStatus: 'unknown',
    projectList: [],
    projectNotice: null,

    setProjectNotice: (projectNotice) => set({ projectNotice }),

    refreshProjects: async () => {
      const result = await projectStore.list();
      const status = projectStore.status();
      if (!result.ok) {
        // Unavailable: keep the id (Export current session still uses it) but
        // there is no name to show — the UI renders "Unnamed project".
        set({ projectStoreStatus: status, projectList: [] });
        return;
      }
      const { currentProjectId } = get();
      const current = currentProjectId ? result.value.find((m) => m.id === currentProjectId) : undefined;
      set({
        projectStoreStatus: status,
        projectList: result.value,
        // A stored id that names no project is a lookup miss, not an error:
        // the session is simply unsaved now. The baseline goes with the id
        // (as in deleteProject): a hash belonging to a project that is no
        // longer there can never be matched again, and the untitled rule —
        // compare against the default project — is the right one from here.
        currentProjectId: current ? currentProjectId : null,
        currentProjectName: current ? current.name : null,
        ...(current ? {} : { projectBaselineHash: null }),
      });
    },

    newProject: () => install(factoryProjectContent(), { id: null, name: null }),

    openProject: async (id) => {
      const result = await projectStore.get(id);
      set({ projectStoreStatus: projectStore.status() });
      if (!result.ok) return result;
      // Keep the list in sync immediately, so a Save right after Open (with
      // no intervening refreshProjects) still finds the project's envelope.
      upsertList(toMeta(result.value));
      install(result.value.content, { id: result.value.id, name: result.value.name });
      return { ok: true, value: toMeta(result.value) };
    },

    saveProject: async () => {
      const s = get();
      if (!s.currentProjectId) {
        return { ok: false, error: 'not-found', message: 'This session is not a saved project yet.' };
      }
      if (!s.projectList.some((m) => m.id === s.currentProjectId)) {
        // projectList is transient and starts empty after a reload — a
        // persisted currentProjectId can be a real saved project that just
        // hasn't been through refreshProjects() yet. Confirm against the
        // store itself before refusing the save.
        const existing = await projectStore.get(s.currentProjectId);
        if (existing.ok === false) {
          if (existing.error === 'not-found') {
            set({ currentProjectId: null, currentProjectName: null, projectBaselineHash: null });
          }
          return existing;
        }
        upsertList(toMeta(existing.value));
      }
      return write(currentBody('', now()), true);
    },

    saveProjectAs: async (name) => {
      const body: ProjectBody = { ...makeEnvelope(name, now()), content: buildProjectContent(get()) };
      return write(body, true);
    },

    renameProject: async (id, name) => {
      const existing = await projectStore.get(id);
      if (!existing.ok) return existing;
      const renamed: ProjectBody = { ...existing.value, name, updatedAt: now() };
      const result = await projectStore.put(renamed);
      set({ projectStoreStatus: projectStore.status() });
      if (!result.ok) return result;
      upsertList(result.value);
      if (get().currentProjectId === id) set({ currentProjectName: name });
      return result;
    },

    deleteProject: async (id) => {
      const result = await projectStore.remove(id);
      set({ projectStoreStatus: projectStore.status() });
      if (!result.ok) return result;
      set((s) => ({
        projectList: s.projectList.filter((m) => m.id !== id),
        // The session's work is now stored nowhere — but stays on screen.
        ...(s.currentProjectId === id
          ? { currentProjectId: null, currentProjectName: null, projectBaselineHash: null, dirty: true }
          : {}),
      }));
      return result;
    },

    importProject: async (body, mode) => {
      const at = now();
      const toStore: ProjectBody =
        mode === 'copy'
          ? { ...body, formatVersion: PROJECT_FORMAT_VERSION, id: newProjectId(), name: `${body.name}${IMPORTED_SUFFIX}`, createdAt: at, updatedAt: at }
          : { ...body, formatVersion: PROJECT_FORMAT_VERSION };
      const result = await projectStore.put(toStore);
      set({ projectStoreStatus: projectStore.status() });
      if (result.ok === false && result.error !== 'unavailable') return result;
      if (result.ok) upsertList(result.value);
      // Storage unavailable: the file still opens, but it is nobody's project.
      install(toStore.content, result.ok ? { id: toStore.id, name: toStore.name } : { id: null, name: null });
      return { ok: true, value: result.ok ? result.value : null };
    },

    exportStoredProject: async (id) => {
      const result = await projectStore.get(id);
      set({ projectStoreStatus: projectStore.status() });
      return result;
    },

    // Precondition: requires refreshProjects() to have run since load, so
    // currentBody's `existing` lookup can find the current project's
    // envelope in `projectList` — the Project Manager does this on open.
    // Unlike saveProject, this is sync and cannot fall back to an async
    // projectStore.get(); refreshProjects() is the only place that
    // populates the list.
    buildSessionExport: (name, at) => currentBody(name, at),
  };
}
